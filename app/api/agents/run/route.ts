import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startCampaignRun, cleanup } from "@/lib/agents/jarvis-graph";
import { canProcessLeads, incrementLeadsUsed } from "@/lib/subscription";
import type { LeadData } from "@/lib/agents/state";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/agents/run
 * Starts a LangGraph pipeline for a campaign.
 * Streams events back via SSE so the client gets real-time updates.
 *
 * Body: { campaignId: string }
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
  const { campaignId } = body as { campaignId: string };

  if (!campaignId) {
    return NextResponse.json(
      { error: "campaignId is required" },
      { status: 400 }
    );
  }

  // Fetch leads for this campaign
  const { data: rawLeads, error: leadsError } = await supabase
    .from("leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .in("status", ["new", "researched", "draft_ready"])
    .order("created_at", { ascending: true });

  if (leadsError) {
    return NextResponse.json({ error: leadsError.message }, { status: 500 });
  }

  if (!rawLeads || rawLeads.length === 0) {
    return NextResponse.json(
      { error: "No actionable leads in this campaign" },
      { status: 400 }
    );
  }

  const usageCheck = await canProcessLeads(user.id, rawLeads.length);
  if (!usageCheck.allowed) {
    return NextResponse.json(
      { error: usageCheck.reason },
      { status: 403 }
    );
  }

  await incrementLeadsUsed(user.id, rawLeads.length);

  const leads: LeadData[] = rawLeads.map((l) => ({
    id: l.id,
    firstName: l.first_name,
    lastName: l.last_name,
    email: l.email,
    linkedinUrl: l.linkedin_url,
    title: l.title,
    company: l.company,
    companyUrl: l.company_url,
  }));

  // Create agent_run record
  const threadId = crypto.randomUUID();
  await supabase.from("agent_runs").insert({
    user_id: user.id,
    campaign_id: campaignId,
    thread_id: threadId,
    status: "running",
    current_node: "supervisor",
  });

  // Update campaign status
  await supabase
    .from("campaigns")
    .update({ status: "active" })
    .eq("id", campaignId);

  // Stream graph events via SSE
  const encoder = new TextEncoder();
  // Each lead needs ~5 graph steps (supervisor→researcher→supervisor→outreach→supervisor→gate→supervisor)
  // Leads without email need 2 steps. Add buffer.
  const recursionLimit = Math.max(leads.length * 6 + 10, 50);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { stream: graphStream } = await startCampaignRun({
          userId: user.id,
          campaignId,
          leads,
          threadId,
          recursionLimit,
        });

        for await (const event of graphStream) {
          const payload = JSON.stringify({
            type: "update",
            threadId,
            data: event,
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }

        // Graph completed — all leads processed
        await supabase
          .from("agent_runs")
          .update({ status: "completed", current_node: "done" })
          .eq("thread_id", threadId);

        await supabase
          .from("campaigns")
          .update({ status: "active" })
          .eq("id", campaignId);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "done", threadId })}\n\n`
          )
        );
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: errMsg })}\n\n`
          )
        );

        await supabase
          .from("agent_runs")
          .update({ status: "failed", error_message: errMsg })
          .eq("thread_id", threadId);
      } finally {
        await cleanup();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
