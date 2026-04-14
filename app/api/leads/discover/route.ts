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

function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) ?? [];
  return [...new Set(matches)]
    .filter((e) => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".svg") && !e.endsWith(".gif"))
    .filter((e) => !e.includes("example.com") && !e.includes("noreply") && !e.includes("unsubscribe") && !e.includes("github.com"));
}

function pickBestEmail(emails: string[]): string | null {
  const personal = emails.find(
    (e) => !e.startsWith("info@") && !e.startsWith("hello@") && !e.startsWith("support@") && !e.startsWith("contact@") && !e.startsWith("sales@")
  );
  return personal || emails[0] || null;
}

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
    return pickBestEmail(extractEmails(html));
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════
// HACKER NEWS
// ══════════════════════════════════════════════════════

async function getHNUserEmail(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://hacker-news.firebaseio.com/v0/user/${username}.json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const user = await res.json();
    const about: string = user?.about ?? "";
    const emails = extractEmails(about.replace(/<[^>]+>/g, " "));
    return emails[0] || null;
  } catch {
    return null;
  }
}

interface HNHit {
  title?: string;
  author?: string;
  url?: string;
  objectID?: string;
  points?: number;
  created_at?: string;
}

async function searchHackerNews(
  query: string,
  browse: boolean,
  refresh: number
): Promise<DiscoveredLead[]> {
  try {
    const page = browse ? Math.min(refresh % 8, 7) : Math.min(refresh % 5, 4);
    const endpoint = browse
      ? `https://hn.algolia.com/api/v1/search?tags=show_hn&hitsPerPage=40&page=${page}`
      : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=show_hn&hitsPerPage=40&page=${page}`;

    const res = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const hits: HNHit[] = ((await res.json()).hits ?? []) as HNHit[];
    // Rotate through hit list when browsing so repeat searches don't start from identical rows
    const offset = browse ? (refresh % 5) * 3 : 0;
    const rotated = [...hits.slice(offset), ...hits.slice(0, offset)];
    const leads: DiscoveredLead[] = [];

    for (let i = 0; i < rotated.length && leads.length < 12; i += 10) {
      const batch = rotated.slice(i, i + 10);
      const profiles = await Promise.all(
        batch.map(async (hit) => {
          const author = hit.author ?? "Unknown";
          const title = hit.title ?? "";
          const company = title.replace(/^Show HN:\s*/i, "").split(/[-–—:,(]/)[0].trim();

          let email: string | null = null;
          if (author !== "Unknown") email = await getHNUserEmail(author);
          if (!email && hit.url) email = await scrapeEmailFromUrl(hit.url);

          return {
            name: author,
            company: company.slice(0, 60),
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            source: "Hacker News",
            description: title,
            postedAt: hit.created_at ?? "",
            score: hit.points ?? 0,
            email: email ?? "",
          };
        })
      );
      for (const l of profiles) { if (l.email) leads.push(l); }
    }
    return leads;
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════
// PRODUCT HUNT
// ══════════════════════════════════════════════════════

async function searchProductHunt(query: string, refresh: number): Promise<DiscoveredLead[]> {
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

// ══════════════════════════════════════════════════════
// GITHUB
// ══════════════════════════════════════════════════════

interface GitHubUser {
  login: string;
  html_url: string;
  avatar_url?: string;
  type: string;
}

interface GitHubProfile {
  login: string;
  name: string | null;
  company: string | null;
  blog: string | null;
  bio: string | null;
  email: string | null;
  html_url: string;
  public_repos: number;
  followers: number;
}

const GITHUB_DEFAULT_QUERIES = [
  "founder in:bio type:user",
  "CEO in:bio type:user",
  "startup in:bio type:user",
  "indiehacker in:bio type:user",
  "building in:bio type:user",
];

async function searchGitHub(query: string, refresh: number): Promise<DiscoveredLead[]> {
  try {
    const searchQuery = query.trim()
      ? `${query} type:user`
      : GITHUB_DEFAULT_QUERIES[refresh % GITHUB_DEFAULT_QUERIES.length];

    const page = 1 + (refresh % 5);
    const res = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(searchQuery)}&sort=followers&per_page=30&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "SDR-Jarvis/1.0",
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return [];

    const data = await res.json();
    const users: GitHubUser[] = (data.items ?? []).filter((u: GitHubUser) => u.type === "User");

    const leads: DiscoveredLead[] = [];

    // Fetch profiles in batches of 8 (GitHub allows 10 req/min unauthenticated)
    for (let i = 0; i < users.length && leads.length < 15; i += 8) {
      const batch = users.slice(i, i + 8);

      const profiles = await Promise.all(
        batch.map(async (user): Promise<DiscoveredLead | null> => {
          try {
            const profileRes = await fetch(
              `https://api.github.com/users/${user.login}`,
              {
                headers: {
                  Accept: "application/vnd.github+json",
                  "User-Agent": "SDR-Jarvis/1.0",
                },
                signal: AbortSignal.timeout(5000),
              }
            );
            if (!profileRes.ok) return null;

            const profile: GitHubProfile = await profileRes.json();

            let email = profile.email;

            // Try extracting email from bio
            if (!email && profile.bio) {
              const bioEmails = extractEmails(profile.bio);
              email = bioEmails[0] || null;
            }

            // Try scraping their blog/website
            if (!email && profile.blog) {
              const blogUrl = profile.blog.startsWith("http")
                ? profile.blog
                : `https://${profile.blog}`;
              email = await scrapeEmailFromUrl(blogUrl);
            }

            if (!email) return null;

            const displayName = profile.name || profile.login;
            const company = profile.company?.replace(/^@/, "") || "";
            const desc = profile.bio?.slice(0, 120) || `${profile.public_repos} repos, ${profile.followers} followers`;

            return {
              name: displayName,
              company: company.slice(0, 60) || displayName,
              url: profile.html_url,
              source: "GitHub",
              description: desc,
              postedAt: "",
              score: profile.followers,
              email,
            };
          } catch {
            return null;
          }
        })
      );

      for (const lead of profiles) {
        if (lead) leads.push(lead);
      }
    }

    return leads;
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════
// X / TWITTER
// ══════════════════════════════════════════════════════

