import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Users,
  Send,
  Mail,
  CheckCircle,
  MessageSquare,
  TrendingUp,
  BarChart3,
  Target,
  Clock,
  Shield,
} from "lucide-react";

const ADMIN_EMAIL = "ronith.reagan@gmail.com";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  if (user.email !== ADMIN_EMAIL) redirect("/dashboard");

  // Fetch all stats in parallel
  const [
    usersRes,
    campaignsRes,
    leadsRes,
    interactionsRes,
    approvalsRes,
    runsRes,
    repliesRes,
    recentUsersRes,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("campaigns").select("id", { count: "exact", head: true }),
    supabase.from("leads").select("id", { count: "exact", head: true }),
    supabase.from("interactions").select("id, status", { count: "exact" }).eq("status", "sent"),
    supabase.from("approvals").select("id", { count: "exact", head: true }),
    supabase.from("agent_runs").select("id", { count: "exact", head: true }),
    supabase.from("interactions").select("id", { count: "exact", head: true }).in("status", ["replied", "qualified"]),
    supabase
      .from("profiles")
      .select("id, full_name, company_name, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const totalUsers = usersRes.count ?? 0;
  const totalCampaigns = campaignsRes.count ?? 0;
  const totalLeads = leadsRes.count ?? 0;
  const totalSent = interactionsRes.count ?? 0;
  const totalApprovals = approvalsRes.count ?? 0;
  const totalRuns = runsRes.count ?? 0;
  const totalReplies = repliesRes.count ?? 0;
  const recentUsers = recentUsersRes.data ?? [];

  // Users active in last 7 days (based on agent_runs)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: activeWeekly } = await supabase
    .from("agent_runs")
    .select("user_id", { count: "exact", head: true })
    .gte("started_at", sevenDaysAgo);

  // Users active today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: activeToday } = await supabase
    .from("agent_runs")
    .select("user_id", { count: "exact", head: true })
    .gte("started_at", todayStart.toISOString());

  const stats = [
    { label: "Total Users", value: totalUsers, icon: Users, color: "text-jarvis-blue" },
    { label: "Active Today", value: activeToday ?? 0, icon: Clock, color: "text-jarvis-success" },
    { label: "Active This Week", value: activeWeekly ?? 0, icon: TrendingUp, color: "text-jarvis-cyan" },
    { label: "Campaigns", value: totalCampaigns, icon: Send, color: "text-jarvis-gold" },
    { label: "Total Leads", value: totalLeads, icon: Target, color: "text-jarvis-blue" },
    { label: "Emails Sent", value: totalSent, icon: Mail, color: "text-jarvis-success" },
    { label: "Approvals", value: totalApprovals, icon: CheckCircle, color: "text-jarvis-gold" },
    { label: "Replies", value: totalReplies, icon: MessageSquare, color: "text-jarvis-cyan" },
    { label: "Pipeline Runs", value: totalRuns, icon: BarChart3, color: "text-jarvis-blue" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Shield className="h-5 w-5 text-jarvis-gold" />
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-sm text-jarvis-muted">
            Product metrics — only visible to you.
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="jarvis-card flex items-center gap-4"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 ${stat.color}`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">
                {stat.value.toLocaleString()}
              </p>
              <p className="text-xs text-jarvis-muted">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Signups */}
      <div className="jarvis-card">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
          <Users className="h-4 w-4" />
          Recent Signups
        </h2>
        {recentUsers.length === 0 ? (
          <p className="text-sm text-jarvis-muted/60">No users yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-jarvis-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-jarvis-border bg-jarvis-surface">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                    Name
                  </th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                    Company
                  </th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-jarvis-border/50">
                {recentUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-white">
                      {u.full_name || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-jarvis-muted">
                      {u.company_name || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-jarvis-muted/60">
                      {u.created_at
                        ? new Date(u.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
