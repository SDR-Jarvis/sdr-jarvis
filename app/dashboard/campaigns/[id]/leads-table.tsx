"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Linkedin, Building2, User, MessageSquare, Loader2, X } from "lucide-react";

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
  sent: { text: "Sent", class: "bg-jarvis-success/10 text-jarvis-success" },
  contacted: { text: "Sent", class: "bg-jarvis-success/10 text-jarvis-success" },
  delivered: { text: "Delivered", class: "bg-jarvis-success/15 text-jarvis-success" },
  qualified: { text: "Qualified", class: "bg-jarvis-blue/20 text-jarvis-blue" },
  archived: { text: "Archived", class: "bg-white/5 text-jarvis-muted" },
  replied: { text: "Replied", class: "bg-jarvis-success/20 text-jarvis-success" },
  meeting_booked: { text: "Meeting", class: "bg-jarvis-blue/20 text-jarvis-blue" },
  not_interested: { text: "Declined", class: "bg-jarvis-danger/10 text-jarvis-danger" },
  bounced: { text: "Bounced", class: "bg-jarvis-danger/10 text-jarvis-danger" },
  failed: { text: "Failed", class: "bg-jarvis-danger/10 text-jarvis-danger" },
};

export function CampaignLeadsTable({ leads }: { leads: Lead[] }) {
  const [replyModal, setReplyModal] = useState<Lead | null>(null);

  return (
    <>
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
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const badge = STATUS_BADGE[lead.status] ?? STATUS_BADGE.new;
              const canLogReply = ["sent", "delivered", "contacted"].includes(lead.status);
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
                    <div className="flex items-center justify-end gap-2">
                      {canLogReply && (
                        <button
                          onClick={() => setReplyModal(lead)}
                          className="flex items-center gap-1 rounded-md bg-jarvis-blue/10 px-2 py-1 text-[10px] font-medium text-jarvis-blue hover:bg-jarvis-blue/20 transition-colors"
                          title="Log a reply from this prospect"
                        >
                          <MessageSquare className="h-3 w-3" />
                          Log Reply
                        </button>
                      )}
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

      {replyModal && (
        <LogReplyModal
          lead={replyModal}
          onClose={() => setReplyModal(null)}
        />
      )}
    </>
  );
}

function LogReplyModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const router = useRouter();
  const [replyContent, setReplyContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    interestLevel: string;
    intent: string;
    suggestedAction: string;
    confidence: number;
  } | null>(null);

  async function handleSubmit() {
    if (!replyContent.trim()) return;
    setLoading(true);

    try {
      const res = await fetch("/api/replies/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, replyContent }),
      });

      const data = await res.json();

      if (data.success && data.qualification) {
        setResult(data.qualification);
      } else if (!res.ok) {
        alert(data.error ?? "Failed to log reply");
      }

      router.refresh();
    } catch {
      alert("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-jarvis-border bg-jarvis-surface p-6 shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Log Reply</h3>
            <p className="text-sm text-jarvis-muted">
              Paste {lead.name}&apos;s reply and Jarvis will analyze it
            </p>
          </div>
          <button onClick={onClose} className="text-jarvis-muted hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!result ? (
          <div className="space-y-4">
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={6}
              placeholder="Paste the prospect's reply here..."
              className="jarvis-input resize-none text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="jarvis-btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!replyContent.trim() || loading}
                className="jarvis-btn-primary text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <MessageSquare className="h-4 w-4" />
                    Log &amp; Analyze
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-jarvis-border bg-jarvis-dark p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Interest
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  result.interestLevel === "hot" ? "bg-red-400/10 text-red-400" :
                  result.interestLevel === "warm" ? "bg-amber-400/10 text-amber-400" :
                  result.interestLevel === "cold" ? "bg-blue-300/10 text-blue-300" :
                  "bg-white/5 text-jarvis-muted"
                }`}>
                  {result.interestLevel.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Intent
                </span>
                <span className="text-xs text-white">
                  {result.intent.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Suggested Action
                </span>
                <span className="text-xs text-jarvis-blue">
                  {result.suggestedAction.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                  Confidence
                </span>
                <span className="text-xs text-white">
                  {Math.round(result.confidence * 100)}%
                </span>
              </div>
            </div>

            <p className="text-xs text-jarvis-muted">
              Check the <span className="text-jarvis-blue">Replies</span> tab for full details and to take action.
            </p>

            <div className="flex justify-end">
              <button onClick={onClose} className="jarvis-btn-primary text-sm">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
