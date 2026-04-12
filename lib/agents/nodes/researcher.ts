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
