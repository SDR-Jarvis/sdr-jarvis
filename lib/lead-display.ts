/** Display company for lead lists — never blank for solo founders. */
export function displayLeadCompany(company: string | null | undefined): string {
  const t = (company ?? "").trim();
  return t.length > 0 ? t : "Independent Founder";
}

type Enrichment = Record<string, unknown> | null | undefined;

function githubUsernameFromEnrichment(data: Enrichment): string | null {
  if (!data || typeof data !== "object") return null;
  const u = (data as { github_username?: unknown }).github_username;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

/** DB row: show full name, else GitHub username from enrichment, else a neutral label (never "Unknown"). */
export function displayLeadFullName(lead: {
  first_name?: string | null;
  last_name?: string | null;
  enrichment_data?: Enrichment;
}): string {
  const first = (lead.first_name ?? "").trim();
  const last = (lead.last_name ?? "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined.length > 0) return combined;
  const gh = githubUsernameFromEnrichment(lead.enrichment_data);
  if (gh) return gh;
  return "Contact";
}
