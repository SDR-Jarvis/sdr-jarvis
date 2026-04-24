import { AIMessage } from "@langchain/core/messages";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import {
  scrapeLinkedInProfile,
  scrapeWebPage,
  searchWeb,
  searchLinkedIn,
  researchCompany,
} from "@/lib/agents/tools";
import type { JarvisStateType, ResearchData } from "../state";

const RESEARCHER_SYSTEM_PROMPT = `
You are researching a B2B SaaS founder or technical 
decision-maker before a cold email is written to them.

Your job is NOT to summarize their LinkedIn bio.
Their bio is already known. Do not repeat it.

Your job is to find SPECIFIC RECENT SIGNALS that would
make a cold email feel like it was written by someone
who actually pays attention to what they are building.

Research the person and their company and find ONE of
these signals (in priority order):

TIER 1 — USE IF FOUND (strongest openers):
- Something they shipped or launched in the last 90 days
  (GitHub release, Product Hunt launch, blog post about
  a specific technical decision, changelog entry)
- A specific technical problem they publicly discussed
  (tweet, HN comment, conference talk, podcast quote)
- A recent company milestone they announced
  (funding, new customer type, pivot, team growth)

TIER 2 — USE IF TIER 1 NOT FOUND:
- A specific architectural or product decision visible
  in their public work (GitHub, docs, open source repo)
- A specific opinion they expressed about their market
  or competitors
- Their company's specific differentiation vs named
  competitors (what makes them different from X)

TIER 3 — LAST RESORT ONLY:
- Their company's core focus and target customer
  (only if nothing more specific is findable)

OUTPUT FORMAT — return JSON only:

{
  "opener_signal": "The specific thing to reference in the opener. One sentence. Concrete. No adjectives like 'impressive' or 'interesting'.",
  "opener_type": "launch | technical_decision | milestone | opinion | differentiation | general",
  "signal_source": "Where you found this. URL or 'GitHub' or 'Twitter' or 'blog'",
  "company_differentiation": "What makes their product different from alternatives in one sentence",
  "likely_pain_point": "The specific operational or growth problem a founder at this stage likely has",
  "confidence": "high | medium | low",
  "fallback_used": false
}

If you cannot find anything specific (confidence: low),
set fallback_used: true and use their company's core
technical differentiation as the opener_signal.

DO NOT make things up.
DO NOT use generic phrases like "innovative approach"
DO NOT summarize their bio back to them.
`.trim();

function mergeResearchOutput(
  parsed: Record<string, unknown>,
  lead: { firstName: string; lastName: string; company: string | null }
): ResearchData {
  const opener_signal = String(parsed.opener_signal ?? "").trim();
  const opener_type = String(parsed.opener_type ?? "general").trim();
  const signal_source = String(parsed.signal_source ?? "").trim();
  const company_differentiation = String(parsed.company_differentiation ?? "").trim();
  const likely_pain_point = String(parsed.likely_pain_point ?? "").trim();
  const confRaw = String(parsed.confidence ?? "low").toLowerCase();
  const confidence: "high" | "medium" | "low" =
    confRaw === "high" || confRaw === "medium" || confRaw === "low" ? confRaw : "low";
  const fallback_used = Boolean(parsed.fallback_used);

  let score = 40;
  if (confidence === "high") score = fallback_used ? 58 : 84;
  else if (confidence === "medium") score = fallback_used ? 48 : 68;
  else score = fallback_used ? 32 : 38;

  const painPoints = likely_pain_point ? [likely_pain_point] : [];
  const talkingPoints = opener_signal ? [opener_signal] : [];

  return {
    summary:
      opener_signal ||
      `${lead.firstName} ${lead.lastName}${lead.company ? ` at ${lead.company}` : ""}`,
    companyInfo:
      company_differentiation ||
      (lead.company ? `Works at ${lead.company}.` : "Company unknown."),
    recentActivity: signal_source || "None found",
    painPoints,
    talkingPoints,
    techStack: [],
    fundingInfo: null,
    score,
    opener_signal: opener_signal || undefined,
    opener_type,
    signal_source: signal_source || undefined,
    company_differentiation: company_differentiation || undefined,
    likely_pain_point: likely_pain_point || undefined,
    confidence,
    fallback_used,
  };
}