const TWITTER_DEFAULT_QUERIES = [
  "#buildinpublic founder",
  "indie hacker launching -is:retweet",
  "SaaS founder building -is:retweet",
  "solo founder shipped -is:retweet",
];

async function searchTwitter(query: string, refresh: number): Promise<DiscoveredLead[]> {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) return [];

  try {
    const searchQuery = query.trim()
      ? `${query} (founder OR CEO OR "building" OR "launched")`
      : TWITTER_DEFAULT_QUERIES[refresh % TWITTER_DEFAULT_QUERIES.length];

    const params = new URLSearchParams({
      query: searchQuery,
      max_results: "20",
      "tweet.fields": "author_id,created_at",
      "user.fields": "name,username,description,url,public_metrics",
      expansions: "author_id",
    });

    const res = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?${params}`,
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "User-Agent": "SDR-Jarvis/1.0",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) return [];

    const data = await res.json();

    interface TwitterUser {
      id: string;
      name: string;
      username: string;
      description?: string;
      url?: string;
      public_metrics?: { followers_count?: number };
    }

    const users: TwitterUser[] = data.includes?.users ?? [];
    const seen = new Set<string>();
    const leads: DiscoveredLead[] = [];

    for (const user of users) {
      if (seen.has(user.username)) continue;
      seen.add(user.username);

      let email: string | null = null;

      // Try extracting email from bio
      if (user.description) {
        const bioEmails = extractEmails(user.description);
        email = bioEmails[0] || null;
      }

      // Try scraping their linked URL
      if (!email && user.url) {
        email = await scrapeEmailFromUrl(user.url);
      }

      if (!email) continue;

      const nameParts = user.name.split(/\s+/);
      const company = user.description?.match(/(?:founder|ceo|building|creator)\s+(?:of\s+|@\s*)?(\w[\w\s]{1,30})/i)?.[1]?.trim() || "";

      leads.push({
        name: user.name,
        company: company.slice(0, 60) || nameParts[0],
        url: `https://x.com/${user.username}`,
        source: "X / Twitter",
        description: (user.description ?? "").slice(0, 120),
        postedAt: "",
        score: user.public_metrics?.followers_count ?? 0,
        email,
      });

      if (leads.length >= 15) break;
    }

    return leads;
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════
// GOOGLE FOUNDER SEARCH
// ══════════════════════════════════════════════════════

