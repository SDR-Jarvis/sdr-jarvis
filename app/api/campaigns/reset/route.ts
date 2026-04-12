import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaignId } = (await req.json()) as { campaignId: string };
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }

  const service = createServiceClient();

  // Reset all non-sent leads back to "new" so pipeline can pick them up
  const { data: resetLeads } = await service
    .from("leads")
    .update({ status: "new" })
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .in("status", ["new", "researching", "researched", "draft_ready", "pending_approval"])
    .select("id");

  // Clear stale agent runs
  await service
    .from("agent_runs")
    .update({ status: "cancelled" })
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .in("status", ["running", "waiting_approval"]);

  // Delete pending approvals (drafts that were never reviewed)
  await service
    .from("approvals")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .eq("status", "pending");

  // Delete pending_approval interactions
  await service
    .from("interactions")
    .delete()
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .eq("status", "pending_approval");

  // Reset campaign status to draft
  await service
    .from("campaigns")
    .update({ status: "draft" })
    .eq("id", campaignId)
    .eq("user_id", user.id);

  return NextResponse.json({
    success: true,
    resetCount: resetLeads?.length ?? 0,
  });
}
