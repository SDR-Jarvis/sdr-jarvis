import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createLLMClient } from "@/lib/llm";
import { sendEmail } from "@/lib/agents/tools";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

interface SequenceConfig {
  steps: number;
  delay_days: number[];
  channels: string[];
}

interface FollowUpCandidate {
  lead_id: string;
  lead_first_name: string;
  lead_last_name: string;
  lead_email: string;
  lead_company: string | null;
  lead_title: string | null;
  lead_research_data: Record<string, unknown> | null;
  campaign_id: string;
  campaign_name: string;
  user_id: string;
  sequence_config: SequenceConfig;
  current_step: number;
  last_subject: string;
  last_body: string;
  last_contacted_at: string;
}

const FOLLOW_UP_PROMPT = `You write follow-up cold emails. This is step {step} of {totalSteps} in a sequence.

CRITICAL RULES:
- This is a FOLLOW-UP, not a new email. Reference the previous email naturally.
- Step 2: Light bump. 2-3 sentences. "Just floating this back up" energy. Add one new angle or insight.
- Step 3 (final): Last touch. 2-3 sentences. Graceful close. "Totally understand if the timing isn't right" energy. Leave the door open.
- NEVER re-introduce yourself or your company in detail.
- NEVER guilt-trip ("I haven't heard back...").
- Subject line: Reply-style ("Re: {originalSubject}") OR a fresh 3-5 word subject.

PREVIOUS EMAIL:
Subject: {prevSubject}
Body: {prevBody}

PROSPECT: {firstName} {lastName}{title}{company}

Return ONLY valid JSON:
{
  "subject": "the subject line",
  "body": "Hi {firstName},\\n\\nThe follow-up body here.",
  "channel": "email",
  "personalizationNotes": "Why this follow-up angle should work."
}`;

