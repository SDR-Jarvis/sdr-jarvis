import { Resend } from "resend";
import { logger } from "@/lib/logger";

// ════════════════════════════════════════════════════
// RATE LIMITER
// ════════════════════════════════════════════════════

class RateLimiter {
  private lastCall = 0;
  private readonly minDelayMs: number;
  private readonly jitterMs: number;

  constructor(minDelayMs: number, jitterMs: number) {
    this.minDelayMs = minDelayMs;
    this.jitterMs = jitterMs;
  }

  async wait() {
    const elapsed = Date.now() - this.lastCall;
    const required = this.minDelayMs + Math.random() * this.jitterMs;
    if (elapsed < required) {
      await new Promise((r) => setTimeout(r, required - elapsed));
    }
    this.lastCall = Date.now();
  }
}

const googleLimiter = new RateLimiter(500, 500);
const duckLimiter = new RateLimiter(2000, 2000);
const webLimiter = new RateLimiter(1500, 1500);

// ════════════════════════════════════════════════════
// FETCH UTILITIES
// ════════════════════════════════════════════════════

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchHtml(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) {
      return `HTTP ${res.status}: ${res.statusText}`;
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromHtml(html: string, maxLen = 5000): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function extractMeta(html: string): { title: string; description: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);

  return {
    title: titleMatch?.[1]?.trim() ?? "",
    description: descMatch?.[1]?.trim() ?? "",
  };
}

export async function closeBrowser(): Promise<void> {
  // No-op: using fetch instead of Playwright
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  label: string
): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < retries) {
        const backoff = (i + 1) * 2000 + Math.random() * 1000;
        logger.warn("tools", `${label} attempt ${i + 1} failed, retrying in ${Math.round(backoff)}ms…`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastError;
}

// ════════════════════════════════════════════════════
// GOOGLE CUSTOM SEARCH API
// Free tier: 100 queries/day — structured JSON results
// ════════════════════════════════════════════════════

interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
}

function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
}

export async function searchGoogle(query: string, num = 5): Promise<GoogleSearchResult[]> {
  if (!isGoogleConfigured()) return [];

  await googleLimiter.wait();
  logger.step("researcher", `Google search: "${query}"`);

  try {
    const params = new URLSearchParams({
      key: process.env.GOOGLE_SEARCH_API_KEY!,
      cx: process.env.GOOGLE_SEARCH_CX!,
      q: query,
      num: String(Math.min(num, 10)),
    });

    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) {
      const errText = await res.text();
      logger.warn("researcher", `Google API ${res.status}: ${errText.slice(0, 200)}`);
      return [];
    }

    const data = await res.json();
    const items: GoogleSearchResult[] = (data.items ?? []).map(
      (item: { title?: string; link?: string; snippet?: string }) => ({
        title: item.title ?? "",
        link: item.link ?? "",
        snippet: item.snippet ?? "",
      })
    );

    logger.success("researcher", `Google returned ${items.length} results for "${query}"`);
    return items;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("researcher", `Google search failed: ${msg}`);
    return [];
  }
}

function formatGoogleResults(results: GoogleSearchResult[]): string {
  if (!results.length) return "";
  return results
    .map((r) => `${r.title}\n${r.snippet}\n${r.link}`)
    .join("\n---\n");
}

// ════════════════════════════════════════════════════
// SMART WEB SEARCH — Google first, DuckDuckGo fallback
// ════════════════════════════════════════════════════

export async function searchWeb(query: string): Promise<string> {
  // Try Google first (structured, reliable)
  const googleResults = await searchGoogle(query);
  if (googleResults.length > 0) {
    return formatGoogleResults(googleResults);
  }

  // Fallback to DuckDuckGo
  return searchDuckDuckGo(query);
}

