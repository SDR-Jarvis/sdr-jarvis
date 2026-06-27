import type { SupabaseClient } from "@supabase/supabase-js";
import { createLLMClient } from "@/lib/llm";
import { logger } from "@/lib/logger";
import { searchWeb } from "@/lib/agents/tools";

export type ProspectEnrichmentSourceType =
  | "homepage"
  | "about"
  | "blog"
  | "changelog"
  | "linkedin"
  | "github"
  | "news"
  | "uploaded_note";

export type ProspectEnrichment = {
  version: 1;
  status: "ready" | "low_confidence" | "failed";
  confidence: "high" | "medium" | "low";
  enrichedAt: string;
  expiresAt?: string;
  sources: Array<{
    type: ProspectEnrichmentSourceType;
    url?: string;
    title?: string;
    fetchedAt: string;
    snippet: string;
  }>;
  facts: Array<{
    text: string;
    sourceUrl?: string;
    sourceType: string;
    usableInOpener: boolean;
  }>;
  recentSignals: Array<{
    type:
      | "launch"
      | "product"
      | "hiring"
      | "funding"
      | "customer"
      | "technical"
      | "positioning"
      | "other";
    text: string;
    sourceUrl?: string;
    observedAt?: string;
  }>;
  selectedOpenerFact?: {
    text: string;
    sourceUrl?: string;
    reason: string;
  };
  companySummary?: string;
  roleContext?: {
    title?: string;
    likelyPriorities: string[];
  };
};

type ProspectInput = {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
  companyUrl: string | null;
  linkedinUrl?: string | null;
  enrichmentData?: Record<string, unknown> | null;
};

const CACHE_KEY = "prospect_enrichment";
const MAX_SOURCE_CHARS = 3200;
const CACHE_TTL_DAYS = 14;

const ENRICHMENT_SYSTEM_PROMPT = `
You enrich one outbound email prospect using only the provided public sources.

Return JSON only. Do not invent facts. Every fact or signal must be supported by one of the provided source URLs.

Return this exact schema shape:
{
  "version": 1,
  "status": "ready|low_confidence|failed",
  "confidence": "high|medium|low",
  "enrichedAt": "ISO timestamp",
  "expiresAt": "ISO timestamp",
  "sources": [{ "type": "homepage|about|blog|changelog|linkedin|github|news|uploaded_note", "url": "optional URL", "title": "optional title", "fetchedAt": "ISO timestamp", "snippet": "short source snippet" }],
  "facts": [{ "text": "specific true fact", "sourceUrl": "optional source URL", "sourceType": "source type", "usableInOpener": true }],
  "recentSignals": [{ "type": "launch|product|hiring|funding|customer|technical|positioning|other", "text": "specific signal", "sourceUrl": "optional source URL", "observedAt": "optional ISO timestamp" }],
  "selectedOpenerFact": { "text": "best sourced fact for line one", "sourceUrl": "optional source URL", "reason": "why it is relevant" },
  "companySummary": "plain-language summary",
  "roleContext": { "title": "prospect title", "likelyPriorities": ["role-specific priority"] }
}

Rules:
- Prefer concrete product, customer, pricing, launch, technical, or positioning facts.
- selectedOpenerFact must come from facts where usableInOpener is true.
- If sources are thin, set status "low_confidence", confidence "low", facts [], recentSignals [], and omit selectedOpenerFact.
- Do not use generic claims like "they are innovative" or "they use AI" unless the source says something concrete about how.
`.trim();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeCompanyUrl(url: string | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function addDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy.toISOString();
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

function extractTitle(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = og ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return title?.replace(/\s+/g, " ").trim().slice(0, 140) || undefined;
}

async function fetchSource(
  type: ProspectEnrichmentSourceType,
  url: string,
  timeoutMs = 8000
): Promise<ProspectEnrichment["sources"][number] | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SDR-Jarvis/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const html = await response.text();
    const snippet = stripHtml(html);
    if (snippet.length < 80) return null;
    return {
      type,
      url: response.url || url,
      title: extractTitle(html),
      fetchedAt: new Date().toISOString(),
      snippet,
    };
  } catch {
    return null;
  }
}

