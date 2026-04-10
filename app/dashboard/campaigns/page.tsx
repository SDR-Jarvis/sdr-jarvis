import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Send,
  Pause,
  CheckCircle,
  Archive,
  FileEdit,
  Users,
  Mail,
  MessageSquare,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; dotClass: string }
> = {
  draft: { label: "Draft", icon: FileEdit, dotClass: "bg-jarvis-muted" },
  active: { label: "Active", icon: Send, dotClass: "bg-jarvis-success" },
  paused: { label: "Paused", icon: Pause, dotClass: "bg-jarvis-gold" },
  completed: { label: "Completed", icon: CheckCircle, dotClass: "bg-jarvis-blue" },
  archived: { label: "Archived", icon: Archive, dotClass: "bg-jarvis-muted/50" },
};

export default async function CampaignsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Campaigns</h1>
          <p className="mt-1 text-sm text-jarvis-muted">
            {campaigns?.length
              ? `${campaigns.length} campaign${campaigns.length > 1 ? "s" : ""} total`
              : "No campaigns yet. Create one to get started."}
          </p>
        </div>
        <Link href="/dashboard/campaigns/new" className="jarvis-btn-primary">
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {!campaigns?.length ? (
        <div className="jarvis-card flex flex-col items-center justify-center py-16 text-center">
          <Send className="mb-4 h-10 w-10 text-jarvis-blue/30" />
          <h3 className="text-lg font-semibold text-white">
            Launch your first campaign
          </h3>
          <p className="mt-2 max-w-md text-sm text-jarvis-muted">
            Define your ICP, upload leads, and let Jarvis research and draft
            personalized outreach for each prospect.
          </p>
          <Link
            href="/dashboard/campaigns/new"
            className="jarvis-btn-primary mt-6"
          >
            <Plus className="h-4 w-4" />
            Create Campaign
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => {
            const stats = (campaign.stats ?? {}) as Record<string, number>;
            const cfg = STATUS_CONFIG[campaign.status] ?? STATUS_CONFIG.draft;
            const Icon = cfg.icon;

            return (
              <Link
                key={campaign.id}
                href={`/dashboard/campaigns/${campaign.id}`}
                className="jarvis-card group flex items-center gap-5 transition-all hover:border-jarvis-blue/30"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-jarvis-blue/10">
                  <Icon className="h-5 w-5 text-jarvis-blue" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-white group-hover:text-jarvis-blue transition-colors">
                      {campaign.name}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        campaign.status === "active"
                          ? "bg-jarvis-success/10 text-jarvis-success"
                          : campaign.status === "paused"
                            ? "bg-jarvis-gold/10 text-jarvis-gold"
                            : "bg-white/5 text-jarvis-muted"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
                      {cfg.label}
                    </span>
                  </div>
                  {campaign.description && (
                    <p className="mt-0.5 truncate text-sm text-jarvis-muted">
                      {campaign.description}
                    </p>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-6 text-xs text-jarvis-muted">
                  <div className="flex items-center gap-1.5" title="Leads">
                    <Users className="h-3.5 w-3.5" />
                    {stats.total_leads ?? 0}
                  </div>
                  <div className="flex items-center gap-1.5" title="Sent">
                    <Mail className="h-3.5 w-3.5" />
                    {stats.sent ?? 0}
                  </div>
                  <div className="flex items-center gap-1.5" title="Replied">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {stats.replied ?? 0}
                  </div>
                </div>

                <span className="shrink-0 text-xs text-jarvis-muted/50">
                  {formatRelativeTime(campaign.created_at)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
