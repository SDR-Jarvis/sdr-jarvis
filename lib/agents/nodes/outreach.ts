import { AIMessage } from "@langchain/core/messages";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { appendSignaturePlain } from "@/lib/email/signature";
import { createServiceClient } from "@/lib/supabase/server";
import type { JarvisStateType, DraftMessage, ResearchData } from "../state";

const OUTREACH_SYSTEM_PROMPT = `
You are writing a cold email for a B2B SaaS founder
reaching out to another technical founder or 
decision-maker at a SaaS company.

HARD RULES — violating any of these is failure:
1. Under 120 words total (not counting signature)
2. No bullet points
3. No bold text  
4. No "Hope this finds you well" or any variant
5. No "I came across your profile"
6. No "Just floating this back up" or follow-up framing
7. No "I believe this could" or "I think this might"
   (weasel words — either it's relevant or it isn't)
8. No aggressive CTA like "book a 30-min call"
9. Subject line max 7 words, no clickbait

EMAIL STRUCTURE (two parts, separated by one blank line):

PART 1 — WARM OPENER (2 sentences max):
Reference the opener_signal from research data directly.
Write it as an observation, not a compliment.
BAD: "I was really impressed by your recent launch"
GOOD: "Saw you shipped remote-write compatibility last 
month — staying wire-compatible while solving cardinality 
underneath is a cleaner migration path than most teams take."

The opener must make the reader think:
"This person actually looked at what I'm building."

If confidence is low and fallback_used is true:
Reference their company_differentiation instead.
Still write it as an observation, not a compliment.

PART 2 — THE PITCH + CTA (3-4 sentences):
Sentence 1: What the sender does. Plain language. 
  No buzzwords. No "leverage AI to synergize."
Sentence 2: Why it is specifically relevant to THIS person.
  Reference their likely_pain_point from research.
  Or reference their company stage/focus.
Sentence 3 (optional): One concrete outcome or number
  if the sender has proof. Skip if no proof exists.
  Do not invent numbers.
Sentence 4: Soft CTA. A genuine question.
  "Worth a quick look?" or "Would this fit what 
  you're building?" or "Open to a 10-min chat?"
  NOT "Can we schedule time on your calendar?"

SIGN-OFF:
First name only. Then the configured sign-off line.

RESEARCH DATA:
opener_signal: {opener_signal}
opener_type: {opener_type}
company_differentiation: {company_differentiation}
likely_pain_point: {likely_pain_point}
confidence: {confidence}
fallback_used: {fallback_used}

SENDER CONTEXT:
Name: {sender_name}
Company: {sender_company}
What they do: {product_description}
ICP: {icp_description}
Tone formality: {formality_level}
Sign-off: {sign_off}

STYLE EXAMPLES (emails this sender approved without edits):
{approved_examples}

LEAD CONTEXT:
Name: {lead_name}
Title: {lead_title}  
Company: {lead_company}

OUTPUT — JSON only, no markdown, no explanation:
{
  "subject": "...",
  "body": "...",
  "personalizationNotes": "One sentence: which signal drove the angle."
}
`.trim();

