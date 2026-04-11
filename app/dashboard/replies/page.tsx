import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  MessageSquare,
  Flame,
  ThermometerSun,
  Snowflake,
  XCircle,
  Calendar,
  Send,
  Shield,
  Archive,
  Clock,
  ArrowRight,
  Inbox,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { ReplyActions } from "./reply-actions";

interface ReplyRecord {
  id: string;
  lead_id: string;
  campaign_id: string;
  subject: string | null;
  body: string;
  metadata: {
    qualification?: {
      interestLevel: string;
      intent: string;
      suggestedAction: string;
      confidence: number;
      reasoning: string;
      draftReply: string | null;
    };
    original_interaction_id?: string;
  } | null;
  replied_at: string | null;
  created_at: string;
  leads: {
    first_name: string;
    last_name: string;
    email: string | null;
    company: string | null;
    title: string | null;
    status: string;
  } | null;
  campaigns: {
    name: string;
  } | null;
}

const INTEREST_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  hot: { icon: Flame, color: "text-red-400", label: "Hot" },
  warm: { icon: ThermometerSun, color: "text-amber-400", label: "Warm" },
  cold: { icon: Snowflake, color: "text-blue-300", label: "Cold" },
  not_interested: { icon: XCircle, color: "text-jarvis-muted", label: "Not Interested" },
};

const ACTION_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  book_meeting: { icon: Calendar, label: "Book Meeting", color: "text-jarvis-success" },
  send_info: { icon: Send, label: "Send Info", color: "text-jarvis-blue" },
  handle_objection: { icon: Shield, label: "Handle Objection", color: "text-amber-400" },
  archive: { icon: Archive, label: "Archive", color: "text-jarvis-muted" },
  follow_up_later: { icon: Clock, label: "Follow Up Later", color: "text-jarvis-gold" },
  wait: { icon: Clock, label: "Wait", color: "text-jarvis-muted" },
};

export default async function RepliesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: replies } = await supabase
    .from("interactions")
    .select(`
      id,
      lead_id,
      campaign_id,
      subject,
      body,
      metadata,
      replied_at,
      created_at,
      leads (first_name, last_name, email, company, title, status),
      campaigns (name)
    `)
    .eq("user_id", user.id)
    .eq("type", "email_reply")
    .order("created_at", { ascending: false })
    .limit(50);

  const replyList = (replies ?? []) as unknown as ReplyRecord[];

  const stats = {
    total: replyList.length,
    hot: replyList.filter((r) => r.metadata?.qualification?.interestLevel === "hot").length,
    warm: replyList.filter((r) => r.metadata?.qualification?.interestLevel === "warm").length,
    cold: replyList.filter((r) => r.metadata?.qualification?.interestLevel === "cold").length,
    actionNeeded: replyList.filter((r) => {
      const action = r.metadata?.qualification?.suggestedAction;
      return action && !["archive", "wait"].includes(action);
    }).length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Replies</h1>
        <p className="mt-1 text-sm text-jarvis-muted">
          Jarvis analyzes every reply and suggests the best next move.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Total Replies" value={stats.total} icon={MessageSquare} color="text-jarvis-blue" />
        <StatCard label="Hot Leads" value={stats.hot} icon={Flame} color="text-red-400" />
        <StatCard label="Warm" value={stats.warm} icon={ThermometerSun} color="text-amber-400" />
        <StatCard label="Cold" value={stats.cold} icon={Snowflake} color="text-blue-300" />
        <StatCard label="Action Needed" value={stats.actionNeeded} icon={ArrowRight} color="text-jarvis-success" />
      </div>

      {/* Reply List */}
      {replyList.length === 0 ? (
        <div className="jarvis-card flex flex-col items-center justify-center py-16 text-center">
          <Inbox className="mb-4 h-10 w-10 text-jarvis-blue/30" />
          <p className="text-sm text-jarvis-muted">
            No replies yet. Once prospects respond, Jarvis will analyze them here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {replyList.map((reply) => {
            const qual = reply.metadata?.qualification;
            const interest = INTEREST_CONFIG[qual?.interestLevel ?? "cold"] ?? INTEREST_CONFIG.cold;
            const action = ACTION_CONFIG[qual?.suggestedAction ?? "wait"] ?? ACTION_CONFIG.wait;
            const InterestIcon = interest.icon;
            const ActionIcon = action.icon;
            const lead = reply.leads;

            return (
              <div key={reply.id} className="jarvis-card space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5`}>
                      <InterestIcon className={`h-4 w-4 ${interest.color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {lead?.first_name} {lead?.last_name}
                        {lead?.company && (
                          <span className="text-jarvis-muted"> @ {lead.company}</span>
                        )}
                      </p>
                      <p className="text-xs text-jarvis-muted">
                        {lead?.title ?? ""}
                        {reply.campaigns?.name && ` · ${reply.campaigns.name}`}
                        {reply.replied_at && ` · ${formatRelativeTime(reply.replied_at)}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${interest.color} bg-white/5`}>
                      {interest.label}
                    </span>
                    {qual && (
                      <span className="text-[10px] text-jarvis-muted">
                        {Math.round(qual.confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Reply Preview */}
                <div className="rounded-md border border-jarvis-border bg-jarvis-dark p-3">
                  <p className="text-xs font-medium text-jarvis-blue">
                    {reply.subject ?? "No subject"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-jarvis-muted line-clamp-4">
                    {reply.body}
                  </p>
                </div>

                {/* Qualification Info */}
                {qual && (
                  <div className="flex items-start gap-4 rounded-md bg-white/[0.02] p-3">
                    <div className="flex-1">
                      <p className="text-[11px] text-jarvis-muted">
                        <span className="font-medium text-white">Jarvis says: </span>
                        {qual.reasoning}
                      </p>
                    </div>
                    <div className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${action.color} bg-white/5`}>
                      <ActionIcon className="h-3 w-3" />
                      {action.label}
                    </div>
                  </div>
                )}

                {/* Draft Reply */}
                {qual?.draftReply && (
                  <div className="rounded-md border border-jarvis-blue/20 bg-jarvis-blue/5 p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-jarvis-blue">
                      Suggested Reply
                    </p>
                    <p className="text-xs leading-relaxed text-jarvis-muted">
                      {qual.draftReply}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <ReplyActions
                  replyId={reply.id}
                  leadId={reply.lead_id}
                  leadEmail={lead?.email ?? null}
                  suggestedAction={qual?.suggestedAction ?? "wait"}
                  draftReply={qual?.draftReply ?? null}
                  originalSubject={reply.subject ?? ""}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="jarvis-card flex items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div>
        <p className="text-lg font-bold text-white">{value}</p>
        <p className="text-[10px] text-jarvis-muted">{label}</p>
      </div>
    </div>
  );
}
