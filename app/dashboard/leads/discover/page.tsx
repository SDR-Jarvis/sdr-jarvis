"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  CheckCircle,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  PRODUCT_TAGLINE,
  PRODUCT_SUBLINE,
  discoverySourceLabel,
  fitLabel,
} from "@/lib/product-copy";
import { displayLeadCompany } from "@/lib/lead-display";

type IcpLabel = "hot" | "maybe" | "weak";

interface IcpDiscoveredLead {
  name: string | null;
  username?: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  bio: string | null;
  url: string | null;
  source: string;
  icp_label: IcpLabel;
  icp_match_reason: string;
  icp_score?: number;
  raw_score?: number;
}

const LOADING_STEPS = [
  "Reading your description…",
  "Searching public profiles…",
  "Checking launches and communities…",
  "Scoring matches to your ICP…",
  "Curating the best results…",
];

const ICP_PLACEHOLDERS = [
  "e.g. seed-stage AI startup founders",
  "e.g. B2B SaaS founders who recently launched",
  "e.g. founders building developer tools or APIs",
  "e.g. technical founders at AI infrastructure startups",
] as const;

const EXAMPLE_ICPS = [
  "Seed-stage AI startup founders",
  "B2B SaaS founders who recently launched",
  "Founders building developer tools or APIs",
  "Technical founders at AI infrastructure startups",
] as const;

