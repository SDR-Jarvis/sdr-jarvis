import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { qualifyReply } from "@/lib/agents/nodes/qualifier";
import { logger } from "@/lib/logger";
import { parseInboundReply } from "@/lib/email/reply-parser";
import {
  fetchReceivedEmail,
  ResendReceivingError,
} from "@/lib/email/resend-receiving";
import { extractCandidateIds } from "@/lib/email/message-id";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Union of the Resend webhook events we care about.
 *
 * Send-side events (`email.delivered` / `opened` / `bounced` / `complained`)
 * carry only the outbound send's `email_id`, which we stored on the
 * originating interaction at send time.
 *
 * `email.received` is an inbound event: `data.email_id` identifies the
 * *received* message and is not stored anywhere yet. We fetch the full
 * payload via the Received Emails API and thread it back to an outbound
 * interaction via the `In-Reply-To` / `References` headers.
 *
 * Ref: https://www.resend.com/docs/webhooks/event-types
 */
interface ResendSendEvent {
  type:
    | "email.delivered"
    | "email.opened"
    | "email.bounced"
    | "email.complained"
    | "email.replied";
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

interface ResendReceivedEvent {
  type: "email.received";
  created_at: string;
  data: {
    email_id: string;
    created_at: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    message_id?: string;
  };
}

type ResendWebhookPayload = ResendSendEvent | ResendReceivedEvent;

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
      return await handleEvent(JSON.parse(body));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("webhook", `Signature verification failed: ${msg}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // No webhook secret configured — accept without verification (dev mode).
  try {
    return await handleEvent(await req.json());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("webhook", `Webhook parse error: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

async function handleEvent(payload: ResendWebhookPayload): Promise<NextResponse> {
  logger.info("webhook", `Resend event: ${payload.type}`);

  if (payload.type === "email.received") {
    return await handleInbound(payload);
  }

  return await handleSendEvent(payload);
}

// ─── Send-side events (delivered / opened / bounced / complained / replied) ─

async function handleSendEvent(event: ResendSendEvent): Promise<NextResponse> {
  const messageId = event.data.email_id;
  if (!messageId) {
    return NextResponse.json({ error: "No email_id in payload" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: interaction, error: findError } = await supabase
    .from("interactions")
    .select("id, lead_id, campaign_id, user_id, subject, body, sequence_step, status")
    .contains("metadata", { messageId })
    .limit(1)
    .single();

  if (findError || !interaction) {
    logger.warn("webhook", `No interaction found for send event ${messageId}`);
    return NextResponse.json({ received: true, matched: false });
  }

  switch (event.type) {
    case "email.delivered": {
      await supabase
        .from("interactions")
        .update({ status: "delivered" })
        .eq("id", interaction.id)
        .in("status", ["sent"]);
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
      break;
    }

    case "email.replied": {
      // Legacy / alternate path: some Resend configurations surface the fact
      // of a reply on the send record before (or instead of) firing
      // `email.received`. We only flip the outbound interaction's state here
      // and let `email.received` do the heavy lifting of parsing + qualifying.
      await supabase
        .from("interactions")
        .update({ status: "replied", replied_at: new Date().toISOString() })
        .eq("id", interaction.id);
      break;
    }
  }

  return NextResponse.json({ received: true, type: event.type, matched: true });
}

// ─── Inbound: email.received ────────────────────────────────────────────────

async function handleInbound(event: ResendReceivedEvent): Promise<NextResponse> {
  const receivedEmailId = event.data.email_id;
  if (!receivedEmailId) {
    return NextResponse.json({ error: "No email_id in payload" }, { status: 400 });
  }

  let email;
  try {
    email = await fetchReceivedEmail(receivedEmailId);
  } catch (err) {
    if (err instanceof ResendReceivingError) {
      logger.error("webhook", `Could not fetch received email ${receivedEmailId}: ${err.message}`);
      // Return 500 so Resend retries — the body may not be ready immediately.
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }

  const parsed = parseInboundReply(email);
  const supabase = createServiceClient();

  const interaction = await matchOutboundInteraction(supabase, email);
  if (!interaction) {
    logger.warn(
      "webhook",
      `Inbound ${receivedEmailId} from ${email.from} did not match any outbound interaction`
    );
    return NextResponse.json({ received: true, matched: false });
  }

  await supabase
    .from("interactions")
    .update({ status: "replied", replied_at: new Date().toISOString() })
    .eq("id", interaction.id);

  await supabase.from("audit_log").insert({
    user_id: interaction.user_id,
    action: "email_reply_received",
    resource_type: "lead",
    resource_id: interaction.lead_id,
    details: {
      received_email_id: receivedEmailId,
      is_auto_reply: parsed.isAutoReply,
      signature_removed: parsed.signatureRemoved,
    },
  });

  // Auto-replies (OOO, vendor bots, vacation responders) should update the
  // outbound interaction's state but must not trigger the qualifier LLM or
  // create a new `email_reply` row — they aren't real replies from the lead.
  if (parsed.isAutoReply) {
    logger.info("webhook", `Skipping qualifier for auto-reply from ${email.from}`);
    return NextResponse.json({
      received: true,
      matched: true,
      auto_reply: true,
    });
  }

  if (!parsed.cleanText) {
    logger.warn("webhook", `Inbound ${receivedEmailId} had no extractable reply text`);
    return NextResponse.json({ received: true, matched: true, empty: true });
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("first_name, last_name, title, company")
    .eq("id", interaction.lead_id)
    .single();

  if (lead) {
    await supabase
      .from("leads")
      .update({ status: "replied" })
      .eq("id", interaction.lead_id);

    await qualifyReply({
      interactionId: interaction.id,
      leadId: interaction.lead_id,
      campaignId: interaction.campaign_id,
      userId: interaction.user_id,
      replyContent: parsed.cleanText,
      originalSubject: interaction.subject ?? "",
      originalBody: interaction.body ?? "",
      leadName: `${lead.first_name} ${lead.last_name}`,
      leadTitle: lead.title,
      leadCompany: lead.company,
    });
  }

  logger.success("webhook", `Reply processed for interaction ${interaction.id}`);
  return NextResponse.json({ received: true, matched: true, auto_reply: false });
}

// ─── Inbound → outbound interaction matching ────────────────────────────────

/**
 * Resolve an inbound email back to the outbound interaction it's replying to.
 *
 * Thin IO wrapper: candidate Message-Id extraction is delegated to the pure
 * `extractCandidateIds` helper in `lib/email/message-id.ts` (covered by unit
 * tests), and this function only handles the Supabase lookup.
 *
 * Strategy, in order of reliability:
 *   1. RFC 822 `In-Reply-To` header — points at the Message-Id of the
 *      outbound send, which we generated ourselves in `sendEmail` and stored
 *      on `interactions.metadata.rfcMessageId`.
 *   2. `References` header tokens — same lookup, useful when a thread was
 *      forwarded through a list server that rewrote `In-Reply-To`.
 *
 * We intentionally do NOT fall back to "same sender + subject startsWith
 * 'Re:'" — it's too easy to cross-thread between different leads.
 */
async function matchOutboundInteraction(
  supabase: ReturnType<typeof createServiceClient>,
  email: Pick<Awaited<ReturnType<typeof fetchReceivedEmail>>, "headers">
) {
  const candidates = extractCandidateIds(email.headers);

  for (const rfcMessageId of candidates) {
    const { data } = await supabase
      .from("interactions")
      .select("id, lead_id, campaign_id, user_id, subject, body")
      .contains("metadata", { rfcMessageId })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}
