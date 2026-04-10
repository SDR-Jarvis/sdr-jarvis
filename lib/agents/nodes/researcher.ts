import { AIMessage } from "@langchain/core/messages";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import {
  scrapeLinkedInProfile,
  scrapeWebPage,
  searchWeb,
} from "@/lib/agents/tools";
import type { JarvisStateType, ResearchData } from "../state";

const RESEARCH_SYNTHESIS_PROMPT = `You are a B2B sales research analyst. Your job: turn raw, messy web data into a crisp prospect profile that a sales rep can actually use to write a personalized email.

IMPORTANT RULES:
- Be SPECIFIC. "They use React" is useful. "They have a modern tech stack" is garbage.
- If the raw data is thin, say so. Do NOT invent details. "Unable to determine" is always acceptable.
- Pain points should be INFERRED from real signals (hiring patterns, tech choices, company stage), not generic guesses like "probably wants to grow."
- Talking points must reference something CONCRETE: a specific post, a product launch, a funding round, a job listing.
- Score honestly. A lead with only a name and company and no other data is a 20, not a 50.

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "summary": "2-3 sentence overview. Who is this person, what do they do, why should we care.",
  "companyInfo": "What the company does, rough size/stage, market position. Be specific.",
  "recentActivity": "Any recent posts, job changes, product launches, company news. Say 'None found' if nothing.",
  "painPoints": ["specific inferred pain point based on real signals"],
  "talkingPoints": ["concrete personalization angle with source reference"],
  "techStack": ["specific technologies mentioned or inferred"],
  "fundingInfo": "Recent rounds with amounts if available, or null",
  "score": 65
}`;

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
  const timings: Record<string, number> = {};

  // 1. LinkedIn
  if (lead.linkedinUrl) {
    const t0 = Date.now();
    const linkedin = await scrapeLinkedInProfile(lead.linkedinUrl);
    timings.linkedin = Date.now() - t0;

    if (linkedin && !linkedin.startsWith("LinkedIn profile unavailable")) {
      rawParts.push(`=== LINKEDIN PROFILE ===\n${linkedin}`);
    } else {
      logger.warn("researcher", `LinkedIn data weak for ${name}, supplementing with web search`);
      const fallback = await searchWeb(`${name} linkedin ${lead.company ?? ""}`);
      rawParts.push(`=== LINKEDIN (via search) ===\n${fallback}`);
    }
  } else {
    logger.info("researcher", `No LinkedIn URL for ${name}, using web search`);
    const fallback = await searchWeb(`${name} ${lead.title ?? ""} ${lead.company ?? ""} linkedin`);
    rawParts.push(`=== PERSON SEARCH ===\n${fallback}`);
  }

  // 2. Company website
  if (lead.companyUrl) {
    const t0 = Date.now();
    const site = await scrapeWebPage(lead.companyUrl);
    timings.company = Date.now() - t0;
    rawParts.push(`=== COMPANY WEBSITE ===\n${site}`);
  } else if (lead.company) {
    logger.info("researcher", `No company URL, searching for ${lead.company}`);
    const companySite = await searchWeb(`${lead.company} official website`);
    rawParts.push(`=== COMPANY SEARCH ===\n${companySite}`);
  }

  // 3. Recent news / activity
  if (lead.company) {
    const t0 = Date.now();
    const news = await searchWeb(`"${lead.company}" news OR announcement OR launch 2025 2026`);
    timings.news = Date.now() - t0;
    rawParts.push(`=== RECENT NEWS ===\n${news}`);
  }

  // 4. Person's recent activity
  const personQuery = `"${lead.firstName} ${lead.lastName}" ${lead.company ?? ""} post OR talk OR article`;
  const personActivity = await searchWeb(personQuery);
  rawParts.push(`=== PERSON ACTIVITY ===\n${personActivity}`);

  const totalResearchTime = Object.values(timings).reduce((a, b) => a + b, 0);
  logger.info("researcher", `Raw research gathered in ${Math.round(totalResearchTime / 1000)}s — ${rawParts.length} sources`);

  // Synthesize with LLM
  const llm = createLLMClient({ temperature: 0.2, maxTokens: 1200 });
  logger.step("researcher", `Synthesizing research for ${name}…`);

  try {
    const response = await llm.invoke([
      { role: "system", content: RESEARCH_SYNTHESIS_PROMPT },
      {
        role: "user",
        content: `Synthesize research for: ${name}${lead.title ? `, ${lead.title}` : ""}${lead.company ? ` at ${lead.company}` : ""}.\n\nRaw data:\n\n${rawParts.join("\n\n").slice(0, 12000)}`,
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

    const research: ResearchData = JSON.parse(jsonMatch[0]);
    logger.success("researcher", `Research complete — score: ${research.score}/100, ${research.talkingPoints.length} talking points`);

    return {
      researchData: research,
      messages: [
        new AIMessage(
          `Research on ${lead.firstName} done. Score: ${research.score}/100. ` +
            (research.talkingPoints.length
              ? `Best angles: ${research.talkingPoints.slice(0, 2).join("; ")}.`
              : "Limited personalization angles found — I'll work with what we have.")
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
  return {
    summary: `${lead.firstName} ${lead.lastName}${lead.title ? `, ${lead.title}` : ""}${lead.company ? ` at ${lead.company}` : ""}. Limited research data available.`,
    companyInfo: lead.company ? `Works at ${lead.company}. Further details unavailable.` : "Company unknown.",
    recentActivity: "None found",
    painPoints: [],
    talkingPoints: [],
    techStack: [],
    fundingInfo: null,
    score: 20,
  };
}
