import type { ScoredLead } from "@/lib/icp/scorer";

/** Tunable via env; used server-side in API and client when NEXT_PUBLIC mirror is set. */
export function getMinLeadScore(): number {
  const raw =
    typeof process !== "undefined"
      ? (process.env.MIN_LEAD_SCORE ?? process.env.NEXT_PUBLIC_MIN_LEAD_SCORE)
      : undefined;
  if (raw === undefined || raw === "") return 10;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(0, Math.min(100, n));
}

const BAD_PATTERNS = [
  "i built",
  "my daughter",
  "weekend project",
  "toy project",
  "experiment",
  "for fun",
  "side project",
  "personal project",
];

function hasContactPath(lead: ScoredLead): boolean {
  const email = (lead.email ?? "").trim();
  if (email.length > 0) return true;
  const url = (lead.url ?? "").trim();
  if (url.includes("github.com")) return true;
  try {
    if (!url.startsWith("http")) return false;
    const host = new URL(url).hostname.toLowerCase();
    if (!host) return false;
    if (host.includes("github.com")) return true;
    if (host.includes("linkedin.com")) return true;
    if (host.includes("producthunt.com")) return true;
    if (host.includes("ycombinator.com")) return true;
    return host.length > 0;
  } catch {
    return false;
  }
}

function textHaystack(lead: ScoredLead, companyNorm: string): string {
  return [companyNorm, lead.bio, lead.title, lead.name, lead.username]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Safe starting threshold for discovery / import — not aggressive.
 * GitHub-only leads may lack company; we treat missing company as "Independent Founder" for checks only.
 */
export function isValidLead(lead: ScoredLead): boolean {
  if (lead.source === "apollo") {
    const hasName = (lead.name ?? "").trim().length > 0;
    const hasCompany = (lead.company ?? "").trim().length > 0;
    if (!hasName || !hasCompany) return false;
    // Apollo rows may lack an email until enrichment or manual add — still listable.
    return true;
  }

  const min = getMinLeadScore();
  const score = lead.icp_score ?? 0;
  if (score < min) return false;

  if (!hasContactPath(lead)) return false;

  const companyRaw = (lead.company ?? "").trim();
  const companyNorm =
    companyRaw ||
    ((lead.url ?? "").includes("github.com") ? "Independent Founder" : "");

  if (!companyNorm) return false;

  const words = companyNorm.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;

  const hay = textHaystack(lead, companyNorm);
  if (BAD_PATTERNS.some((p) => hay.includes(p))) return false;

  const namePart = `${(lead.name ?? "").trim()} ${(lead.username ?? "").trim()}`.trim();
  if (!namePart) return false;

  return true;
}
