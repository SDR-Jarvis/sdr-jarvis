import { AIMessage } from "@langchain/core/messages";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { appendSignaturePlain } from "@/lib/email/signature";
import { createServiceClient } from "@/lib/supabase/server";
import { isPipelineRunCancelled } from "@/lib/agents/pipeline-cancel";
import {
  getUsableEnrichmentFacts,
  hasUsablePersonalizationFacts,
  prospectEnrichmentToPromptBlock,
  type ProspectEnrichment,
} from "@/lib/enrichment/prospect";
import type { JarvisStateType, DraftMessage, ResearchData } from "../state";

function buildProductBlock(profile: Record<string, unknown> | null): string {
  const productDesc = (
    typeof profile?.product_description === "string" ? profile.product_description : ""
  ).trim();
  const companyName =
    (typeof profile?.company_name === "string" && profile.company_name.trim()) ||
    (typeof profile?.full_name === "string" && profile.full_name.trim()) ||
    "my company";

  if (productDesc.length < 20) {
    return `
=== SENDER'S PRODUCT INFORMATION ===

The sender hasn't fully described their product yet.
Use vague but honest framing in the pitch.

For the pitch, use phrasing like:
"I'm building something at ${companyName} — focused on helping
founders like you with [contextual benefit]."

DO NOT invent specific capabilities.
Keep the pitch SHORT and refer them to a follow-up.
=== END PRODUCT INFO ===
`.trim();
  }

  return `
=== SENDER'S PRODUCT INFORMATION ===

The sender's actual product is described below. This is the
ONLY thing you can claim the product does. Do not invent
capabilities not described here.

PRODUCT DESCRIPTION (verbatim from sender):
"""
${productDesc}
"""

CRITICAL PITCH RULES:

1. Read the product description above carefully.
2. The pitch must describe THIS product accurately.
   Not a different product. Not what the recipient does.
3. Use plain, natural language drawn from the description.
   Don't copy the description word-for-word, but stay true to it.
4. If the description says the product does X, you can say
   the product does X. If it says nothing about Y, do not
   claim the product does Y.
5. The PITCH describes what the SENDER offers (their product).
   The OPENER references the RECIPIENT's context.
   These are separate. Never blend them.

EXAMPLE — for a product description like:
"Project management tool for construction teams"

GOOD pitch:
"I built a project management tool specifically for
construction teams. Given you're running a construction
company, curious if you've found a tool that fits how
construction projects actually work."

BAD pitch (invents capabilities):
"I built a tool that helps you scale your business and
optimize workflows."

BAD pitch (describes wrong product):
"I built a tool that writes cold emails for your approval."

=== END PRODUCT INFO ===
`.trim();
}