const FOLLOW_UP_PROMPT = `You write follow-up cold emails. This is step {STEP} of {TOTAL_STEPS} in a sequence.

CRITICAL RULES:
- This is a FOLLOW-UP, not a new cold email. Reference the previous email naturally.
- Step 2: Light bump. 2-3 sentences max. Add ONE new angle or insight not in the original. No "circling back" or "bumping this."
- Step 3+: Final touch. 2-3 sentences max. Graceful close. Leave the door open without guilt.
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

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function subjectWordCount(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((w) => w.replace(/[^a-zA-Z0-9]/g, "").length > 0).length;
}

function firstNameFromFull(full: string): string {
  const t = full.trim();
  if (!t) return "Founder";
  return t.split(/\s+/)[0] ?? "Founder";
}

function fillInitialOutreachPrompt(params: {
  research: ResearchData;
  sender_name: string;
  sender_company: string;
  product_description: string;
  icp_description: string;
  formality_level: string;
  sign_off: string;
  approved_examples: string;
  lead_name: string;
  lead_title: string;
  lead_company: string;
}): string {
  const r = params.research;
  return OUTREACH_SYSTEM_PROMPT.replaceAll("{opener_signal}", r.opener_signal ?? r.summary ?? "")
    .replaceAll("{opener_type}", r.opener_type ?? "general")
    .replaceAll("{company_differentiation}", r.company_differentiation ?? r.companyInfo ?? "")
    .replaceAll("{likely_pain_point}", r.likely_pain_point ?? (r.painPoints[0] ?? ""))
    .replaceAll("{confidence}", r.confidence ?? "low")
    .replaceAll("{fallback_used}", String(r.fallback_used ?? false))
    .replaceAll("{sender_name}", params.sender_name)
    .replaceAll("{sender_company}", params.sender_company)
    .replaceAll("{product_description}", params.product_description)
    .replaceAll("{icp_description}", params.icp_description)
    .replaceAll("{formality_level}", params.formality_level)
    .replaceAll("{sign_off}", params.sign_off)
    .replaceAll("{approved_examples}", params.approved_examples)
    .replaceAll("{lead_name}", params.lead_name)
    .replaceAll("{lead_title}", params.lead_title)
    .replaceAll("{lead_company}", params.lead_company);
}

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

  const llm = createLLMClient({ temperature: 0.75, maxTokens: 900 });

  let systemPrompt: string;
  let userContent: string;
  let appendSignatureBlock = true;

  if (isFollowUp && state.previousEmail) {
    systemPrompt = FOLLOW_UP_PROMPT.replace("{STEP}", String(state.sequenceStep))
      .replace("{TOTAL_STEPS}", "3")
      .replace(/\{PREV_SUBJECT\}/g, state.previousEmail.subject)
      .replace("{PREV_BODY}", state.previousEmail.body);

    const context = [
      `PROSPECT: ${lead.firstName} ${lead.lastName}`,
      lead.title && `Title: ${lead.title}`,
      lead.company && `Company: ${lead.company}`,
      `\nRESEARCH BRIEF:`,
      research.opener_signal ?? research.summary,
      research.likely_pain_point && `Pain: ${research.likely_pain_point}`,
      research.company_differentiation && `Differentiation: ${research.company_differentiation}`,
    ]
      .filter(Boolean)
      .join("\n");
    userContent = context;
  } else {
    appendSignatureBlock = false;
    let senderName = state.senderDisplayName || "Founder";
    let senderCompany = "";
    let productDescription = "Outbound for founders with human approval before send.";
    let icpDescription = "";
    let formalityLevel = "professional-casual";
    let signOff = state.senderSignoff?.trim() || "Best";

    try {
      const supabase = createServiceClient();
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, company_name, role, icp_description, tone_preferences")
        .eq("id", state.userId)
        .single();

      if (profile) {
        const p = profile as Record<string, unknown>;
        if (typeof p.full_name === "string" && p.full_name.trim()) senderName = p.full_name.trim();
        if (typeof p.company_name === "string" && p.company_name.trim())
          senderCompany = p.company_name.trim();
        if (typeof p.role === "string" && p.role.trim()) productDescription = p.role.trim();
        if (typeof p.icp_description === "string" && p.icp_description.trim())
          icpDescription = p.icp_description.trim();
        const tone = (p.tone_preferences ?? {}) as Record<string, unknown>;
        if (typeof tone.formality === "string" && tone.formality.trim())
          formalityLevel = tone.formality.trim();
        if (typeof tone.signoff === "string" && tone.signoff.trim()) signOff = tone.signoff.trim();
      }

      const { data: examples } = await supabase
        .from("interactions")
        .select("human_approved_subject, human_approved_body")
        .eq("user_id", state.userId)
        .eq("was_edited", false)
        .eq("status", "sent")
        .not("human_approved_body", "is", null)
        .order("created_at", { ascending: false })
        .limit(3);

      let approvedExamples = "None yet — follow the voice rules above.";
      if (examples?.length) {
        approvedExamples = examples
          .map((e, i) => {
            const sub =
              typeof e.human_approved_subject === "string"
                ? e.human_approved_subject.trim()
                : "";
            const bod = String(e.human_approved_body ?? "").slice(0, 700);
            return `Example ${i + 1}:\nSubject: ${sub || "(no subject saved)"}\n${bod}`;
          })
          .join("\n\n---\n");
      }

      systemPrompt = fillInitialOutreachPrompt({
        research,
        sender_name: senderName,
        sender_company: senderCompany,
        product_description: productDescription,
        icp_description: icpDescription || "B2B technical founders and operators.",
        formality_level: formalityLevel,
        sign_off: signOff,
        approved_examples: approvedExamples,
        lead_name: `${lead.firstName} ${lead.lastName}`,
        lead_title: lead.title ?? "",
        lead_company: lead.company ?? "",
      });

      userContent =
        "Write the email. Use Hi [FirstName], as the greeting line (replace [FirstName] with the lead's first name only). " +
        `End the body with two lines: your first name only (${firstNameFromFull(senderName)}), then the sign-off phrase (${signOff}) on the next line. No extra lines after that.`;
    } catch {
      systemPrompt = fillInitialOutreachPrompt({
        research,
        sender_name: senderName,
        sender_company: senderCompany,
        product_description: productDescription,
        icp_description: icpDescription || "B2B technical founders and operators.",
        formality_level: formalityLevel,
        sign_off: signOff,
        approved_examples: "None yet — follow the voice rules above.",
        lead_name: `${lead.firstName} ${lead.lastName}`,
        lead_title: lead.title ?? "",
        lead_company: lead.company ?? "",
      });
      userContent =
        "Write the email. Use Hi [FirstName], as the greeting. Replace [FirstName] with the lead's first name only.";
    }
  }

  let styleBlock = "";
  if (isFollowUp) {
    try {
      const supabase = createServiceClient();
      const { data: examples } = await supabase
        .from("interactions")
        .select("human_approved_body")
        .eq("user_id", state.userId)
        .eq("was_edited", false)
        .eq("status", "sent")
        .not("human_approved_body", "is", null)
        .order("created_at", { ascending: false })
        .limit(3);
      if (examples?.length) {
        const blocks = examples.map(
          (e, i) =>
            `Example ${i + 1}:\n${String(e.human_approved_body ?? "").slice(0, 600)}`
        );
        styleBlock = `\n\nFOUNDER-APPROVED STYLE (match tone and brevity — these were sent without edits):\n${blocks.join("\n\n---\n")}`;
      }
    } catch {
      /* optional */
    }
  }

  const fullUser = userContent + styleBlock;

  try {
    const response = await llm.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: fullUser },
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("outreach", "LLM returned non-JSON", { preview: text.slice(0, 200) });
      return skipLeadAfterDraftFailure(
        state,
        lead,
        "Outreach: LLM returned non-JSON — skipped this lead."
      );
    }

    let draft: DraftMessage = JSON.parse(jsonMatch[0]);
    draft.channel = draft.channel ?? "email";
    draft.body = draft.body.replace(/\[FirstName\]/gi, lead.firstName);
    if (!draft.personalizationNotes) {
      draft.personalizationNotes =
        research.opener_signal ?? research.talkingPoints[0] ?? "Research-led angle.";
    }

    const wc = wordCount(draft.body);
    const sc = subjectWordCount(draft.subject);
    if (wc > 120 || sc > 7) {
      logger.warn(
        "outreach",
        `Draft length check (words: ${wc}, subject words: ${sc}) — requesting revision`
      );
      const revision = await llm.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: fullUser },
        {
          role: "assistant",
          content: text,
        },
        {
          role: "user",
          content: `Revise: body must be under 120 words (currently ${wc}). Subject max 7 words (currently ${sc}). Same JSON shape with subject, body, personalizationNotes. No bullets, no bold.`,
        },
      ]);

      const revText =
        typeof revision.content === "string"
          ? revision.content
          : JSON.stringify(revision.content);
      const revMatch = revText.match(/\{[\s\S]*\}/);
      if (revMatch) {
        draft = JSON.parse(revMatch[0]);
        draft.channel = draft.channel ?? "email";
        draft.body = draft.body.replace(/\[FirstName\]/gi, lead.firstName);
        if (!draft.personalizationNotes) {
          draft.personalizationNotes =
            research.opener_signal ?? research.talkingPoints[0] ?? "Research-led angle.";
        }
        logger.success("outreach", `Revised draft for ${name}: "${draft.subject}"`);
        return buildDraftResult(
          lead.firstName,
          draft,
          state.complianceEmailSuffix ?? "",
          state.senderDisplayName ?? "",
          {
            appendSignatureBlock,
            ...(appendSignatureBlock
              ? { signoffPhrase: state.senderSignoff || "Best" }
              : {}),
          }
        );
      }
    }

    logger.success("outreach", `Draft ready for ${name}: "${draft.subject}"`);
    return buildDraftResult(
      lead.firstName,
      draft,
      state.complianceEmailSuffix ?? "",
      state.senderDisplayName ?? "",
      {
        appendSignatureBlock,
        ...(appendSignatureBlock
          ? { signoffPhrase: state.senderSignoff || "Best" }
          : {}),
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("outreach", `Draft failed for ${name}: ${msg}`);
    return skipLeadAfterDraftFailure(
      state,
      lead,
      `Couldn't draft for ${lead.firstName}: ${msg}`
    );
  }
}

