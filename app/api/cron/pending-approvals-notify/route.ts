import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendSlackNotification } from "@/lib/slack";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/cron/pending-approvals-notify
 *
 * Daily backup: if any approvals are still pending, Slack once per UTC day.
 * Covers cases where the pipeline stream ended before the post-run Slack hook ran.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    logger.info("slack", "pending-approvals-notify skipped: SLACK_WEBHOOK_URL unset");
    return NextResponse.json({ ok: true, skipped: true, reason: "no_webhook" });
  }

  const supabase = createServiceClient();
  const dayKey = new Date().toISOString().slice(0, 10);

  const { count, error } = await supabase
    .from("approvals")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const n = count ?? 0;
  if (n === 0) {
    return NextResponse.json({ ok: true, pending: 0, notified: false });
  }

  const { data: dup } = await supabase
    .from("audit_log")
    .select("id")
    .eq("action", "slack_pending_approvals_reminder")
    .contains("details", { date_utc: dayKey })
    .limit(1)
    .maybeSingle();

  if (dup) {
    return NextResponse.json({
      ok: true,
      pending: n,
      notified: false,
      reason: "already_sent_today",
    });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  void sendSlackNotification(
    `🟡 SDR Jarvis — ${n} approval(s) still pending\n→ Review: ${base}/dashboard/approvals`
  );

  await supabase.from("audit_log").insert({
    action: "slack_pending_approvals_reminder",
    details: { date_utc: dayKey, count: n },
  });

  return NextResponse.json({ ok: true, pending: n, notified: true });
}
