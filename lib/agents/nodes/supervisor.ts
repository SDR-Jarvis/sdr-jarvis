import { AIMessage } from "@langchain/core/messages";
import { createLLMClient, JARVIS_SYSTEM_PROMPT } from "@/lib/llm";
import { logger } from "@/lib/logger";
import type { JarvisStateType } from "../state";

export async function supervisorNode(
  state: JarvisStateType
): Promise<Partial<JarvisStateType>> {
  const lead = state.leads[state.currentLeadIndex];
  const idx = state.currentLeadIndex + 1;
  const total = state.leads.length;

  // All leads processed
  if (!lead) {
    logger.success("supervisor", `Pipeline complete — ${total} leads processed`);
    return {
      nextAgent: "done",
      messages: [
        new AIMessage(
          total === 0
            ? "No leads to process, sir. Upload some targets and I'll get to work."
            : `All ${total} leads handled. Check the approvals queue for anything pending your review.`
        ),
      ],
    };
  }

  const name = `${lead.firstName} ${lead.lastName}`;

  // Needs research
  if (!state.researchData) {
    logger.step("supervisor", `[${idx}/${total}] ${name} → researcher`);
    return {
      nextAgent: "researcher",
      messages: [
        new AIMessage(`[${idx}/${total}] Pulling intel on ${name}${lead.company ? ` at ${lead.company}` : ""}…`),
      ],
    };
  }

  // Needs draft
  if (!state.draftMessage) {
    logger.step("supervisor", `[${idx}/${total}] ${name} → outreach (score: ${state.researchData.score})`);
    return {
      nextAgent: "outreach",
      messages: [
        new AIMessage(`Intel on ${lead.firstName} looks ${state.researchData.score >= 60 ? "solid" : "workable"}. Writing the message now.`),
      ],
    };
  }

  // Has draft, needs approval → route to approval gate (mapped as "send" in graph edges)
  if (state.approvalStatus === "none") {
    logger.step("supervisor", `[${idx}/${total}] ${name} → approval queue`);
    return {
      nextAgent: "send",
    };
  }

  // Waiting for approval (shouldn't normally reach here — graph interrupts)
  if (state.approvalStatus === "pending") {
    logger.info("supervisor", `${name} is pending approval`);
    return { nextAgent: "done" };
  }

  // Approved — send already executed, advance to next lead
  if (state.approvalStatus === "approved") {
    logger.success("supervisor", `[${idx}/${total}] ${name} — sent, advancing`);
    return {
      currentLeadIndex: state.currentLeadIndex + 1,
      researchData: null,
      draftMessage: null,
      approvalStatus: "none",
      nextAgent: "supervisor",
      messages: [
        new AIMessage(`${lead.firstName}'s email is away. ${total - idx > 0 ? `${total - idx} left.` : "That was the last one."}`),
      ],
    };
  }

  // Rejected — skip
  if (state.approvalStatus === "rejected") {
    logger.info("supervisor", `[${idx}/${total}] ${name} — rejected, skipping`);
    return {
      currentLeadIndex: state.currentLeadIndex + 1,
      researchData: null,
      draftMessage: null,
      approvalStatus: "none",
      nextAgent: "supervisor",
      messages: [
        new AIMessage(`Scrapped the draft for ${lead.firstName}. Moving on.`),
      ],
    };
  }

  return { nextAgent: "done" };
}

export function routeFromSupervisor(state: JarvisStateType): string {
  return state.nextAgent;
}

export async function jarvisChatNode(
  state: JarvisStateType
): Promise<Partial<JarvisStateType>> {
  const llm = createLLMClient({ temperature: 0.7 });

  const response = await llm.invoke([
    { role: "system", content: JARVIS_SYSTEM_PROMPT },
    ...state.messages.map((m) => ({
      role: m._getType() === "human" ? ("user" as const) : ("assistant" as const),
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })),
  ]);

  return {
    messages: [new AIMessage(typeof response.content === "string" ? response.content : JSON.stringify(response.content))],
  };
}
