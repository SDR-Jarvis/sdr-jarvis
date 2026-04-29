import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/agents/stop
 * Body: { campaign_id: string } or { campaignId: string }
 * Marks in-flight agent_runs for this campaign as cancelled so the graph exits cooperatively.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { campaign_id?: unknown; campaignId?: unknown };
  try {
    body = (await req.json()) as { campaign_id?: unknown; campaignId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const campaignId =
    (typeof body.campaign_id === "string" && body.campaign_id.trim()) ||
    (typeof body.campaignId === "string" && body.campaignId.trim()) ||
    "";

  if (!campaignId) {
    return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
  }

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (cErr || !campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .in("status", ["running", "waiting_approval"])
    .select("id");

  if (error) {
    console.error("[Pipeline Stop] Failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stopped = data?.length ?? 0;
  console.log("[Pipeline Stop] Stopped runs:", stopped);

  return NextResponse.json({ success: true, stopped_runs: stopped });
}
