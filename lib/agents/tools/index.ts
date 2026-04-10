import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Resend } from "resend";
import { google } from "googleapis";
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
// BROWSER MANAGEMENT
// ════════════════════════════════════════════════════

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return _browser;
}

async function getPage(): Promise<{ page: Page; context: BrowserContext }> {
  const browser = await getBrowser();
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const context = await browser.newContext({
    userAgent: ua,
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
  });
  const page = await context.newPage();
  return { page, context };
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
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
// LINKEDIN SCRAPING
// ════════════════════════════════════════════════════

export async function scrapeLinkedInProfile(url: string): Promise<string> {
  logger.step("researcher", `Scraping LinkedIn: ${url}`);
  await linkedInLimiter.wait();

  return withRetry(
    async () => {
      const { page, context } = await getPage();
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });

        if (!response || response.status() >= 400) {
          const status = response?.status() ?? "no response";
          logger.warn("researcher", `LinkedIn returned ${status} for ${url}`);
          return `LinkedIn profile unavailable (HTTP ${status}). Using web search as fallback.`;
        }

        // Wait for profile content to render
        await page.waitForSelector("main", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);

        const data = await page.evaluate(() => {
          const getText = (sel: string) =>
            document.querySelector(sel)?.textContent?.trim() ?? "";

          const name =
            getText("h1") ||
            getText(".text-heading-xlarge") ||
            getText('[data-anonymize="person-name"]');

          const headline =
            getText(".text-body-medium.break-words") ||
            getText('[data-anonymize="headline"]');

          const location = getText(".text-body-small.inline.t-black--light.break-words");

          const about = getText("#about ~ div .inline-show-more-text") ||
            getText('[data-anonymize="about-description"]');

          const experienceItems: string[] = [];
          document.querySelectorAll("#experience ~ .pvs-list__outer-container li.artdeco-list__item").forEach((li) => {
            const text = li.textContent?.replace(/\s+/g, " ").trim() ?? "";
            if (text.length > 10) experienceItems.push(text.slice(0, 300));
          });

          const bodyText = document.body.innerText.slice(0, 4000);

          return [
            name && `Name: ${name}`,
            headline && `Headline: ${headline}`,
            location && `Location: ${location}`,
            about && `About: ${about.slice(0, 500)}`,
            experienceItems.length && `Experience:\n${experienceItems.slice(0, 4).join("\n")}`,
            `\nPage extract:\n${bodyText}`,
          ]
            .filter(Boolean)
            .join("\n\n");
        });

        logger.success("researcher", `LinkedIn scraped: ${data.slice(0, 80)}…`);
        return data || "LinkedIn profile loaded but no structured data found.";
      } finally {
        await context.close();
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
      const { page, context } = await getPage();
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });

        if (!response || response.status() >= 400) {
          return `Page unavailable (HTTP ${response?.status() ?? "timeout"})`;
        }

        await page.waitForTimeout(1000);

        const data = await page.evaluate(() => {
          // Remove nav, footer, scripts for cleaner extraction
          document.querySelectorAll("nav, footer, script, style, noscript, iframe, [role='navigation']")
            .forEach((el) => el.remove());

          const title = document.title?.trim() ?? "";
          const meta = document.querySelector('meta[name="description"]')
            ?.getAttribute("content")
            ?.trim() ?? "";
          const body = document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 5000);

          return [
            title && `Title: ${title}`,
            meta && `Description: ${meta}`,
            `\nContent:\n${body}`,
          ]
            .filter(Boolean)
            .join("\n");
        });

        logger.success("researcher", `Page scraped: ${url}`);
        return data;
      } finally {
        await context.close();
      }
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
      const { page, context } = await getPage();
      try {
        await page.goto(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
          { waitUntil: "domcontentloaded", timeout: 12_000 }
        );

        const results = await page.evaluate(() => {
          const items = document.querySelectorAll(".result__body");
          return Array.from(items)
            .slice(0, 6)
            .map((el) => {
              const title = el.querySelector(".result__a")?.textContent?.trim() ?? "";
              const snippet = el.querySelector(".result__snippet")?.textContent?.trim() ?? "";
              const link = el.querySelector(".result__a")?.getAttribute("href") ?? "";
              return `${title}\n${snippet}\n${link}`;
            })
            .filter((r) => r.length > 10)
            .join("\n---\n");
        });

        const count = results.split("---").length;
        logger.success("researcher", `Search returned ${count} results for "${query}"`);
        return results || "No search results found.";
      } finally {
        await context.close();
      }
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
      reply_to: params.replyTo || process.env.REPLY_TO_EMAIL,
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
// GOOGLE CALENDAR
// ════════════════════════════════════════════════════

function getCalendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export async function getAvailableSlots(params: {
  accessToken: string;
  daysAhead?: number;
}): Promise<{ start: string; end: string }[]> {
  const cal = getCalendarClient(params.accessToken);
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
    const cal = getCalendarClient(params.accessToken);
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
