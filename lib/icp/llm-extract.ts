import { createLLMClient } from "@/lib/llm";
import type { ICPSignals } from "@/lib/icp/parser";

const SYSTEM = `You extract ideal customer profile (ICP) signals from a short plain-English description.
Return ONLY valid JSON with these fields (arrays of short strings, use [] if unknown):
roles, industries, stage, company_size ("solo"|"small"|"any"), exclude, geography, keywords.
No markdown. No explanation.`;

export async function extractICPWithLLM(
  description: string
): Promise<Partial<ICPSignals>> {
  const llm = createLLMClient({ temperature: 0.2, maxTokens: 500 });
  const res = await llm.invoke([
    { role: "system", content: SYSTEM },
    { role: "user", content: description },
  ]);
  const text =
    typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    const parsed = JSON.parse(m[0]) as Partial<ICPSignals>;
    return {
      roles: Array.isArray(parsed.roles) ? parsed.roles.map(String) : [],
      industries: Array.isArray(parsed.industries)
        ? parsed.industries.map(String)
        : [],
      stage: Array.isArray(parsed.stage) ? parsed.stage.map(String) : [],
      exclude: Array.isArray(parsed.exclude) ? parsed.exclude.map(String) : [],
      geography: Array.isArray(parsed.geography)
        ? parsed.geography.map(String)
        : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
      company_size:
        parsed.company_size === "solo" || parsed.company_size === "small"
          ? parsed.company_size
          : "any",
    };
  } catch {
    return {};
  }
}
