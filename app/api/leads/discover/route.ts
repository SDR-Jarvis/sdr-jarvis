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
}

// ── Hacker News API (free, no auth) ──

async function searchHackerNews(query: string): Promise<DiscoveredLead[]> {
  try {
    const params = new URLSearchParams({
      query,
      tags: "show_hn",
      hitsPerPage: "20",
    });

    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return [];

    const data = await res.json();
    const hits = data.hits ?? [];

    return hits.map(
      (hit: {
        title?: string;
        author?: string;
        url?: string;
        objectID?: string;
        points?: number;
        created_at?: string;
        _highlightResult?: { title?: { value?: string } };
      }) => {
        const title = hit.title ?? "";
        const companyMatch = title.match(/Show HN:\s*(.+?)[\s–—-]+/i);
        const company = companyMatch?.[1]?.trim() || title.replace(/^Show HN:\s*/i, "").split(/[-–—:]/)[0].trim();

        return {
          name: hit.author ?? "Unknown",
          company: company.slice(0, 60),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: "Hacker News",
          description: title,
          postedAt: hit.created_at ?? "",
          score: hit.points ?? 0,
        };
      }
    );
  } catch {
    return [];
  }
}

async function getRecentShowHN(): Promise<DiscoveredLead[]> {
  try {
    const res = await fetch(
      "https://hn.algolia.com/api/v1/search?tags=show_hn&hitsPerPage=30",
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return [];

    const data = await res.json();
    const hits = data.hits ?? [];

    return hits.map(
      (hit: {
        title?: string;
        author?: string;
        url?: string;
        objectID?: string;
        points?: number;
        created_at?: string;
      }) => {
        const title = hit.title ?? "";
        const company = title.replace(/^Show HN:\s*/i, "").split(/[-–—:,(]/)[0].trim();

        return {
          name: hit.author ?? "Unknown",
          company: company.slice(0, 60),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: "Hacker News",
          description: title,
          postedAt: hit.created_at ?? "",
          score: hit.points ?? 0,
        };
      }
    );
  } catch {
    return [];
  }
}

// ── Product Hunt (public page scraping) ──

async function searchProductHunt(query: string): Promise<DiscoveredLead[]> {
  try {
    const res = await fetch(
      `https://www.producthunt.com/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) return [];

    const html = await res.text();

    const products: DiscoveredLead[] = [];
    const nameBlocks =
      html.match(
        /<a[^>]*href="\/posts\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi
      ) ?? [];

    const seen = new Set<string>();

    for (const block of nameBlocks.slice(0, 20)) {
      const hrefMatch = block.match(/href="(\/posts\/[^"]*)"/);
      const textMatch = block.match(/>([^<]{3,})</);
      if (!hrefMatch || !textMatch) continue;

      const slug = hrefMatch[1];
      const name = textMatch[1].trim();

      if (seen.has(slug) || name.length > 80) continue;
      seen.add(slug);

      products.push({
        name: "Founder",
        company: name,
        url: `https://www.producthunt.com${slug}`,
        source: "Product Hunt",
        description: name,
        postedAt: "",
      });
    }

    return products;
  } catch {
    return [];
  }
}

// ── Indie Hackers (public page) ──

async function searchIndieHackers(query: string): Promise<DiscoveredLead[]> {
  try {
    const res = await fetch(
      `https://www.indiehackers.com/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) return [];

    const html = await res.text();

    const leads: DiscoveredLead[] = [];
    const postBlocks =
      html.match(/<a[^>]*href="\/post\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi) ?? [];

    const seen = new Set<string>();

    for (const block of postBlocks.slice(0, 20)) {
      const hrefMatch = block.match(/href="(\/post\/[^"]*)"/);
      const textMatch = block.match(/>([^<]{5,})</);
      if (!hrefMatch || !textMatch) continue;

      const slug = hrefMatch[1];
      const title = textMatch[1].trim();

      if (seen.has(slug) || title.length > 100) continue;
      seen.add(slug);

      leads.push({
        name: "Founder",
        company: title.split(/[-–—:]/)[0].trim().slice(0, 60),
        url: `https://www.indiehackers.com${slug}`,
        source: "Indie Hackers",
        description: title,
        postedAt: "",
      });
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
    const hn = query
      ? await searchHackerNews(query)
      : await getRecentShowHN();
    results.push(...hn);
  }

  if (source === "all" || source === "producthunt") {
    const ph = await searchProductHunt(query || "saas");
    results.push(...ph);
  }

  if (source === "all" || source === "indiehackers") {
    const ih = await searchIndieHackers(query || "launched");
    results.push(...ih);
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

  return NextResponse.json({ leads: results.slice(0, 50) });
}
