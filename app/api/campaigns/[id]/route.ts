import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/** GET — summary for delete confirmation (counts + name). */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (cErr || !campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { count: leadCount, error: lErr } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);

  const { count: interactionCount, error: iErr } = await supabase
    .from("interactions")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);

  if (lErr) console.error("[Campaign GET] lead count:", lErr);
  if (iErr) console.error("[Campaign GET] interaction count:", iErr);

  return NextResponse.json({
    name: campaign.name,
    leadCount: leadCount ?? 0,
    interactionCount: interactionCount ?? 0,
  });
}

/** DELETE — own campaign only; FK CASCADE removes leads, interactions, approvals. */
export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    console.error("[Campaign Delete] Not found or denied:", id);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase.from("campaigns").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    console.error("[Campaign Delete] FAILED:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log("[Campaign Delete] SUCCESS:", id);
  return NextResponse.json({ ok: true });
}
