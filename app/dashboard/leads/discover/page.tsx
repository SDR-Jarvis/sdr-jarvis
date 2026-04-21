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

type IcpLabel = "hot" | "maybe" | "weak";

interface IcpDiscoveredLead {
  name: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  bio: string | null;
  url: string | null;
  source: string;
  icp_label: IcpLabel;
  icp_match_reason: string;
  icp_score?: number;
}

const LOADING_STEPS = [
  "Reading your description…",
  "Searching public profiles…",
  "Checking launches and communities…",
  "Scoring matches to your ICP…",
  "Curating the best results…",
];

const EXAMPLE_ICPS = [
  "Bootstrapped SaaS founders who launched recently",
  "Solo developers building developer tools",
  "Seed-stage CTOs at fintech startups",
];

export default function DiscoverLeadsPage() {
  const supabase = createClient();

  const [icpDescription, setIcpDescription] = useState("");
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
  const loadingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function loadCampaigns() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("campaigns")
        .select("id, name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setCampaigns(data ?? []);
      if (data?.length) setCampaignId(data[0].id);
    }
    loadCampaigns();
  }, [supabase]);

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
        };
        const list = (data.leads ?? []) as IcpDiscoveredLead[];
        setLeads(list);
        setFromCache(!!data.fromCache);
        setSourceWarnings(
          data.sourceWarnings?.length ? data.sourceWarnings : null
        );
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
    if (withEmail.length === 0 || !campaignId) {
      setImportResult("Select leads with a valid email, and pick a campaign.");
      return;
    }

    setImporting(true);
    setImportResult(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setImportResult("Please sign in again.");
      setImporting(false);
      return;
    }

    const rows = withEmail.map((i) => {
      const lead = leads[i];
      const raw = (lead.name || "Contact").trim();
      const parts = raw.split(/\s+/);
      const first = parts[0] || "Contact";
      const last = parts.slice(1).join(" ") || " ";
      const url = lead.url?.startsWith("http") ? lead.url : null;
      return {
        campaign_id: campaignId,
        user_id: user.id,
        first_name: first,
        last_name: last,
        company: lead.company || null,
        company_url: url,
        title: lead.title || null,
        email: emailAt(i),
        linkedin_url: url?.includes("linkedin.com") ? url : null,
        status: "new" as const,
        discovery_source: lead.source,
        icp_label: lead.icp_label,
        icp_score: lead.icp_score ?? null,
        icp_match_reason: lead.icp_match_reason || null,
      };
    });

    const { data, error } = await supabase.from("leads").insert(rows).select("id");
    setImporting(false);

    if (error) {
      setImportResult("Could not import those leads. Check emails and try again.");
      return;
    }

    const n = data?.length ?? 0;
    setImportResult(`${n} lead${n === 1 ? "" : "s"} added to your campaign. Run the pipeline when you're ready.`);
    setSelected(new Set());
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
          placeholder="e.g. bootstrapped SaaS founders who launched recently"
          className="jarvis-input resize-none text-[15px] leading-relaxed"
        />
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-jarvis-border bg-jarvis-surface/40 px-4 py-3">
            <div>
              <p className="text-sm text-white">
                Found <span className="font-semibold text-jarvis-blue">{leads.length}</span> matches
              </p>
              <p className="text-xs text-jarvis-muted/80 line-clamp-1">&ldquo;{icpDescription.trim()}&rdquo;</p>
            </div>
            {campaigns.length > 0 ? (
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="jarvis-input max-w-[200px] text-xs"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <Link href="/dashboard/campaigns/new" className="jarvis-btn-primary text-xs">
                New campaign
              </Link>
            )}
          </div>

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
                !campaignId ||
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
              disabled={importing || selectedWithEmail.length === 0 || !campaignId}
              onClick={() => void importRows(Array.from(selected))}
              className="jarvis-btn-ghost text-xs"
            >
              Add selected ({selectedWithEmail.length} with email)
            </button>
          </div>

          {importResult && (
            <div
              className={`rounded-md border px-4 py-3 text-sm ${
                importResult.startsWith("Could") || importResult.startsWith("Select") || importResult.startsWith("Please")
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
                        {lead.name || "Name unknown"}{" "}
                        {lead.company && (
                          <span className="font-normal text-jarvis-muted">
                            · {lead.company}
                            {lead.title && ` · ${lead.title}`}
                          </span>
                        )}
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