/** Without a draft, supervisor would loop outreach forever — advance to next lead. */
function skipLeadAfterDraftFailure(
  state: JarvisStateType,
  lead: { firstName: string; lastName: string },
  errorLine: string
): Partial<JarvisStateType> {
  const short =
    errorLine.length > 180 ? `${errorLine.slice(0, 177)}…` : errorLine;
  return {
    currentLeadIndex: state.currentLeadIndex + 1,
    researchData: null,
    draftMessage: null,
    approvalStatus: "none",
    nextAgent: "supervisor",
    errors: [errorLine],
    messages: [
      new AIMessage(`${short} Moving to the next lead.`),
    ],
  };
}

function buildDraftResult(
  firstName: string,
  draft: DraftMessage,
  complianceSuffix: string,
  senderDisplayName: string,
  options: { appendSignatureBlock?: boolean; signoffPhrase?: string } = {}
): Partial<JarvisStateType> {
  const suffix = complianceSuffix ?? "";
  const appendSig = options.appendSignatureBlock !== false;
  const signoffPhrase = options.signoffPhrase ?? "Best";
  const mainSigned = appendSig
    ? appendSignaturePlain(draft.body, senderDisplayName, signoffPhrase)
    : draft.body.trimEnd();
  const bodyWithCompliance = `${mainSigned.trimEnd()}${suffix}`;
  const withFooter: DraftMessage = { ...draft, body: bodyWithCompliance };
  return {
    draftMessage: withFooter,
    messages: [
      new AIMessage(
        `Draft for ${firstName}:\n\n` +
          `**Subject:** ${withFooter.subject}\n\n` +
          `${withFooter.body}\n\n` +
          `---\n_Angle: ${withFooter.personalizationNotes}_\n\n` +
          `Awaiting your call, sir. Approve, edit, or reject.`
      ),
    ],
  };
}
