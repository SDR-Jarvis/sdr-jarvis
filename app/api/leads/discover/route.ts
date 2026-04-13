import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface DiscoveredLead {
  name: string;
  company: string;
  url: string;
  source: string;
  description: string;
  postedAt: string;
  score?: number;
  email: string;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// ── Extract emails from text ──

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) ?? [];
  return [...new Set(matches)]
    .filter((e) => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".svg"))
    .filter((e) => !e.includes("example.com") && !e.includes("noreply") && !e.includes("unsubscribe"));
}

// ── Fetch a webpage and extract emails from it ──

async function scrapeEmailFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;

    const html = await res.text();
    const emails = extractEmails(html);

    // Prefer personal-looking emails over generic ones
    const personal = emails.find(
      (e) => !e.startsWith("info@") && !e.startsWith("hello@") && !e.startsWith("support@") && !e.startsWith("contact@")
    );
    return personal || emails[0] || null;
  } catch {
    return null;
  }
}

// ── Hacker News: fetch user profile for email ──

async function getHNUserEmail(username: string): Promise<{ email: string | null; about: string }> {
  try {
    const res = await fetch(
      `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { email: null, about: "" };

    const user = await res.json();
    const about: string = user?.about ?? "";

    // Extract email from bio
    const emails = extractEmails(about.replace(/<[^>]+>/g, " "));
    return { email: emails[0] || null, about };
  } catch {
    return { email: null, about: "" };
  }
}

// ── Hacker News API ──

interface HNHit {
  title?: string;
  author?: string;
  url?: string;
  objectID?: string;
  points?: number;
  created_at?: string;
}

async function searchHackerNews(query: string, browse: boolean): Promise<DiscoveredLead[]> {
  try {
    const endpoint = browse
      ? "https://hn.algolia.com/api/v1/search?tags=show_hn&hitsPerPage=40"
      : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=show_hn&hitsPerPage=40`;

    const res = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json();
    const hits: HNHit[] = data.hits ?? [];

    // Fetch user profiles in parallel (batches of 10 to avoid overloading)
    const leads: DiscoveredLead[] = [];
    const batchSize = 10;

    for (let i = 0; i < hits.length && leads.length < 15; i += batchSize) {
      const batch = hits.slice(i, i + batchSize);

      const profiles = await Promise.all(
        batch.map(async (hit) => {
          const author = hit.author ?? "Unknown";
          const title = hit.title ?? "";
          const company = title.replace(/^Show HN:\s*/i, "").split(/[-–—:,(]/)[0].trim();
          const siteUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;

          // Try to get email from HN profile
          let email: string | null = null;
          if (author !== "Unknown") {
            const profile = await getHNUserEmail(author);
            email = profile.email;
          }

          // If no email in profile, try scraping their website
          if (!email && hit.url) {
            email = await scrapeEmailFromUrl(hit.url);
          }

          return {
            name: author,
            company: company.slice(0, 60),
            url: siteUrl,
            source: "Hacker News",
            description: title,
            postedAt: hit.created_at ?? "",
            score: hit.points ?? 0,
            email: email ?? "",
          };
        })
      );

      // Only add leads that have emails
      for (const lead of profiles) {
        if (lead.email) {
          leads.push(lead);
        }
      }
    }

    return leads;
  } catch {
    return [];
  }
}

// ── Product Hunt (scrape for email on product pages) ──

async function searchProductHunt(query: string): Promise<DiscoveredLead[]> {
  try {
    const res = await fetch(
      `https://www.producthunt.com/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return [];

    const html = await res.text();
    const products: { name: string; slug: string }[] = [];
    const nameBlocks = html.match(/<a[^>]*href="\/posts\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi) ?? [];
    const seen = new Set<string>();

    for (const block of nameBlocks.slice(0, 15)) {
      const hrefMatch = block.match(/href="(\/posts\/[^"]*)"/);
      const textMatch = block.match(/>([^<]{3,})</);
      if (!hrefMatch || !textMatch) continue;

      const slug = hrefMatch[1];
      const name = textMatch[1].trim();
      if (seen.has(slug) || name.length > 80) continue;
      seen.add(slug);
      products.push({ name, slug });
    }

    // Try to find emails on product pages
    const leads: DiscoveredLead[] = [];
    for (const product of products.slice(0, 8)) {
      const email = await scrapeEmailFromUrl(`https://www.producthunt.com${product.slug}`);
      if (email) {
        leads.push({
          name: "Founder",
          company: product.name,
          url: `https://www.producthunt.com${product.slug}`,
          source: "Product Hunt",
          description: product.name,
          postedAt: "",
          email,
        });
      }
    }

    return leads;
  } catch {
    return [];
  }
}

// ── Main Handler ──

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = req.nextUrl.searchParams.get("q") ?? "";
  const source = req.nextUrl.searchParams.get("source") ?? "all";

  let results: DiscoveredLead[] = [];

  if (source === "all" || source === "hackernews") {
    const hn = await searchHackerNews(query, !query.trim());
    results.push(...hn);
  }

  if (source === "all" || source === "producthunt") {
    const ph = await searchProductHunt(query || "saas");
    results.push(...ph);
  }

  // Sort: HN by score, others by name
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Deduplicate by company name
  const seen = new Set<string>();
  results = results.filter((r) => {
    const key = r.company.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({ leads: results.slice(0, 30) });
}