export async function searchDuckDuckGo(query: string): Promise<string> {
  logger.step("researcher", `DuckDuckGo search: "${query}"`);
  await duckLimiter.wait();

  return withRetry(
    async () => {
      const html = await fetchHtml(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      );

      const resultBlocks = html.match(/<div class="result__body">[\s\S]*?<\/div>\s*<\/div>/g) ?? [];

      const results = resultBlocks
        .slice(0, 6)
        .map((block) => {
          const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([^<]*)<\/a>/i);
          const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/i);
          const hrefMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*/i);

          const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
          const snippet = snippetMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
          const link = hrefMatch?.[1] ?? "";

          return `${title}\n${snippet}\n${link}`;
        })
        .filter((r) => r.length > 10)
        .join("\n---\n");

      const count = results ? results.split("---").length : 0;
      logger.success("researcher", `DuckDuckGo returned ${count} results for "${query}"`);
      return results || "No search results found.";
    },
    2,
    "DuckDuckGo search"
  );
}

// ════════════════════════════════════════════════════
// LINKEDIN RESEARCH — Google site-search (reliable)
// Direct LinkedIn fetch almost always gets blocked.
// Using Google to search site:linkedin.com works well.
// ════════════════════════════════════════════════════

export async function scrapeLinkedInProfile(linkedinUrl: string): Promise<string> {
  logger.step("researcher", `Researching LinkedIn profile: ${linkedinUrl}`);

  const parts: string[] = [];

  // Strategy 1: Google search for this exact LinkedIn URL (best data)
  const googleUrlResults = await searchGoogle(`site:linkedin.com "${linkedinUrl}"`);
  if (googleUrlResults.length > 0) {
    parts.push("=== LINKEDIN (via Google) ===");
    for (const r of googleUrlResults) {
      parts.push(`${r.title}\n${r.snippet}`);
    }
  }

  // Strategy 2: Try direct fetch — sometimes works for public profiles
  try {
    await webLimiter.wait();
    const html = await fetchHtml(linkedinUrl);
    if (!html.startsWith("HTTP ") && html.length > 1000) {
      const { title, description } = extractMeta(html);
      const text = extractTextFromHtml(html, 3000);

      // LinkedIn returns a login-wall page with ~200 chars of useful data at best
      if (text.length > 300 && !text.includes("Sign in") && !text.includes("Join now")) {
        parts.push("=== LINKEDIN DIRECT ===");
        if (title) parts.push(`Profile: ${title}`);
        if (description) parts.push(`Summary: ${description}`);
        parts.push(text.slice(0, 2000));
      } else if (title && title.length > 10) {
        parts.push(`LinkedIn title: ${title}`);
        if (description) parts.push(`LinkedIn meta: ${description}`);
      }
    }
  } catch {
    logger.info("researcher", "Direct LinkedIn fetch blocked (expected)");
  }

  if (parts.length === 0) {
    return "LinkedIn profile unavailable via direct access. Using search fallback.";
  }

  const result = parts.join("\n\n");
  logger.success("researcher", `LinkedIn research gathered: ${result.slice(0, 100)}…`);
  return result;
}

// ════════════════════════════════════════════════════
// GOOGLE-POWERED LINKEDIN SEARCH (by name)
// When we don't have a LinkedIn URL, search for the person
// ════════════════════════════════════════════════════

export async function searchLinkedIn(
  name: string,
  title?: string | null,
  company?: string | null
): Promise<string> {
  const query = [
    `site:linkedin.com/in/`,
    `"${name}"`,
    company && `"${company}"`,
    title && title,
  ]
    .filter(Boolean)
    .join(" ");

  logger.step("researcher", `LinkedIn search via Google: ${query}`);

  const googleResults = await searchGoogle(query, 3);
  if (googleResults.length > 0) {
    const formatted = googleResults
      .map((r) => `${r.title}\n${r.snippet}\n${r.link}`)
      .join("\n---\n");
    logger.success("researcher", `Found ${googleResults.length} LinkedIn results`);
    return formatted;
  }

  // Fall back to DuckDuckGo
  const ddgResults = await searchDuckDuckGo(`${name} ${company ?? ""} site:linkedin.com`);
  return ddgResults;
}

// ════════════════════════════════════════════════════
// GOOGLE-POWERED COMPANY RESEARCH
// Searches for company info, funding, news, tech stack
// ════════════════════════════════════════════════════

