import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICPSignals } from "@/lib/icp/parser";
import { hashIcpSignalsSha256 } from "@/lib/icp/hash";

export interface RawLead {
  name: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  bio: string | null;
  url: string | null;
  source: "github" | "hn" | "producthunt" | "apollo" | "manual";
  raw_score: number;
  icp_label: "hot" | "maybe" | "weak";
  icp_match_reason: string;
  icp_score?: number;
}

const HOUR_MS = 3600_000;
const MAX_RUNS_PER_WINDOW = 3;

async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; nextAvailableAt?: Date }> {
  const { data } = await supabase
    .from("discovery_rate_limits")
    .select("run_count, window_start")
    .eq("user_id", userId)
    .maybeSingle();

  const now = new Date();
  const windowStart = data?.window_start ? new Date(data.window_start as string) : now;
  const hourElapsed = now.getTime() - windowStart.getTime() > HOUR_MS;

  if (!data || hourElapsed) {
    await supabase.from("discovery_rate_limits").upsert(
      {
        user_id: userId,
        run_count: 1,
        window_start: now.toISOString(),
      },
      { onConflict: "user_id" }
    );
    return { allowed: true };
  }

  const count = (data.run_count as number) ?? 0;
  if (count >= MAX_RUNS_PER_WINDOW) {
    return {
      allowed: false,
      nextAvailableAt: new Date(windowStart.getTime() + HOUR_MS),
    };
  }

  await supabase
    .from("discovery_rate_limits")
    .update({ run_count: count + 1 })
    .eq("user_id", userId);

  return { allowed: true };
}

async function getCachedLeads(
  supabase: SupabaseClient,
  userId: string,
  icpHash: string
): Promise<RawLead[] | null> {
  const { data } = await supabase
    .from("icp_discovery_cache")
    .select("leads, expires_at")
    .eq("user_id", userId)
    .eq("icp_hash", icpHash)
    .maybeSingle();

  if (!data?.expires_at) return null;
  if (new Date(data.expires_at as string) < new Date()) return null;
  return (data.leads as RawLead[]) ?? null;
}

async function setCachedLeads(
  supabase: SupabaseClient,
  userId: string,
  icpHash: string,
  description: string,
  leads: RawLead[],
  sourceStats: Record<string, number>
): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * HOUR_MS).toISOString();
  await supabase.from("icp_discovery_cache").upsert(
    {
      user_id: userId,
      icp_hash: icpHash,
      icp_description: description,
      leads,
      source_stats: sourceStats,
      expires_at: expiresAt,
    },
    { onConflict: "user_id,icp_hash" }
  );
}

function emptyLead(
  partial: Omit<RawLead, "raw_score" | "icp_label" | "icp_match_reason">
): RawLead {
  return {
    ...partial,
    raw_score: 0,
    icp_label: "maybe",
    icp_match_reason: "",
  };
}

async function discoverGitHub(signals: ICPSignals): Promise<RawLead[]> {
  const query = [...signals.roles.slice(0, 2), ...signals.keywords.slice(0, 3)].join(
    "+"
  );
  if (!query.trim()) return [];

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "SDR-Jarvis/1.0",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(
    `https://api.github.com/search/users?q=${encodeURIComponent(query)}+in:bio&per_page=10&sort=followers`,
    { headers, next: { revalidate: 3600 } }
  );
  if (!response.ok) return [];

  const data = (await response.json()) as { items?: { login: string }[] };
  if (!data.items?.length) return [];

  const profiles = await Promise.allSettled(
    data.items.slice(0, 8).map(async (user) => {
      const res = await fetch(`https://api.github.com/users/${user.login}`, {
        headers,
        next: { revalidate: 3600 },
      });
      return res.ok ? res.json() : null;
    })
  );

  return profiles
    .filter(
      (r): r is PromiseFulfilledResult<Record<string, unknown> | null> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value as Record<string, unknown>)
    .filter((p) => p.email || p.blog)
    .map((p) =>
      emptyLead({
        name: (p.name as string) ?? (p.login as string),
        email: (p.email as string) ?? null,
        title: null,
        company:
          typeof p.company === "string"
            ? String(p.company).replace("@", "")
            : null,
        bio: (p.bio as string) ?? null,
        url: (p.blog as string) ?? `https://github.com/${p.login as string}`,
        source: "github",
      })
    );
}

async function discoverHN(signals: ICPSignals): Promise<RawLead[]> {
  const query = [...signals.roles.slice(0, 2), ...signals.industries.slice(0, 2)].join(
    " "
  );
  if (!query.trim()) return [];

  const response = await fetch(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=ask_hn&hitsPerPage=10`,
    { next: { revalidate: 3600 } }
  );
  if (!response.ok) return [];

  const data = (await response.json()) as { hits?: { author?: string; story_text?: string }[] };
  if (!data.hits?.length) return [];

  return data.hits
    .filter((hit) => hit.author)
    .map((hit) =>
      emptyLead({
        name: hit.author ?? null,
        email: null,
        title: null,
        company: null,
        bio: hit.story_text?.slice(0, 200) ?? null,
        url: `https://news.ycombinator.com/user?id=${hit.author}`,
        source: "hn",
      })
    );
}

