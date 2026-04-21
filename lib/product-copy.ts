/** Single source for founder-facing positioning (UI only). */

export const PRODUCT_TAGLINE = "The fastest way for a founder to start outbound";

export const PRODUCT_SUBLINE =
  "AI researches leads, writes personalized emails, and lets you approve before sending.";

export const IMPORT_INVITE =
  "Already have leads? Bring them in — we'll write the emails.";

export const APPROVALS_CONTROL_LINE =
  "You stay in control. Nothing sends without your approval.";

export function fitLabel(icpLabel: string | null | undefined): string {
  switch (icpLabel) {
    case "hot":
      return "🔥 High fit";
    case "maybe":
      return "👍 Good fit";
    case "weak":
      return "⚠️ Low fit";
    default:
      return "👍 Good fit";
  }
}

/** Card subtitle — how we found this lead (no raw source codes). */
export function discoverySourceLabel(source: string | null | undefined): string {
  const key = (source ?? "").toLowerCase();
  const map: Record<string, string> = {
    github: "GitHub",
    hn: "Hacker News",
    producthunt: "Product Hunt",
    apollo: "People search",
    manual: "Your list",
  };
  return map[key] ?? (source ? "Web" : "—");
}
