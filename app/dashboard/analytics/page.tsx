import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Mail,
  MessageSquare,
  Calendar,
  TrendingUp,
  Users,
  Target,
  Send,
  Eye,
  AlertTriangle,
  Flame,
  ThermometerSun,
  Snowflake,
  ArrowRight,
  Zap,
  Clock,
} from "lucide-react";

interface CampaignStats {
  id: string;
  name: string;
  status: string;
  totalLeads: number;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  qualified: number;
  booked: number;
  bounced: number;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // Fetch all data in parallel
  const [
    campaignsRes,
    leadsRes,
    interactionsRes,
    repliesRes,
    pendingRes,
    recentActivityRes,
  ] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("leads")
      .select("id, campaign_id, status")
      .eq("user_id", user.id),
    supabase
      .from("interactions")
      .select("id, campaign_id, type, status, opened_at, replied_at, sequence_step")
      .eq("user_id", user.id),
    supabase
      .from("interactions")
      .select("id, metadata, created_at")
      .eq("user_id", user.id)
      .eq("type", "email_reply")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "pending"),
    supabase
      .from("audit_log")
      .select("action, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const campaigns = campaignsRes.data ?? [];
  const leads = leadsRes.data ?? [];
  const interactions = interactionsRes.data ?? [];
  const replies = repliesRes.data ?? [];
  const pending = pendingRes.count ?? 0;

  // Global metrics from real data
  const totalLeads = leads.length;
  const outboundEmails = interactions.filter((i) => i.type === "email_outbound");
  const sentEmails = outboundEmails.filter((i) => ["sent", "delivered", "opened", "replied"].includes(i.status));
  const deliveredEmails = outboundEmails.filter((i) => ["delivered", "opened", "replied"].includes(i.status));
  const openedEmails = outboundEmails.filter((i) => i.opened_at !== null);
  const repliedLeads = leads.filter((l) => ["replied", "qualified", "meeting_booked"].includes(l.status));
  const qualifiedLeads = leads.filter((l) => ["qualified", "meeting_booked"].includes(l.status));
  const bookedLeads = leads.filter((l) => l.status === "meeting_booked");
  const bouncedEmails = outboundEmails.filter((i) => i.status === "bounced");

  const sent = sentEmails.length;
  const delivered = deliveredEmails.length;
  const opened = openedEmails.length;
  const replied = repliedLeads.length;
  const qualified = qualifiedLeads.length;
  const booked = bookedLeads.length;
  const bounced = bouncedEmails.length;

  const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0";
  const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : "0";
  const qualifyRate = replied > 0 ? ((qualified / replied) * 100).toFixed(1) : "0";
  const bookRate = replied > 0 ? ((booked / replied) * 100).toFixed(1) : "0";
  const bounceRate = sent > 0 ? ((bounced / sent) * 100).toFixed(1) : "0";

  // Reply qualification breakdown
  const replyQualifications = replies
    .map((r) => {
      const meta = r.metadata as { qualification?: { interestLevel: string } } | null;
      return meta?.qualification?.interestLevel;
    })
    .filter(Boolean);

  const hotCount = replyQualifications.filter((l) => l === "hot").length;
  const warmCount = replyQualifications.filter((l) => l === "warm").length;
  const coldCount = replyQualifications.filter((l) => l === "cold").length;

  // Per-campaign breakdown
  const campaignStats: CampaignStats[] = campaigns.map((c) => {
    const cLeads = leads.filter((l) => l.campaign_id === c.id);
    const cInteractions = interactions.filter((i) => i.campaign_id === c.id && i.type === "email_outbound");
    const cSent = cInteractions.filter((i) => ["sent", "delivered", "opened", "replied"].includes(i.status));
    const cDelivered = cInteractions.filter((i) => ["delivered", "opened", "replied"].includes(i.status));
    const cOpened = cInteractions.filter((i) => i.opened_at !== null);
    const cReplied = cLeads.filter((l) => ["replied", "qualified", "meeting_booked"].includes(l.status));
    const cQualified = cLeads.filter((l) => ["qualified", "meeting_booked"].includes(l.status));
    const cBooked = cLeads.filter((l) => l.status === "meeting_booked");
    const cBounced = cInteractions.filter((i) => i.status === "bounced");

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      totalLeads: cLeads.length,
      sent: cSent.length,
      delivered: cDelivered.length,
      opened: cOpened.length,
      replied: cReplied.length,
      qualified: cQualified.length,
      booked: cBooked.length,
      bounced: cBounced.length,
    };
  });

  // Follow-up stats
  const followUps = outboundEmails.filter((i) => (i.sequence_step ?? 1) > 1);

  // Jarvis insights
  const insights: string[] = [];
  if (pending > 0) {
    insights.push(`You have ${pending} message${pending > 1 ? "s" : ""} in the approval queue. Your leads are cooling off, sir.`);
  }
  if (parseFloat(bounceRate) > 10) {
    insights.push(`Bounce rate is ${bounceRate}% — consider cleaning your lead list. Bad data wastes good emails.`);
  }
  if (sent > 5 && parseFloat(replyRate) < 5) {
    insights.push(`Reply rate is ${replyRate}%. Industry average is 5-15%. Consider testing different subject lines or hooks.`);
  }
  if (hotCount > 0 && booked === 0) {
    insights.push(`You have ${hotCount} hot lead${hotCount > 1 ? "s" : ""} but no meetings booked. Time to close, sir.`);
  }
  if (sent > 0 && parseFloat(openRate) > 0 && parseFloat(openRate) < 20) {
    insights.push(`Open rate is ${openRate}%. Try shorter subject lines (4-6 words) and avoid spam trigger words.`);
  }
  if (followUps.length > 0) {
    insights.push(`${followUps.length} follow-up email${followUps.length > 1 ? "s" : ""} have been sent. Persistence pays off.`);
  }
  if (sent === 0) {
    insights.push("No emails sent yet. Create a campaign, import leads, and run the pipeline to get started.");
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-jarvis-muted">
          Real-time pipeline performance across all campaigns.
        </p>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
        <MetricCard icon={Users} label="Total Leads" value={totalLeads} color="text-jarvis-blue" />
        <MetricCard icon={Send} label="Emails Sent" value={sent} color="text-jarvis-success" />
        <MetricCard icon={Eye} label="Opened" value={opened} subtext={sent > 0 ? `${openRate}%` : undefined} color="text-jarvis-cyan" />
        <MetricCard icon={MessageSquare} label="Replied" value={replied} subtext={sent > 0 ? `${replyRate}%` : undefined} color="text-amber-400" />
        <MetricCard icon={Target} label="Qualified" value={qualified} subtext={replied > 0 ? `${qualifyRate}%` : undefined} color="text-jarvis-blue" />
        <MetricCard icon={Calendar} label="Meetings" value={booked} subtext={replied > 0 ? `${bookRate}%` : undefined} color="text-jarvis-gold" />
      </div>

      {/* Pipeline Funnel + Reply Breakdown side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Funnel */}
        <div className="jarvis-card space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            <TrendingUp className="h-4 w-4" />
            Pipeline Funnel
          </h2>
          <div className="space-y-3">
            <FunnelBar label="Leads" value={totalLeads} max={totalLeads} color="bg-jarvis-blue" />
            <FunnelBar label="Sent" value={sent} max={totalLeads} color="bg-jarvis-success" />
            <FunnelBar label="Delivered" value={delivered} max={totalLeads} color="bg-jarvis-success/80" />
            <FunnelBar label="Opened" value={opened} max={totalLeads} color="bg-jarvis-cyan" />
            <FunnelBar label="Replied" value={replied} max={totalLeads} color="bg-amber-400" />
            <FunnelBar label="Qualified" value={qualified} max={totalLeads} color="bg-jarvis-blue" />
            <FunnelBar label="Meetings" value={booked} max={totalLeads} color="bg-jarvis-gold" />
          </div>
          {bounced > 0 && (
            <div className="flex items-center gap-2 pt-2 text-xs text-jarvis-danger">
              <AlertTriangle className="h-3.5 w-3.5" />
              {bounced} bounced ({bounceRate}%)
            </div>
          )}
        </div>

        {/* Reply Breakdown */}
        <div className="jarvis-card space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            <MessageSquare className="h-4 w-4" />
            Reply Quality
          </h2>
          {replied === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <MessageSquare className="mb-3 h-8 w-8 text-jarvis-muted/30" />
              <p className="text-sm text-jarvis-muted">No replies yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md bg-red-400/5 p-3 text-center">
                  <Flame className="mx-auto mb-1 h-5 w-5 text-red-400" />
                  <p className="text-xl font-bold text-white">{hotCount}</p>
                  <p className="text-[10px] text-jarvis-muted">Hot</p>
                </div>
                <div className="rounded-md bg-amber-400/5 p-3 text-center">
                  <ThermometerSun className="mx-auto mb-1 h-5 w-5 text-amber-400" />
                  <p className="text-xl font-bold text-white">{warmCount}</p>
                  <p className="text-[10px] text-jarvis-muted">Warm</p>
                </div>
                <div className="rounded-md bg-blue-300/5 p-3 text-center">
                  <Snowflake className="mx-auto mb-1 h-5 w-5 text-blue-300" />
                  <p className="text-xl font-bold text-white">{coldCount}</p>
                  <p className="text-[10px] text-jarvis-muted">Cold</p>
                </div>
              </div>

              {/* Conversion rates */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-jarvis-muted">Sent → Replied</span>
                  <span className="font-medium text-white">{replyRate}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-jarvis-muted">Replied → Qualified</span>
                  <span className="font-medium text-white">{qualifyRate}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-jarvis-muted">Replied → Meeting</span>
                  <span className="font-medium text-white">{bookRate}%</span>
                </div>
              </div>

              {followUps.length > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-jarvis-blue/5 px-3 py-2 text-xs text-jarvis-blue">
                  <Clock className="h-3.5 w-3.5" />
                  {followUps.length} follow-up{followUps.length > 1 ? "s" : ""} sent
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Per-Campaign Breakdown */}
      {campaignStats.length > 0 && (
        <div className="jarvis-card space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            <Mail className="h-4 w-4" />
            Campaign Performance
          </h2>
          <div className="overflow-x-auto rounded-md border border-jarvis-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-jarvis-border bg-jarvis-surface">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Campaign</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Leads</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Sent</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Opened</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Replied</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Qualified</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Meetings</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Reply %</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-jarvis-border/50">
                {campaignStats.map((c) => {
                  const cReplyRate = c.sent > 0 ? ((c.replied / c.sent) * 100).toFixed(0) : "0";
                  return (
                    <tr key={c.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 font-medium text-white">{c.name}</td>
                      <td className="px-3 py-2.5 text-center text-jarvis-muted">{c.totalLeads}</td>
                      <td className="px-3 py-2.5 text-center text-jarvis-muted">{c.sent}</td>
                      <td className="px-3 py-2.5 text-center text-jarvis-muted">{c.opened}</td>
                      <td className="px-3 py-2.5 text-center text-jarvis-muted">{c.replied}</td>
                      <td className="px-3 py-2.5 text-center text-jarvis-muted">{c.qualified}</td>
                      <td className="px-3 py-2.5 text-center text-jarvis-muted">{c.booked}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-medium ${parseFloat(cReplyRate) >= 10 ? "text-jarvis-success" : parseFloat(cReplyRate) > 0 ? "text-amber-400" : "text-jarvis-muted"}`}>
                          {cReplyRate}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                          c.status === "active" ? "bg-jarvis-success/10 text-jarvis-success" :
                          c.status === "completed" ? "bg-jarvis-blue/10 text-jarvis-blue" :
                          c.status === "paused" ? "bg-amber-400/10 text-amber-400" :
                          "bg-white/5 text-jarvis-muted"
                        }`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Jarvis Insights */}
      {insights.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            <Zap className="h-4 w-4 text-jarvis-gold" />
            Jarvis Insights
          </h2>
          {insights.map((insight, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-md border border-jarvis-gold/20 bg-jarvis-gold/5 px-4 py-3 text-sm text-jarvis-gold"
            >
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
              {insight}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subtext?: string;
  color: string;
}) {
  return (
    <div className="jarvis-card">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
        <div>
          <p className="text-xl font-bold text-white">{value}</p>
          <p className="text-[10px] text-jarvis-muted">
            {label}
            {subtext && <span className={`ml-1 ${color}`}>{subtext}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function FunnelBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0;

  return (
    <div className="flex items-center gap-4">
      <span className="w-16 text-right text-xs text-jarvis-muted">{label}</span>
      <div className="flex-1">
        <div className="h-6 w-full overflow-hidden rounded-md bg-jarvis-surface">
          <div
            className={`h-full rounded-md ${color} transition-all duration-700`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="w-12 text-right font-mono text-xs text-jarvis-muted">
        {value}
      </span>
    </div>
  );
}