const OUTREACH_SYSTEM_PROMPT = `
You are writing a cold email from one technical founder
to another. Both are building real products.

TONE: Founder to founder. Casual but smart.
Like a peer, not a salesperson.

{product_block}

PITCH VS OPENER:
- PART 1 (opener) uses STRUCTURED PROSPECT ENRICHMENT first, then research.
- PART 2 (pitch) must follow PRODUCT CONTEXT above only — the sender's real product, not a generic outreach stack.

PERSONALIZATION SOURCE OF TRUTH:
- The opener MUST reference at least one specific, true fact from STRUCTURED PROSPECT ENRICHMENT.
- The first line of the email MUST reference selectedOpenerFact or one usable enrichment fact, tied directly to the prospect/company.
- Use selectedOpenerFact first, then facts where usableInOpener is true. If those are empty, mark personalizationNotes as "low confidence — needs review" and do not fake specificity.
- The opening line must tie to something specific about THEM: their company, product, role, launch, hiring, customer, pricing, or positioning.
- Never write a generic templated opener when enrichment is thin.

You may NEVER claim the sender's product does any of these invented things:
- Manages microservices
- Does sentiment analysis
- Scales technology
- Maintains accuracy in real-time analysis
- Helps with collaboration
- Project management
- User engagement
- Data infrastructure
- API platform

If the lead's company does X, do NOT pretend the sender's product is secretly "also about X" unless the product description says so.

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

Sentence 1: What the sender sells or built — concrete language taken from PRODUCT CONTEXT only.
NOT: "I help founders deepen engagement" or generic SaaS verbs.

Sentence 2: Why it might matter to THIS person specifically (still honest to PRODUCT CONTEXT).
Reference their stage, role, or what they're building — without misrepresenting your product.

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

Use the research data to write the opener:

If research_depth is 'deep' and confidence is 'high':
  Reference opener_signal directly. This is the gold case.

If research_depth is 'medium':
  Still use opener_signal but frame it as observation, not praise.

If research_depth is 'surface' or fallback_used is true:
  DO NOT pretend to know specifics. Use a more honest opener:
  "Came across [company] — I'm reaching out to founders
  building [their company_focus]."

  Then make the pitch carry the email instead of relying on
  a fake-deep opener.

NEVER write a fake-specific opener if research is shallow.
A direct, honest opener beats a generic compliment dressed up
as personalization.

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

SIGN-OFF FORMAT:
End the email with EXACTLY this signature, on separate lines:
{sender_name}
{sender_company}

Do NOT use placeholders like "our team", "[name]", or "best regards".
Always use the actual name and company provided above.

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
  "body": "opener\\n\\npitch with cta",
  "confidence": "high|medium|low",
  "personalizationNotes": "what sourced fact was used, or low confidence — needs review",
  "factsUsed": ["exact enrichment fact(s) referenced"]
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
- Research depth: {research_depth}
- Company focus: {company_focus}
- Fallback used: {fallback_used}

STRUCTURED PROSPECT ENRICHMENT (primary source for the opener):
{prospect_enrichment}

SENDER:
- Name: {sender_name}
- Company: {sender_company}
- One-line reminder: {product_one_liner}

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

type ProfileSummary = {
  full_name?: string | null;
  company_name?: string | null;
  product_description?: string | null;
  email?: string | null;
};

function validateProductPitch(
  body: string,
  rawProductDescription: string | null
): { isValid: boolean; reason?: string } {
  if (!body || body.trim().length < 50) {
    return { isValid: false, reason: "Body too short (likely template stub)" };
  }

  const FORBIDDEN_CLICHES: RegExp[] = [
    /awaiting your call/i,
    /best regards/i,
    /sincerely yours/i,
    /game[- ]changer/i,
    /thrilled to/i,
    /excited to (work|share|connect|partner)/i,
    /seamlessly/i,
    /robust solution/i,
    /cutting[- ]edge/i,
    /state[- ]of[- ]the[- ]art/i,
    /one[- ]of[- ]a[- ]kind/i,
    /uniquely positioned/i,
    /next[- ]level/i,
    /\bsynergiz/i,
    /\bleverag/i,
    /unlock potential/i,
  ];
  for (const pattern of FORBIDDEN_CLICHES) {
    pattern.lastIndex = 0;
    if (pattern.test(body)) {
      return { isValid: false, reason: `Contains cliche: ${pattern}` };
    }
  }

  const EMPTY_PRAISE_PATTERNS: RegExp[] = [
    /that'?s (a |an )?(smart|key|crucial|important|amazing|great|impressive) (move|approach|step)/i,
    /sounds (amazing|incredible|fantastic)/i,
  ];
  for (const pattern of EMPTY_PRAISE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(body)) {
      return { isValid: false, reason: `Contains empty praise: ${pattern}` };
    }
  }

  void rawProductDescription;

  return { isValid: true };
}

function generateFallbackPitch(
  lead: JarvisStateType["leads"][number],
  profile: ProfileSummary,
  rawProductDescription: string,
  enrichment: ProspectEnrichment | null
): string {
  const leadFirstName = lead.firstName?.trim() || "there";
  const senderFirstName =
    profile.full_name?.trim().split(/\s+/)[0] ||
    profile.email?.split("@")[0]?.replace(/[._]/g, " ").trim() ||
    null;
  const senderCompany = profile.company_name?.trim() || null;
  const company = lead.company?.trim() || "your company";
  const productDesc = (rawProductDescription || profile.product_description || "").trim();
  const fact =
    enrichment?.selectedOpenerFact?.text?.trim() ??
    getUsableEnrichmentFacts(enrichment)[0]?.trim();
  const opener = fact
    ? `${company} caught my eye for ${fact.charAt(0).toLowerCase()}${fact.slice(1)}.`
    : lead.title?.trim()
      ? `Saw you're ${lead.title} at ${company} — I couldn't verify a specific recent signal, so flagging this for review.`
      : `Came across ${company} — I couldn't verify a specific recent signal, so flagging this for review.`;
  const pitch = productDesc.length > 0
    ? `I'm building something — ${productDesc}. Curious if this fits what you're working on?`
    : "I'm building a tool for founders. Would love to share more if useful.";
  const signatureLines = [senderFirstName, senderCompany].filter(
    (x): x is string => Boolean(x)
  );
  const signature = signatureLines.join("\n");
  return `Hi ${leadFirstName},

${opener}

${pitch}

${signature}`.trim();
}

