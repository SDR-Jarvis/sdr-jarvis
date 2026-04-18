import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { qualifyReply } from "@/lib/agents/nodes/qualifier";
import { sendEmail } from "@/lib/agents/tools";
import { logger } from "@/lib/logger";
import { appendSignaturePlain, resolveSenderName } from "@/lib/email/signature";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/replies/log
 *
 * Manually log a reply from a prospect and trigger the Qualifier agent.
 * If autoSend is true and the lead is "hot", Jarvis sends the reply automatically.
 * Body: { leadId, replyContent, autoSend? }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { leadId, replyContent, autoSend } = body as {
    leadId: string;
    replyContent: string;
    autoSend?: boolean;
  };

  if (!leadId || !replyContent?.trim()) {
    return NextResponse.json({ error: "Lead ID and reply content are required" }, { status: 400 });
  }

  logger.setUser(user.id);

  const { data: lead } = await supabase
    .from("leads")
    .select("first_name, last_name, email, title, company, campaign_id")
    .eq("id", leadId)
    .eq("user_id", user.id)
    .single();

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const serviceClient = createServiceClient();

  // Find the most recent outbound interaction for this lead. `metadata` is
  // pulled too because we need the outbound's `rfcMessageId` to set
  // threading headers on any auto-reply.
  const { data: lastOutbound } = await serviceClient
    .from("interactions")
    .select("id, subject, body, campaign_id, metadata")
    .eq("lead_id", leadId)
    .eq("type", "email_outbound")
    .in("status", ["sent", "delivered"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const originalSubject = lastOutbound?.subject ?? "";
  const originalBody = lastOutbound?.body ?? "";
  const campaignId = lead.campaign_id;
  const leadName = `${lead.first_name} ${lead.last_name}`;

  logger.step("replies", `Manually logging reply from ${leadName}`);

  // Update lead status
  await serviceClient
    .from("leads")
    .update({ status: "replied" })
    .eq("id", leadId);

  // Update the outbound interaction status
  if (lastOutbound) {
    await serviceClient
      .from("interactions")
      .update({ status: "replied", replied_at: new Date().toISOString() })
      .eq("id", lastOutbound.id);
  }

  // Run the Qualifier agent
  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();
  const replySenderName = resolveSenderName(
    (prof as { full_name?: string | null } | null)?.full_name
  );

  const qualification = await qualifyReply({
    interactionId: lastOutbound?.id ?? leadId,
    leadId,
    campaignId,
    userId: user.id,
    replyContent,
    originalSubject,
    originalBody,
    leadName,
    leadTitle: lead.title,
    leadCompany: lead.company,
  });

  // Auto-send Jarvis's reply for hot leads if enabled
  let autoSent = false;
  if (
    autoSend &&
    qualification &&
    qualification.draftReply &&
    qualification.interestLevel === "hot" &&
    lead.email
  ) {
    logger.step("replies", `Auto-sending Jarvis reply to ${lead.email}`);

    // This route is called with a manually-pasted reply, so we don't have
    // the prospect's inbound Message-Id. Best-effort threading: point
    // In-Reply-To at the last outbound of ours the prospect was replying
    // to. The prospect's client then threads off the same id.
    const lastOutboundMeta = (lastOutbound?.metadata ?? {}) as {
      rfcMessageId?: string;
    };
    const priorOutboundMessageId = lastOutboundMeta.rfcMessageId;

    const replyBodySigned = appendSignaturePlain(
      qualification.draftReply,
      replySenderName
    );

    const sendResult = await sendEmail({
      to: lead.email,
      subject: `Re: ${originalSubject}`,
      body: replyBodySigned,
      inReplyTo: priorOutboundMessageId,
      references: priorOutboundMessageId,
    });

    if (sendResult.success) {
      const serviceClient2 = createServiceClient();
      await serviceClient2.from("interactions").insert({
        lead_id: leadId,
        campaign_id: campaignId,
        user_id: user.id,
        type: "email_outbound",
        status: "sent",
        subject: `Re: ${originalSubject}`,
        body: replyBodySigned,
        metadata: {
          messageId: sendResult.messageId,
          rfcMessageId: sendResult.rfcMessageId,
          auto_reply: true,
          inReplyTo: priorOutboundMessageId,
          references: priorOutboundMessageId,
        },
        sent_at: new Date().toISOString(),
      });

      await serviceClient2
        .from("leads")
        .update({ status: "qualified", last_contacted_at: new Date().toISOString() })
        .eq("id", leadId);

      await serviceClient2.from("audit_log").insert({
        user_id: user.id,
        action: "auto_reply_sent",
        resource_type: "lead",
        resource_id: leadId,
        details: {
          to: lead.email,
          lead_name: leadName,
          interest_level: qualification.interestLevel,
        },
      });

      autoSent = true;
      logger.success("replies", `Auto-reply sent to ${lead.email}`);
    }
  }

  return NextResponse.json({
    success: true,
    autoSent,
    qualification: qualification
      ? {
          interestLevel: qualification.interestLevel,
          intent: qualification.intent,
          suggestedAction: qualification.suggestedAction,
          confidence: qualification.confidence,
          draftReply: qualification.draftReply,
        }
      : null,
  });
}
