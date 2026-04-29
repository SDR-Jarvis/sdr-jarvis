import { AIMessage } from "@langchain/core/messages";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import {
  scrapeLinkedInProfile,
  searchWeb,
  searchLinkedIn,
} from "@/lib/agents/tools";
import { isPipelineRunCancelled } from "@/lib/agents/pipeline-cancel";
import type { JarvisStateType, ResearchData } from "../state";

const RESEARCHER_SYSTEM_PROMPT = `
You are researching a B2B SaaS or AI founder before a 
personalized cold email is written.

YOUR ONE JOB:
Find ONE specific, recent, non-obvious thing about this 
person or their company that demonstrates real attention.

Generic signals like "they launched a feature" or "they're 
building in AI" are FAILURES. Anyone could write those after 
30 seconds on LinkedIn.

GOOD signals look like:
- A specific design decision: "Their pricing page leads with 
  pay-per-action instead of per-seat"
- A technical choice: "They built on Postgres + pgvector 
  instead of a dedicated vector DB"
- A market position: "They explicitly target Series-B teams 
  rather than seed-stage like everyone else"
- A controversial opinion: "Their CEO publicly disagrees with 
  the AGI timeline — wrote a post about why models are plateauing"
- A specific customer signal: "They just signed Plaid as a 
  customer based on their changelog"
- A sharp tradeoff: "They chose accuracy over latency in their 
  inference pipeline — rare in this space"

RESEARCH SOURCES TO CHECK (in order):
1. Their company's blog (look for recent technical posts, 
   not marketing fluff)
2. Their company's changelog or "what's new" page
3. Their GitHub if technical (recent repos, README depth)
4. Their Twitter/X bio AND last 5 tweets (controversial takes)
5. Their ProductHunt page if they launched there
6. Podcast appearances or conference talks
7. Their LinkedIn — but only their POSTS not their bio

NEVER use as a primary signal:
- Generic company description
- The fact that they raised funding (everyone has)
- Their team size (boring)
- Generic industry trends ("they're in AI")
- Bio summaries

OUTPUT FORMAT — return JSON only:

{
  "opener_signal": "ONE specific, non-obvious observation. 
    Concrete. Under 25 words. Should feel like 'wait, how did 
    you notice that?'",
  "opener_type": "design_decision | technical_choice | 
    market_position | opinion | customer_signal | tradeoff | 
    fallback",
  "signal_source": "Where you found this — 'their blog', 
    'GitHub README', 'Twitter thread', etc.",
  "signal_url": "The actual URL where you found this",
  "company_focus": "What their company actually does in plain 
    words. One sentence.",
  "likely_pain_point": "What a founder at THIS stage doing 
    THIS specifically would struggle with. Be specific.",
  "confidence": "high | medium | low",
  "fallback_used": true | false,
  "research_depth": "deep | medium | surface"
}

CONFIDENCE RULES:
- "high" = found a specific design/technical/opinion signal 
  with clear source
- "medium" = found something specific but somewhat generic
- "low" = could only find general company info → set 
  fallback_used: true and use company_focus as opener_signal

Mark research_depth: "deep" only if you found something most 
people wouldn't notice. Otherwise "medium" or "surface".
`.trim();

type ResearchSource = {
  type: "blog" | "changelog" | "github" | "producthunt" | "homepage" | "linkedin" | "web";
  url: string;
  content: string;
};

const WEAK_SIGNAL_PATTERNS = [
  /launched (a |their |the )?new feature/i,
  /building in (ai|saas|tech)/i,
  /raised (seed|series)/i,
  /scaling .{0,20}(team|business|company)/i,
  /that's (smart|crucial|key|important)/i,
  /makes sense/i,
  /innovative approach/i,
];

function isSignalWeak(signal: string): boolean {
  return WEAK_SIGNAL_PATTERNS.some((p) => p.test(signal));
}

async function fetchWithTimeout(url: string, ms: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SDR-Jarvis/1.0)",
      },
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return null;
  }
}

async function fetchJSON<T>(url: string, ms: number): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SDR-Jarvis/1.0)",
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function gatherResearchSources(
  lead: JarvisStateType["leads"][number]
): Promise<ResearchSource[]> {
  const sources: ResearchSource[] = [];

  if (lead.companyUrl) {
    const base = lead.companyUrl.replace(/\/$/, "");
    const blog = await fetchWithTimeout(`${base}/blog`, 8000);
    if (blog) {
      sources.push({ type: "blog", url: `${base}/blog`, content: blog });
    }

    for (const path of ["/changelog", "/whats-new", "/updates"]) {
      const url = `${base}${path}`;
      const content = await fetchWithTimeout(url, 5000);
      if (content) {
        sources.push({ type: "changelog", url, content });
        break;
      }
    }
  }

  if (lead.githubUsername) {
    const ghUrl = `https://api.github.com/users/${lead.githubUsername}/repos?sort=updated&per_page=5`;
    const repos = await fetchJSON<
      { name: string; description: string | null; updated_at: string }[]
    >(ghUrl, 5000);
    if (repos?.length) {
      sources.push({
        type: "github",
        url: `https://github.com/${lead.githubUsername}`,
        content: repos
          .map((r) => `${r.name}: ${r.description ?? ""} (updated ${r.updated_at})`)
          .join("\n"),
      });
    }
  }

  if (lead.discoverySource === "producthunt" && lead.companyUrl) {
    const phContent = await fetchWithTimeout(lead.companyUrl, 5000);
    if (phContent) {
      sources.push({
        type: "producthunt",
        url: lead.companyUrl,
        content: phContent,
      });
    }
  }

  if (lead.linkedinUrl) {
    const linkedin = await scrapeLinkedInProfile(lead.linkedinUrl);
    if (linkedin && !linkedin.startsWith("LinkedIn profile unavailable")) {
      sources.push({ type: "linkedin", url: lead.linkedinUrl, content: linkedin.slice(0, 3000) });
    }
  }

  const personQuery = `"${lead.firstName} ${lead.lastName}" ${lead.company ?? ""} post OR talk OR article OR announcement`;
  const webActivity = await searchWeb(personQuery);
  if (webActivity) {
    sources.push({
      type: "web",
      url: "web-search",
      content: String(webActivity).slice(0, 3000),
    });
  }

  if (lead.companyUrl && sources.length === 0) {
    const fallback = await fetchWithTimeout(lead.companyUrl, 5000);
    if (fallback) {
      sources.push({ type: "homepage", url: lead.companyUrl, content: fallback });
    }
  }

  return sources;
}

