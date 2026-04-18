import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { sendSlackNotification } from "@/lib/slack";
import { countSendsTodayUtc } from "@/lib/usage-limits";

export const runtime = "nodejs";
export const maxDuration = 300;

function utcDayStart(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function utcDayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * GET /api/cron/daily-lead-refresh
 * Moves leads from pool campaigns (is_lead_pool) into active campaigns, within caps.
 */
export async function GET(_req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const dayStart = utcDayStart();
  const dayKey = utcDayString();
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

  try {
    const { data: activeCampaigns, error: campErr } = await supabase
      .from("campaigns")
      .select("id, name, user_id, daily_lead_cap")
      .eq("status", "active")
      .eq("is_lead_pool", false);

    if (campErr) {
      logger.error("cron", `daily-lead-refresh campaigns: ${campErr.message}`);
      return NextResponse.json({ error: campErr.message }, { status: 500 });
    }

    type SummaryLine = {
      name: string;
      added: number;
      totalInCampaign: number;
      pendingApproval: number;
    };
    const summary: SummaryLine[] = [];
    let totalMoved = 0;

    if (activeCampaigns?.length) {
      for (const target of activeCampaigns) {
        const { data: poolRows } = await supabase
          .from("campaigns")
          .select("id")
          .eq("user_id", target.user_id)
          .eq("is_lead_pool", true);

        const poolIds = (poolRows ?? []).map((p) => p.id);
        if (poolIds.length === 0) {
          continue;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("warmup_daily_send_cap")
          .eq("id", target.user_id)
          .single();

        const warmupCap =
          (profile as { warmup_daily_send_cap?: number } | null)
            ?.warmup_daily_send_cap ?? 20;
        const sentToday = await countSendsTodayUtc(supabase, target.user_id);
        let warmSlots = Math.max(0, warmupCap - sentToday);
        if (warmSlots <= 0) {
          continue;
        }

        const { count: assignedToday } = await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", target.id)
          .gte("assigned_at", dayStart);

        const cap = target.daily_lead_cap ?? 20;
        let remaining = Math.max(0, cap - (assignedToday ?? 0));
        remaining = Math.min(remaining, warmSlots);
        if (remaining <= 0) continue;

        const { data: poolLeads } = await supabase
          .from("leads")
          .select("id, email")
          .in("campaign_id", poolIds)
          .eq("user_id", target.user_id)
          .in("status", ["new", "researched"])
          .order("assigned_at", { ascending: true })
          .limit(remaining);

        let movedHere = 0;
        for (const pl of poolLeads ?? []) {
          if (movedHere >= remaining) break;
          if (!pl.email?.includes("@")) continue;

          const { error: updErr } = await supabase
            .from("leads")
            .update({
              campaign_id: target.id,
              status: "new",
              assigned_at: new Date().toISOString(),
            })
            .eq("id", pl.id);

          if (updErr) {
            logger.error("cron", `Move lead ${pl.id}: ${updErr.message}`);
            continue;
          }
          movedHere++;
          totalMoved++;
          warmSlots--;
          remaining--;
          if (warmSlots <= 0) break;
        }

        if (movedHere > 0) {
          const { count: totalLeads } = await supabase
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", target.id);

          const { count: pendingAppr } = await supabase
            .from("approvals")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", target.id)
            .eq("status", "pending");

          summary.push({
            name: target.name,
            added: movedHere,
            totalInCampaign: totalLeads ?? 0,
            pendingApproval: pendingAppr ?? 0,
          });
        }
      }
    }

    const { data: existingDigest } = await supabase
      .from("audit_log")
      .select("id")
      .eq("action", "slack_daily_lead_refresh_digest")
      .contains("details", { date_utc: dayKey })
      .limit(1)
      .maybeSingle();

    if (!existingDigest) {
      let digestText: string;
      if (!activeCampaigns?.length) {
        digestText = `ℹ️ SDR Jarvis — No leads added today\nReason: no active campaigns\n→ ${base}/dashboard/leads`;
      } else if (totalMoved > 0) {
        const lines = summary
          .map(
            (s) =>
              `· ${s.name}: +${s.added} leads (${s.totalInCampaign} total, ${s.pendingApproval} pending approval)`
          )
          .join("\n");
        digestText = `☀️ SDR Jarvis — Daily lead update\n\n${lines}\n\nOpen → ${base}/dashboard/campaigns`;
      } else {
        digestText = `ℹ️ SDR Jarvis — No leads added today\nReason: cap reached / pool empty / no active campaigns\n→ ${base}/dashboard/leads`;
      }
      void sendSlackNotification(digestText);
      await supabase.from("audit_log").insert({
        action: "slack_daily_lead_refresh_digest",
        details: {
          date_utc: dayKey,
          moved: totalMoved,
          summary,
          no_active_campaigns: !activeCampaigns?.length,
        },
      });
    }

    return NextResponse.json({
      moved: totalMoved,
      summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("cron", `daily-lead-refresh: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
