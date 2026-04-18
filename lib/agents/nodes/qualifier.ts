import { createLLMClient } from "@/lib/llm";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export type InterestLevel = "hot" | "warm" | "cold" | "not_interested";
export type ReplyIntent =
  | "interested"
  | "wants_more_info"
  | "objection"
  | "meeting_request"
  | "unsubscribe"
  | "auto_reply"
  | "out_of_office";
export type SuggestedAction =
  | "book_meeting"
  | "send_info"
  | "handle_objection"
  | "archive"
  | "follow_up_later"
  | "wait";

export interface QualificationResult {
  interestLevel: InterestLevel;
  intent: ReplyIntent;
  suggestedAction: SuggestedAction;
  confidence: number;
  reasoning: string;
  draftReply: string | null;
}

const QUALIFIER_PROMPT = `You are an expert sales reply analyst AND a sharp conversationalist. Your job is twofold:
1. Classify the prospect's reply precisely.
2. Draft a reply that sounds like a REAL HUMAN wrote it — not a bot, not a template.

ORIGINAL OUTREACH:
Subject: {OUTREACH_SUBJECT}
Body: {OUTREACH_BODY}

PROSPECT: {LEAD_NAME}{LEAD_TITLE}{LEAD_COMPANY}

THEIR REPLY:
{REPLY_CONTENT}

Analyze and return ONLY valid JSON:
{
  "interestLevel": "hot" | "warm" | "cold" | "not_interested",
  "intent": "interested" | "wants_more_info" | "objection" | "meeting_request" | "unsubscribe" | "auto_reply" | "out_of_office",
  "suggestedAction": "book_meeting" | "send_info" | "handle_objection" | "archive" | "follow_up_later" | "wait",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence: why you classified it this way.",
  "draftReply": "Your suggested reply OR null"
}

DRAFT REPLY RULES (critical):
- Write as the sender, responding to their specific words. Reference what THEY said.
- 2-3 sentences MAX. Match their energy — if they're casual, be casual. If they're formal, be formal.
- If they asked for a call: propose 2-3 specific time slots this week. "How about Tuesday 2pm or Thursday 10am PT?"
- If they want info: give one concrete detail, then offer to hop on a call.
- If they have an objection: acknowledge it genuinely, address it in one sentence, pivot to value.
- NEVER use: "Thank you for your interest", "I appreciate you getting back to me", "I'd be happy to..."
- Sound like a busy founder replying from their phone, not a sales bot.
- If action is archive/wait/follow_up_later, set draftReply to null.

Classification guide:
- "hot" + "meeting_request" → they asked for a call/meeting → "book_meeting"
- "hot" + "interested" → explicit positive interest → "book_meeting"
- "warm" + "wants_more_info" → curious but not committed → "send_info"
- "warm" + "objection" → raised concern but still engaged → "handle_objection"
- "cold" + "auto_reply" or "out_of_office" → automated → "wait"
- "not_interested" + "unsubscribe" → asked to stop → "archive"
- If uncertain, err toward "warm" + "follow_up_later"`;

/**
 * Analyzes a reply email and stores the qualification result.
 * Called from the Resend webhook when a reply is detected.
 */
export async function qualifyReply(params: {
  interactionId: string;
  leadId: string;
  campaignId: string;
  userId: string;
  replyContent: string;
  originalSubject: string;
  originalBody: string;
  leadName: string;
  leadTitle: string | null;
  leadCompany: string | null;
  /**
   * RFC 822 `Message-Id` of the inbound email, in canonical `<id@domain>`
   * form. Persisted on the `email_reply` row so outbound replies can set
   * `In-Reply-To` correctly without re-fetching from Resend.
   */
  inboundMessageId?: string | null;
  /**
   * The inbound email's `References` header, preserved verbatim for the
   * RFC 5322 References-builder rule on outbound replies.
   */
  inboundReferences?: string | null;
  /**
   * Resend's internal `email_id` for the received message. Used only as a
   * fallback by `loadReplyThreadContext` when the cached fields above are
   * missing (legacy rows, or inbounds that arrived with a null message_id).
   */
  resendEmailId?: string | null;
}): Promise<QualificationResult | null> {
  logger.setUser(params.userId);
  logger.step("qualifier", `Analyzing reply for ${params.leadName}`);

  try {
    const prompt = QUALIFIER_PROMPT
      .replace("{OUTREACH_SUBJECT}", params.originalSubject)
      .replace("{OUTREACH_BODY}", params.originalBody)
      .replace("{LEAD_NAME}", params.leadName)
      .replace("{LEAD_TITLE}", params.leadTitle ? `, ${params.leadTitle}` : "")
      .replace("{LEAD_COMPANY}", params.leadCompany ? ` at ${params.leadCompany}` : "")
      .replace("{REPLY_CONTENT}", params.replyContent);

    const llm = createLLMClient({ temperature: 0.3, maxTokens: 500 });
    const response = await llm.invoke([
      { role: "system", content: prompt },
      { role: "user", content: "Classify this reply." },
    ]);

    const text = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("qualifier", "LLM returned non-JSON");
      return null;
    }

    const result: QualificationResult = JSON.parse(jsonMatch[0]);

    const supabase = createServiceClient();

    const replyMetadata: Record<string, unknown> = {
      qualification: result,
      original_interaction_id: params.interactionId,
    };
    if (params.inboundMessageId) replyMetadata.inboundMessageId = params.inboundMessageId;
    if (params.inboundReferences) replyMetadata.inboundReferences = params.inboundReferences;
    if (params.resendEmailId) replyMetadata.resendEmailId = params.resendEmailId;

    const replyInteraction = await supabase
      .from("interactions")
      .insert({
        lead_id: params.leadId,
        campaign_id: params.campaignId,
        user_id: params.userId,
        type: "email_reply",
        status: "replied",
        subject: `Re: ${params.originalSubject}`,
        body: params.replyContent,
        metadata: replyMetadata,
        replied_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const newLeadStatus = mapInterestToLeadStatus(result.interestLevel, result.intent);
    await supabase
      .from("leads")
      .update({ status: newLeadStatus })
      .eq("id", params.leadId);

    await supabase.from("audit_log").insert({
      user_id: params.userId,
      action: "reply_qualified",
      resource_type: "lead",
      resource_id: params.leadId,
      details: {
        lead_name: params.leadName,
        interest_level: result.interestLevel,
        intent: result.intent,
        suggested_action: result.suggestedAction,
        confidence: result.confidence,
      },
    });

    logger.success(
      "qualifier",
      `${params.leadName}: ${result.interestLevel}/${result.intent} → ${result.suggestedAction} (${Math.round(result.confidence * 100)}% confident)`
    );

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("qualifier", `Qualification failed for ${params.leadName}: ${msg}`);
    return null;
  }
}

function mapInterestToLeadStatus(
  interest: InterestLevel,
  intent: ReplyIntent
): string {
  if (intent === "unsubscribe") return "not_interested";
  if (intent === "meeting_request") return "meeting_booked";
  if (interest === "hot") return "qualified";
  if (interest === "warm") return "replied";
  if (interest === "not_interested") return "not_interested";
  return "replied";
}
