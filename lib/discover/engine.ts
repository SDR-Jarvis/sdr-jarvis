/**
 * Lead discovery engine.
 * Set `ENABLE_APOLLO_DISCOVERY=true` and `APOLLO_API_KEY` for Apollo-backed discovery.
 * Apollo is intentionally opt-in; bring-your-own leads is the default path.
 */
import { getApolloDiscoveryKey } from "@/lib/discover/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICPSignals } from "@/lib/icp/parser";
import { hashIcpSignalsSha256 } from "@/lib/icp/hash";

export interface RawLead {
  apollo_id?: string | null;
  name: string | null;
  /** GitHub login (or similar) when display name is missing */
  username?: string | null;
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
  can_be_enriched?: boolean;
}

const HOUR_MS = 3600_000;
const MAX_RUNS_PER_WINDOW = 3;
/** Safety cap per discovery run (deduped). */
const MAX_LEADS_PER_RUN = 50;

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
    .filter((p) => typeof p.login === "string" && (p.login as string).length > 0)
    .map((p) => {
      const login = String(p.login);
      const displayName =
        typeof p.name === "string" && (p.name as string).trim()
          ? (p.name as string).trim()
          : login;
      return emptyLead({
        name: displayName,
        username: login,
        email: (p.email as string) ?? null,
        title: null,
        company:
          typeof p.company === "string"
            ? String(p.company).replace("@", "")
            : null,
        bio: (p.bio as string) ?? null,
        url: (p.blog as string) ?? `https://github.com/${login}`,
        source: "github",
      });
    });
}

async function discoverHN(signals: ICPSignals): Promise<RawLead[]> {
  /* TEMPORARILY DISABLED — HN produces noisy hobby-side projects. Restore by uncommenting below and removing the `return []`.
  const query = [...signals.roles.slice(0, 2), ...signals.industries.slice(0, 2)].join(" ");
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
  */
  void signals;
  return [];
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
    return makers.map((maker) => {
      const uname =
        typeof maker.username === "string" && (maker.username as string).trim()
          ? String(maker.username).trim()
          : null;
      const display =
        typeof maker.name === "string" && (maker.name as string).trim()
          ? String(maker.name).trim()
          : uname;
      return emptyLead({
        name: display,
        username: uname,
        email: null,
        title: (maker.headline as string) ?? null,
        company: (node.name as string) ?? null,
        bio: (node.tagline as string) ?? null,
        url:
          (maker.websiteUrl as string) ??
          (node.website as string) ??
          (uname ? `https://www.producthunt.com/@${uname}` : "https://www.producthunt.com/"),
        source: "producthunt",
      });
    });
  });
}

async function enrichApolloEmail(
  person: Record<string, unknown>,
  apiKey: string
): Promise<string | null> {
  try {
    const org = (person.organization as Record<string, unknown> | undefined) ?? {};
    const response = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        id: person.id,
        first_name: person.first_name,
        organization_name: org.name,
        reveal_personal_emails: true,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Apollo Enrich] Failed:", response.status, errorText);
      return null;
    }
    const data = (await response.json()) as {
      person?: Record<string, unknown> & { email?: string | null };
    };
    console.log(
      "[Apollo Enrich] Person match response keys:",
      Object.keys(data.person ?? {})
    );
    return data.person?.email ?? null;
  } catch (err) {
    console.error("[Apollo Enrich] Exception:", err);
    return null;
  }
}

