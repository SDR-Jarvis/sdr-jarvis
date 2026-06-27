import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { startCampaignRun, cleanup } from "@/lib/agents/jarvis-graph";
import { canProcessLeads, incrementLeadsUsed } from "@/lib/subscription";
import type { LeadData } from "@/lib/agents/state";
import { buildComplianceEmailSuffix } from "@/lib/compliance";
import { resolveSenderName } from "@/lib/email/signature";
import { sendSlackNotification } from "@/lib/slack";
import { logger } from "@/lib/logger";
import {
  countLeadsScheduledToday,
  getDailyLeadProcessingCap,
} from "@/lib/usage-limits";

export const runtime = "nodejs";
export const maxDuration = 300;

function logPipelineFailure(step: string, err: unknown) {
  console.error("[Pipeline] Fetch failed:", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    step,
  });
}

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

  const { data: campaignRow, error: campaignError } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single();

  if (campaignError || !campaignRow) {
    return NextResponse.json(
      { error: "Campaign not found" },
      { status: 404 }
    );
  }

  const { data: rawLeads, error: leadsError } = await supabase
    .from("leads")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
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
        error: `Daily processing limit is ${cap} (UTC calendar day). You’ve already queued ${usedToday} leads today; this run has ${rawLeads.length}. You can queue ${remaining} more today — try a smaller batch, wait until tomorrow, or contact support if you need a higher limit.`,
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
    discoverySource: l.discovery_source ?? null,
    enrichmentData: (l.enrichment_data as Record<string, unknown> | null) ?? null,
    githubUsername:
      (l.enrichment_data as { github_username?: string } | null)?.github_username ??
      null,
  }));

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "compliance_opt_out_line, compliance_postal_address, full_name, tone_preferences"
    )
    .eq("id", user.id)
    .single();

  const tonePrefs = (profile as { tone_preferences?: Record<string, unknown> } | null)
    ?.tone_preferences;
  const senderSignoff =
    typeof tonePrefs?.signoff === "string" && tonePrefs.signoff.trim()
      ? tonePrefs.signoff.trim()
      : "Best";

  const senderDisplayName = resolveSenderName(
    (profile as { full_name?: string | null } | null)?.full_name
  );

  const ext = profile as {
    compliance_opt_out_line?: string | null;
    compliance_postal_address?: string | null;
  } | null;
  const complianceEmailSuffix = buildComplianceEmailSuffix({
    optOutLine: ext?.compliance_opt_out_line?.trim() ?? "",
    postalAddress: ext?.compliance_postal_address ?? null,
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
    .eq("id", campaignId)
    .eq("user_id", user.id);

  const encoder = new TextEncoder();
  const recursionLimit = Math.max(leads.length * 6 + 10, 50);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let graphStream: Awaited<ReturnType<typeof startCampaignRun>>["stream"];
        try {
          const result = await startCampaignRun({
            userId: user.id,
            campaignId,
            leads,
            threadId,
            recursionLimit,
            dryRun: dryRun === true,
            complianceEmailSuffix,
            senderDisplayName,
            senderSignoff,
          });
          graphStream = result.stream;
        } catch (err) {
          logPipelineFailure("startCampaignRun", err);
          throw err;
        }

        for await (const event of graphStream) {
          const payload = JSON.stringify({
            type: "update",
            threadId,
            data: event,
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }

        if (dryRun !== true) {
          const { data: runRow } = await supabase
            .from("agent_runs")
            .select("id, started_at")
            .eq("thread_id", threadId)
            .eq("user_id", user.id)
            .single();

          if (runRow?.started_at) {
            const service = createServiceClient();
            const { data: dupSlack } = await service
              .from("audit_log")
              .select("id")
              .eq("action", "slack_pipeline_approvals")
              .eq("resource_id", runRow.id)
              .eq("user_id", user.id)
              .limit(1)
              .maybeSingle();

            if (!dupSlack) {
              // Source of truth: approvals row (audit "approval_queued" can be missed or filtered badly)
              const { count: pendingCount, error: pendingErr } = await supabase
                .from("approvals")
                .select("*", { count: "exact", head: true })
                .eq("user_id", user.id)
                .eq("campaign_id", campaignId)
                .eq("status", "pending")
                .gte("created_at", runRow.started_at);

              if (pendingErr) {
                logger.error("slack", `Pending approvals count failed: ${pendingErr.message}`);
              }

              const n = pendingCount ?? 0;

              if (n > 0) {
                const { data: camp } = await supabase
                  .from("campaigns")
                  .select("name")
                  .eq("id", campaignId)
                  .eq("user_id", user.id)
                  .single();
                const base =
                  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
                try {
                  await sendSlackNotification(
                    `🟡 SDR Jarvis — ${n} email(s) ready for approval\nCampaign: ${camp?.name ?? "Campaign"}\n→ Review: ${base}/dashboard/approvals`
                  );
                } catch (err) {
                  logPipelineFailure("sendSlackNotification", err);
                }
                await service.from("audit_log").insert({
                  user_id: user.id,
                  action: "slack_pipeline_approvals",
                  resource_type: "agent_run",
                  resource_id: runRow.id,
                  details: { campaign_id: campaignId, count: n },
                });
              }
            }
          }
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
          .eq("thread_id", threadId)
          .eq("user_id", user.id);
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