async function gatherEnrichmentSources(
  lead: ProspectInput
): Promise<ProspectEnrichment["sources"]> {
  const sources: ProspectEnrichment["sources"] = [];
  const baseUrl = normalizeCompanyUrl(lead.companyUrl);

  if (baseUrl) {
    const homepage = await fetchSource("homepage", baseUrl);
    if (homepage) sources.push(homepage);

    for (const [type, path] of [
      ["about", "/about"],
      ["blog", "/blog"],
      ["changelog", "/changelog"],
      ["changelog", "/whats-new"],
    ] as const) {
      const source = await fetchSource(type, `${baseUrl}${path}`, 5000);
      if (source) sources.push(source);
      if (sources.length >= 4) break;
    }
  }

  if (lead.linkedinUrl) {
    sources.push({
      type: "linkedin",
      url: lead.linkedinUrl,
      fetchedAt: new Date().toISOString(),
      snippet: `LinkedIn URL supplied for ${lead.firstName} ${lead.lastName}. Use only as an identity/profile source, not as proof of claims unless source content is available elsewhere.`,
    });
  }

  const companyQuery = [
    lead.company ? `"${lead.company}"` : null,
    baseUrl ? new URL(baseUrl).hostname.replace(/^www\./, "") : null,
    "launch OR product OR changelog OR hiring OR customer",
  ]
    .filter(Boolean)
    .join(" ");

  if (companyQuery.trim().length > 20) {
    const search = await searchWeb(companyQuery);
    if (search && !/^No search results found\./i.test(search)) {
      sources.push({
        type: "news",
        url: "web-search",
        title: companyQuery,
        fetchedAt: new Date().toISOString(),
        snippet: search.slice(0, MAX_SOURCE_CHARS),
      });
    }
  }

  return sources.slice(0, 6);
}

function emptyEnrichment(
  lead: ProspectInput,
  status: ProspectEnrichment["status"] = "low_confidence"
): ProspectEnrichment {
  const now = new Date();
  return {
    version: 1,
    status,
    confidence: "low",
    enrichedAt: now.toISOString(),
    expiresAt: addDays(now, CACHE_TTL_DAYS),
    sources: [],
    facts: [],
    recentSignals: [],
    companySummary: lead.company
      ? `${lead.company}. Public company details were limited.`
      : undefined,
    roleContext: {
      title: lead.title ?? undefined,
      likelyPriorities: [],
    },
  };
}

function isProspectEnrichment(value: unknown): value is ProspectEnrichment {
  const record = asRecord(value);
  if (!record) return false;
  return (
    record.version === 1 &&
    typeof record.enrichedAt === "string" &&
    Array.isArray(record.sources) &&
    Array.isArray(record.facts) &&
    Array.isArray(record.recentSignals)
  );
}

function isFresh(enrichment: ProspectEnrichment): boolean {
  if (!enrichment.expiresAt) return true;
  return Date.parse(enrichment.expiresAt) > Date.now();
}

function coerceStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : [];
}

function coerceSourceType(value: unknown): ProspectEnrichmentSourceType {
  const type = String(value ?? "homepage").toLowerCase();
  if (
    type === "homepage" ||
    type === "about" ||
    type === "blog" ||
    type === "changelog" ||
    type === "linkedin" ||
    type === "github" ||
    type === "news" ||
    type === "uploaded_note"
  ) {
    return type;
  }
  return "homepage";
}

function coerceSignalType(value: unknown): ProspectEnrichment["recentSignals"][number]["type"] {
  const type = String(value ?? "other").toLowerCase();
  if (
    type === "launch" ||
    type === "product" ||
    type === "hiring" ||
    type === "funding" ||
    type === "customer" ||
    type === "technical" ||
    type === "positioning" ||
    type === "other"
  ) {
    return type;
  }
  return "other";
}

