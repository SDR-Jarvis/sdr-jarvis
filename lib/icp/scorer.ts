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

  const searchText = [lead.bio, lead.title, lead.company, lead.name]
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

  if (lead.email) {
    score += 25;
    matches.push("has email");
  }

  const excludeMatch = signals.exclude.find((e) => searchText.includes(e));
  if (excludeMatch) {
    score -= 40;
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
