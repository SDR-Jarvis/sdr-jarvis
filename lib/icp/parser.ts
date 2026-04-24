export interface ICPSignals {
  roles: string[];
  industries: string[];
  stage: string[];
  keywords: string[];
  company_size: "solo" | "small" | "any";
  exclude: string[];
  geography: string[];
}

const ROLE_KEYWORDS = [
  "founder",
  "ceo",
  "cto",
  "coo",
  "indie hacker",
  "bootstrapper",
  "solopreneur",
  "solo dev",
  "solo founder",
  "maker",
  "operator",
  "developer",
  "engineer",
  "designer",
  "product manager",
  "pm",
  "head of",
  "vp of",
  "director of",
  "lead",
  "ai founder",
  "saas founder",
  "technical founder",
  "indie saas",
  "micro saas",
  "b2b saas",
  "ai startup",
  "ml founder",
  "llm founder",
  "developer tools founder",
  "devtools founder",
];

const INDUSTRY_KEYWORDS = [
  "saas",
  "software",
  "developer tools",
  "devtools",
  "fintech",
  "b2b",
  "b2c",
  "productivity",
  "no-code",
  "low-code",
  "api",
  "infrastructure",
  "marketplace",
  "ecommerce",
  "e-commerce",
  "healthcare",
  "edtech",
  "proptech",
  "hr tech",
  "legal tech",
  "ai",
  "ml",
  "machine learning",
  "data",
  "artificial intelligence",
  "llm",
  "generative ai",
  "ai-powered",
  "ai native",
  "vertical saas",
  "b2b saas",
  "api-first",
  "data infrastructure",
  "mlops",
  "ai infrastructure",
  "foundation model",
  "workflow automation",
];

const STAGE_SIGNALS = [
  "bootstrapped",
  "seed",
  "pre-seed",
  "series a",
  "series b",
  "recently launched",
  "just launched",
  "early stage",
  "early-stage",
  "product hunt",
  "yc",
  "y combinator",
  "indie",
  "side project",
  "self-funded",
  "profitable",
  "revenue",
  "pre-revenue",
];

const SIZE_SIGNALS: Record<"solo" | "small", string[]> = {
  solo: ["solo", "solopreneur", "one-person", "1 person", "just me", "alone"],
  small: [
    "small team",
    "startup",
    "2-10",
    "tiny team",
    "few people",
    "small company",
    "early team",
  ],
};

const EXCLUDE_SIGNALS = [
  "enterprise",
  "fortune 500",
  "large company",
  "corporate",
  "big company",
  "multinational",
  "conglomerate",
];

const GEOGRAPHY_KEYWORDS = [
  "us",
  "usa",
  "united states",
  "uk",
  "united kingdom",
  "europe",
  "eu",
  "asia",
  "india",
  "canada",
  "australia",
  "global",
  "worldwide",
  "remote",
  "latin america",
  "latam",
  "africa",
];

export function extractKeywordsSync(description: string): Partial<ICPSignals> {
  const lower = description.toLowerCase();

  const company_size: ICPSignals["company_size"] = SIZE_SIGNALS.solo.some((s) =>
    lower.includes(s)
  )
    ? "solo"
    : SIZE_SIGNALS.small.some((s) => lower.includes(s))
      ? "small"
      : "any";

  return {
    roles: ROLE_KEYWORDS.filter((k) => lower.includes(k)),
    industries: INDUSTRY_KEYWORDS.filter((k) => lower.includes(k)),
    stage: STAGE_SIGNALS.filter((k) => lower.includes(k)),
    exclude: EXCLUDE_SIGNALS.filter((k) => lower.includes(k)),
    geography: GEOGRAPHY_KEYWORDS.filter((k) => lower.includes(k)),
    company_size,
    keywords: description
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 15),
  };
}

export function isAmbiguous(signals: Partial<ICPSignals>): boolean {
  return (
    (signals.roles?.length ?? 0) === 0 &&
    (signals.industries?.length ?? 0) === 0 &&
    (signals.stage?.length ?? 0) === 0
  );
}

export function mergeSignals(
  keyword: Partial<ICPSignals>,
  llm: Partial<ICPSignals>
): ICPSignals {
  return {
    roles: [...new Set([...(keyword.roles ?? []), ...(llm.roles ?? [])])],
    industries: [...new Set([...(keyword.industries ?? []), ...(llm.industries ?? [])])],
    stage: [...new Set([...(keyword.stage ?? []), ...(llm.stage ?? [])])],
    exclude: [...new Set([...(keyword.exclude ?? []), ...(llm.exclude ?? [])])],
    geography: [...new Set([...(keyword.geography ?? []), ...(llm.geography ?? [])])],
    keywords: [...new Set([...(keyword.keywords ?? []), ...(llm.keywords ?? [])])],
    company_size: keyword.company_size ?? llm.company_size ?? "any",
  };
}

/**
 * @param llmFallback — only invoked when keyword extraction is ambiguous (e.g. from API route).
 */
export async function parseICP(
  description: string,
  llmFallback: (d: string) => Promise<Partial<ICPSignals>>
): Promise<ICPSignals> {
  const keywordSignals = extractKeywordsSync(description);
  if (isAmbiguous(keywordSignals)) {
    const llmSignals = await llmFallback(description);
    return mergeSignals(keywordSignals, llmSignals);
  }
  return mergeSignals(keywordSignals, {});
}
