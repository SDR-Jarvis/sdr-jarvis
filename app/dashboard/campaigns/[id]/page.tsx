import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  Mail,
  MessageSquare,
  Clock,
  CheckCircle,
  TrendingUp,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { RunPipelineButton } from "./run-button";
import { CampaignLeadsTable } from "./leads-table";

const STATUS_LABEL: Record<string, { text: string; class: string }> = {
  draft: { text: "Draft", class: "bg-white/10 text-jarvis-muted" },
  active: { text: "Running", class: "bg-jarvis-success/10 text-jarvis-success" },
  paused: { text: "Paused", class: "bg-jarvis-gold/10 text-jarvis-gold" },
  completed: { text: "Completed", class: "bg-jarvis-blue/10 text-jarvis-blue" },
  archived: { text: "Archived", class: "bg-white/5 text-jarvis-muted/60" },
};

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!campaign) redirect("/dashboard/campaigns");

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  const { data: pendingApprovals } = await supabase
    .from("approvals")
    .select("id")
    .eq("campaign_id", id)
    .eq("status", "pending");

  const { data: activeRun } = await supabase
    .from("agent_runs")
    .select("id, status, current_node, started_at")
    .eq("campaign_id", id)
    .in("status", ["running", "waiting_approval"])
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  const allLeads = leads ?? [];
  const stats = (campaign.stats ?? {}) as Record<string, number>;
  const statusCfg = STATUS_LABEL[campaign.status] ?? STATUS_LABEL.draft;
  const icp = (campaign.icp_criteria ?? {}) as Record<string, unknown>;
  const seq = (campaign.sequence_config ?? {}) as Record<string, unknown>;

  const newLeadsCount = allLeads.filter((l) => l.status === "new").length;
  const pendingCount = pendingApprovals?.length ?? 0;
  const hasStaleRun = !!activeRun;
  const canRun = newLeadsCount > 0 && !activeRun;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/dashboard/campaigns"
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-jarvis-muted" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusCfg.class}`}
              >
                {statusCfg.text}
              </span>
            </div>
            {campaign.description && (
              <p className="mt-1 text-sm text-jarvis-muted">
                {campaign.description}
              </p>
            )}
            <p className="mt-1 text-xs text-jarvis-muted/50">
              Created {formatRelativeTime(campaign.created_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <Link href="/dashboard/approvals" className="jarvis-btn-ghost text-xs">
              <Clock className="h-3.5 w-3.5" />
              {pendingCount} pending approval{pendingCount > 1 ? "s" : ""}
            </Link>
          )}
          <Link
            href={`/dashboard/leads/import?campaign=${id}`}
            className="jarvis-btn-ghost"
          >
            <Users className="h-4 w-4" />
            Add Leads
          </Link>
          <RunPipelineButton
            campaignId={id}
            canRun={canRun}
            newLeadsCount={newLeadsCount}
            totalLeads={allLeads.length}
            hasStaleRun={hasStaleRun}
          />
        </div>
      </div>

      {/* Active Run Banner */}
      {activeRun && (
        <div className="flex items-center gap-3 rounded-lg border border-jarvis-blue/20 bg-jarvis-blue/5 px-4 py-3">
          <span className="status-dot status-dot-active" />
          <p className="text-sm text-jarvis-blue">
            Pipeline is{" "}
            {activeRun.status === "waiting_approval"
              ? "paused — waiting for your approval"
              : `running (${activeRun.current_node ?? "processing"})`}
            . Started {formatRelativeTime(activeRun.started_at)}.
          </p>
          {activeRun.status === "waiting_approval" && (
            <Link href="/dashboard/approvals" className="jarvis-btn-primary text-xs ml-auto">
              <CheckCircle className="h-3.5 w-3.5" />
              Review Now
            </Link>
          )}
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-5 gap-4">
        <MetricCard icon={Users} label="Total Leads" value={allLeads.length} />
        <MetricCard
          icon={TrendingUp}
          label="Researched"
          value={allLeads.filter((l) => !["new", "researching"].includes(l.status)).length}
        />
        <MetricCard icon={Mail} label="Sent" value={stats.sent ?? 0} />
        <MetricCard icon={MessageSquare} label="Replied" value={stats.replied ?? 0} />
        <MetricCard
          icon={Clock}
          label="Pending"
          value={pendingCount}
          highlight={pendingCount > 0}
        />
      </div>

      {/* ICP Summary */}
      {Object.keys(icp).length > 0 && (
        <div className="jarvis-card">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
            Target ICP
          </h3>
          <div className="flex flex-wrap gap-2 text-xs">
            {Array.isArray(icp.titles) &&
              (icp.titles as string[]).map((t) => (
                <span key={t} className="rounded-full bg-jarvis-blue/10 px-2.5 py-1 text-jarvis-blue">
                  {t}
                </span>
              ))}
            {Array.isArray(icp.industries) &&
              (icp.industries as string[]).map((i) => (
                <span key={i} className="rounded-full bg-jarvis-gold/10 px-2.5 py-1 text-jarvis-gold">
                  {i}
                </span>
              ))}
            {typeof icp.companySize === "string" && (
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-jarvis-muted">
                {icp.companySize} employees
              </span>
            )}
          </div>
        </div>
      )}

      {/* Leads Table */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            Leads ({allLeads.length})
          </h2>
        </div>

        {allLeads.length === 0 ? (
          <div className="jarvis-card flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-3 h-8 w-8 text-jarvis-blue/30" />
            <p className="text-sm text-jarvis-muted">
              No leads in this campaign yet.
            </p>
            <Link
              href={`/dashboard/leads/import?campaign=${id}`}
              className="jarvis-btn-primary mt-4 text-sm"
            >
              Import Leads
            </Link>
          </div>
        ) : (
          <CampaignLeadsTable leads={allLeads} />
        )}
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className={`jarvis-card ${highlight ? "border-jarvis-gold/30 jarvis-glow" : ""}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-jarvis-blue" />
        <div>
          <p className="text-xl font-bold text-white">{value}</p>
          <p className="text-[11px] text-jarvis-muted">{label}</p>
        </div>
      </div>
    </div>
  );
}
