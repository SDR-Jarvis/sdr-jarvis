import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startCampaignRun, cleanup } from "@/lib/agents/jarvis-graph";
import { canProcessLeads, incrementLeadsUsed } from "@/lib/subscription";
import type { LeadData } from "@/lib/agents/state";
import { buildComplianceEmailSuffix } from "@/lib/compliance";
import {
  countLeadsScheduledToday,
  getDailyLeadProcessingCap,
} from "@/lib/usage-limits";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/agents/run
 * Body: { campaignId: string, dryRun?: boolean }
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
  const { campaignId, dryRun } = body as {
    campaignId: string;
    dryRun?: boolean;
  };

  if (!campaignId) {
    return NextResponse.json(
      { error: "campaignId is required" },
      { status: 400 }
    );
  }

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

  const cap = getDailyLeadProcessingCap();
  const usedToday = await countLeadsScheduledToday(supabase, user.id);
  const remaining = Math.max(0, cap - usedToday);
  if (rawLeads.length > remaining) {
    return NextResponse.json(
      {
        error: `Daily lead processing cap is ${cap} (UTC day). Already scheduled ${usedToday} leads today; this run has ${rawLeads.length}. Remaining budget: ${remaining}. Try tomorrow, lower the batch, or ask support to raise DAILY_LEAD_PROCESSING_CAP.`,
      },
      { status: 429 }
    );
  }

  const usageCheck = await canProcessLeads(user.id, rawLeads.length);
  if (!usageCheck.allowed) {
    return NextResponse.json(
      { error: usageCheck.reason },
      { status: 403 }
    );
  }

  if (dryRun !== true) {
    await incrementLeadsUsed(user.id, rawLeads.length);
  }

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("email_opt_out_footer, postal_address")
    .eq("id", user.id)
    .single();

  const complianceEmailSuffix = buildComplianceEmailSuffix({
    optOutLine:
      (profile as { email_opt_out_footer?: string | null } | null)
        ?.email_opt_out_footer ?? "",
    postalAddress:
      (profile as { postal_address?: string | null } | null)?.postal_address ??
      null,
  });

  const threadId = crypto.randomUUID();
  await supabase.from("agent_runs").insert({
    user_id: user.id,
    campaign_id: campaignId,
    thread_id: threadId,
    status: "running",
    current_node: "supervisor",
    leads_count: leads.length,
  });

  await supabase
    .from("campaigns")
    .update({ status: "active" })
    .eq("id", campaignId);

  const encoder = new TextEncoder();
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
          dryRun: dryRun === true,
          complianceEmailSuffix,
        });

        for await (const event of graphStream) {
          const payload = JSON.stringify({
            type: "update",
            threadId,
            data: event,
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }

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
