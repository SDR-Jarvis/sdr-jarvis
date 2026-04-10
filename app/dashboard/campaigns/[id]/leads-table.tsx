"use client";

import { Mail, Linkedin, Building2, User } from "lucide-react";

interface Lead {
  id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  status: string;
  linkedin_url?: string;
  enrichment_score?: number;
}

const STATUS_BADGE: Record<string, { text: string; class: string }> = {
  new: { text: "New", class: "bg-white/10 text-jarvis-muted" },
  researching: { text: "Researching", class: "bg-jarvis-blue/10 text-jarvis-blue" },
  researched: { text: "Researched", class: "bg-jarvis-blue/15 text-jarvis-blue" },
  drafting: { text: "Drafting", class: "bg-jarvis-gold/10 text-jarvis-gold" },
  pending_approval: { text: "Awaiting Review", class: "bg-jarvis-gold/15 text-jarvis-gold" },
  contacted: { text: "Sent", class: "bg-jarvis-success/10 text-jarvis-success" },
  replied: { text: "Replied", class: "bg-jarvis-success/20 text-jarvis-success" },
  meeting_booked: { text: "Meeting", class: "bg-jarvis-blue/20 text-jarvis-blue" },
  not_interested: { text: "Declined", class: "bg-jarvis-danger/10 text-jarvis-danger" },
  bounced: { text: "Bounced", class: "bg-jarvis-danger/10 text-jarvis-danger" },
  failed: { text: "Failed", class: "bg-jarvis-danger/10 text-jarvis-danger" },
};

export function CampaignLeadsTable({ leads }: { leads: Lead[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-jarvis-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-jarvis-border bg-jarvis-surface/40">
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
              Lead
            </th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
              Company
            </th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
              Status
            </th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
              Score
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const badge = STATUS_BADGE[lead.status] ?? STATUS_BADGE.new;
            return (
              <tr
                key={lead.id}
                className="border-b border-jarvis-border/50 transition-colors hover:bg-white/[0.02]"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-jarvis-blue/10 text-jarvis-blue text-xs font-bold">
                      {lead.name?.charAt(0) ?? "?"}
                    </div>
                    <div>
                      <p className="font-medium text-white">{lead.name || "Unknown"}</p>
                      <div className="flex items-center gap-2 text-xs text-jarvis-muted">
                        {lead.title && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {lead.title}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 text-jarvis-muted">
                    <Building2 className="h-3.5 w-3.5" />
                    {lead.company || "—"}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.class}`}
                  >
                    {badge.text}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {lead.enrichment_score != null && (
                      <span className="text-xs text-jarvis-muted">
                        {lead.enrichment_score}%
                      </span>
                    )}
                    <div className="flex gap-1">
                      {lead.email && (
                        <a
                          href={`mailto:${lead.email}`}
                          className="rounded p-1 text-jarvis-muted hover:bg-white/5 hover:text-white transition-colors"
                          title={lead.email}
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {lead.linkedin_url && (
                        <a
                          href={lead.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded p-1 text-jarvis-muted hover:bg-white/5 hover:text-white transition-colors"
                          title="LinkedIn"
                        >
                          <Linkedin className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
