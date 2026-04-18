import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendSlackNotification } from "@/lib/slack";

export const runtime = "nodejs";

/**
 * POST /api/settings/slack-test — verify Slack incoming webhook (optional env).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  void sendSlackNotification(
    "🔔 SDR Jarvis — Slack notifications are working correctly."
  );

  return NextResponse.json({ success: true });
}
