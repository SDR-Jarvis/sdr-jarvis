import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendSlackNotification } from "@/lib/slack";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/cron/pending-approvals-notify
 *
 * Daily backup: for each user with pending approvals, Slack at most once per
 * UTC day (deduped per user in audit_log). Service role queries always scope
 * by user_id — never aggregate or dedupe across tenants in one row.
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
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

  const { data: pendingRows, error } = await supabase
    .from("approvals")
    .select("user_id")
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!pendingRows?.length) {
    return NextResponse.json({
      ok: true,
      pending: 0,
      workspacesWithPending: 0,
      notified: 0,
    });
  }

  const byUser = new Map<string, number>();
  for (const row of pendingRows) {
    const uid = row.user_id as string;
    if (!uid) continue;
    byUser.set(uid, (byUser.get(uid) ?? 0) + 1);
  }

  let notified = 0;

  for (const [userId, count] of byUser) {
    const { data: dup } = await supabase
      .from("audit_log")
      .select("id")
      .eq("action", "slack_pending_approvals_reminder")
      .eq("user_id", userId)
      .contains("details", { date_utc: dayKey })
      .limit(1)
      .maybeSingle();

    if (dup) continue;

    void sendSlackNotification(
      `🟡 SDR Jarvis — ${count} approval(s) still pending\n→ Review: ${base}/dashboard/approvals`
    );

    await supabase.from("audit_log").insert({
      user_id: userId,
      action: "slack_pending_approvals_reminder",
      resource_type: "approvals",
      details: { date_utc: dayKey, count },
    });

    notified++;
  }

  return NextResponse.json({
    ok: true,
    pending: pendingRows.length,
    workspacesWithPending: byUser.size,
    notified,
  });
}
