import { AIMessage } from "@langchain/core/messages";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { appendSignaturePlain } from "@/lib/email/signature";
import { createServiceClient } from "@/lib/supabase/server";
import type { JarvisStateType, DraftMessage, ResearchData } from "../state";

const OUTREACH_SYSTEM_PROMPT = `
You are writing a cold email from one technical founder
to another. Both are building real products.

TONE: Founder to founder. Casual but smart.
Like a peer, not a salesperson.

HARD RULES — violating any is failure:
1. Total body under 80 words (excluding signature)
2. No bullet points, no bold, no markdown
3. Subject line max 6 words, lowercase except names
4. NEVER include: "Awaiting your call", "sir", "ma'am",
   "Dear", "Hope this finds you well", "Just floating",
   "I came across", "I believe", "synergize",
   "streamline", "optimize", "leverage", "value-add"
5. NEVER include any address, phone, or compliance text
   in your output — that gets appended automatically
6. NEVER include internal labels like "Angle:" or
   "Why this lead:" in the email body

EMAIL STRUCTURE:

PART 1 — WARM OPENER (1-2 sentences max):

The opener must reference a SPECIFIC DECISION the person
made, not just what they shipped.

Three opener types, in priority order:

TYPE A — Reference a design/technical decision:
"Saw you went with [specific choice] instead of [common alternative] —
that's [why this matters]."

Example: "Saw you went with progress milestones instead of
leaderboards — turns the experience into a coach instead of
a competition."

TYPE B — Reference a market positioning:
"[Their thing] going [direction] makes sense — most teams
[common mistake] but yours [different angle]."

Example: "Going domain-specific with healthcare NLP makes
sense — most general models fall apart on clinical vocabulary
in production."

TYPE C — Reference a recent visible action with insight:
"[Recent action] is interesting — [observation about why it
matters in their space]."

Example: "Your changelog mentioning vector search shipped
in 2 weeks is fast — most tools take 2 quarters for that
same feature."

FORBIDDEN OPENER PATTERNS:
- "That's a smart move" (empty praise)
- "Makes sense for [generic reason]" (vague)
- "Great work on [thing they did]" (flattery)
- Anything that could be sent to ANY person who shipped
  ANY product (test: would this opener work for 100 different
  people? if yes, it's too generic)

The test: read the opener and ask "could this have been written
by someone who only spent 30 seconds on their LinkedIn?" If yes,
it's too generic. Rewrite to show you understand a SPECIFIC
choice they made.

PART 2 — PITCH (2-3 sentences max):

Sentence 1: What sender does in CONCRETE language.
NOT: "I help founders deepen engagement"
YES: "I built a tool that writes your cold emails and queues
them for your approval before sending."

NOT: "We scale AI solutions effectively"
YES: "We replace the hour it takes founders to write 20
personalized emails."

Use the SPECIFIC product description from sender's profile.
If the description says "tool that writes cold emails" — say
"I built a tool that writes cold emails." Don't abstract it.

Sentence 2: Why it might matter to THIS person specifically.
Reference their stage, role, or what they're building.

Sentence 3: Soft CTA — a real question.
"Worth a quick look?" or "Curious if this fits what you're
building?" or "Open to a 10-min chat if useful?"

FORBIDDEN PITCH WORDS (do NOT use):
- "deepen engagement"
- "scale solutions"
- "platform value"
- "leverage"
- "synergize"
- "streamline"
- "optimize"
- "drive"
- "showcase"
- "unlock potential"
- Any verb-noun combo that sounds like a SaaS landing page

CTA EXAMPLES (use one):
- "Worth a quick look?"
- "Curious if this fits what you're building."
- "Open to a 10-min chat if useful?"
- "Happy to share more if interesting."

NEVER:
- "Schedule a call on my calendar"
- "Book a demo"
- "Hop on a quick call"
- "Sync up"

SIGN-OFF:
First name only on its own line.
Then sender's company on next line if relevant.

FORBIDDEN PHRASES (do not use under any circumstance):
"Awaiting your call"
"Best regards"
"Sincerely"
"Looking forward to hearing"
"Don't hesitate"
"Reach out anytime"

OUTPUT FORMAT — valid JSON only, nothing else:
{
  "subject": "lowercase short subject",
  "body": "opener\\n\\npitch with cta"
}

NEVER include compliance text in output.
NEVER include the angle/signal metadata in body.
NEVER include addresses or footer info.

Use these variables to write the email:

LEAD:
- Name: {lead_name}
- Title: {lead_title}
- Company: {lead_company}

RESEARCH (use this for the opener):
- Signal: {opener_signal}
- Why it matters: {likely_pain_point}
- Confidence: {confidence}

SENDER:
- Name: {sender_name}
- Company: {sender_company}
- What they do: {product_description}

PAST APPROVED (match this voice):
{approved_examples}
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

const FORBIDDEN_PATTERNS: RegExp[] = [
  /awaiting your call/gi,
  /\b(?:sir|ma'am)\b/gi,
  /angle:/gi,
  /why this lead:/gi,
  /\d{3,5}\s+[a-z0-9.'-]+\s+(?:st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive)\b/gi,
  /\b\d{5}(?:-\d{4})?\b/g,
  /best regards/gi,
  /sincerely/gi,
  /looking forward to hearing/gi,
  /don't hesitate/gi,
  /reach out anytime/gi,
  /\n\n---[\s\S]*$/gi,
];

function sanitizeDraftBody(body: string): string {
  let cleanBody = body;
  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(cleanBody)) {
      console.warn("[Outreach] Stripping forbidden pattern:", pattern);
      pattern.lastIndex = 0;
      cleanBody = cleanBody.replace(pattern, "").trim();
    }
  }
  return cleanBody;
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
        .select("*")
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
        "Write the email now. Use Hi [FirstName], as the greeting line (replace [FirstName] with the lead's first name only). Keep it concise and follow the JSON format exactly.";
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
        "Write the email now. Use Hi [FirstName], as the greeting. Replace [FirstName] with the lead's first name only. Return valid JSON only.";
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
    draft.body = sanitizeDraftBody(
      draft.body.replace(/\[FirstName\]/gi, lead.firstName)
    );
    if (!draft.personalizationNotes) {
      draft.personalizationNotes =
        research.opener_signal ?? research.talkingPoints[0] ?? "Research-led angle.";
    }

    const wc = wordCount(draft.body);
    const sc = subjectWordCount(draft.subject);
    if (wc > 80 || sc > 6) {
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
          content: `Revise: body must be under 80 words (currently ${wc}). Subject max 6 words (currently ${sc}). Same JSON shape with subject, body, personalizationNotes. No bullets, no bold.`,
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
        draft.body = sanitizeDraftBody(
          draft.body.replace(/\[FirstName\]/gi, lead.firstName)
        );
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
  const bodyWithCompliance = suffix
    ? `${mainSigned.trimEnd()}${suffix.startsWith("\n\n") ? suffix : `\n\n${suffix}`}`
    : mainSigned.trimEnd();
  const withFooter: DraftMessage = { ...draft, body: bodyWithCompliance };
  return {
    draftMessage: withFooter,
    messages: [
      new AIMessage(
        `Draft for ${firstName}:\n\n` +
          `**Subject:** ${withFooter.subject}\n\n` +
          `${withFooter.body}\n\n` +
          `Approve, edit, or reject.`
      ),
    ],
  };
}
