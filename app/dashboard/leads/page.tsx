import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Upload,
  Users,
  Search,
  Mail,
  Linkedin,
  Building2,
  ArrowUpDown,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-white/10 text-jarvis-muted",
  researching: "bg-jarvis-blue/10 text-jarvis-blue",
  researched: "bg-jarvis-blue/10 text-jarvis-blue",
  drafting: "bg-jarvis-gold/10 text-jarvis-gold",
  draft_ready: "bg-jarvis-gold/10 text-jarvis-gold",
  pending_approval: "bg-jarvis-gold/10 text-jarvis-gold",
  approved: "bg-jarvis-success/10 text-jarvis-success",
  sent: "bg-jarvis-success/10 text-jarvis-success",
  replied: "bg-jarvis-cyan/10 text-jarvis-cyan",
  qualified: "bg-jarvis-cyan/10 text-jarvis-cyan",
  meeting_booked: "bg-jarvis-success/10 text-jarvis-success",
  not_interested: "bg-jarvis-danger/10 text-jarvis-danger",
  bounced: "bg-jarvis-danger/10 text-jarvis-danger",
  archived: "bg-white/5 text-jarvis-muted/60",
};

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: leads } = await supabase
    .from("leads")
    .select("*, campaigns(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Leads</h1>
          <p className="mt-1 text-sm text-jarvis-muted">
            {leads?.length
              ? `${leads.length} lead${leads.length > 1 ? "s" : ""} across all campaigns`
              : "No leads yet. Import a CSV to get started."}
          </p>
        </div>
        <Link href="/dashboard/leads/import" className="jarvis-btn-primary">
          <Upload className="h-4 w-4" />
          Import CSV
        </Link>
      </div>

      {!leads?.length ? (
        <div className="jarvis-card flex flex-col items-center justify-center py-16 text-center">
          <Users className="mb-4 h-10 w-10 text-jarvis-blue/30" />
          <h3 className="text-lg font-semibold text-white">
            No leads in the pipeline
          </h3>
          <p className="mt-2 max-w-md text-sm text-jarvis-muted">
            Import a CSV with prospect data — name, email, company, title,
            LinkedIn URL — and Jarvis will handle the rest.
          </p>
          <Link
            href="/dashboard/leads/import"
            className="jarvis-btn-primary mt-6"
          >
            <Upload className="h-4 w-4" />
            Import Leads
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-jarvis-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-jarvis-border bg-jarvis-surface">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Company
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Campaign
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Score
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Added
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-jarvis-border">
              {leads.map((lead) => {
                const campaign = lead.campaigns as unknown as { name: string } | null;
                return (
                  <tr
                    key={lead.id}
                    className="bg-jarvis-dark transition-colors hover:bg-jarvis-surface/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-jarvis-surface text-xs font-bold text-jarvis-blue">
                          {lead.first_name[0]}
                          {lead.last_name[0]}
                        </div>
                        <div>
                          <p className="font-medium text-white">
                            {lead.first_name} {lead.last_name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {lead.email && (
                              <Mail className="h-3 w-3 text-jarvis-muted/50" />
                            )}
                            {lead.linkedin_url && (
                              <Linkedin className="h-3 w-3 text-jarvis-muted/50" />
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-jarvis-muted">
                        <Building2 className="h-3.5 w-3.5" />
                        {lead.company ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-jarvis-muted">
                      {lead.title ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-jarvis-muted">
                      {campaign?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                          STATUS_COLORS[lead.status] ?? STATUS_COLORS.new
                        }`}
                      >
                        {lead.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {lead.enrichment_score != null ? (
                        <span
                          className={`font-mono text-xs ${
                            lead.enrichment_score >= 70
                              ? "text-jarvis-success"
                              : lead.enrichment_score >= 40
                                ? "text-jarvis-gold"
                                : "text-jarvis-muted"
                          }`}
                        >
                          {lead.enrichment_score}
                        </span>
                      ) : (
                        <span className="text-xs text-jarvis-muted/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-jarvis-muted/50">
                      {formatRelativeTime(lead.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