function coerceEnrichment(
  parsed: Record<string, unknown>,
  lead: ProspectInput,
  gatheredSources: ProspectEnrichment["sources"]
): ProspectEnrichment {
  const now = new Date();
  const confidenceRaw = String(parsed.confidence ?? "low").toLowerCase();
  const confidence: ProspectEnrichment["confidence"] =
    confidenceRaw === "high" || confidenceRaw === "medium" || confidenceRaw === "low"
      ? confidenceRaw
      : "low";

  const facts = Array.isArray(parsed.facts)
    ? parsed.facts
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          text: String(item.text ?? "").trim(),
          sourceUrl:
            typeof item.sourceUrl === "string" && item.sourceUrl.trim()
              ? item.sourceUrl.trim()
              : undefined,
          sourceType: String(item.sourceType ?? "").trim() || "homepage",
          usableInOpener: Boolean(item.usableInOpener),
        }))
        .filter((item) => item.text.length >= 12)
        .slice(0, 8)
    : [];

  const recentSignals = Array.isArray(parsed.recentSignals)
    ? parsed.recentSignals
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          type: coerceSignalType(item.type),
          text: String(item.text ?? "").trim(),
          sourceUrl:
            typeof item.sourceUrl === "string" && item.sourceUrl.trim()
              ? item.sourceUrl.trim()
              : undefined,
          observedAt:
            typeof item.observedAt === "string" && item.observedAt.trim()
              ? item.observedAt.trim()
              : undefined,
        }))
        .filter((item) => item.text.length >= 12)
        .slice(0, 6)
    : [];

  const parsedSources = Array.isArray(parsed.sources)
    ? parsed.sources
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          type: coerceSourceType(item.type),
          url: typeof item.url === "string" && item.url.trim() ? item.url.trim() : undefined,
          title:
            typeof item.title === "string" && item.title.trim()
              ? item.title.trim().slice(0, 140)
              : undefined,
          fetchedAt:
            typeof item.fetchedAt === "string" && item.fetchedAt.trim()
              ? item.fetchedAt.trim()
              : now.toISOString(),
          snippet: String(item.snippet ?? "").trim().slice(0, 800),
        }))
        .filter((item) => item.snippet)
        .slice(0, 8)
    : [];

  const usableFacts = facts.filter((fact) => fact.usableInOpener);
  const selectedRaw = asRecord(parsed.selectedOpenerFact);
  const selectedText = String(selectedRaw?.text ?? "").trim();
  const selected = selectedText
    ? {
        text: selectedText,
        sourceUrl:
          typeof selectedRaw?.sourceUrl === "string" && selectedRaw.sourceUrl.trim()
            ? selectedRaw.sourceUrl.trim()
            : undefined,
        reason:
          typeof selectedRaw?.reason === "string" && selectedRaw.reason.trim()
            ? selectedRaw.reason.trim()
            : "Best sourced opener fact.",
      }
    : usableFacts[0]
      ? {
          text: usableFacts[0].text,
          sourceUrl: usableFacts[0].sourceUrl,
          reason: "Best usable sourced fact from enrichment.",
        }
      : undefined;

  const roleContext = asRecord(parsed.roleContext);
  const statusRaw = String(parsed.status ?? "").toLowerCase();
  const status: ProspectEnrichment["status"] =
    statusRaw === "failed"
      ? "failed"
      : selected && confidence !== "low"
        ? "ready"
        : "low_confidence";

  return {
    version: 1,
    status,
    confidence: status === "ready" ? confidence : "low",
    enrichedAt:
      typeof parsed.enrichedAt === "string" && parsed.enrichedAt.trim()
        ? parsed.enrichedAt.trim()
        : now.toISOString(),
    expiresAt:
      typeof parsed.expiresAt === "string" && parsed.expiresAt.trim()
        ? parsed.expiresAt.trim()
        : addDays(now, CACHE_TTL_DAYS),
    sources: parsedSources.length ? parsedSources : gatheredSources,
    facts,
    recentSignals,
    ...(selected ? { selectedOpenerFact: selected } : {}),
    companySummary:
      typeof parsed.companySummary === "string" && parsed.companySummary.trim()
        ? parsed.companySummary.trim()
        : lead.company
          ? `${lead.company}.`
          : undefined,
    roleContext: {
      title:
        typeof roleContext?.title === "string" && roleContext.title.trim()
          ? roleContext.title.trim()
          : lead.title ?? undefined,
      likelyPriorities: coerceStringArray(roleContext?.likelyPriorities),
    },
  };
}

