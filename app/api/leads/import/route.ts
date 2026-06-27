import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ImportLeadInput = {
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  linkedin_url?: unknown;
  title?: unknown;
  company?: unknown;
  company_url?: unknown;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string | null {
  const email = cleanString(value).toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizeUrl(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] ?? "",
    last: parts.slice(1).join(" ") || " ",
  };
}

function namePartsFromEmail(email: string): { first: string; last: string } {
  const local = email.split("@")[0]?.replace(/[^a-zA-Z0-9._-]+/g, ".") ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
  if (parts.length >= 2) return { first: cap(parts[0]), last: cap(parts.slice(1).join(" ")) };
  return { first: cap(parts[0] ?? "Contact") || "Contact", last: " " };
}

function normalizeLead(input: ImportLeadInput) {
  const email = normalizeEmail(input.email);
  const fullName = cleanString(input.full_name);
  const fromFullName = splitName(fullName);
  const fromEmail = email ? namePartsFromEmail(email) : { first: "", last: "" };
  const firstName = cleanString(input.first_name) || fromFullName.first || fromEmail.first;
  const lastName = cleanString(input.last_name) || fromFullName.last || fromEmail.last || " ";
  const company = cleanString(input.company);
  const companyUrl = normalizeUrl(input.company_url);
  const linkedinUrl = normalizeUrl(input.linkedin_url);
  const title = cleanString(input.title);

  const errors: string[] = [];
  if (!firstName) errors.push("name");
  if (!company) errors.push("company");
  if (!email && !companyUrl && !linkedinUrl) errors.push("email or URL");

  return {
    row: {
      first_name: firstName || "Contact",
      last_name: lastName || " ",
      email,
      linkedin_url: linkedinUrl,
      title: title || null,
      company: company || null,
      company_url: companyUrl,
      status: "new" as const,
      discovery_source: "manual",
      enrichment_data: {
        byo: {
          source: "import",
          importedAt: new Date().toISOString(),
          providedFields: {
            name: Boolean(firstName || fullName),
            title: Boolean(title),
            company: Boolean(company),
            email: Boolean(email),
            companyUrl: Boolean(companyUrl),
            linkedinUrl: Boolean(linkedinUrl),
          },
        },
      },
    },
    errors,
  };
}

/**
 * POST /api/leads/import
 * Body: { campaign_id: string, leads: ImportLeadInput[] }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { campaign_id?: unknown; leads?: unknown };
  try {
    body = (await req.json()) as { campaign_id?: unknown; leads?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const campaignId = cleanString(body.campaign_id);
  const rawLeads = Array.isArray(body.leads) ? (body.leads as ImportLeadInput[]) : [];
  if (!campaignId || rawLeads.length === 0) {
    return NextResponse.json(
      { error: "campaign_id and a non-empty leads array are required" },
      { status: 400 }
    );
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, user_id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (campaignError || !campaign) {
    return NextResponse.json({ error: "Campaign not found or not yours" }, { status: 404 });
  }

  const { data: existingRows } = await supabase
    .from("leads")
    .select("email")
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .not("email", "is", null);

  const seenEmails = new Set(
    (existingRows ?? [])
      .map((lead) => cleanString((lead as { email?: unknown }).email).toLowerCase())
      .filter(Boolean)
  );

  const rows: Record<string, unknown>[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  let duplicateCount = 0;

  rawLeads.forEach((lead, index) => {
    const normalized = normalizeLead(lead);
    if (normalized.errors.length) {
      rejected.push({ index, reason: `Missing or invalid ${normalized.errors.join(", ")}` });
      return;
    }

    const email = normalized.row.email;
    if (email && seenEmails.has(email)) {
      duplicateCount += 1;
      return;
    }

    rows.push({
      ...normalized.row,
      campaign_id: campaignId,
      user_id: user.id,
    });
    if (email) seenEmails.add(email);
  });

  if (rows.length === 0) {
    return NextResponse.json({
      success: true,
      added: 0,
      skipped: duplicateCount,
      rejected,
      message: "No new leads to import.",
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("leads")
    .insert(rows)
    .select("id");

  if (insertError) {
    return NextResponse.json({ error: `Import failed: ${insertError.message}` }, { status: 500 });
  }

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id);

  await supabase
    .from("campaigns")
    .update({
      stats: {
        total_leads: count ?? rows.length,
        researched: 0,
        drafted: 0,
        sent: 0,
        replied: 0,
        booked: 0,
      },
    })
    .eq("id", campaignId)
    .eq("user_id", user.id);

  return NextResponse.json({
    success: true,
    added: inserted?.length ?? 0,
    skipped: duplicateCount,
    rejected,
  });
}
