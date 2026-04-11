import { AIMessage } from "@langchain/core/messages";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import type { JarvisStateType, DraftMessage } from "../state";

const INITIAL_OUTREACH_PROMPT = `You write cold emails for B2B sales. You are exceptionally good at it because you follow these rules without exception:

FORMAT (non-negotiable):
- 3 to 5 sentences total. Not 6. Not "a short paragraph." Three to five sentences.
- Subject line: 4-7 words. Lowercase unless proper noun. No punctuation tricks, no emoji, no clickbait.
- No greeting line ("Hi [Name]," is fine as a salutation, but it doesn't count as a sentence).
- No "I hope this finds you well." No "Just reaching out." No "Quick question." Ever.

STRUCTURE:
Sentence 1 — THE HOOK: Reference something SPECIFIC about them. A recent post, a product launch, a hiring pattern, a tech decision. This proves you did your homework. If research is thin, reference their role + company mission.
Sentence 2-3 — THE BRIDGE: Connect their situation to your value. One clear, relevant benefit. Not a feature list. Show you understand their world.
Sentence 4 (optional) — PROOF: A brief credibility signal. "We helped [similar company] do X" or "I've been building in [their space] for Y years."
Final sentence — THE ASK: Soft, low-friction. Good: "Worth a 15-min call this week?" or "Open to a quick chat?" Bad: "Book a demo now" or "When are you free for a 30-minute deep dive?"

TONE:
- Sound like a sharp peer, not a sales rep. Think: smart founder emailing another founder.
- Warm but not sycophantic. Confident but not pushy.
- If humor fits naturally, fine. Don't force it.
- Write at a 7th-grade reading level. Short words, short sentences.

Return ONLY valid JSON (no markdown, no explanation outside the JSON):
{
  "subject": "the subject line here",
  "body": "Hi [FirstName],\\n\\nThe full email body here. Each sentence on its own line separated by \\n\\n for readability.",
  "channel": "email",
  "personalizationNotes": "One sentence: what research insight drove this angle and why it should resonate."
}`;

const FOLLOW_UP_PROMPT = `You write follow-up cold emails. This is step {STEP} of {TOTAL_STEPS} in a sequence.

CRITICAL RULES:
- This is a FOLLOW-UP, not a new cold email. Reference the previous email naturally.
- Step 2: Light bump. 2-3 sentences max. "Floating this back up" energy. Add ONE new angle or insight not in the original.
- Step 3+: Final touch. 2-3 sentences max. Graceful close. "Totally understand if timing isn't right" energy. Leave the door open.
- NEVER re-introduce yourself or your company in detail.
- NEVER guilt-trip ("I haven't heard back...", "Following up again...").
- Subject line: "Re: {PREV_SUBJECT}" OR a fresh 3-5 word subject.

PREVIOUS EMAIL:
Subject: {PREV_SUBJECT}
Body: {PREV_BODY}

TONE:
- Breezy, not needy. You're busy too.
- One new value add or angle if possible.
- Short. Really short. 2-3 sentences.

Return ONLY valid JSON:
{
  "subject": "the subject line",
  "body": "Hi [FirstName],\\n\\nThe follow-up body here.",
  "channel": "email",
  "personalizationNotes": "Why this follow-up angle should resonate."
}`;

export async function outreachNode(
  state: JarvisStateType
): Promise<Partial<JarvisStateType>> {
  const lead = state.leads[state.currentLeadIndex];
  const research = state.researchData;

  if (!lead || !research) {
    logger.error("outreach", "Missing lead or research data");
    return { errors: ["Outreach: missing lead or research data"] };
  }

  const name = `${lead.firstName} ${lead.lastName}`;
  const isFollowUp = state.sequenceStep > 1 && state.previousEmail;

  logger.step(
    "outreach",
    isFollowUp
      ? `Drafting follow-up step ${state.sequenceStep} for ${name}`
      : `Drafting email for ${name} (score: ${research.score}/100)`
  );

  const llm = createLLMClient({ temperature: 0.85, maxTokens: 600 });

  // Build a tight context — only feed what's useful
  const context = [
    `PROSPECT: ${lead.firstName} ${lead.lastName}`,
    lead.title && `Title: ${lead.title}`,
    lead.company && `Company: ${lead.company}`,
    `\nRESEARCH BRIEF:`,
    research.summary,
    research.recentActivity !== "None found" && `Recent: ${research.recentActivity}`,
    research.painPoints.length && `Pain points: ${research.painPoints.join("; ")}`,
    research.talkingPoints.length && `Angles: ${research.talkingPoints.join("; ")}`,
    research.techStack.length && `Tech: ${research.techStack.join(", ")}`,
    research.fundingInfo && `Funding: ${research.fundingInfo}`,
  ]
    .filter(Boolean)
    .join("\n");

  let systemPrompt: string;

  if (isFollowUp && state.previousEmail) {
    systemPrompt = FOLLOW_UP_PROMPT
      .replace("{STEP}", String(state.sequenceStep))
      .replace("{TOTAL_STEPS}", "3")
      .replace(/\{PREV_SUBJECT\}/g, state.previousEmail.subject)
      .replace("{PREV_BODY}", state.previousEmail.body);
  } else {
    systemPrompt = INITIAL_OUTREACH_PROMPT;
  }

  try {
    const response = await llm.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("outreach", "LLM returned non-JSON", { preview: text.slice(0, 200) });
      return { errors: ["Outreach: LLM returned non-JSON"] };
    }

    const draft: DraftMessage = JSON.parse(jsonMatch[0]);

    // Validate: reject if too long
    const sentenceCount = draft.body
      .split(/[.!?]\s/)
      .filter((s) => s.trim().length > 10).length;

    if (sentenceCount > 7) {
      logger.warn("outreach", `Draft too long (${sentenceCount} sentences), asking for revision`);
      const revision = await llm.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: context },
        {
          role: "assistant",
          content: text,
        },
        {
          role: "user",
          content: "This is too long. Cut it to exactly 3-4 sentences. Same angle, half the words. Return the same JSON format.",
        },
      ]);

      const revText =
        typeof revision.content === "string"
          ? revision.content
          : JSON.stringify(revision.content);
      const revMatch = revText.match(/\{[\s\S]*\}/);
      if (revMatch) {
        const revised: DraftMessage = JSON.parse(revMatch[0]);
        logger.success("outreach", `Revised draft for ${name}: "${revised.subject}"`);
        return buildDraftResult(lead.firstName, revised);
      }
    }

    logger.success("outreach", `Draft ready for ${name}: "${draft.subject}"`);
    return buildDraftResult(lead.firstName, draft);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("outreach", `Draft failed for ${name}: ${msg}`);
    return {
      errors: [`Outreach error: ${msg}`],
      messages: [
        new AIMessage(`Couldn't draft for ${lead.firstName}. ${msg}. Want me to retry?`),
      ],
    };
  }
}

function buildDraftResult(
  firstName: string,
  draft: DraftMessage
): Partial<JarvisStateType> {
  return {
    draftMessage: draft,
    messages: [
      new AIMessage(
        `Draft for ${firstName}:\n\n` +
          `**Subject:** ${draft.subject}\n\n` +
          `${draft.body}\n\n` +
          `---\n_Angle: ${draft.personalizationNotes}_\n\n` +
          `Awaiting your call, sir. Approve, edit, or reject.`
      ),
    ],
  };
}
