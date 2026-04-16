import type { SupabaseClient } from "@supabase/supabase-js";

export function getDailyLeadProcessingCap(): number {
  const n = parseInt(process.env.DAILY_LEAD_PROCESSING_CAP ?? "30", 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** Sum leads_count from agent_runs started today (UTC midnight). */
export async function countLeadsScheduledToday(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("agent_runs")
    .select("leads_count")
    .eq("user_id", userId)
    .gte("started_at", start.toISOString());

  return (data ?? []).reduce((s, row) => s + (row.leads_count ?? 0), 0);
}

export async function countSendsTodayUtc(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("interactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "email_outbound")
    .eq("status", "sent")
    .gte("sent_at", start.toISOString());

  return count ?? 0;
}
