import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { JarvisState, type JarvisStateType, type LeadData } from "./state";
import { supervisorNode, routeFromSupervisor } from "./nodes/supervisor";
import { researcherNode } from "./nodes/researcher";
import { outreachNode } from "./nodes/outreach";
import { closeBrowser } from "./tools";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// ════════════════════════════════════════════════════
// APPROVAL GATE — creates approval record in Supabase
// then advances to the next lead (no interrupt)
// ════════════════════════════════════════════════════

async function approvalGateNode(
  state: JarvisStateType
): Promise<Partial<JarvisStateType>> {
  const lead = state.leads[state.currentLeadIndex];
  const draft = state.draftMessage;

  if (!lead || !draft) {
    logger.error("approval", "Gate reached without lead or draft");
    return {
      currentLeadIndex: state.currentLeadIndex + 1,
      researchData: null,
      draftMessage: null,
      approvalStatus: "none",
      nextAgent: "supervisor",
    };
  }

  logger.step("approval", `Queuing draft for ${lead.firstName} ${lead.lastName}`);

  try {
    const supabase = createServiceClient();

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

    await supabase
      .from("leads")
      .update({
        status: "pending_approval",
        research_data: state.researchData,
        enrichment_score: state.researchData?.score ?? null,
      })
      .eq("id", lead.id);

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
        campaign_id: state.campaignId,
      },
    });

    logger.success("approval", `Draft queued for ${lead.firstName} — moving to next lead`);
  } catch (err) {
    logger.error("approval", `Failed to create approval record: ${err}`);
  }

  // Advance to next lead — no interrupt, keep processing
  return {
    currentLeadIndex: state.currentLeadIndex + 1,
    researchData: null,
    draftMessage: null,
    approvalStatus: "none",
    nextAgent: "supervisor",
    messages: [
      new AIMessage(
        `Draft for ${lead.firstName} queued for your review. Moving on.`
      ),
    ],
  };
}

// ════════════════════════════════════════════════════
// GRAPH DEFINITION
// No interrupt — processes ALL leads, queues ALL
// drafts for approval. User reviews in batch.
// ════════════════════════════════════════════════════

const checkpointer = new MemorySaver();

const workflow = new StateGraph(JarvisState)
  .addNode("supervisor", supervisorNode)
  .addNode("researcher", researcherNode)
  .addNode("outreach", outreachNode)
  .addNode("approval_gate", approvalGateNode)

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
  .addEdge("approval_gate", "supervisor");

export const jarvisGraph = workflow.compile({ checkpointer });

// ════════════════════════════════════════════════════
// RUNNER HELPERS
// ════════════════════════════════════════════════════

export async function startCampaignRun(params: {
  userId: string;
  campaignId: string;
  leads: LeadData[];
  threadId?: string;
  recursionLimit?: number;
  dryRun?: boolean;
  complianceEmailSuffix?: string;
  senderDisplayName?: string;
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
    dryRun: params.dryRun ?? false,
    complianceEmailSuffix: params.complianceEmailSuffix ?? "",
    senderDisplayName: params.senderDisplayName ?? "",
  };

  const stream = await jarvisGraph.stream(initialState, {
    ...config,
    streamMode: "updates",
    recursionLimit: params.recursionLimit ?? 50,
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
  logger.info("graph", "Cleaning up…");
  await closeBrowser();
}