/**
 * GET /api/cron/follow-ups
 *
 * Vercel Cron triggers this daily. Finds leads eligible for follow-up,
 * generates drafts, and queues them for human approval.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const { data: sentLeads, error: queryError } = await supabase
      .from("leads")
      .select(`
        id,
        first_name,
        last_name,
        email,
        company,
        title,
        research_data,
        last_contacted_at,
        campaign_id,
        user_id,
        campaigns!inner (
          id,
          name,
          status,
          sequence_config
        )
      `)
      .eq("status", "sent")
      .not("last_contacted_at", "is", null)
      .not("email", "is", null);

    if (queryError) {
      logger.error("cron", `Query error: ${queryError.message}`);
      return NextResponse.json({ error: queryError.message }, { status: 500 });
    }

    if (!sentLeads || sentLeads.length === 0) {
      return NextResponse.json({ processed: 0, message: "No leads eligible for follow-up" });
    }

    const candidates: FollowUpCandidate[] = [];

    for (const lead of sentLeads) {
      const campaign = lead.campaigns as unknown as {
        id: string;
        name: string;
        status: string;
        sequence_config: SequenceConfig;
      };

      if (!campaign || campaign.status !== "active") continue;

      const seqConfig = campaign.sequence_config ?? { steps: 3, delay_days: [0, 3, 7], channels: ["email"] };
      if (seqConfig.steps <= 1) continue;

      const { data: latestInteraction } = await supabase
        .from("interactions")
        .select("sequence_step, subject, body, sent_at")
        .eq("lead_id", lead.id)
        .eq("campaign_id", lead.campaign_id)
        .eq("type", "email_outbound")
        .in("status", ["sent", "delivered"])
        .order("sequence_step", { ascending: false })
        .limit(1)
        .single();

      if (!latestInteraction) continue;

      const currentStep = latestInteraction.sequence_step ?? 1;
      if (currentStep >= seqConfig.steps) continue;

      const { count: replyCount } = await supabase
        .from("interactions")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .eq("campaign_id", lead.campaign_id)
        .eq("type", "email_reply");

      if (replyCount && replyCount > 0) continue;

      const delayDays = seqConfig.delay_days[currentStep] ?? 3;
      const lastContactDate = new Date(lead.last_contacted_at!);
      const nextFollowUpDate = new Date(lastContactDate.getTime() + delayDays * 24 * 60 * 60 * 1000);

      if (new Date() < nextFollowUpDate) continue;

      candidates.push({
        lead_id: lead.id,
        lead_first_name: lead.first_name,
        lead_last_name: lead.last_name,
        lead_email: lead.email!,
        lead_company: lead.company,
        lead_title: lead.title,
        lead_research_data: lead.research_data as Record<string, unknown> | null,
        campaign_id: lead.campaign_id,
        campaign_name: campaign.name,
        user_id: lead.user_id,
        sequence_config: seqConfig,
        current_step: currentStep,
        last_subject: latestInteraction.subject ?? "",
        last_body: latestInteraction.body ?? "",
        last_contacted_at: lead.last_contacted_at!,
      });
    }

    logger.info("cron", `Found ${candidates.length} leads eligible for follow-up`);

    let processed = 0;
    let errors = 0;

    for (const candidate of candidates) {
      try {
        const nextStep = candidate.current_step + 1;

        logger.step("cron", `Generating follow-up step ${nextStep}/${candidate.sequence_config.steps} for ${candidate.lead_first_name} ${candidate.lead_last_name}`);

        const prompt = FOLLOW_UP_PROMPT
          .replace("{step}", String(nextStep))
          .replace("{totalSteps}", String(candidate.sequence_config.steps))
          .replace("{prevSubject}", candidate.last_subject)
          .replace("{prevBody}", candidate.last_body)
          .replace("{firstName}", candidate.lead_first_name)
          .replace("{lastName}", candidate.lead_last_name)
          .replace("{title}", candidate.lead_title ? `, ${candidate.lead_title}` : "")
          .replace("{company}", candidate.lead_company ? ` at ${candidate.lead_company}` : "");

        const llm = createLLMClient({ temperature: 0.85, maxTokens: 500 });
        const response = await llm.invoke([
          { role: "system", content: prompt },
          { role: "user", content: `Write the step ${nextStep} follow-up email.` },
        ]);

        const text = typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error("cron", `LLM returned non-JSON for ${candidate.lead_first_name}`);
          errors++;
          continue;
        }

        const draft = JSON.parse(jsonMatch[0]) as {
          subject: string;
          body: string;
          channel: string;
          personalizationNotes: string;
        };

        const { data: interaction } = await supabase
          .from("interactions")
          .insert({
            lead_id: candidate.lead_id,
            campaign_id: candidate.campaign_id,
            user_id: candidate.user_id,
            type: "email_outbound",
            status: "pending_approval",
            sequence_step: nextStep,
            subject: draft.subject,
            body: draft.body,
            metadata: {
              channel: draft.channel,
              personalization: draft.personalizationNotes,
              is_follow_up: true,
              previous_step: candidate.current_step,
            },
          })
          .select("id")
          .single();

        if (interaction) {
          await supabase.from("approvals").insert({
            user_id: candidate.user_id,
            interaction_id: interaction.id,
            lead_id: candidate.lead_id,
            campaign_id: candidate.campaign_id,
            status: "pending",
            preview_subject: draft.subject,
            preview_body: draft.body,
            channel: draft.channel || "email",
            agent_notes: `Follow-up ${nextStep}/${candidate.sequence_config.steps}: ${draft.personalizationNotes}`,
          });
        }

        await supabase
          .from("leads")
          .update({ status: "pending_approval" })
          .eq("id", candidate.lead_id);

        await supabase.from("audit_log").insert({
          user_id: candidate.user_id,
          action: "follow_up_drafted",
          resource_type: "lead",
          resource_id: candidate.lead_id,
          details: {
            lead_name: `${candidate.lead_first_name} ${candidate.lead_last_name}`,
            campaign_name: candidate.campaign_name,
            step: nextStep,
            total_steps: candidate.sequence_config.steps,
            subject: draft.subject,
          },
        });

        processed++;
        logger.success("cron", `Follow-up queued for ${candidate.lead_first_name} (step ${nextStep})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("cron", `Failed for ${candidate.lead_first_name}: ${msg}`);
        errors++;
      }
    }

    return NextResponse.json({
      processed,
      errors,
      total_candidates: candidates.length,
      message: `Generated ${processed} follow-up drafts, ${errors} errors`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("cron", `Cron job failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