export function getUsableEnrichmentFacts(
  enrichment: ProspectEnrichment | null | undefined
): string[] {
  if (!enrichment) return [];
  return enrichment.facts
    .filter((fact) => fact.usableInOpener && fact.text.trim().length >= 12)
    .map((fact) => fact.text.trim());
}

export function hasUsablePersonalizationFacts(
  enrichment: ProspectEnrichment | null | undefined
): boolean {
  return Boolean(enrichment?.selectedOpenerFact?.text) || getUsableEnrichmentFacts(enrichment).length > 0;
}

export function prospectEnrichmentToPromptBlock(
  enrichment: ProspectEnrichment | null | undefined
): string {
  if (!enrichment) return "No structured enrichment available.";
  return JSON.stringify(enrichment, null, 2);
}

export async function enrichProspectForLead(params: {
  supabase: SupabaseClient;
  userId: string;
  campaignId: string | null;
  lead: ProspectInput;
}): Promise<{ enrichment: ProspectEnrichment; fromCache: boolean }> {
  const embedded = asRecord(params.lead.enrichmentData)?.[CACHE_KEY];
  if (isProspectEnrichment(embedded) && isFresh(embedded)) {
    return { enrichment: embedded, fromCache: true };
  }

  const query = params.supabase
    .from("leads")
    .select("id, campaign_id, enrichment_data")
    .eq("id", params.lead.id)
    .eq("user_id", params.userId);
  if (params.campaignId) query.eq("campaign_id", params.campaignId);
  const { data: leadRow, error: leadError } = await query.maybeSingle();
  if (leadError || !leadRow) {
    logger.warn("enrichment", `Lead ${params.lead.id} not found for scoped enrichment`);
    return { enrichment: emptyEnrichment(params.lead, "failed"), fromCache: false };
  }

  const existingData = asRecord((leadRow as { enrichment_data?: unknown }).enrichment_data) ?? {};
  const cached = existingData[CACHE_KEY];
  if (isProspectEnrichment(cached) && isFresh(cached)) {
    return { enrichment: cached, fromCache: true };
  }

  let enrichment = emptyEnrichment(params.lead);
  try {
    const sources = await gatherEnrichmentSources(params.lead);
    if (sources.length > 0) {
      const llm = createLLMClient({ temperature: 0.1, maxTokens: 1600 });
      const response = await llm.invoke([
        { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Prospect:
Name: ${params.lead.firstName} ${params.lead.lastName}
Title: ${params.lead.title ?? ""}
Company: ${params.lead.company ?? ""}
Company URL: ${params.lead.companyUrl ?? ""}
LinkedIn URL: ${params.lead.linkedinUrl ?? ""}
Observed at: ${new Date().toISOString()}

Sources:
${sources.map((s) => `=== ${s.type} | ${s.url ?? "no-url"}${s.title ? ` | ${s.title}` : ""} ===\n${s.snippet}`).join("\n\n")}

Create structured prospect enrichment. Use only these sources.`,
        },
      ]);
      const text =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      enrichment = jsonMatch
        ? coerceEnrichment(JSON.parse(jsonMatch[0]) as Record<string, unknown>, params.lead, sources)
        : {
            ...emptyEnrichment(params.lead),
            sources,
          };
    }
  } catch (err) {
    enrichment = emptyEnrichment(params.lead, "failed");
    logger.warn(
      "enrichment",
      `Prospect enrichment failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const mergedData = {
    ...existingData,
    [CACHE_KEY]: enrichment,
  };
  const updateQuery = params.supabase
    .from("leads")
    .update({ enrichment_data: mergedData })
    .eq("id", params.lead.id)
    .eq("user_id", params.userId);
  if (params.campaignId) updateQuery.eq("campaign_id", params.campaignId);
  await updateQuery;

  return { enrichment, fromCache: false };
}
