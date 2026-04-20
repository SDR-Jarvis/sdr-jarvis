import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseICP } from "@/lib/icp/parser";
import { extractICPWithLLM } from "@/lib/icp/llm-extract";
import { findLeads } from "@/lib/discover/engine";
import { scoreAndSortLeads } from "@/lib/icp/scorer";

export const runtime = "nodejs";

/**
 * POST /api/discover/run
 * Body: { icpDescription: string, bypassCache?: boolean }
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

  return NextResponse.json({
    signals,
    leads: scored,
    fromCache: result.fromCache,
    sourceStats: result.sourceStats,
  });
}