export async function researchCompany(companyName: string): Promise<{
  website: string;
  funding: string;
  news: string;
  techStack: string;
}> {
  logger.step("researcher", `Deep company research: ${companyName}`);

  // Run multiple Google searches in parallel
  const [siteResults, fundingResults, newsResults, techResults] = await Promise.all([
    searchGoogle(`"${companyName}" official website about`, 3),
    searchGoogle(`"${companyName}" funding round series raised crunchbase`, 3),
    searchGoogle(`"${companyName}" news announcement launch 2025 2026`, 3),
    searchGoogle(`"${companyName}" tech stack engineering blog technologies`, 3),
  ]);

  return {
    website: formatGoogleResults(siteResults) || "No company website found.",
    funding: formatGoogleResults(fundingResults) || "No funding info found.",
    news: formatGoogleResults(newsResults) || "No recent news found.",
    techStack: formatGoogleResults(techResults) || "No tech stack info found.",
  };
}

// ════════════════════════════════════════════════════
// GENERIC WEB SCRAPING
// ════════════════════════════════════════════════════

export async function scrapeWebPage(url: string): Promise<string> {
  logger.step("researcher", `Scraping page: ${url}`);
  await webLimiter.wait();

  return withRetry(
    async () => {
      const html = await fetchHtml(url);

      if (html.startsWith("HTTP ")) {
        return `Page unavailable (${html})`;
      }

      const { title, description } = extractMeta(html);
      const body = extractTextFromHtml(html);

      const result = [
        title && `Title: ${title}`,
        description && `Description: ${description}`,
        `\nContent:\n${body}`,
      ]
        .filter(Boolean)
        .join("\n");

      logger.success("researcher", `Page scraped: ${url}`);
      return result;
    },
    1,
    "Web scrape"
  );
}

// ════════════════════════════════════════════════════
// EMAIL — Resend
// ════════════════════════════════════════════════════

let _resend: Resend | null = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

import {
  generateRfcMessageId,
  extractSenderDomain,
} from "@/lib/email/message-id";

/**
 * Send an email via Resend.
 *
 * This function is the single place in the codebase where an RFC 822
 * `Message-Id` is generated. We set it ourselves via Resend's `headers`
 * option so we know the exact value that goes on the wire — Resend's SDK
 * response only contains an internal UUID (`data.id`) and does not expose
 * the Message-Id header. Callers persist the returned `rfcMessageId` onto
 * `interactions.metadata.rfcMessageId` so inbound replies can be threaded
 * back via `In-Reply-To` / `References`.
 *
 * When replying in a thread, pass `inReplyTo` and `references` built by
 * `buildThreadHeaders` (from `lib/email/message-id.ts`). Both are set
 * verbatim on the outgoing message headers.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<{
  success: boolean;
  messageId?: string;
  rfcMessageId?: string;
  error?: string;
}> {
  logger.step("send", `Sending email to ${params.to} — "${params.subject}"`);

  const from = process.env.FROM_EMAIL || "onboarding@resend.dev";
  const domain = extractSenderDomain(from);
  const rfcMessageId = generateRfcMessageId(domain);

  const headers: Record<string, string> = { "Message-Id": rfcMessageId };
  if (params.inReplyTo) headers["In-Reply-To"] = params.inReplyTo;
  if (params.references) headers["References"] = params.references;

  try {
    const { data, error } = await getResend().emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.body.replace(/\n/g, "<br>"),
      replyTo: params.replyTo || process.env.REPLY_TO_EMAIL,
      headers,
    });

    if (error) {
      logger.error("send", `Resend error: ${error.message}`);
      return { success: false, error: error.message };
    }

    logger.success(
      "send",
      `Email delivered — resend_id=${data?.id} rfc_message_id=${rfcMessageId}`
    );
    return { success: true, messageId: data?.id, rfcMessageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("send", `Email exception: ${msg}`);
    return { success: false, error: msg };
  }
}

// ════════════════════════════════════════════════════
// GOOGLE CALENDAR (disabled — enable when OAuth is configured)
// ════════════════════════════════════════════════════

export async function getAvailableSlots(_params: {
  accessToken: string;
  daysAhead?: number;
}): Promise<{ start: string; end: string }[]> {
  logger.warn("calendar", "Google Calendar not configured yet");
  return [];
}

export async function createCalendarEvent(_params: {
  accessToken: string;
  summary: string;
  description: string;
  startTime: string;
  endTime: string;
  attendeeEmail: string;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  return { success: false, error: "Google Calendar not configured yet" };
}
