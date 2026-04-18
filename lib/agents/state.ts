import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// ── Shared data shapes ────────────────────────────

export interface LeadData {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  linkedinUrl: string | null;
  title: string | null;
  company: string | null;
  companyUrl: string | null;
}

export interface ResearchData {
  summary: string;
  companyInfo: string;
  recentActivity: string;
  painPoints: string[];
  talkingPoints: string[];
  techStack: string[];
  fundingInfo: string | null;
  score: number; // 0-100
}

export interface DraftMessage {
  subject: string;
  body: string;
  channel: "email" | "linkedin";
  personalizationNotes: string;
}

export interface PreviousEmail {
  subject: string;
  body: string;
  sequenceStep: number;
}

// ── LangGraph State (Annotation) ──────────────────

function messagesReducer(existing: BaseMessage[], incoming: BaseMessage[]) {
  return [...existing, ...incoming];
}

export const JarvisState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesReducer,
    default: () => [],
  }),

  userId: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  campaignId: Annotation<string | null>({
    reducer: (_, y) => y ?? null,
    default: () => null,
  }),

  leads: Annotation<LeadData[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  currentLeadIndex: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),

  researchData: Annotation<ResearchData | null>({
    reducer: (_, y) => y ?? null,
    default: () => null,
  }),

  draftMessage: Annotation<DraftMessage | null>({
    reducer: (_, y) => y ?? null,
    default: () => null,
  }),

  approvalStatus: Annotation<"none" | "pending" | "approved" | "rejected">({
    reducer: (_, y) => y,
    default: () => "none" as const,
  }),

  nextAgent: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "supervisor",
  }),

  sequenceStep: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 1,
  }),

  previousEmail: Annotation<PreviousEmail | null>({
    reducer: (_, y) => y ?? null,
    default: () => null,
  }),

  errors: Annotation<string[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),

  /** Research-only run: no LLM draft, no approval queue (saves cost). */
  dryRun: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),

  /** Appended after model-written body (opt-out + postal address). */
  complianceEmailSuffix: Annotation<string>({
    reducer: (_, y) => y ?? "",
    default: () => "",
  }),

  /** Display name for email sign-off (from profile.full_name, fallback in resolver). */
  senderDisplayName: Annotation<string>({
    reducer: (_, y) => y ?? "",
    default: () => "",
  }),
});

export type JarvisStateType = typeof JarvisState.State;
