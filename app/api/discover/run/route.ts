import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseICP } from "@/lib/icp/parser";
import { extractICPWithLLM } from "@/lib/icp/llm-extract";
import { findLeads } from "@/lib/discover/engine";
import { scoreAndSortLeads, type ScoredLead } from "@/lib/icp/scorer";
import { isValidLead } from "@/lib/isValidLead";

if (!process.env.APOLLO_API_KEY) {
  console.warn("Apollo API key missing — discovery may be limited.");
}

export const runtime = "nodejs";

/**
 * POST /api/discover/run
 * Body: { icpDescription: string, bypassCache?: boolean }
 *
 * Optional Apollo People Search uses `APOLLO_API_KEY` from server environment
 * (e.g. set in Vercel) — one shared key for all discovery runs.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const icpDescription =
    typeof body.icpDescription === "string" ? body.icpDescription.trim() : "";
  const bypassCache = body.bypassCache === true;
  if (!icpDescription) {
    return NextResponse.json({ error: "icpDescription required" }, { status: 400 });
  }

  console.log("Discovery sources active:", {
    github: true,
    productHunt: true,
    apollo: !!process.env.APOLLO_API_KEY,
  });

  const signals = await parseICP(icpDescription, extractICPWithLLM);
  const result = await findLeads(supabase, user.id, signals, icpDescription, {
    bypassCache,
  });

  if (result.rateLimitError) {
    return NextResponse.json(
      {
        error: "rate_limited",
        nextAvailableAt: result.rateLimitError.nextAvailableAt.toISOString(),
      },
      { status: 429 }
    );
  }

  const scored = scoreAndSortLeads(result.leads, signals);
  const totalFound = scored.length;
  let leadsOut = scored.filter((lead) => isValidLead(lead));
  let totalFiltered = totalFound - leadsOut.length;
  let filterRelaxed = false;

  if (leadsOut.length === 0 && totalFound > 0) {
    leadsOut = scored.slice(0, Math.min(5, scored.length));
    totalFiltered = totalFound - leadsOut.length;
    filterRelaxed = true;
  }

  console.log("Discovery Summary:", {
    found: totalFound,
    filtered: totalFiltered,
    returned: leadsOut.length,
    filterRelaxed,
    fromCache: result.fromCache,
  });

  return NextResponse.json({
    signals,
    leads: leadsOut,
    fromCache: result.fromCache,
    sourceStats: result.sourceStats,
    sourceWarnings: result.sourceWarnings,
    discovery: {
      totalFound,
      totalFiltered,
      returned: leadsOut.length,
      filterRelaxed,
    },
  });
}