async function discoverApollo(
  signals: ICPSignals,
  apiKey: string
): Promise<RawLead[]> {
  // Map user's ICP industries to Apollo keywords, but always include AI/SaaS as core scope.
  const userIndustries = signals.industries.slice(0, 3);

  const aiSaasCoreTerms = ["saas", "software", "b2b"];
  const aiTerms = ["artificial intelligence", "machine learning"];

  const industries = [
    ...new Set([
      ...aiSaasCoreTerms,
      ...userIndustries,
      ...(signals.industries.some((i) =>
        ["ai", "ml", "llm", "genai"].some((t) => i.toLowerCase().includes(t))
      )
        ? aiTerms
        : []),
    ]),
  ].slice(0, 6);

  const titles = signals.roles.length
    ? signals.roles.slice(0, 6)
    : ["founder", "co-founder", "ceo", "cto"];

  const sizeMap: Record<string, string[]> = {
    solo: ["1,1"],
    small: ["1,10"],
    any: ["1,50"],
  };
  const sizeRange = sizeMap[signals.company_size] ?? ["1,50"];

  const body = {
    api_key: apiKey,
    person_titles: titles,
    q_organization_keyword_tags: industries,
    organization_num_employees_ranges: sizeRange,
    per_page: 25,
    reveal_personal_emails: true,
  };

  console.log("[Apollo] Query built for AI/SaaS scope:", {
    titles,
    industries,
    sizeRange,
  });

  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as {
    people?: Record<string, unknown>[];
    pagination?: { total_entries?: number };
  };

  console.log("[Apollo] Request sent:", JSON.stringify(body));
  console.log("[Apollo] Results returned:", data.people?.length ?? 0);
  console.log(
    "[Apollo] Total available:",
    data.pagination?.total_entries ?? "unknown"
  );

  if (!response.ok) {
    console.error("[Apollo] API error:", response.status, data);
    return [];
  }

  const people = data.people ?? [];

  // First, log what fields Apollo actually returns
  if (people.length > 0) {
    console.log("[Apollo Debug] First lead fields:", Object.keys(people[0]!));
    console.log(
      "[Apollo Debug] Sample lead:",
      JSON.stringify(people[0], null, 2).slice(0, 1000)
    );
  }

  // Try enrichment for leads with enough data
  const candidatesForEnrichment = people
    .filter((p) => {
      const org = (p.organization as Record<string, unknown> | undefined) ?? {};
      const hasId = typeof p.id === "string" && p.id.length > 0;
      const hasFirst = typeof p.first_name === "string" && p.first_name.length > 0;
      const hasOrg = typeof org.name === "string" && org.name.length > 0;
      const hasEmailFlag = p.has_email === true;
      return hasId && hasFirst && hasOrg && hasEmailFlag;
    })
    .slice(0, 5);

  console.log("[Apollo Enrich] Attempting:", candidatesForEnrichment.length);

  const enrichedEmails = await Promise.allSettled(
    candidatesForEnrichment.map((p) => enrichApolloEmail(p, apiKey))
  );

  const enrichedMap = new Map<string, string>();
  candidatesForEnrichment.forEach((p, i) => {
    const result = enrichedEmails[i];
    const apolloId = typeof p.id === "string" ? p.id : "";
    if (apolloId && result?.status === "fulfilled" && result.value) {
      enrichedMap.set(apolloId, result.value);
    }
  });

  console.log(
    "[Apollo Enrich] Emails found:",
    enrichedMap.size,
    "of",
    candidatesForEnrichment.length
  );

  // Map ALL people to leads, with enriched email if available
  const leads = people.map((p) => {
    const org = (p.organization as Record<string, unknown> | undefined) ?? {};
    const firstName = (typeof p.first_name === "string" ? p.first_name : null) ?? null;
    const lastName =
      (typeof p.last_name === "string" ? p.last_name : null) ??
      (typeof p.last_name_obfuscated === "string" ? p.last_name_obfuscated : null) ??
      null;
    const rawName = typeof p.name === "string" ? p.name : "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || rawName || null;
    const companyName = (typeof org.name === "string" ? org.name : null) ?? null;
    const apolloId = typeof p.id === "string" ? p.id : null;
    const enrichedEmail = apolloId ? enrichedMap.get(apolloId) : undefined;

    return {
      apollo_id: apolloId,
      name: fullName,
      email: enrichedEmail ?? null,
      title: (p.title as string) ?? null,
      company: companyName,
      bio: (p.title as string) ?? null,
      url: (p.linkedin_url as string) ?? null,
      source: "apollo" as const,
      raw_score: 0,
      icp_label: "maybe" as const,
      icp_match_reason: "",
      can_be_enriched: p.has_email === true,
    } satisfies RawLead;
  });

  console.log("[Apollo] Returning leads:", leads.length);
  return leads;
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
  sourceWarnings?: string[];
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

  /** Global Apollo key only — per-user keys in Settings are reserved for future use. */
  const apolloKey = getApolloDiscoveryKey();

  const [githubResult, hnResult, phResult, apolloResult] = await Promise.allSettled([
    discoverGitHub(signals),
    discoverHN(signals),
    discoverProductHunt(signals),
    apolloKey ? discoverApollo(signals, apolloKey) : Promise.resolve([] as RawLead[]),
  ]);

  const flatten = (r: PromiseSettledResult<RawLead[]>) =>
    r.status === "fulfilled" ? r.value : [];

  const sourceFriendly: Record<"github" | "hn" | "producthunt" | "apollo", string> = {
    github: "GitHub",
    hn: "Hacker News",
    producthunt: "Product Hunt",
    apollo: "People search",
  };
  const sourceWarnings: string[] = [];
  const settled = [githubResult, hnResult, phResult, apolloResult] as const;
  (["github", "hn", "producthunt", "apollo"] as const).forEach((key, i) => {
    if (settled[i].status === "rejected") sourceWarnings.push(sourceFriendly[key]);
  });

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
    const key =
      lead.email ??
      lead.url ??
      (lead.username ? `gh:${lead.username}` : null) ??
      lead.name ??
      Math.random().toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const capped = deduped.slice(0, MAX_LEADS_PER_RUN);
  await setCachedLeads(supabase, userId, icpHash, icpDescription, capped, sourceStats);

  return {
    leads: capped,
    fromCache: false,
    sourceStats,
    sourceWarnings: sourceWarnings.length ? sourceWarnings : undefined,
  };
}