const GOOGLE_DEFAULT_QUERIES = [
  "indie hacker founder email contact",
  "solo founder SaaS email contact",
  "startup founder contact email about page",
  "build in public founder email",
];

async function searchGoogleFounders(query: string, refresh: number): Promise<DiscoveredLead[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) return [];

  try {
    const searchQuery = query.trim()
      ? `${query} founder email contact`
      : GOOGLE_DEFAULT_QUERIES[refresh % GOOGLE_DEFAULT_QUERIES.length];

    const start = 1 + (refresh % 5) * 10;
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: searchQuery,
      num: "10",
      start: String(start),
    });

    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];

    const data = await res.json();

    interface GoogleItem {
      title?: string;
      link?: string;
      snippet?: string;
    }

    const items: GoogleItem[] = data.items ?? [];
    const leads: DiscoveredLead[] = [];

    // Scrape each result page for emails (parallel, capped at 8)
    const results = await Promise.all(
      items.slice(0, 8).map(async (item): Promise<DiscoveredLead | null> => {
        if (!item.link) return null;

        // Skip big sites that won't have individual founder emails
        const skip = ["linkedin.com", "facebook.com", "youtube.com", "wikipedia.org", "amazon.com"];
        if (skip.some((s) => item.link!.includes(s))) return null;

        const email = await scrapeEmailFromUrl(item.link);
        if (!email) return null;

        // Extract a name from snippet or title
        const title = item.title ?? "";
        const snippet = item.snippet ?? "";
        const nameMatch = snippet.match(/(?:by|founder|ceo|author)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/);
        const name = nameMatch?.[1] || "Founder";
        const company = title.split(/[-–—|:]/)[0].trim().slice(0, 60);

        return {
          name,
          company: company || "Unknown",
          url: item.link,
          source: "Google",
          description: snippet.slice(0, 120),
          postedAt: "",
          email,
        };
      })
    );

    for (const lead of results) {
      if (lead) leads.push(lead);
    }

    return leads;
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════

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
  const refreshParam = req.nextUrl.searchParams.get("refresh");
  let refresh = parseInt(refreshParam ?? "0", 10);
  if (Number.isNaN(refresh)) refresh = 0;

  const { data: existingRows } = await supabase
    .from("leads")
    .select("email")
    .eq("user_id", user.id)
    .not("email", "is", null);

  const existingEmails = new Set(
    (existingRows ?? [])
      .map((r: { email: string | null }) => r.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e))
  );

  let results: DiscoveredLead[] = [];

  // Run sources in parallel when "all" is selected
  if (source === "all") {
    const [hn, ph, gh, tw, goog] = await Promise.all([
      searchHackerNews(query, !query.trim(), refresh),
      searchProductHunt(query || "saas", refresh),
      searchGitHub(query, refresh),
      searchTwitter(query, refresh),
      searchGoogleFounders(query, refresh),
    ]);
    results.push(...hn, ...ph, ...gh, ...tw, ...goog);
  } else {
    if (source === "hackernews")
      results.push(...(await searchHackerNews(query, !query.trim(), refresh)));
    if (source === "producthunt")
      results.push(...(await searchProductHunt(query || "saas", refresh)));
    if (source === "github") results.push(...(await searchGitHub(query, refresh)));
    if (source === "twitter") results.push(...(await searchTwitter(query, refresh)));
    if (source === "google") results.push(...(await searchGoogleFounders(query, refresh)));
  }

  // Sort by score (followers, points, etc.)
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Deduplicate by email (most important) then by company name
  const seenEmail = new Set<string>();
  const seenCompany = new Set<string>();
  results = results.filter((r) => {
    const emailKey = r.email.toLowerCase();
    const companyKey = r.company.toLowerCase();
    if (seenEmail.has(emailKey)) return false;
    if (seenCompany.has(companyKey)) return false;
    seenEmail.add(emailKey);
    seenCompany.add(companyKey);
    return true;
  });

  const skippedAlreadyImported = results.filter((r) =>
    existingEmails.has(r.email.toLowerCase())
  ).length;
  results = results.filter((r) => !existingEmails.has(r.email.toLowerCase()));

  return NextResponse.json({
    leads: results.slice(0, 50),
    skippedAlreadyImported,
  });
}
