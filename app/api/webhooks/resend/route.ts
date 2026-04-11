import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { qualifyReply } from "@/lib/agents/nodes/qualifier";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    headers?: { name: string; value: string }[];
    click?: { link: string };
  };
}

/**
 * POST /api/webhooks/resend
 *
 * Handles Resend webhook events: delivered, opened, bounced, replied, complained.
 * Matches events to interactions via the messageId stored in interactions.metadata.
 */
export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (webhookSecret) {
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: "Missing webhook headers" }, { status: 401 });
    }

    try {
      const { Webhook } = await import("svix");
      const wh = new Webhook(webhookSecret);
      const body = await req.text();
      wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });

      const payload: ResendWebhookPayload = JSON.parse(body);
      return await handleEvent(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("webhook", `Signature verification failed: ${msg}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // No webhook secret configured — accept without verification (dev mode)
  try {
    const payload: ResendWebhookPayload = await req.json();
    return await handleEvent(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("webhook", `Webhook parse error: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

async function handleEvent(payload: ResendWebhookPayload): Promise<NextResponse> {
  const { type, data } = payload;
  const messageId = data.email_id;

  if (!messageId) {
    return NextResponse.json({ error: "No email_id in payload" }, { status: 400 });
  }

  logger.info("webhook", `Resend event: ${type} for message ${messageId}`);

  const supabase = createServiceClient();

  // Find the interaction by messageId in metadata
  const { data: interaction, error: findError } = await supabase
    .from("interactions")
    .select("id, lead_id, campaign_id, user_id, subject, body, sequence_step, status")
    .contains("metadata", { messageId })
    .limit(1)
    .single();

  if (findError || !interaction) {
    logger.warn("webhook", `No interaction found for messageId ${messageId}`);
    return NextResponse.json({ received: true, matched: false });
  }

  switch (type) {
    case "email.delivered": {
      await supabase
        .from("interactions")
        .update({ status: "delivered" })
        .eq("id", interaction.id)
        .in("status", ["sent"]);

      logger.success("webhook", `Email delivered: ${messageId}`);
      break;
    }

    case "email.opened": {
      await supabase
        .from("interactions")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", interaction.id);

      await supabase.from("audit_log").insert({
        user_id: interaction.user_id,
        action: "email_opened",
        resource_type: "interaction",
        resource_id: interaction.id,
        details: { lead_id: interaction.lead_id, message_id: messageId },
      });

      logger.info("webhook", `Email opened: ${messageId}`);
      break;
    }

    case "email.bounced": {
      await supabase
        .from("interactions")
        .update({ status: "bounced" })
        .eq("id", interaction.id);

      await supabase
        .from("leads")
        .update({ status: "bounced" })
        .eq("id", interaction.lead_id);

      await supabase.from("audit_log").insert({
        user_id: interaction.user_id,
        action: "email_bounced",
        resource_type: "lead",
        resource_id: interaction.lead_id,
        details: { message_id: messageId },
      });

      logger.warn("webhook", `Email bounced: ${messageId}`);
      break;
    }

    case "email.complained": {
      await supabase
        .from("leads")
        .update({ status: "not_interested" })
        .eq("id", interaction.lead_id);

      await supabase.from("audit_log").insert({
        user_id: interaction.user_id,
        action: "email_complaint",
        resource_type: "lead",
        resource_id: interaction.lead_id,
        details: { message_id: messageId },
      });

      logger.warn("webhook", `Spam complaint for: ${messageId}`);
      break;
    }

    case "email.replied": {
      await supabase
        .from("interactions")
        .update({
          status: "replied",
          replied_at: new Date().toISOString(),
        })
        .eq("id", interaction.id);

      await supabase
        .from("leads")
        .update({ status: "replied" })
        .eq("id", interaction.lead_id);

      // Fetch lead details for the qualifier
      const { data: lead } = await supabase
        .from("leads")
        .select("first_name, last_name, title, company")
        .eq("id", interaction.lead_id)
        .single();

      const replyContent = extractReplyContent(data);

      if (lead && replyContent) {
        await qualifyReply({
          interactionId: interaction.id,
          leadId: interaction.lead_id,
          campaignId: interaction.campaign_id,
          userId: interaction.user_id,
          replyContent,
          originalSubject: interaction.subject ?? "",
          originalBody: interaction.body ?? "",
          leadName: `${lead.first_name} ${lead.last_name}`,
          leadTitle: lead.title,
          leadCompany: lead.company,
        });
      }

      await supabase.from("audit_log").insert({
        user_id: interaction.user_id,
        action: "email_reply_received",
        resource_type: "lead",
        resource_id: interaction.lead_id,
        details: {
          message_id: messageId,
          lead_name: lead ? `${lead.first_name} ${lead.last_name}` : "Unknown",
        },
      });

      logger.success("webhook", `Reply received for: ${messageId}`);
      break;
    }

    default: {
      logger.info("webhook", `Unhandled event type: ${type}`);
    }
  }

  return NextResponse.json({ received: true, type, matched: true });
}

function extractReplyContent(data: ResendWebhookPayload["data"]): string | null {
  // Resend may include reply content in headers or the payload varies.
  // For now, return a placeholder — the actual reply content extraction
  // depends on how Resend delivers reply data in their webhook payload.
  // In production, this would parse the inbound email body.
  const subject = data.subject ?? "";
  return `[Reply to: ${subject}] — Reply content received via Resend webhook. Check your inbox for the full message.`;
}
