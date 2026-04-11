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

const QUALIFIER_PROMPT = `You are an expert sales reply analyst. Your job is to read a prospect's reply to a cold email and classify it precisely.

ORIGINAL OUTREACH:
Subject: {OUTREACH_SUBJECT}
Body: {OUTREACH_BODY}

PROSPECT: {LEAD_NAME}{LEAD_TITLE}{LEAD_COMPANY}

REPLY:
{REPLY_CONTENT}

Analyze this reply and return ONLY valid JSON:
{
  "interestLevel": "hot" | "warm" | "cold" | "not_interested",
  "intent": "interested" | "wants_more_info" | "objection" | "meeting_request" | "unsubscribe" | "auto_reply" | "out_of_office",
  "suggestedAction": "book_meeting" | "send_info" | "handle_objection" | "archive" | "follow_up_later" | "wait",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence: why you classified it this way.",
  "draftReply": "A suggested reply (2-3 sentences) if action is book_meeting, send_info, or handle_objection. null if archive/wait/follow_up_later."
}

Classification guide:
- "hot" + "meeting_request" → they asked for a call/meeting → suggestedAction: "book_meeting"
- "hot" + "interested" → explicit positive interest → suggestedAction: "book_meeting"
- "warm" + "wants_more_info" → curious but not committed → suggestedAction: "send_info"
- "warm" + "objection" → raised concern but still engaged → suggestedAction: "handle_objection"
- "cold" + "auto_reply" or "out_of_office" → automated response → suggestedAction: "wait"
- "not_interested" + "unsubscribe" → asked to stop → suggestedAction: "archive"
- If uncertain, err on the side of "warm" + "follow_up_later"`;

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
        metadata: {
          qualification: result,
          original_interaction_id: params.interactionId,
        },
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
