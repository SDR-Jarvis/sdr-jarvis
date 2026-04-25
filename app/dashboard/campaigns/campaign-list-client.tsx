"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Send,
  Pause,
  CheckCircle,
  Archive,
  FileEdit,
  Users,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { CampaignDeleteDialog } from "./campaign-delete-dialog";

type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  stats: Record<string, unknown> | null;
  created_at: string;
};

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

export function CampaignListClient({ initialCampaigns }: { initialCampaigns: CampaignRow[] }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  function removeCampaign(id: string) {
    setCampaigns((c) => c.filter((row) => row.id !== id));
    setMenuOpenId(null);
  }

  return (
    <>
      <CampaignDeleteDialog
        campaignId={deleteTarget?.id ?? null}
        campaignName={deleteTarget?.name ?? ""}
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={(id) => {
          removeCampaign(id);
          setDeleteTarget(null);
        }}
      />

      <div className="grid gap-4">
        {campaigns.map((campaign) => {
          const stats = (campaign.stats ?? {}) as Record<string, number>;
          const cfg = STATUS_CONFIG[campaign.status] ?? STATUS_CONFIG.draft;
          const Icon = cfg.icon;
          const menuOpen = menuOpenId === campaign.id;

          return (
            <div
              key={campaign.id}
              className="jarvis-card group flex items-center gap-4 transition-all hover:border-jarvis-blue/30"
            >
              <Link
                href={`/dashboard/campaigns/${campaign.id}`}
                className="flex min-w-0 flex-1 items-center gap-5"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-jarvis-blue/10">
                  <Icon className="h-5 w-5 text-jarvis-blue" />
                </div>

                <div className="min-w-0 flex-1">
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
                    <p className="mt-0.5 truncate text-sm text-jarvis-muted">{campaign.description}</p>
                  )}
                </div>

                <div className="hidden items-center gap-6 text-xs text-jarvis-muted sm:flex">
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

              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label="Campaign actions"
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-jarvis-border text-jarvis-muted hover:border-jarvis-blue/30 hover:text-white"
                  onClick={() => setMenuOpenId(menuOpen ? null : campaign.id)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen ? (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-10 cursor-default"
                      aria-hidden
                      onClick={() => setMenuOpenId(null)}
                    />
                    <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-md border border-jarvis-border bg-jarvis-dark py-1 shadow-lg">
                      <Link
                        href={`/dashboard/campaigns/${campaign.id}`}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-jarvis-muted hover:bg-white/5 hover:text-white"
                        onClick={() => setMenuOpenId(null)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-jarvis-danger hover:bg-jarvis-danger/10"
                        onClick={() => {
                          setMenuOpenId(null);
                          setDeleteTarget({ id: campaign.id, name: campaign.name });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
