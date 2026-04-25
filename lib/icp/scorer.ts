import type { ICPSignals } from "@/lib/icp/parser";
import type { RawLead } from "@/lib/discover/engine";

export interface ScoredLead extends RawLead {
  icp_score: number;
}

const LABEL_COPY: Record<ScoredLead["icp_label"], string> = {
  hot: "High fit",
  maybe: "Good fit",
  weak: "Low fit",
};

export function labelDisplay(label: ScoredLead["icp_label"]): string {
  const emoji =
    label === "hot" ? "🔥" : label === "maybe" ? "👍" : "⚠️";
  return `${emoji} ${LABEL_COPY[label]}`;
}

export function scoreLead(lead: RawLead, signals: ICPSignals): ScoredLead {
  let score = 0;
  const matches: string[] = [];

  const searchText = [lead.bio, lead.title, lead.company, lead.name, lead.username]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const roleMatch = signals.roles.find((r) => searchText.includes(r));
  if (roleMatch) {
    score += 20;
    matches.push(roleMatch);
  }

  const industryMatch = signals.industries.find((i) => searchText.includes(i));
  if (industryMatch) {
    score += 15;
    matches.push(industryMatch);
  }

  const stageMatch = signals.stage.find((s) => searchText.includes(s));
  if (stageMatch) {
    score += 12;
    matches.push(stageMatch);
  }

  const keywordMatches = signals.keywords
    .filter((k) => k.length > 3 && searchText.includes(k.toLowerCase()))
    .slice(0, 3);
  score += keywordMatches.length * 8;
  matches.push(...keywordMatches);

  const aiSignals = [
    "ai",
    "llm",
    "ml",
    "gpt",
    "artificial intelligence",
    "machine learning",
    "generative",
  ];
  const saasSignals = [
    "saas",
    "b2b",
    "api",
    "dashboard",
    "platform",
    "subscription",
    "devtools",
  ];
  const hasAISignal = aiSignals.some((s) => searchText.includes(s));
  const hasSaaSSignal = saasSignals.some((s) => searchText.includes(s));
  if (hasAISignal) score += 15;
  if (hasSaaSSignal) score += 10;
  if (hasAISignal && hasSaaSSignal) {
    score += 10;
  }

  if (lead.email) {
    score += 25;
    matches.push("has email");
  }

  const excludeMatch = signals.exclude.find((e) => searchText.includes(e));
  if (excludeMatch) {
    score -= 40;
  }

  // Apollo leads come pre-vetted by Apollo's data quality
  if (lead.source === "apollo") {
    score += 20; // base credibility boost
    if (lead.title) score += 10; // verified title at a real company
    if (lead.email) score += 10; // can contact
  }

  // Hard filter: must be AI or SaaS adjacent
  const searchTextLower = searchText;

  const aiSaasIndicators = [
    "saas",
    "software",
    "platform",
    "api",
    "b2b",
    "ai",
    "ml",
    "llm",
    "data",
    "cloud",
    "devtools",
    "developer tools",
    "infrastructure",
    "analytics",
    "automation",
    "workflow",
    "dashboard",
    "engine",
    "tool",
    "app",
  ];

  const offTopicIndicators = [
    "agency",
    "consulting",
    "consultancy",
    "marketing agency",
    "e-commerce store",
    "shopify store",
    "dropshipping",
    "real estate",
    "restaurant",
    "retail store",
    "salon",
    "fitness",
    "coach",
    "coaching",
    "influencer",
  ];

  const looksAISaas = aiSaasIndicators.some((t) => searchTextLower.includes(t));
  const looksOffTopic = offTopicIndicators.some((t) => searchTextLower.includes(t));

  if (looksOffTopic && !looksAISaas) {
    return {
      ...lead,
      icp_score: 5,
      icp_label: "weak" as const,
      icp_match_reason: "Outside AI/SaaS scope",
    };
  }

  if (!looksAISaas && lead.source !== "apollo") {
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));

  const icp_label: ScoredLead["icp_label"] =
    score >= 70 ? "hot" : score >= 40 ? "maybe" : "weak";

  const icp_match_reason =
    matches.length > 0
      ? `Matches: ${[...new Set(matches)].slice(0, 3).join(", ")}`
      : "Partial match based on your description";

  return { ...lead, icp_score: score, icp_label, icp_match_reason };
}

export function scoreAndSortLeads(leads: RawLead[], signals: ICPSignals): ScoredLead[] {
  return leads
    .map((lead) => scoreLead(lead, signals))
    .sort((a, b) => b.icp_score - a.icp_score);
}
