import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CheckCircle, Clock, Mail, Linkedin } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { ApprovalActions } from "../approval-actions";

interface ApprovalRecord {
  id: string;
  status: string;
  preview_subject: string;
  preview_body: string;
  channel: string;
  agent_notes: string | null;
  reviewed_at: string | null;
  leads: {
    first_name: string;
    last_name: string;
    company: string | null;
    email: string | null;
    title: string | null;
    linkedin_url: string | null;
  };
  campaigns: { name: string } | null;
}

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: approvals } = await supabase
    .from("approvals")
    .select(
      "*, leads(first_name, last_name, company, email, title, linkedin_url), campaigns(name)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const allApprovals = (approvals ?? []) as unknown as ApprovalRecord[];
  const pending = allApprovals.filter((a) => a.status === "pending");
  const reviewed = allApprovals.filter((a) => a.status !== "pending");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Approval Queue</h1>
        <p className="mt-1 text-sm text-jarvis-muted">
          Every outbound message passes through here. Nothing goes out without
          your sign-off.
        </p>
      </div>

      {/* Pending */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-gold">
          <Clock className="h-4 w-4" />
          Pending ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <div className="jarvis-card flex items-center justify-center py-10 text-center">
            <div>
              <CheckCircle className="mx-auto mb-2 h-8 w-8 text-jarvis-success/40" />
              <p className="text-sm text-jarvis-muted">
                All caught up. No messages waiting for review.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </section>

      {/* History */}
      {reviewed.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            History
          </h2>
          <div className="space-y-2">
            {reviewed.map((approval) => {
              const lead = approval.leads;
              return (
                <div
                  key={approval.id}
                  className="flex items-center gap-4 rounded-md px-4 py-3 text-sm hover:bg-white/[0.02]"
                >
                  <span
                    className={`status-dot ${
                      approval.status === "approved"
                        ? "bg-jarvis-success"
                        : approval.status === "rejected"
                          ? "bg-jarvis-danger"
                          : "bg-jarvis-muted"
                    }`}
                  />
                  <span className="flex-1 text-jarvis-muted">
                    {lead?.first_name} {lead?.last_name}
                    {lead?.company ? ` @ ${lead.company}` : ""} —{" "}
                    <span className="capitalize">{approval.status}</span>
                  </span>
                  <span className="text-xs text-jarvis-muted/50">
                    {approval.reviewed_at
                      ? formatRelativeTime(approval.reviewed_at)
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function ApprovalCard({ approval }: { approval: ApprovalRecord }) {
  const lead = approval.leads;
  const campaign = approval.campaigns;

  return (
    <div className="jarvis-card jarvis-glow space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white">
              {lead?.first_name} {lead?.last_name}
            </h3>
            {lead?.company && (
              <span className="text-sm text-jarvis-muted">
                @ {lead.company}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-jarvis-muted/60">
            {lead?.title && <span>{lead.title}</span>}
            {lead?.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" /> {lead.email}
              </span>
            )}
            {lead?.linkedin_url && (
              <span className="flex items-center gap-1">
                <Linkedin className="h-3 w-3" /> LinkedIn
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-jarvis-gold/10 px-2 py-0.5 text-[10px] font-medium text-jarvis-gold">
            <span className="status-dot status-dot-pending" />
            {approval.channel ?? "email"}
          </span>
          {campaign && (
            <p className="mt-1 text-[10px] text-jarvis-muted/50">
              {campaign.name}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-md border border-jarvis-border bg-jarvis-dark p-4">
        <p className="text-sm font-medium text-jarvis-blue">
          {approval.preview_subject}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-jarvis-muted">
          {approval.preview_body}
        </p>
      </div>

      {approval.agent_notes && (
        <p className="rounded-md bg-jarvis-blue/5 px-3 py-2 text-xs italic text-jarvis-blue/70">
          Jarvis: {approval.agent_notes}
        </p>
      )}

      <ApprovalActions
        approvalId={approval.id}
        initialSubject={approval.preview_subject}
        initialBody={approval.preview_body}
      />
    </div>
  );
}
