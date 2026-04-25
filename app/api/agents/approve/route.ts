import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/agents/tools";
import { logger } from "@/lib/logger";
import { canSendEmail, incrementEmailsSent } from "@/lib/subscription";
import {
  ensureComplianceInBody,
  splitMainAndComplianceBlock,
} from "@/lib/compliance";
import { appendSignaturePlain, resolveSenderName } from "@/lib/email/signature";
import { sendSlackNotification } from "@/lib/slack";
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

  const { data: interactionRow } = await supabase
    .from("interactions")
    .select("metadata, sequence_step, ai_draft_subject, ai_draft_body")
    .eq("id", approval.interaction_id)
    .maybeSingle();

  const { data: profileRow } = await supabase
    .from("profiles")
    .select(
      "compliance_opt_out_line, compliance_postal_address, warmup_daily_send_cap, full_name, sending_mode, sending_domain"
    )
    .eq("id", user.id)
    .single();

  // ── APPROVE or EDIT+APPROVE ─────────────────
  const subject =
    action === "edit" && editedSubject ? editedSubject : approval.preview_subject;
  const emailBody =
    action === "edit" && editedBody ? editedBody : approval.preview_body;

  const extProfile = profileRow as {
    sending_mode?: string | null;
    sending_domain?: string | null;
    full_name?: string | null;
  } | null;
  const sendingMode = extProfile?.sending_mode ?? "shared";
  const sendingDomain = extProfile?.sending_domain?.trim();
  const displayName = extProfile?.full_name?.trim() || "Hello";
  const fromOverride =
    sendingMode === "custom" && sendingDomain
      ? `${displayName} <hello@${sendingDomain}>`
      : undefined;

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

  const warmupCap =
    (profileRow as { warmup_daily_send_cap?: number } | null)
      ?.warmup_daily_send_cap ?? 20;
  const sentToday = await countSendsTodayUtc(supabase, user.id);
  if (sentToday >= warmupCap) {
    return NextResponse.json(
      {
        error: `Daily send limit reached (${warmupCap} sends per UTC day, warmup guardrail). Increase the cap in Settings → Legal footer or wait until tomorrow.`,
      },
      { status: 429 }
    );
  }

  const senderName = resolveSenderName(
    (profileRow as { full_name?: string | null } | null)?.full_name
  );
  const { main: mainBeforeSend, compliance: complianceBlock } =
    splitMainAndComplianceBlock(emailBody ?? "");
  const mainSigned = appendSignaturePlain(mainBeforeSend, senderName);
  const mergedBody = complianceBlock
    ? `${mainSigned.trimEnd()}${complianceBlock}`
    : mainSigned;

  const extCompliance = profileRow as {
    compliance_opt_out_line?: string | null;
    compliance_postal_address?: string | null;
  } | null;
  const bodyToSend = ensureComplianceInBody(mergedBody, {
    optOutLine: extCompliance?.compliance_opt_out_line?.trim() ?? "",
    postalAddress: extCompliance?.compliance_postal_address ?? null,
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

  const aiSub =
    (interactionRow as { ai_draft_subject?: string | null } | null)
      ?.ai_draft_subject ?? approval.preview_subject;
  const aiBody =
    (interactionRow as { ai_draft_body?: string | null } | null)?.ai_draft_body ??
    approval.preview_body;
  const subjectEdited =
    (subject ?? "").trim() !== (aiSub ?? "").trim();
  const bodyEdited = (emailBody ?? "").trim() !== (aiBody ?? "").trim();
  const wasEdited = action === "edit" || subjectEdited || bodyEdited;
  const editDeltaChars = Math.abs(
    ((subject ?? "") + (bodyToSend ?? "")).length -
      ((String(aiSub ?? "")) + (String(aiBody ?? ""))).length
  );

  const result = await sendEmail({
    to: lead.email,
    subject: subject ?? "",
    body: bodyToSend,
    fromOverride,
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

  const existingMeta = (interactionRow?.metadata ?? {}) as Record<string, unknown>;

  await serviceClient
    .from("interactions")
    .update({
      status: result.success ? "sent" : "failed",
      sent_at: result.success ? new Date().toISOString() : null,
      subject: subject ?? undefined,
      body: bodyToSend,
      human_approved_subject: subject ?? null,
      human_approved_body: bodyToSend,
      was_edited: wasEdited,
      edit_delta_chars: editDeltaChars,
      metadata: {
        ...existingMeta,
        messageId: result.messageId,
        rfcMessageId: result.rfcMessageId,
        error: result.error,
      },
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

    const { data: priorSend } = await serviceClient
      .from("profiles")
      .select("first_email_sent_at")
      .eq("id", user.id)
      .single();
    if (!(priorSend as { first_email_sent_at?: string | null } | null)?.first_email_sent_at) {
      await serviceClient
        .from("profiles")
        .update({ first_email_sent_at: new Date().toISOString() })
        .eq("id", user.id);
    }

    const { data: dupSlack } = await serviceClient
      .from("audit_log")
      .select("id")
      .eq("action", "slack_email_sent_notify")
      .eq("resource_id", approvalId)
      .limit(1)
      .maybeSingle();

    if (!dupSlack) {
      const { data: campRow } = await serviceClient
        .from("campaigns")
        .select("name")
        .eq("id", approval.campaign_id)
        .single();
      const campaignLabel = campRow?.name ?? "Campaign";
      void sendSlackNotification(
        `✅ 1 email(s) sent · Campaign: ${campaignLabel}`
      );
      await serviceClient.from("audit_log").insert({
        user_id: user.id,
        action: "slack_email_sent_notify",
        resource_type: "approval",
        resource_id: approvalId,
        details: { campaign_id: approval.campaign_id },
      });
    }
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
