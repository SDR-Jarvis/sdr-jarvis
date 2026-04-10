import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Users,
  Mail,
  Clock,
  TrendingUp,
  Plus,
  Upload,
  ArrowRight,
  Zap,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { getJarvisGreeting, formatRelativeTime } from "@/lib/utils";
import { ApprovalActions } from "./approval-actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // Fetch dashboard data in parallel
  const [campaignsRes, approvalsRes, leadsRes, recentRes] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, status, stats")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("approvals")
      .select("id, preview_subject, preview_body, channel, agent_notes, created_at, leads(first_name, last_name, company, email)")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("audit_log")
      .select("id, action, resource_type, details, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const campaigns = campaignsRes.data ?? [];
  const pendingApprovals = approvalsRes.data ?? [];
  const totalLeads = leadsRes.count ?? 0;
  const recentActivity = recentRes.data ?? [];

  // Aggregate stats from campaigns
  const totalSent = campaigns.reduce(
    (sum, c) => sum + ((c.stats as Record<string, number>)?.sent ?? 0),
    0
  );
  const totalReplied = campaigns.reduce(
    (sum, c) => sum + ((c.stats as Record<string, number>)?.replied ?? 0),
    0
  );
  const openRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* ── Greeting ────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {getJarvisGreeting()}
          </h1>
          <p className="mt-1 text-sm text-jarvis-muted">
            {pendingApprovals.length > 0
              ? `${pendingApprovals.length} message${pendingApprovals.length > 1 ? "s" : ""} awaiting your approval.`
              : "All systems operational. No pending actions."}
          </p>
        </div>
        <div className="flex gap-3">
          <a href="/dashboard/campaigns/new" className="jarvis-btn-primary">
            <Plus className="h-4 w-4" />
            New Campaign
          </a>
          <a href="/dashboard/leads/import" className="jarvis-btn-ghost">
            <Upload className="h-4 w-4" />
            Import Leads
          </a>
        </div>
      </div>

      {/* ── Metric Cards ────────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          icon={Users}
          label="Total Leads"
          value={totalLeads}
          trend={null}
        />
        <MetricCard
          icon={Mail}
          label="Emails Sent"
          value={totalSent}
          trend={null}
        />
        <MetricCard
          icon={Clock}
          label="Pending Approval"
          value={pendingApprovals.length}
          trend={null}
          highlight={pendingApprovals.length > 0}
        />
        <MetricCard
          icon={TrendingUp}
          label="Reply Rate"
          value={`${openRate}%`}
          trend={null}
        />
      </div>

      {/* ── Approval Queue ──────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            Approval Queue
          </h2>
          {pendingApprovals.length > 0 && (
            <a
              href="/dashboard/approvals"
              className="flex items-center gap-1 text-xs text-jarvis-blue hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </a>
          )}
        </div>

        {pendingApprovals.length === 0 ? (
          <div className="jarvis-card flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="mb-3 h-8 w-8 text-jarvis-success/40" />
            <p className="text-sm text-jarvis-muted">
              Queue is clear. Nothing requires your attention right now.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map((approval) => {
              const lead = approval.leads as unknown as {
                first_name: string;
                last_name: string;
                company: string | null;
                email: string | null;
              };
              return (
                <div
                  key={approval.id}
                  className="jarvis-card jarvis-glow space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {lead?.first_name} {lead?.last_name}
                        {lead?.company && (
                          <span className="text-jarvis-muted">
                            {" "}
                            @ {lead.company}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-jarvis-muted">
                        {approval.channel} · {formatRelativeTime(approval.created_at)}
                      </p>
                    </div>
                    <span className="status-dot status-dot-pending" />
                  </div>

                  <div className="rounded-md border border-jarvis-border bg-jarvis-dark p-3">
                    <p className="text-xs font-medium text-jarvis-blue">
                      {approval.preview_subject}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-jarvis-muted line-clamp-3">
                      {approval.preview_body}
                    </p>
                  </div>

                  {approval.agent_notes && (
                    <p className="text-[11px] italic text-jarvis-muted/60">
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
            })}
          </div>
        )}
      </section>

      {/* ── Recent Activity ─────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">
          Recent Activity
        </h2>
        {recentActivity.length === 0 ? (
          <div className="jarvis-card flex flex-col items-center justify-center py-12 text-center">
            <Zap className="mb-3 h-8 w-8 text-jarvis-blue/30" />
            <p className="text-sm text-jarvis-muted">
              No activity yet. Start a campaign and I&apos;ll track everything
              here.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-white/[0.02]"
              >
                <ActivityIcon action={event.action} />
                <span className="flex-1 text-jarvis-muted">
                  {formatActivityLabel(event.action, event.details)}
                </span>
                <span className="text-xs text-jarvis-muted/50">
                  {formatRelativeTime(event.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  trend: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`jarvis-card flex items-start gap-4 ${highlight ? "jarvis-glow border-jarvis-gold/30" : ""}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-jarvis-blue/10">
        <Icon className="h-5 w-5 text-jarvis-blue" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-jarvis-muted">{label}</p>
      </div>
    </div>
  );
}

function ActivityIcon({ action }: { action: string }) {
  if (action.includes("sent"))
    return <Mail className="h-4 w-4 text-jarvis-success" />;
  if (action.includes("research"))
    return <Users className="h-4 w-4 text-jarvis-blue" />;
  if (action.includes("approval"))
    return <CheckCircle className="h-4 w-4 text-jarvis-gold" />;
  if (action.includes("fail"))
    return <XCircle className="h-4 w-4 text-jarvis-danger" />;
  return <Zap className="h-4 w-4 text-jarvis-muted" />;
}

function formatActivityLabel(
  action: string,
  details: Record<string, unknown> | null
): string {
  const d = details ?? {};
  switch (action) {
    case "email_sent":
      return `Email sent to ${d.to ?? "prospect"}`;
    case "email_failed":
      return `Email failed: ${d.error ?? "unknown error"}`;
    case "lead_researched":
      return `Researched ${d.lead_name ?? "a lead"}`;
    case "approval_granted":
      return `Approved message for ${d.lead_name ?? "a lead"}`;
    case "approval_rejected":
      return `Rejected draft for ${d.lead_name ?? "a lead"}`;
    default:
      return action.replace(/_/g, " ");
  }
}
