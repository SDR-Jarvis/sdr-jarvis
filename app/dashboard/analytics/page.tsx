import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  BarChart3,
  Mail,
  MousePointerClick,
  MessageSquare,
  Calendar,
  TrendingUp,
  Users,
  Target,
} from "lucide-react";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // Aggregate stats across all campaigns
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, stats")
    .eq("user_id", user.id);

  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const { count: sentCount } = await supabase
    .from("interactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("type", "email_outbound")
    .eq("status", "sent");

  const { count: repliedCount } = await supabase
    .from("interactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "replied");

  const { count: bookedCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "meeting_booked");

  const { count: pendingCount } = await supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "pending");

  const total = totalLeads ?? 0;
  const sent = sentCount ?? 0;
  const replied = repliedCount ?? 0;
  const booked = bookedCount ?? 0;
  const pending = pendingCount ?? 0;

  const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : "0";
  const bookRate = replied > 0 ? ((booked / replied) * 100).toFixed(1) : "0";

  const metrics = [
    { icon: Users, label: "Total Leads", value: total, color: "text-jarvis-blue" },
    { icon: Mail, label: "Emails Sent", value: sent, color: "text-jarvis-success" },
    { icon: MessageSquare, label: "Replies", value: replied, color: "text-jarvis-cyan" },
    { icon: Calendar, label: "Meetings Booked", value: booked, color: "text-jarvis-gold" },
    { icon: TrendingUp, label: "Reply Rate", value: `${replyRate}%`, color: "text-jarvis-success" },
    { icon: Target, label: "Reply → Book", value: `${bookRate}%`, color: "text-jarvis-gold" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-jarvis-muted">
          Pipeline performance across all campaigns.
        </p>
      </div>

      {/* Metric Grid */}
      <div className="grid grid-cols-3 gap-4">
        {metrics.map((m) => (
          <div key={m.label} className="jarvis-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-jarvis-blue/10">
                <m.icon className={`h-5 w-5 ${m.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{m.value}</p>
                <p className="text-xs text-jarvis-muted">{m.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Funnel */}
      <div className="jarvis-card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
          Pipeline Funnel
        </h2>
        <div className="space-y-3">
          <FunnelBar label="Leads" value={total} max={total} color="bg-jarvis-blue" />
          <FunnelBar label="Sent" value={sent} max={total} color="bg-jarvis-success" />
          <FunnelBar label="Replied" value={replied} max={total} color="bg-jarvis-cyan" />
          <FunnelBar label="Booked" value={booked} max={total} color="bg-jarvis-gold" />
        </div>
      </div>

      {/* Per-Campaign Breakdown */}
      {campaigns && campaigns.length > 0 && (
        <div className="jarvis-card space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            By Campaign
          </h2>
          <div className="overflow-hidden rounded-md border border-jarvis-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-jarvis-border bg-jarvis-surface">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-jarvis-muted">
                    Campaign
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-jarvis-muted">
                    Leads
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-jarvis-muted">
                    Sent
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-jarvis-muted">
                    Replied
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-jarvis-muted">
                    Booked
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-jarvis-muted">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-jarvis-border">
                {campaigns.map((c) => {
                  const s = (c.stats ?? {}) as Record<string, number>;
                  return (
                    <tr key={c.id} className="hover:bg-jarvis-surface/50">
                      <td className="px-4 py-2 font-medium text-white">
                        {c.name}
                      </td>
                      <td className="px-4 py-2 text-center text-jarvis-muted">
                        {s.total_leads ?? 0}
                      </td>
                      <td className="px-4 py-2 text-center text-jarvis-muted">
                        {s.sent ?? 0}
                      </td>
                      <td className="px-4 py-2 text-center text-jarvis-muted">
                        {s.replied ?? 0}
                      </td>
                      <td className="px-4 py-2 text-center text-jarvis-muted">
                        {s.booked ?? 0}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                            c.status === "active"
                              ? "bg-jarvis-success/10 text-jarvis-success"
                              : c.status === "completed"
                                ? "bg-jarvis-blue/10 text-jarvis-blue"
                                : "bg-white/5 text-jarvis-muted"
                          }`}
                        >
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

      {/* Jarvis insight */}
      {pending > 0 && (
        <div className="rounded-md border border-jarvis-gold/20 bg-jarvis-gold/5 px-4 py-3 text-sm text-jarvis-gold">
          Sir, you have {pending} message{pending > 1 ? "s" : ""} waiting in
          the approval queue. Your leads are getting cold.
        </div>
      )}
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
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;

  return (
    <div className="flex items-center gap-4">
      <span className="w-16 text-right text-xs text-jarvis-muted">{label}</span>
      <div className="flex-1">
        <div className="h-6 w-full rounded-md bg-jarvis-surface overflow-hidden">
          <div
            className={`h-full rounded-md ${color} transition-all duration-500`}
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
