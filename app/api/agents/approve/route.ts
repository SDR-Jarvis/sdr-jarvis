import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/agents/tools";
import { logger } from "@/lib/logger";
import { canSendEmail, incrementEmailsSent } from "@/lib/subscription";
import { ensureComplianceInBody } from "@/lib/compliance";
import { countSendsTodayUtc } from "@/lib/usage-limits";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/agents/approve
 *
 * Handles three actions: approve (send now), reject (discard), edit (update draft then send).
 * Body: { approvalId, action: "approve" | "reject" | "edit", editedSubject?, editedBody? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logger.setUser(user.id);

  const body = await req.json();
  const { approvalId, action, editedSubject, editedBody } = body as {
    approvalId: string;
    action: "approve" | "reject" | "edit";
    editedSubject?: string;
    editedBody?: string;
  };

  if (!approvalId || !["approve", "reject", "edit"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Fetch the approval
  const { data: approval, error: fetchError } = await supabase
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .single();

  if (fetchError || !approval) {
    return NextResponse.json(
      { error: "Approval not found or already processed" },
      { status: 404 }
    );
  }

  // Fetch the lead for logging / sending
  const { data: lead } = await supabase
    .from("leads")
    .select("first_name, last_name, email, company")
    .eq("id", approval.lead_id)
    .single();

  const leadName = lead ? `${lead.first_name} ${lead.last_name}` : "Unknown";

  // ── REJECT ──────────────────────────────────
  if (action === "reject") {
    logger.step("approval", `User rejected draft for ${leadName}`);

    await supabase
      .from("approvals")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", approvalId);

    await supabase
      .from("interactions")
      .update({ status: "failed" })
      .eq("id", approval.interaction_id);

    await supabase
      .from("leads")
      .update({ status: "archived" })
      .eq("id", approval.lead_id);

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "approval_rejected",
      resource_type: "lead",
      resource_id: approval.lead_id,
      details: { lead_name: leadName, campaign_id: approval.campaign_id },
    });

    return NextResponse.json({ success: true, action: "rejected" });
  }

  // ── APPROVE or EDIT+APPROVE ─────────────────
  const subject =
    action === "edit" && editedSubject ? editedSubject : approval.preview_subject;
  const emailBody =
    action === "edit" && editedBody ? editedBody : approval.preview_body;

  if (!lead?.email) {
    logger.warn("approval", `No email for ${leadName} — can't send`);
    return NextResponse.json(
      { error: `No email address for ${leadName}` },
      { status: 400 }
    );
  }

  const emailCheck = await canSendEmail(user.id);
  if (!emailCheck.allowed) {
    return NextResponse.json(
      { error: emailCheck.reason },
      { status: 403 }
    );
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("email_opt_out_footer, postal_address, warmup_daily_send_cap")
    .eq("id", user.id)
    .single();

  const warmupCap =
    (profileRow as { warmup_daily_send_cap?: number } | null)
      ?.warmup_daily_send_cap ?? 20;
  const sentToday = await countSendsTodayUtc(supabase, user.id);
  if (sentToday >= warmupCap) {
    return NextResponse.json(
      {
        error: `Daily send limit reached (${warmupCap} sends per UTC day, warmup guardrail). Increase the cap in Settings → Compliance & deliverability or wait until tomorrow.`,
      },
      { status: 429 }
    );
  }

  const bodyToSend = ensureComplianceInBody(emailBody ?? "", {
    optOutLine:
      (profileRow as { email_opt_out_footer?: string } | null)
        ?.email_opt_out_footer ?? "",
    postalAddress: (profileRow as { postal_address?: string | null } | null)
      ?.postal_address,
  });

  logger.step("approval", `Sending approved email to ${lead.email}`);

  // If edited, update the approval and interaction records
  if (action === "edit") {
    await supabase
      .from("approvals")
      .update({ preview_subject: subject, preview_body: bodyToSend })
      .eq("id", approvalId);

    await supabase
      .from("interactions")
      .update({ subject, body: bodyToSend })
      .eq("id", approval.interaction_id);
  } else if (bodyToSend !== emailBody) {
    await supabase
      .from("approvals")
      .update({ preview_body: bodyToSend })
      .eq("id", approvalId);
    await supabase
      .from("interactions")
      .update({ body: bodyToSend })
      .eq("id", approval.interaction_id);
  }

  const result = await sendEmail({
    to: lead.email,
    subject: subject ?? "",
    body: bodyToSend,
  });

  // Update all records
  const serviceClient = createServiceClient();

  await serviceClient
    .from("approvals")
    .update({
      status: result.success ? "approved" : "rejected",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", approvalId);

  // Fetch existing interaction metadata to preserve sequence_step
  const { data: existingInteraction } = await serviceClient
    .from("interactions")
    .select("metadata, sequence_step")
    .eq("id", approval.interaction_id)
    .single();

  const existingMeta = (existingInteraction?.metadata ?? {}) as Record<string, unknown>;

  await serviceClient
    .from("interactions")
    .update({
      status: result.success ? "sent" : "failed",
      sent_at: result.success ? new Date().toISOString() : null,
      metadata: { ...existingMeta, messageId: result.messageId, error: result.error },
    })
    .eq("id", approval.interaction_id);

  await serviceClient
    .from("leads")
    .update({
      status: result.success ? "sent" : "bounced",
      last_contacted_at: result.success ? new Date().toISOString() : undefined,
    })
    .eq("id", approval.lead_id);

  await serviceClient.from("audit_log").insert({
    user_id: user.id,
    action: result.success ? "email_sent" : "email_failed",
    resource_type: "lead",
    resource_id: approval.lead_id,
    details: {
      lead_name: leadName,
      to: lead.email,
      subject,
      messageId: result.messageId,
      error: result.error,
      edited: action === "edit",
    },
  });

  if (result.success) {
    await incrementEmailsSent(user.id);
    logger.success("approval", `Email sent to ${lead.email}`);
  } else {
    logger.error("approval", `Send failed: ${result.error}`);
  }

  return NextResponse.json({
    success: result.success,
    action: result.success ? "sent" : "failed",
    error: result.error,
    messageId: result.messageId,
  });
}