async function discoverProductHunt(signals: ICPSignals): Promise<RawLead[]> {
  const token = process.env.PRODUCT_HUNT_TOKEN?.trim();
  if (!token) return [];

  const topic =
    signals.industries[0] ?? signals.keywords[0] ?? "productivity";
  const query = `
    query {
      posts(first: 10, topic: "${topic.replace(/"/g, "")}", order: RANKING) {
        edges {
          node {
            name
            tagline
            website
            makers {
              name
              username
              websiteUrl
              headline
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
    next: { revalidate: 3600 },
  });
  if (!response.ok) return [];

  const json = (await response.json()) as {
    data?: { posts?: { edges?: { node: Record<string, unknown> }[] } };
  };
  const posts = json?.data?.posts?.edges ?? [];

  return posts.flatMap((edge) => {
    const node = edge.node;
    const makers = (node.makers as Record<string, unknown>[]) ?? [];
    return makers.map((maker) =>
      emptyLead({
        name: (maker.name as string) ?? null,
        email: null,
        title: (maker.headline as string) ?? null,
        company: (node.name as string) ?? null,
        bio: (node.tagline as string) ?? null,
        url:
          (maker.websiteUrl as string) ??
          (node.website as string) ??
          `https://www.producthunt.com/@${maker.username}`,
        source: "producthunt",
      })
    );
  });
}

async function discoverApollo(
  signals: ICPSignals,
  apiKey: string
): Promise<RawLead[]> {
  const sizeMap: Record<string, string[]> = {
    solo: ["1,1"],
    small: ["1,10"],
    any: ["1,200"],
  };

  // Apollo (2024+): People API Search — master key in `X-Api-Key` header only;
  // POST /api/v1/mixed_people/api_search with filters as query params.
  const ranges = sizeMap[signals.company_size] ?? ["1,50"];
  const params = new URLSearchParams();
  for (const t of signals.roles.slice(0, 5)) {
    const v = t.trim();
    if (v) params.append("person_titles[]", v);
  }
  for (const r of ranges) {
    params.append("organization_num_employees_ranges[]", r);
  }
  const keywordBits = [
    ...signals.industries.slice(0, 3),
    ...signals.keywords.slice(0, 4),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (keywordBits) params.set("q_keywords", keywordBits.slice(0, 200));
  params.set("per_page", "15");
  params.set("page", "1");

  const url = `https://api.apollo.io/api/v1/mixed_people/api_search?${params.toString()}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: "{}",
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    people?: Record<string, unknown>[];
  };

  return (data.people ?? []).map((p) => {
    const org = p.organization as Record<string, unknown> | undefined;
    const last =
      (typeof p.last_name === "string" && p.last_name) ||
      (typeof p.last_name_obfuscated === "string" && p.last_name_obfuscated) ||
      "";
    const first = typeof p.first_name === "string" ? p.first_name : "";
    const name = `${first} ${last}`.trim() || "Unknown";
    return emptyLead({
      name,
      // People API Search does not return email/phone; enrichment is a separate call.
      email: (p.email as string) ?? null,
      title: (p.title as string) ?? null,
      company: (org?.name as string) ?? null,
      bio: null,
      url: (p.linkedin_url as string) ?? null,
      source: "apollo",
    });
  });
}

export async function findLeads(
  supabase: SupabaseClient,
  userId: string,
  signals: ICPSignals,
  icpDescription: string,
  options: { bypassCache?: boolean } = {}
): Promise<{
  leads: RawLead[];
  fromCache: boolean;
  sourceStats: Record<string, number>;
  rateLimitError?: { nextAvailableAt: Date };
}> {
  const rateLimit = await checkRateLimit(supabase, userId);
  if (!rateLimit.allowed) {
    return {
      leads: [],
      fromCache: false,
      sourceStats: {},
      rateLimitError: { nextAvailableAt: rateLimit.nextAvailableAt! },
    };
  }

  const icpHash = hashIcpSignalsSha256(signals);
  if (!options.bypassCache) {
    const cached = await getCachedLeads(supabase, userId, icpHash);
    if (cached?.length) {
      return { leads: cached, fromCache: true, sourceStats: {} };
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("apollo_api_key")
    .eq("id", userId)
    .single();

  const row = profile as { apollo_api_key?: string | null } | null;
  const apolloKey =
    row?.apollo_api_key?.trim() || process.env.APOLLO_API_KEY?.trim() || null;

  const [githubResult, hnResult, phResult, apolloResult] = await Promise.allSettled([
    discoverGitHub(signals),
    discoverHN(signals),
    discoverProductHunt(signals),
    apolloKey ? discoverApollo(signals, apolloKey) : Promise.resolve([] as RawLead[]),
  ]);

  const flatten = (r: PromiseSettledResult<RawLead[]>) =>
    r.status === "fulfilled" ? r.value : [];

  const g = flatten(githubResult);
  const h = flatten(hnResult);
  const p = flatten(phResult);
  const a = flatten(apolloResult);

  const sourceStats = {
    github: g.length,
    hn: h.length,
    producthunt: p.length,
    apollo: a.length,
  };

  const allLeads = [...p, ...a, ...g, ...h];
  const seen = new Set<string>();
  const deduped = allLeads.filter((lead) => {
    const key = lead.email ?? lead.url ?? lead.name ?? Math.random().toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const capped = deduped.slice(0, 25);
  await setCachedLeads(supabase, userId, icpHash, icpDescription, capped, sourceStats);

  return { leads: capped, fromCache: false, sourceStats };
}
