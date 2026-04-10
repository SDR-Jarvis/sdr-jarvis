import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { JarvisState, type JarvisStateType, type LeadData } from "./state";
import { supervisorNode, routeFromSupervisor } from "./nodes/supervisor";
import { researcherNode } from "./nodes/researcher";
import { outreachNode } from "./nodes/outreach";
import { sendEmail, closeBrowser } from "./tools";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// ════════════════════════════════════════════════════
// APPROVAL GATE — creates approval record in Supabase
// and pauses the graph for human review
// ════════════════════════════════════════════════════

async function approvalGateNode(
  state: JarvisStateType
): Promise<Partial<JarvisStateType>> {
  const lead = state.leads[state.currentLeadIndex];
  const draft = state.draftMessage;

  if (!lead || !draft) {
    logger.error("approval", "Gate reached without lead or draft");
    return { approvalStatus: "rejected" };
  }

  logger.step("approval", `Creating approval record for ${lead.firstName} ${lead.lastName}`);

  try {
    const supabase = createServiceClient();

    // Create the interaction record (draft status)
    const { data: interaction } = await supabase
      .from("interactions")
      .insert({
        lead_id: lead.id,
        campaign_id: state.campaignId,
        user_id: state.userId,
        type: "email_outbound",
        status: "pending_approval",
        subject: draft.subject,
        body: draft.body,
        metadata: { channel: draft.channel, personalization: draft.personalizationNotes },
      })
      .select("id")
      .single();

    // Create the approval queue entry
    if (interaction) {
      await supabase.from("approvals").insert({
        user_id: state.userId,
        interaction_id: interaction.id,
        lead_id: lead.id,
        campaign_id: state.campaignId,
        status: "pending",
        preview_subject: draft.subject,
        preview_body: draft.body,
        channel: draft.channel,
        agent_notes: draft.personalizationNotes,
      });
    }

    // Update lead status
    await supabase
      .from("leads")
      .update({
        status: "pending_approval",
        research_data: state.researchData,
        enrichment_score: state.researchData?.score ?? null,
      })
      .eq("id", lead.id);

    // Update agent run status
    if (state.campaignId) {
      await supabase
        .from("agent_runs")
        .update({ status: "waiting_approval", current_node: "approval_gate" })
        .eq("campaign_id", state.campaignId)
        .eq("status", "running");
    }

    logger.success("approval", `Approval queued for ${lead.firstName} — waiting for human review`);

    await supabase.from("audit_log").insert({
      user_id: state.userId,
      action: "approval_queued",
      resource_type: "lead",
      resource_id: lead.id,
      details: {
        subject: draft.subject,
        to: lead.email,
        score: state.researchData?.score,
        lead_name: `${lead.firstName} ${lead.lastName}`,
      },
    });
  } catch (err) {
    logger.error("approval", `Failed to create approval record: ${err}`);
  }

  return {
    approvalStatus: "pending",
    messages: [
      new AIMessage(
        `Message for ${lead.firstName} is in the approval queue. Check the dashboard to review, edit, or send.`
      ),
    ],
  };
}

// ════════════════════════════════════════════════════
// SEND NODE — executes after human approval
// ════════════════════════════════════════════════════