export async function researcherNode(
  state: JarvisStateType
): Promise<Partial<JarvisStateType>> {
  const lead = state.leads[state.currentLeadIndex];
  if (!lead) {
    logger.error("researcher", "No lead at current index");
    return { errors: ["Researcher: no lead at current index"] };
  }

  const name = `${lead.firstName} ${lead.lastName}`;
  logger.step("researcher", `Starting research on ${name}${lead.company ? ` (${lead.company})` : ""}`);

  const rawParts: string[] = [];

  // ── 1. LinkedIn profile ──
  if (lead.linkedinUrl) {
    const linkedin = await scrapeLinkedInProfile(lead.linkedinUrl);
    if (linkedin && !linkedin.startsWith("LinkedIn profile unavailable")) {
      rawParts.push(`=== LINKEDIN PROFILE ===\n${linkedin}`);
    } else {
      logger.info("researcher", `LinkedIn direct failed for ${name}, using Google`);
      const fallback = await searchLinkedIn(name, lead.title, lead.company);
      rawParts.push(`=== LINKEDIN (via search) ===\n${fallback}`);
    }
  } else {
    logger.info("researcher", `No LinkedIn URL for ${name}, searching via Google`);
    const fallback = await searchLinkedIn(name, lead.title, lead.company);
    rawParts.push(`=== LINKEDIN SEARCH ===\n${fallback}`);
  }

  // ── 2. Company deep research (parallel Google searches) ──
  if (lead.company) {
    const companyData = await researchCompany(lead.company);

    if (lead.companyUrl) {
      const site = await scrapeWebPage(lead.companyUrl);
      rawParts.push(`=== COMPANY WEBSITE ===\n${site}`);
    } else {
      rawParts.push(`=== COMPANY INFO ===\n${companyData.website}`);
    }

    rawParts.push(`=== FUNDING INFO ===\n${companyData.funding}`);
    rawParts.push(`=== RECENT NEWS ===\n${companyData.news}`);
    rawParts.push(`=== TECH STACK ===\n${companyData.techStack}`);
  } else if (lead.companyUrl) {
    const site = await scrapeWebPage(lead.companyUrl);
    rawParts.push(`=== COMPANY WEBSITE ===\n${site}`);
  }

  // ── 3. Person's recent activity ──
  const personQuery = `"${lead.firstName} ${lead.lastName}" ${lead.company ?? ""} post OR talk OR article OR announcement`;
  const personActivity = await searchWeb(personQuery);
  rawParts.push(`=== PERSON ACTIVITY ===\n${personActivity}`);

  const sourcesCount = rawParts.length;
  logger.info("researcher", `Raw research gathered — ${sourcesCount} source sections`);

  // ── Synthesize with LLM ──
  const llm = createLLMClient({ temperature: 0.2, maxTokens: 1400 });
  logger.step("researcher", `Synthesizing research for ${name}…`);

  try {
    const response = await llm.invoke([
      { role: "system", content: RESEARCHER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Prospect: ${name}${lead.title ? `, ${lead.title}` : ""}${lead.company ? ` at ${lead.company}` : ""}.\n\nRaw evidence (do not summarize as a bio — extract a concrete opener_signal):\n\n${rawParts.join("\n\n").slice(0, 12000)}`,
      },
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("researcher", "LLM returned non-JSON", { response: text.slice(0, 200) });
      return {
        errors: ["Researcher: LLM returned non-JSON response"],
        researchData: buildFallbackResearch(lead),
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const research = mergeResearchOutput(parsed, lead);
    logger.success(
      "researcher",
      `Research complete — score: ${research.score}/100, opener_type: ${research.opener_type ?? "n/a"}`
    );

    return {
      researchData: research,
      messages: [
        new AIMessage(
          `Research on ${lead.firstName} done. Score: ${research.score}/100. ` +
            (research.opener_signal
              ? `Signal: ${research.opener_signal.slice(0, 200)}${research.opener_signal.length > 200 ? "…" : ""}`
              : "Limited personalization signals — using fallback.")
        ),
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("researcher", `Synthesis failed: ${msg}`);

    return {
      errors: [`Researcher synthesis error: ${msg}`],
      researchData: buildFallbackResearch(lead),
      messages: [
        new AIMessage(
          `Hit a wall synthesizing research on ${lead.firstName}. Proceeding with basic profile data.`
        ),
      ],
    };
  }
}

function buildFallbackResearch(lead: {
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
}): ResearchData {
  const label = `${lead.firstName} ${lead.lastName}${lead.title ? `, ${lead.title}` : ""}${lead.company ? ` at ${lead.company}` : ""}`;
  return {
    summary: `${label}. Limited research data available.`,
    companyInfo: lead.company ? `Works at ${lead.company}. Further details unavailable.` : "Company unknown.",
    recentActivity: "None found",
    painPoints: [],
    talkingPoints: [],
    techStack: [],
    fundingInfo: null,
    score: 20,
    opener_signal: lead.company
      ? `Building at ${lead.company} — specifics not verified from public sources.`
      : "Limited public signal — proceed with care.",
    opener_type: "general",
    signal_source: "fallback",
    company_differentiation: lead.company
      ? `${lead.company} — differentiation not verified.`
      : "Unknown company positioning.",
    likely_pain_point: "Unknown — thin data.",
    confidence: "low",
    fallback_used: true,
  };
}
