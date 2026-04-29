import { createServiceClient } from "@/lib/supabase/server";

/**
 * True when the agent_run row for this LangGraph thread was marked cancelled
 * (user clicked Stop pipeline).
 */
export async function isPipelineRunCancelled(
  threadId: string,
  userId: string
): Promise<boolean> {
  if (!threadId || !userId) return false;
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("agent_runs")
      .select("status")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .maybeSingle();
    return data?.status === "cancelled";
  } catch {
    return false;
  }
}