async function sendNode(
  state: JarvisStateType
): Promise<Partial<JarvisStateType>> {
  const lead = state.leads[state.currentLeadIndex];
  const draft = state.draftMessage;

  if (!lead?.email || !draft) {
    const reason = !lead?.email ? "no email address" : "no draft";
    logger.warn("send", `Skipping ${lead?.firstName ?? "unknown"}: ${reason}`);
    return {
      approvalStatus: "rejected",
      errors: [`Send: ${reason}`],
      messages: [
        new AIMessage(
          !lead?.email
            ? `No email on file for ${lead?.firstName ?? "this lead"}. Skipping, sir.`
            : "No draft to send."
        ),
      ],
    };
  }

  logger.step("send", `Sending approved email to ${lead.email}`);

  const result = await sendEmail({
    to: lead.email,
    subject: draft.subject,
    body: draft.body,
  });

  // Persist to Supabase
  try {
    const supabase = createServiceClient();

    await supabase
      .from("interactions")
      .update({
        status: result.success ? "sent" : "failed",
        metadata: { messageId: result.messageId, channel: draft.channel, error: result.error },
        sent_at: result.success ? new Date().toISOString() : null,
      })
      .eq("lead_id", lead.id)
      .eq("campaign_id", state.campaignId)
      .eq("status", "pending_approval");

    await supabase
      .from("leads")
      .update({
        status: result.success ? "sent" : "bounced",
        last_contacted_at: result.success ? new Date().toISOString() : undefined,
      })
      .eq("id", lead.id);

    await supabase.from("audit_log").insert({
      user_id: state.userId,
      action: result.success ? "email_sent" : "email_failed",
      resource_type: "lead",
      resource_id: lead.id,
      details: {
        subject: draft.subject,
        to: lead.email,
        messageId: result.messageId,
        error: result.error,
        lead_name: `${lead.firstName} ${lead.lastName}`,
      },
    });
  } catch {
    // Best-effort DB logging
  }

  if (!result.success) {
    logger.error("send", `Failed: ${result.error}`);
    return {
      approvalStatus: "rejected",
      errors: [`Send failed: ${result.error}`],
      messages: [
        new AIMessage(
          `Email to ${lead.firstName} bounced: ${result.error}. Flagged and moving on.`
        ),
      ],
    };
  }

  logger.success("send", `Delivered to ${lead.email}`);
  return {
    approvalStatus: "approved",
    messages: [
      new AIMessage(`Sent to ${lead.firstName} ${lead.lastName} (${lead.email}). On to the next.`),
    ],
  };
}

// ════════════════════════════════════════════════════
// GRAPH DEFINITION
// ════════════════════════════════════════════════════

const checkpointer = new MemorySaver();

const workflow = new StateGraph(JarvisState)
  .addNode("supervisor", supervisorNode)
  .addNode("researcher", researcherNode)
  .addNode("outreach", outreachNode)
  .addNode("approval_gate", approvalGateNode)
  .addNode("send", sendNode)

  .addEdge(START, "supervisor")

  .addConditionalEdges("supervisor", routeFromSupervisor, {
    researcher: "researcher",
    outreach: "outreach",
    send: "approval_gate",
    supervisor: "supervisor",
    done: END,
  })

  .addEdge("researcher", "supervisor")
  .addEdge("outreach", "supervisor")
  .addEdge("approval_gate", "send")
  .addEdge("send", "supervisor");

export const jarvisGraph = workflow.compile({
  checkpointer,
  interruptBefore: ["send"], // Pauses AFTER approval_gate, BEFORE send — human reviews in dashboard
});

// ════════════════════════════════════════════════════
// RUNNER HELPERS
// ════════════════════════════════════════════════════

export async function startCampaignRun(params: {
  userId: string;
  campaignId: string;
  leads: LeadData[];
  threadId?: string;
}) {
  const threadId = params.threadId ?? crypto.randomUUID();

  logger.setUser(params.userId);
  logger.step("graph", `Starting campaign run — ${params.leads.length} leads, thread: ${threadId.slice(0, 8)}…`);

  const config = { configurable: { thread_id: threadId } };

  const initialState = {
    userId: params.userId,
    campaignId: params.campaignId,
    leads: params.leads,
    currentLeadIndex: 0,
    messages: [],
  };

  const stream = await jarvisGraph.stream(initialState, {
    ...config,
    streamMode: "updates",
  });

  return { threadId, stream };
}

export async function resumeAfterApproval(params: {
  threadId: string;
  approved: boolean;
}) {
  const action = params.approved ? "approved" : "rejected";
  logger.step("graph", `Resuming thread ${params.threadId.slice(0, 8)}… — ${action}`);

  const config = { configurable: { thread_id: params.threadId } };

  const stream = await jarvisGraph.stream(
    params.approved
      ? { approvalStatus: "approved" }
      : { approvalStatus: "rejected" },
    { ...config, streamMode: "updates" }
  );

  return { stream };
}

export async function getThreadState(threadId: string) {
  const config = { configurable: { thread_id: threadId } };
  return jarvisGraph.getState(config);
}

export async function cleanup() {
  logger.info("graph", "Cleaning up browser…");
  await closeBrowser();
}