function attachDraftMetadata(params: {
  draft: DraftMessage;
  research: ResearchData;
  enrichment: ProspectEnrichment | null;
  usableEnrichmentFacts: string[];
  hasUsableEnrichment: boolean;
}): DraftMessage {
  const factsUsed =
    Array.isArray(params.draft.factsUsed) && params.draft.factsUsed.length
      ? params.draft.factsUsed
      : [
          params.enrichment?.selectedOpenerFact?.text,
          ...params.usableEnrichmentFacts,
        ].filter((fact): fact is string => Boolean(fact)).slice(0, 3);

  const confidence =
    params.draft.confidence ??
    params.enrichment?.confidence ??
    params.research.confidence ??
    "low";

  return {
    ...params.draft,
    confidence: params.hasUsableEnrichment ? confidence : "low",
    factsUsed: params.hasUsableEnrichment ? factsUsed : [],
    personalizationNotes: params.hasUsableEnrichment
      ? params.draft.personalizationNotes
      : `low confidence — needs review: ${params.draft.personalizationNotes}`,
  };
}

function resolveProductDescriptionFromProfile(p: Record<string, unknown> | null): string {
  const pd =
    typeof p?.product_description === "string" ? p.product_description.trim() : "";
  return pd;
}

function fillInitialOutreachPrompt(params: {
  research: ResearchData;
  prospect_enrichment: string;
  sender_name: string;
  sender_company: string;
  product_block: string;
  product_one_liner: string;
  icp_description: string;
  formality_level: string;
  sign_off: string;
  approved_examples: string;
  lead_name: string;
  lead_title: string;
  lead_company: string;
}): string {
  const r = params.research;
  return OUTREACH_SYSTEM_PROMPT.replaceAll("{product_block}", params.product_block)
    .replaceAll("{opener_signal}", r.opener_signal ?? r.summary ?? "")
    .replaceAll("{opener_type}", r.opener_type ?? "general")
    .replaceAll("{company_differentiation}", r.company_differentiation ?? r.companyInfo ?? "")
    .replaceAll("{likely_pain_point}", r.likely_pain_point ?? (r.painPoints[0] ?? ""))
    .replaceAll("{confidence}", r.confidence ?? "low")
    .replaceAll("{fallback_used}", String(r.fallback_used ?? false))
    .replaceAll("{research_depth}", r.research_depth ?? "surface")
    .replaceAll("{company_focus}", r.company_focus ?? r.companyInfo ?? "")
    .replaceAll("{prospect_enrichment}", params.prospect_enrichment)
    .replaceAll("{sender_name}", params.sender_name)
    .replaceAll("{sender_company}", params.sender_company)
    .replaceAll("{product_one_liner}", params.product_one_liner)
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
  const enrichment = state.prospectEnrichment;

  if (!lead || !research) {
    logger.error("outreach", "Missing lead or research data");
    return { errors: ["Outreach: missing lead or research data"] };
  }

  if (
    state.threadId &&
    (await isPipelineRunCancelled(state.threadId, state.userId))
  ) {
    logger.info("outreach", "Run cancelled — skipping draft");
    return {
      currentLeadIndex: state.leads.length,
      researchData: null,
      draftMessage: null,
      approvalStatus: "none",
      stopRequested: true,
      nextAgent: "supervisor",
      messages: [
        new AIMessage("Outreach cancelled — pipeline stopped."),
      ],
    };
  }

  const name = `${lead.firstName} ${lead.lastName}`;
  const isFollowUp = state.sequenceStep > 1 && Boolean(state.previousEmail);
  let profileFallback: ProfileSummary = {};

  logger.step(
    "outreach",
    isFollowUp
      ? `Drafting follow-up step ${state.sequenceStep} for ${name}`
      : `Drafting email for ${name} (score: ${research.score}/100)`
  );

  const llm = createLLMClient({ temperature: 0.75, maxTokens: 900 });
  const usableEnrichmentFacts = getUsableEnrichmentFacts(enrichment);
  const hasUsableEnrichment = hasUsablePersonalizationFacts(enrichment);

  let systemPrompt: string;
  let userContent: string;
  let appendSignatureBlock = true;
  let rawProductDescForValidation = "";

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
    let senderName = state.senderDisplayName || "there";
    let senderCompany = "my project";
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

      const p = (profile ?? null) as Record<string, unknown> | null;
      if (p) {
        const fullName =
          typeof p.full_name === "string" ? p.full_name.trim() : "";
        const emailName =
          typeof p.email === "string" && p.email.includes("@")
            ? p.email.split("@")[0]?.trim() ?? ""
            : "";
        senderName =
          fullName.split(/\s+/)[0] || emailName || senderName || "there";
        if (typeof p.company_name === "string" && p.company_name.trim()) {
          senderCompany = p.company_name.trim();
        } else if (fullName) {
          senderCompany = fullName;
        }
        rawProductDescForValidation = resolveProductDescriptionFromProfile(p);
        if (typeof p.icp_description === "string" && p.icp_description.trim())
          icpDescription = p.icp_description.trim();
        const tone = (p.tone_preferences ?? {}) as Record<string, unknown>;
        if (typeof tone.formality === "string" && tone.formality.trim())
          formalityLevel = tone.formality.trim();
        if (typeof tone.signoff === "string" && tone.signoff.trim()) signOff = tone.signoff.trim();
        profileFallback = {
          full_name: typeof p.full_name === "string" ? p.full_name : null,
          company_name: typeof p.company_name === "string" ? p.company_name : null,
          product_description: rawProductDescForValidation || null,
          email: typeof p.email === "string" ? p.email : null,
        };
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

      const productBlock = buildProductBlock(p);
      const productOneLiner =
        rawProductDescForValidation.length > 0
          ? rawProductDescForValidation.slice(0, 120)
          : "(Not set in profile — follow PRODUCT CONTEXT above.)";

      systemPrompt = fillInitialOutreachPrompt({
        research,
        sender_name: senderName,
        sender_company: senderCompany,
        product_block: productBlock,
        product_one_liner: productOneLiner,
        icp_description: icpDescription || "B2B technical founders and operators.",
        formality_level: formalityLevel,
        sign_off: signOff,
        approved_examples: approvedExamples,
        lead_name: `${lead.firstName} ${lead.lastName}`,
        lead_title: lead.title ?? "",
        lead_company: lead.company ?? "",
      });

      console.log("[Outreach] Building prompt for user:", {
        user_id: state.userId,
        company_name: senderCompany || null,
        product_description_first_100:
          rawProductDescForValidation.slice(0, 100) || "EMPTY",
        product_description_length: rawProductDescForValidation.length,
      });
      console.log("[Outreach] Generating draft for:", {
        user_id: state.userId,
        product_desc_first_50:
          rawProductDescForValidation.slice(0, 50) || "EMPTY",
        sender_name: senderName,
        sender_company: senderCompany,
      });

      userContent =
        "Write the email now. Use Hi [FirstName], as the greeting line (replace [FirstName] with the lead's first name only). Keep it concise and follow the JSON format exactly.";
    } catch {
      rawProductDescForValidation = "";
      profileFallback = {
        full_name: null,
        company_name: null,
        product_description: null,
        email: null,
      };
      console.log("[Outreach] Building prompt for user:", {
        user_id: state.userId,
        company_name: senderCompany || null,
        product_description_first_100: "EMPTY",
        product_description_length: 0,
      });
      console.log("[Outreach] Generating draft for:", {
        user_id: state.userId,
        product_desc_first_50: "EMPTY",
        sender_name: senderName,
        sender_company: senderCompany,
      });
      systemPrompt = fillInitialOutreachPrompt({
        research,
        sender_name: senderName,
        sender_company: senderCompany,
        product_block: buildProductBlock(null),
        product_one_liner: "(Not set in profile — follow PRODUCT CONTEXT above.)",
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

  if (!isFollowUp && !hasUsableEnrichment) {
    const draft: DraftMessage = {
      subject: "quick question",
      body: generateFallbackPitch(
        lead,
        profileFallback,
        rawProductDescForValidation,
        enrichment
      ),
      channel: "email",
      personalizationNotes:
        "low confidence — needs review: no usable sourced enrichment fact was found for the opener.",
      confidence: "low",
      factsUsed: [],
    };

    logger.warn(
      "outreach",
      `No usable enrichment fact for ${name}; queuing low-confidence draft for review`
    );

    return buildDraftResult(
      lead.firstName,
      draft,
      state.complianceEmailSuffix ?? "",
      state.senderDisplayName ?? "",
      { appendSignatureBlock }
    );
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
    console.log("[Outreach] LLM draft generated, validating...");

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
    draft = attachDraftMetadata({
      draft,
      research,
      enrichment,
      usableEnrichmentFacts,
      hasUsableEnrichment: isFollowUp || hasUsableEnrichment,
    });

    if (!isFollowUp) {
      let lastText = text;
      let validation = validateProductPitch(
        draft.body,
        rawProductDescForValidation || null
      );
      console.log("[Outreach] Validation result:", validation);
      let retries = 0;
      const conversation: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [
        { role: "system", content: systemPrompt },
        { role: "user", content: fullUser },
      ];
      while (!validation.isValid && retries < 2) {
        logger.warn(
          "outreach",
          `[Outreach] Invalid draft: ${validation.reason}, retrying`
        );
        conversation.push({ role: "assistant", content: lastText });
        conversation.push({
          role: "user",
          content: `IMPORTANT: Previous attempt failed validation: ${validation.reason}. Rewrite the pitch so it ONLY reflects PRODUCT CONTEXT in the system prompt and the sender's real product. Do NOT use cold-email-tool or generic outbound-SaaS language unless the product description explicitly says the product is about email or outreach. Return JSON only (subject, body, personalizationNotes).`,
        });
        const retryRes = await llm.invoke(conversation);
        lastText =
          typeof retryRes.content === "string"
            ? retryRes.content
            : JSON.stringify(retryRes.content);
        const jm = lastText.match(/\{[\s\S]*\}/);
        if (!jm) break;
        draft = JSON.parse(jm[0]) as DraftMessage;
        draft.channel = draft.channel ?? "email";
        draft.body = sanitizeDraftBody(
          draft.body.replace(/\[FirstName\]/gi, lead.firstName)
        );
        if (!draft.personalizationNotes) {
          draft.personalizationNotes =
            research.opener_signal ?? research.talkingPoints[0] ?? "Research-led angle.";
        }
        draft = attachDraftMetadata({
          draft,
          research,
          enrichment,
          usableEnrichmentFacts,
          hasUsableEnrichment: isFollowUp || hasUsableEnrichment,
        });
        validation = validateProductPitch(
          draft.body,
          rawProductDescForValidation || null
        );
        console.log("[Outreach] Validation result:", validation);
        retries++;
      }
      if (!validation.isValid) {
        console.warn("[Outreach] Falling back due to:", validation.reason);
        logger.error("outreach", "[Outreach] Falling back to template pitch");
        draft.body = generateFallbackPitch(
          lead,
          profileFallback,
          rawProductDescForValidation,
          enrichment
        );
        draft = attachDraftMetadata({
          draft,
          research,
          enrichment,
          usableEnrichmentFacts,
          hasUsableEnrichment: true,
        });
      }
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
        draft = attachDraftMetadata({
          draft,
          research,
          enrichment,
          usableEnrichmentFacts,
          hasUsableEnrichment: isFollowUp || hasUsableEnrichment,
        });
        if (!isFollowUp) {
          const v = validateProductPitch(
            draft.body,
            rawProductDescForValidation || null
          );
          console.log("[Outreach] Validation result:", v);
          if (!v.isValid) {
            console.warn("[Outreach] Falling back due to:", v.reason);
            logger.warn(
              "outreach",
              `Revision failed product validation: ${v.reason}, using fallback pitch`
            );
            draft.body = generateFallbackPitch(
              lead,
              profileFallback,
              rawProductDescForValidation,
              enrichment
            );
            draft = attachDraftMetadata({
              draft,
              research,
              enrichment,
              usableEnrichmentFacts,
              hasUsableEnrichment: true,
            });
          }
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

    if (!isFollowUp) {
      const v = validateProductPitch(
        draft.body,
        rawProductDescForValidation || null
      );
      console.log("[Outreach] Validation result:", v);
      if (!v.isValid) {
        console.warn("[Outreach] Falling back due to:", v.reason);
        logger.warn(
          "outreach",
          `Final draft failed product validation: ${v.reason}, using fallback pitch`
        );
        draft.body = generateFallbackPitch(
          lead,
          profileFallback,
          rawProductDescForValidation,
          enrichment
        );
        draft = attachDraftMetadata({
          draft,
          research,
          enrichment,
          usableEnrichmentFacts,
          hasUsableEnrichment: true,
        });
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
