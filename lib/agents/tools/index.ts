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

const linkedInLimiter = new RateLimiter(4000, 3000);
const webLimiter = new RateLimiter(1500, 1500);
const searchLimiter = new RateLimiter(2000, 2000);

// ════════════════════════════════════════════════════
// FETCH-BASED SCRAPING (Vercel-compatible, no Playwright)
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
// LINKEDIN SCRAPING (public profile via fetch)
// ════════════════════════════════════════════════════

export async function scrapeLinkedInProfile(url: string): Promise<string> {
  logger.step("researcher", `Scraping LinkedIn: ${url}`);
  await linkedInLimiter.wait();

  return withRetry(
    async () => {
      try {
        const html = await fetchHtml(url);

        if (html.startsWith("HTTP ")) {
          logger.warn("researcher", `LinkedIn returned ${html}`);
          return `LinkedIn profile unavailable (${html}). Using web search as fallback.`;
        }

        const { title } = extractMeta(html);
        const text = extractTextFromHtml(html, 4000);

        const result = [
          title && `Profile: ${title}`,
          `\nPage extract:\n${text}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        logger.success("researcher", `LinkedIn scraped: ${result.slice(0, 80)}…`);
        return result || "LinkedIn profile loaded but no structured data found.";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("researcher", `LinkedIn scrape failed: ${msg}`);
        return `LinkedIn profile unavailable: ${msg}. Using web search as fallback.`;
      }
    },
    1,
    "LinkedIn scrape"
  );
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
// WEB SEARCH (DuckDuckGo HTML)
// ════════════════════════════════════════════════════

export async function searchWeb(query: string): Promise<string> {
  logger.step("researcher", `Searching: "${query}"`);
  await searchLimiter.wait();

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
      logger.success("researcher", `Search returned ${count} results for "${query}"`);
      return results || "No search results found.";
    },
    2,
    "Web search"
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

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  logger.step("send", `Sending email to ${params.to} — "${params.subject}"`);

  try {
    const { data, error } = await getResend().emails.send({
      from: process.env.FROM_EMAIL || "onboarding@resend.dev",
      to: params.to,
      subject: params.subject,
      html: params.body.replace(/\n/g, "<br>"),
      replyTo: params.replyTo || process.env.REPLY_TO_EMAIL,
    });

    if (error) {
      logger.error("send", `Resend error: ${error.message}`);
      return { success: false, error: error.message };
    }

    logger.success("send", `Email delivered — ID: ${data?.id}`);
    return { success: true, messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("send", `Email exception: ${msg}`);
    return { success: false, error: msg };
  }
}

// ════════════════════════════════════════════════════
// GOOGLE CALENDAR (lazy-loaded)
// ════════════════════════════════════════════════════

async function getCalendarClient(accessToken: string) {
  const { google } = await import("googleapis");
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export async function getAvailableSlots(params: {
  accessToken: string;
  daysAhead?: number;
}): Promise<{ start: string; end: string }[]> {
  const cal = await getCalendarClient(params.accessToken);
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + (params.daysAhead ?? 7));

  const { data } = await cal.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const busy = data.calendars?.primary?.busy ?? [];
  const slots: { start: string; end: string }[] = [];

  for (let d = 0; d < (params.daysAhead ?? 7); d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(day);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(30);

      const isBusy = busy.some((b) => {
        const bStart = new Date(b.start!);
        const bEnd = new Date(b.end!);
        return slotStart < bEnd && slotEnd > bStart;
      });

      if (!isBusy) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
    }
  }

  return slots.slice(0, 10);
}

export async function createCalendarEvent(params: {
  accessToken: string;
  summary: string;
  description: string;
  startTime: string;
  endTime: string;
  attendeeEmail: string;
}): Promise<{ success: boolean; eventId?: string; error?: string }> {
  try {
    const cal = await getCalendarClient(params.accessToken);
    const { data } = await cal.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.startTime },
        end: { dateTime: params.endTime },
        attendees: [{ email: params.attendeeEmail }],
      },
    });
    return { success: true, eventId: data.id ?? undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