export default function DiscoverLeadsPage() {
  const supabase = createClient();

  const [icpDescription, setIcpDescription] = useState("");
  const [icpPlaceholderIndex, setIcpPlaceholderIndex] = useState(0);
  const [leads, setLeads] = useState<IcpDiscoveredLead[]>([]);
  const [emailOverrides, setEmailOverrides] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [searched, setSearched] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [sourceWarnings, setSourceWarnings] = useState<string[] | null>(null);
  const [rateLimitUntil, setRateLimitUntil] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [discoveryMeta, setDiscoveryMeta] = useState<{
    totalFound: number;
    totalFiltered: number;
    returned: number;
    filterRelaxed?: boolean;
  } | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const loadingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCampaigns = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    const list = data ?? [];
    setCampaigns(list);
    return list;
  }, [supabase]);

  useEffect(() => {
    if (icpDescription !== "") return;
    const id = setInterval(() => {
      setIcpPlaceholderIndex((i) => (i + 1) % ICP_PLACEHOLDERS.length);
    }, 3500);
    return () => clearInterval(id);
  }, [icpDescription]);

  useEffect(() => {
    void loadCampaigns().then((list) => {
      if (list.length > 0) {
        setCampaignId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0].id));
      }
    });
  }, [loadCampaigns]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!loading) {
      if (loadingTimer.current) {
        clearInterval(loadingTimer.current);
        loadingTimer.current = null;
      }
      return;
    }
    loadingTimer.current = setInterval(() => {
      setLoadingStep((s) => (s + 1) % LOADING_STEPS.length);
    }, 900);
    return () => {
      if (loadingTimer.current) clearInterval(loadingTimer.current);
    };
  }, [loading]);

  const runDiscover = useCallback(
    async (bypassCache: boolean, descriptionOverride?: string) => {
      const trimmed = (descriptionOverride ?? icpDescription).trim();
      if (!trimmed) return;
      if (descriptionOverride !== undefined) {
        setIcpDescription(trimmed);
      }

      setLoading(true);
      setLoadingStep(0);
      setSearched(true);
      setImportResult(null);
      setSelected(new Set());
      setRateLimitUntil(null);
      setFromCache(false);
      setDiscoveryMeta(null);

      try {
        const res = await fetch("/api/discover/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icpDescription: trimmed, bypassCache }),
        });

        if (res.status === 429) {
          const err = (await res.json()) as { nextAvailableAt?: string };
          setLeads([]);
          setEmailOverrides({});
          setRateLimitUntil(err.nextAvailableAt ?? null);
          return;
        }

        if (!res.ok) {
          setLeads([]);
          setEmailOverrides({});
          return;
        }

        const data = (await res.json()) as {
          leads?: IcpDiscoveredLead[];
          fromCache?: boolean;
          sourceWarnings?: string[];
          discovery?: {
            totalFound: number;
            totalFiltered: number;
            returned: number;
            filterRelaxed?: boolean;
          };
        };
        const list = (data.leads ?? []) as IcpDiscoveredLead[];
        setLeads(list);
        setFromCache(!!data.fromCache);
        setSourceWarnings(
          data.sourceWarnings?.length ? data.sourceWarnings : null
        );
        setDiscoveryMeta(data.discovery ?? null);
        if (data.discovery && typeof window !== "undefined") {
          // eslint-disable-next-line no-console -- mirrors server summary for local tuning
          console.log("Discovery Summary (client):", data.discovery);
        }
        const emails: Record<number, string> = {};
        list.forEach((l, i) => {
          emails[i] = l.email?.trim() ?? "";
        });
        setEmailOverrides(emails);
      } catch {
        setLeads([]);
        setEmailOverrides({});
      } finally {
        setLoading(false);
      }
    },
    [icpDescription]
  );

  function emailAt(i: number) {
    return (emailOverrides[i] ?? "").trim();
  }

  function hasValidEmail(i: number) {
    const e = emailAt(i);
    return e.includes("@") && e.length > 3;
  }

  function toggleSelect(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function selectIndices(indices: number[]) {
    setSelected(new Set(indices));
  }

  const highFitIndices = leads
    .map((l, i) => (l.icp_label === "hot" ? i : -1))
    .filter((i) => i >= 0);
  const allIndices = leads.map((_, i) => i);

  const selectedWithEmail = Array.from(selected).filter((i) => hasValidEmail(i));

  async function importRows(indices: number[]) {
    const withEmail = indices.filter((i) => hasValidEmail(i));

    if (!campaignId.trim()) {
      const msg = "Pick a campaign first or create a new one.";
      setImportResult(msg);
      setToast({ type: "error", msg });
      return;
    }

    if (withEmail.length === 0) {
      setImportResult("Select leads with a valid email.");
      return;
    }

    setImporting(true);
    setImportResult(null);
    setToast(null);

    const leadsPayload = withEmail.map((i) => {
      const lead = leads[i];
      return {
        name: lead.name,
        username: lead.username ?? null,
        email: emailAt(i),
        title: lead.title,
        company: lead.company,
        bio: lead.bio,
        url: lead.url,
        source: lead.source,
        icp_label: lead.icp_label,
        icp_score: lead.icp_score ?? 0,
        icp_match_reason: lead.icp_match_reason,
      };
    });

    try {
      const res = await fetch("/api/leads/add-from-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, leads: leadsPayload }),
      });
      const json = (await res.json()) as {
        error?: string;
        count?: number;
        campaign_name?: string;
        campaign_id?: string;
      };

      if (!res.ok) {
        const errMsg = json.error ?? "Could not add leads.";
        setImportResult(errMsg);
        setToast({ type: "error", msg: errMsg });
        return;
      }

      const n = json.count ?? 0;
      const cname = json.campaign_name ?? "your campaign";
      const successMsg = `${n} lead${n === 1 ? "" : "s"} added to ${cname}.`;
      setToast({ type: "success", msg: successMsg });
      let msg = `${successMsg} Run the pipeline when you're ready.`;
      if (n < 5) {
        msg += `\n\nWe couldn't find strong matches yet.\nTry broadening your description.\n\nExample ICP: "SaaS founders building developer tools"`;
      }
      setImportResult(msg);
      setSelected(new Set());
    } catch {
      const errMsg = "Network error. Try again.";
      setImportResult(errMsg);
      setToast({ type: "error", msg: errMsg });
    } finally {
      setImporting(false);
    }
  }

  async function handleCreateCampaign() {
    const name = newCampaignName.trim();
    if (!name) return;
    setCreatingCampaign(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setToast({ type: "error", msg: "Please sign in again." });
        return;
      }
      const { data, error } = await supabase
        .from("campaigns")
        .insert({ user_id: user.id, name })
        .select("id, name")
        .single();

      if (error || !data) {
        console.error("[Discover] Create campaign FAILED:", error);
        setToast({ type: "error", msg: error?.message ?? "Could not create campaign." });
        return;
      }

      await loadCampaigns();
      setCampaignId(data.id);
      setNewCampaignName("");
      setCreateCampaignOpen(false);
      setToast({ type: "success", msg: `Campaign "${data.name}" created.` });
    } finally {
      setCreatingCampaign(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <Link
          href="/dashboard/leads"
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-white/5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 text-jarvis-muted" />
        </Link>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-jarvis-blue/90">
            {PRODUCT_TAGLINE}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-white">Discover leads</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-jarvis-muted">
            {PRODUCT_SUBLINE} Describe who you want in plain English — we&apos;ll surface real people to
            review and add.
          </p>
        </div>
      </div>

      <div className="jarvis-card space-y-4">
        <label htmlFor="icp" className="block text-sm font-medium text-jarvis-muted">
          Who are you trying to reach?
        </label>
        <textarea
          id="icp"
          value={icpDescription}
          onChange={(e) => setIcpDescription(e.target.value)}
          rows={3}
          placeholder={ICP_PLACEHOLDERS[icpPlaceholderIndex]}
          className="jarvis-input resize-none text-[15px] leading-relaxed"
        />
        <p className="text-xs leading-relaxed text-jarvis-muted/90">
          Describe the SaaS or AI founder you want to reach. Be specific — better description = better leads.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading || !icpDescription.trim()}
            onClick={() => void runDiscover(false)}
            className="jarvis-btn-primary"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? "Finding…" : "Find leads"}
          </button>
          {fromCache && leads.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void runDiscover(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-jarvis-border px-3 py-2 text-xs font-medium text-jarvis-muted transition-colors hover:border-jarvis-blue/30 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh search
            </button>
          )}
        </div>
      </div>

      {fromCache && leads.length > 0 && !loading && (
        <p className="flex items-center gap-2 text-xs text-jarvis-muted/80">
          <CheckCircle className="h-3.5 w-3.5 text-jarvis-success/70" />
          Showing recent results. Use Refresh for a new pull.
        </p>
      )}

      {sourceWarnings?.length && !loading && leads.length > 0 ? (
        <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-100/90">
          Couldn&apos;t reach {sourceWarnings.join(" · ")} — other sources still contributed. If the list looks thin, try{" "}
          <button
            type="button"
            className="font-medium text-jarvis-blue hover:underline"
            onClick={() => void runDiscover(true)}
          >
            Refresh search
          </button>
          .
        </p>
      ) : null}

      {rateLimitUntil && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-200/90">
          You&apos;ve hit the hourly search limit. Next run after{" "}
          {new Date(rateLimitUntil).toLocaleString()}.{" "}
          <Link href="/dashboard/leads/import" className="font-medium text-jarvis-blue hover:underline">
            Import leads you already have
          </Link>
          .
        </div>
      )}

      {loading && (
        <div className="jarvis-card flex flex-col items-center justify-center py-14 text-center">
          <Loader2 className="mb-4 h-9 w-9 animate-spin text-jarvis-blue" />
          <p className="text-sm font-medium text-white">{LOADING_STEPS[loadingStep]}</p>
          <p className="mt-2 max-w-sm text-xs text-jarvis-muted/80">
            We check several public sources. If one is slow or unavailable, others still contribute.
          </p>
        </div>
      )}

      {!loading && searched && leads.length === 0 && !rateLimitUntil && (
        <div className="jarvis-card space-y-5 py-10 px-6 text-center">
          <p className="text-sm font-medium text-white">No strong matches yet</p>
          <p className="text-sm text-jarvis-muted leading-relaxed">
            Try a shorter, broader description (one audience + one signal). For example, focus on{" "}
            <span className="text-white/90">&quot;fintech founders&quot;</span> instead of stacking many filters.
          </p>
          <div className="space-y-2 text-left">
            <p className="text-xs font-medium uppercase tracking-wider text-jarvis-muted/70">
              Try an example
            </p>
            <div className="flex flex-col gap-2">
              {EXAMPLE_ICPS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => void runDiscover(false, ex)}
                  className="rounded-md border border-jarvis-border bg-jarvis-dark/50 px-3 py-2 text-left text-sm text-jarvis-muted transition-colors hover:border-jarvis-blue/40 hover:text-white"
                >
                  {ex} <span className="text-jarvis-blue">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && leads.length > 0 && (
        <>
          {toast ? (
            <div
              className={`fixed bottom-6 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-lg ${
                toast.type === "success"
                  ? "border-jarvis-success/40 bg-jarvis-dark text-jarvis-success"
                  : "border-jarvis-danger/40 bg-jarvis-dark text-jarvis-danger"
              }`}
            >
              {toast.msg}
            </div>
          ) : null}

          {createCampaignOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/60"
                aria-label="Close"
                onClick={() => !creatingCampaign && setCreateCampaignOpen(false)}
              />
              <div className="relative z-10 w-full max-w-md rounded-lg border border-jarvis-border bg-jarvis-surface p-6 shadow-xl">
                <h3 className="text-lg font-semibold text-white">Create campaign</h3>
                <p className="mt-1 text-sm text-jarvis-muted">
                  Name your workspace — it will be selected for adding leads below.
                </p>
                <input
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  placeholder="e.g. Seed outreach — March"
                  className="jarvis-input mt-4"
                  autoFocus
                />
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    className="jarvis-btn-ghost text-sm"
                    disabled={creatingCampaign}
                    onClick={() => setCreateCampaignOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="jarvis-btn-primary text-sm"
                    disabled={creatingCampaign || !newCampaignName.trim()}
                    onClick={() => void handleCreateCampaign()}
                  >
                    {creatingCampaign ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Create
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="jarvis-card space-y-3 border-jarvis-blue/20">
            <p className="text-sm font-medium text-white">Add selected leads to campaign</p>
            <div className="flex flex-wrap items-center gap-2">
              {campaigns.length > 0 ? (
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="jarvis-input min-w-[200px] max-w-full flex-1 text-sm"
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-jarvis-muted">No campaigns yet — create one to save leads.</p>
              )}
              <button
                type="button"
                onClick={() => setCreateCampaignOpen(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-jarvis-border px-3 py-2 text-xs font-medium text-jarvis-muted transition-colors hover:border-jarvis-blue/40 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Create new
              </button>
            </div>
            <div className="border-t border-white/10 pt-3">
              <p className="text-sm text-white">
                Found <span className="font-semibold text-jarvis-blue">{leads.length}</span> matches
              </p>
              <p className="text-xs text-jarvis-muted/80 line-clamp-1">&ldquo;{icpDescription.trim()}&rdquo;</p>
            </div>
          </div>

          {discoveryMeta?.filterRelaxed ? (
            <div className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-100/90">
              Strict filters removed every candidate — showing a small fallback set so you still have people to
              review. Try a broader ICP or add emails manually, then run again.
            </div>
          ) : null}

          {!discoveryMeta?.filterRelaxed && leads.length > 0 && leads.length < 5 ? (
            <div className="rounded-md border border-jarvis-border/60 bg-jarvis-dark/40 px-3 py-2 text-xs text-jarvis-muted">
              We couldn&apos;t find strong matches yet. Try broadening your description. Example:{" "}
              <span className="text-white/90">&quot;SaaS founders building developer tools&quot;</span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => selectIndices(highFitIndices)}
              className="jarvis-btn-primary text-xs"
              disabled={highFitIndices.length === 0}
            >
              Select all high-fit
            </button>
            <button type="button" onClick={() => selectIndices(allIndices)} className="jarvis-btn-ghost text-xs">
              Select all
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="jarvis-btn-ghost text-xs">
              Clear selection
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled={
                importing ||
                !campaignId.trim() ||
                !highFitIndices.some((i) => hasValidEmail(i))
              }
              onClick={() => void importRows(highFitIndices.filter((i) => hasValidEmail(i)))}
              className="jarvis-btn-primary text-xs"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add all high-fit with email
            </button>
            <button
              type="button"
              disabled={importing || selectedWithEmail.length === 0 || !campaignId.trim()}
              onClick={() => void importRows(Array.from(selected))}
              className="jarvis-btn-ghost text-xs"
            >
              Add selected ({selectedWithEmail.length} with email)
            </button>
          </div>

          {importResult && (
            <div
              className={`rounded-md border px-4 py-3 text-sm whitespace-pre-wrap ${
                importResult.startsWith("Could") ||
                importResult.startsWith("Select") ||
                importResult.startsWith("Pick") ||
                importResult.startsWith("Please") ||
                importResult.startsWith("No leads passed") ||
                importResult.includes("We couldn't find strong matches")
                  ? "border-amber-400/30 bg-amber-400/5 text-amber-100/90"
                  : "border-jarvis-success/30 bg-jarvis-success/5 text-jarvis-success"
              }`}
            >
              {importResult}
            </div>
          )}

          <div className="space-y-3">
            {leads.map((lead, i) => {
              const weak = lead.icp_label === "weak";
              return (
                <div
                  key={`${lead.url ?? ""}-${i}`}
                  className={`jarvis-card space-y-3 transition-opacity ${weak ? "opacity-[0.62]" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggleSelect(i)}
                      className="mt-1 rounded border-jarvis-border"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">{fitLabel(lead.icp_label)}</span>
                        <span className="text-[10px] uppercase tracking-wider text-jarvis-muted/60">
                          via {discoverySourceLabel(lead.source)}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-white">
                        {(lead.name ?? "").trim() || (lead.username ?? "").trim() || "Contact"}{" "}
                        <span className="font-normal text-jarvis-muted">
                          · {displayLeadCompany(lead.company)}
                          {lead.title && ` · ${lead.title}`}
                        </span>
                      </p>
                      {lead.bio && (
                        <p className="text-xs leading-relaxed text-jarvis-muted line-clamp-3">&ldquo;{lead.bio}&rdquo;</p>
                      )}
                      <div className="rounded-md border border-jarvis-border/60 bg-jarvis-dark/60 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted/70">
                          Why this lead?
                        </p>
                        <p className="mt-1 text-xs text-jarvis-muted/90">{lead.icp_match_reason || "Matches your description."}</p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[200px] flex-1">
                          <label className="mb-1 block text-[10px] font-medium text-jarvis-muted/70">Email</label>
                          <input
                            type="email"
                            value={emailOverrides[i] ?? ""}
                            onChange={(e) =>
                              setEmailOverrides((prev) => ({
                                ...prev,
                                [i]: e.target.value,
                              }))
                            }
                            placeholder="Add if missing"
                            className="jarvis-input text-xs"
                          />
                        </div>
                        {lead.url?.startsWith("http") && (
                          <a
                            href={lead.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-jarvis-blue hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Profile
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