function mergeResearchOutput(
  parsed: Record<string, unknown>,
  lead: { firstName: string; lastName: string; company: string | null }
): ResearchData {
  const opener_signal = String(parsed.opener_signal ?? "").trim();
  const opener_type = String(parsed.opener_type ?? "fallback").trim();
  const signal_source = String(parsed.signal_source ?? "").trim();
  const signal_url = String(parsed.signal_url ?? "").trim();
  const company_focus = String(parsed.company_focus ?? "").trim();
  const company_differentiation = String(parsed.company_differentiation ?? company_focus).trim();
  const likely_pain_point = String(parsed.likely_pain_point ?? "").trim();
  const depthRaw = String(parsed.research_depth ?? "surface").toLowerCase();
  const research_depth: "deep" | "medium" | "surface" =
    depthRaw === "deep" || depthRaw === "medium" || depthRaw === "surface"
      ? depthRaw
      : "surface";
  const confRaw = String(parsed.confidence ?? "low").toLowerCase();
  const confidence: "high" | "medium" | "low" =
    confRaw === "high" || confRaw === "medium" || confRaw === "low" ? confRaw : "low";
  const fallback_used = Boolean(parsed.fallback_used) || confidence === "low";

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
    signal_url: signal_url || undefined,
    company_focus: company_focus || undefined,
    company_differentiation: company_differentiation || undefined,
    likely_pain_point: likely_pain_point || undefined,
    confidence,
    fallback_used,
    research_depth,
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

  if (
    state.threadId &&
    (await isPipelineRunCancelled(state.threadId, state.userId))
  ) {
    logger.info("researcher", "Run cancelled — skipping research");
    return {
      currentLeadIndex: state.leads.length,
      researchData: null,
      draftMessage: null,
      approvalStatus: "none",
      stopRequested: true,
      nextAgent: "supervisor",
      messages: [
        new AIMessage("Research cancelled — pipeline stopped."),
      ],
    };
  }

  const name = `${lead.firstName} ${lead.lastName}`;
  logger.step("researcher", `Starting research on ${name}${lead.company ? ` (${lead.company})` : ""}`);

  const sources = await gatherResearchSources(lead);
  if (sources.length === 0) {
    logger.info("researcher", `No deep sources found for ${name}, using LinkedIn search fallback`);
    const fallback = await searchLinkedIn(name, lead.title, lead.company);
    if (fallback) {
      sources.push({
        type: "linkedin",
        url: "linkedin-search",
        content: String(fallback).slice(0, 3000),
      });
    }
  }

  logger.info("researcher", `Raw research gathered — ${sources.length} source sections`);
  const sourcesText = sources
    .map((s) => `=== Source: ${s.type} (${s.url}) ===\n${s.content}\n`)
    .join("\n\n");

  // ── Synthesize with LLM ──
  const llm = createLLMClient({ temperature: 0.2, maxTokens: 1400 });
  logger.step("researcher", `Synthesizing research for ${name}…`);

  try {
    const response = await llm.invoke([
      { role: "system", content: RESEARCHER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Research this person and their company:

Name: ${name}
Title: ${lead.title ?? ""}
Company: ${lead.company ?? ""}

Research sources collected:
${sourcesText || "No sources available — use fallback."}

Find ONE specific, non-obvious signal worth referencing in a cold email. Return JSON.`,
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
    if (research.opener_signal && isSignalWeak(research.opener_signal)) {
      console.warn("[Research] Weak signal detected, marking fallback");
      research.confidence = "low";
      research.fallback_used = true;
      research.research_depth = "surface";
    }
    logger.success(
      "researcher",
      `Research complete — score: ${research.score}/100, opener_type: ${research.opener_type ?? "n/a"}, depth: ${research.research_depth ?? "surface"}`
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
    signal_url: undefined,
    company_focus: lead.company
      ? `${lead.company} builds software for business teams.`
      : "Unknown company focus.",
    company_differentiation: lead.company
      ? `${lead.company} — differentiation not verified.`
      : "Unknown company positioning.",
    likely_pain_point: "Unknown — thin data.",
    confidence: "low",
    fallback_used: true,
    research_depth: "surface",
  };
}
