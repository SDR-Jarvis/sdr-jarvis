import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidLead } from "@/lib/isValidLead";
import { displayLeadCompany } from "@/lib/lead-display";
import type { RawLead } from "@/lib/discover/engine";
import type { ScoredLead } from "@/lib/icp/scorer";

export const runtime = "nodejs";

type DiscoveryLeadInput = {
  name?: string | null;
  username?: string | null;
  email?: string | null;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  url?: string | null;
  source?: string | null;
  icp_label?: string | null;
  icp_score?: number | null;
  icp_match_reason?: string | null;
};

function normalizeIcpLabel(x: string | null | undefined): ScoredLead["icp_label"] {
  if (x === "hot" || x === "maybe" || x === "weak") return x;
  return "maybe";
}

function normalizeSource(s: string | null | undefined): RawLead["source"] {
  const k = (s ?? "").toLowerCase();
  if (k === "github" || k === "hn" || k === "producthunt" || k === "apollo" || k === "manual") {
    return k;
  }
  return "manual";
}

/**
 * POST /api/leads/add-from-discovery
 * Body: { campaign_id: string, leads: DiscoveryLeadInput[] }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { campaign_id?: unknown; leads?: unknown };
  try {
    body = (await req.json()) as { campaign_id?: unknown; leads?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const campaign_id = typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
  const rawLeads = Array.isArray(body.leads) ? body.leads : [];
  if (!campaign_id || rawLeads.length === 0) {
    return NextResponse.json(
      { error: "campaign_id and a non-empty leads array are required" },
      { status: 400 }
    );
  }

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name, user_id")
    .eq("id", campaign_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (campErr || !campaign) {
    console.error("[add-from-discovery] Campaign missing or denied:", campErr);
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const rows: Record<string, unknown>[] = [];

  for (const item of rawLeads as DiscoveryLeadInput[]) {
    const email = typeof item.email === "string" ? item.email.trim() : "";
    if (!email.includes("@") || email.length < 4) continue;

    const url = typeof item.url === "string" && item.url.startsWith("http") ? item.url : null;
    const companyNorm =
      (typeof item.company === "string" ? item.company.trim() : "") ||
      (url?.includes("github.com") ? "Independent Founder" : "");

    const source = normalizeSource(item.source);
    const icp_label = normalizeIcpLabel(item.icp_label ?? undefined);

    const scored: ScoredLead = {
      name: item.name ?? item.username ?? null,
      username: item.username ?? null,
      email,
      title: item.title ?? null,
      company: companyNorm || null,
      bio: item.bio ?? null,
      url,
      source,
      raw_score: 0,
      icp_label,
      icp_match_reason: typeof item.icp_match_reason === "string" ? item.icp_match_reason : "",
      icp_score: typeof item.icp_score === "number" ? item.icp_score : 0,
    };

    if (!isValidLead(scored)) {
      continue;
    }

    const displayName =
      (typeof item.name === "string" ? item.name.trim() : "") ||
      (typeof item.username === "string" ? item.username.trim() : "") ||
      "Contact";
    const parts = displayName.split(/\s+/);
    const first = parts[0] || "Contact";
    const last = parts.slice(1).join(" ") || " ";

    const enrichment: Record<string, string> = {};
    if (source === "github" && typeof item.username === "string" && item.username.trim()) {
      enrichment.github_username = item.username.trim();
    }

    rows.push({
      campaign_id: campaign.id,
      user_id: user.id,
      first_name: first,
      last_name: last,
      company: displayLeadCompany(item.company ?? null),
      company_url: url,
      title: item.title || null,
      email,
      linkedin_url: url?.includes("linkedin.com") ? url : null,
      status: "new" as const,
      discovery_source: source,
      icp_label,
      icp_score: scored.icp_score ?? null,
      icp_match_reason: scored.icp_match_reason || null,
      enrichment_data: Object.keys(enrichment).length ? enrichment : {},
    });
  }

  if (rows.length === 0) {
    console.warn("[add-from-discovery] No valid rows after validation");
    return NextResponse.json(
      { error: "No leads passed validation (email + ICP rules)." },
      { status: 400 }
    );
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("leads")
    .insert(rows)
    .select("id");

  if (insertErr) {
    console.error("[add-from-discovery] Insert FAILED:", insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  const n = inserted?.length ?? 0;
  console.log("[add-from-discovery] SUCCESS:", {
    campaign_id: campaign.id,
    inserted: n,
  });

  return NextResponse.json({
    ok: true,
    count: n,
    campaign_id: campaign.id,
    campaign_name: campaign.name,
  });
}
