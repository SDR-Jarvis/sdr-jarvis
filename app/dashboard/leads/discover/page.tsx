"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  Loader2,
  Plus,
  CheckCircle,
  ExternalLink,
  Flame,
  Zap,
  Globe,
  Filter,
} from "lucide-react";

interface DiscoveredLead {
  name: string;
  company: string;
  url: string;
  source: string;
  description: string;
  postedAt: string;
  score?: number;
}

const SOURCES = [
  { id: "all", label: "All Sources", icon: Globe },
  { id: "hackernews", label: "Hacker News", icon: Flame },
  { id: "producthunt", label: "Product Hunt", icon: Zap },
  { id: "indiehackers", label: "Indie Hackers", icon: Globe },
];

const SOURCE_COLORS: Record<string, string> = {
  "Hacker News": "bg-orange-400/10 text-orange-400",
  "Product Hunt": "bg-red-400/10 text-red-400",
  "Indie Hackers": "bg-blue-400/10 text-blue-400",
};

export default function DiscoverLeadsPage() {
  const supabase = createClient();

  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [leads, setLeads] = useState<DiscoveredLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

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
    handleSearch();
  }, []);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setSearched(true);
    setImportResult(null);
    setSelected(new Set());

    try {
      const params = new URLSearchParams({ source });
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`/api/leads/discover?${params}`);
      const data = await res.json();
      setLeads(data.leads ?? []);
    } catch {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((_, i) => i)));
    }
  }

  async function handleImport() {
    if (selected.size === 0 || !campaignId) return;

    setImporting(true);
    setImportResult(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setImportResult("Not authenticated.");
      setImporting(false);
      return;
    }

    const leadsToImport = Array.from(selected).map((i) => {
      const lead = leads[i];
      const nameParts = lead.name.split(" ");
      return {
        campaign_id: campaignId,
        user_id: user.id,
        first_name: nameParts[0] || lead.name,
        last_name: nameParts.slice(1).join(" ") || "",
        company: lead.company,
        company_url: lead.url.startsWith("http") ? lead.url : null,
        status: "new" as const,
        title: "Founder",
        email: null,
        linkedin_url: null,
      };
    });

    const { data, error } = await supabase
      .from("leads")
      .insert(leadsToImport)
      .select("id");

    setImporting(false);

    if (error) {
      setImportResult(`Error: ${error.message}`);
      return;
    }

    const count = data?.length ?? 0;
    setImportResult(`${count} lead${count !== 1 ? "s" : ""} imported to your campaign. Jarvis is ready to research them.`);
    setSelected(new Set());
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/leads"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 text-jarvis-muted" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Discover Leads</h1>
          <p className="text-sm text-jarvis-muted">
            Find founders from Hacker News, Product Hunt, and Indie Hackers.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-jarvis-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: SaaS, AI, developer tools, no-code..."
            className="jarvis-input w-full pl-10"
          />
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-jarvis-muted pointer-events-none" />
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="jarvis-input pl-10 pr-8 appearance-none"
            >
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={loading} className="jarvis-btn-primary">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </button>
        </div>
      </form>

      {/* Import Controls */}
      {leads.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-jarvis-border bg-jarvis-surface px-4 py-3">
          <span className="text-sm text-jarvis-muted">
            {selected.size} of {leads.length} selected
          </span>
          <button
            onClick={toggleAll}
            className="jarvis-btn-ghost text-xs"
          >
            {selected.size === leads.length ? "Deselect all" : "Select all"}
          </button>

          <div className="flex-1" />

          {campaigns.length > 0 ? (
            <>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="jarvis-input text-xs"
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleImport}
                disabled={importing || selected.size === 0}
                className="jarvis-btn-primary text-xs"
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Import {selected.size} to Campaign
              </button>
            </>
          ) : (
            <Link href="/dashboard/campaigns/new" className="jarvis-btn-primary text-xs">
              <Plus className="h-3.5 w-3.5" />
              Create Campaign First
            </Link>
          )}
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div
          className={`flex items-center gap-2 rounded-md px-4 py-3 text-sm ${
            importResult.startsWith("Error")
              ? "border border-red-400/20 bg-red-400/5 text-red-400"
              : "border border-jarvis-success/20 bg-jarvis-success/5 text-jarvis-success"
          }`}
        >
          <CheckCircle className="h-4 w-4 shrink-0" />
          {importResult}
        </div>
      )}

      {/* Results */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-jarvis-blue" />
          <p className="text-sm text-jarvis-muted">
            Searching for founders across the internet...
          </p>
        </div>
      )}

      {!loading && searched && leads.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="mb-3 h-8 w-8 text-jarvis-muted/30" />
          <p className="text-sm text-jarvis-muted">
            No results found. Try different keywords or a broader search.
          </p>
        </div>
      )}

      {!loading && leads.length > 0 && (
        <div className="overflow-hidden rounded-md border border-jarvis-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-jarvis-border bg-jarvis-surface">
                <th className="px-3 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size === leads.length && leads.length > 0}
                    onChange={toggleAll}
                    className="rounded border-jarvis-border"
                  />
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                  Founder / Company
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                  Description
                </th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                  Source
                </th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                  Score
                </th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                  Link
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-jarvis-border/50">
              {leads.map((lead, i) => (
                <tr
                  key={i}
                  className={`transition-colors ${
                    selected.has(i)
                      ? "bg-jarvis-blue/5"
                      : "hover:bg-white/[0.02]"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggleSelect(i)}
                      className="rounded border-jarvis-border"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-white">{lead.company}</p>
                    <p className="text-xs text-jarvis-muted">
                      by {lead.name}
                    </p>
                  </td>
                  <td className="max-w-xs px-3 py-2.5">
                    <p className="truncate text-xs text-jarvis-muted">
                      {lead.description}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        SOURCE_COLORS[lead.source] ?? "bg-white/5 text-jarvis-muted"
                      }`}
                    >
                      {lead.source}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {lead.score != null && lead.score > 0 ? (
                      <span className="font-mono text-xs text-jarvis-gold">
                        {lead.score}
                      </span>
                    ) : (
                      <span className="text-xs text-jarvis-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <a
                      href={lead.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-jarvis-blue hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tips */}
      <div className="rounded-md border border-jarvis-border/50 bg-jarvis-surface/50 px-4 py-3">
        <p className="text-xs font-medium text-jarvis-muted">Search tips:</p>
        <ul className="mt-1 space-y-0.5 text-xs text-jarvis-muted/80">
          <li>&bull; Try keywords like &ldquo;SaaS&rdquo;, &ldquo;AI tool&rdquo;, &ldquo;developer&rdquo;, &ldquo;no-code&rdquo;, &ldquo;B2B&rdquo;</li>
          <li>&bull; Hacker News &ldquo;Show HN&rdquo; posts are great — founders launching products and looking for users</li>
          <li>&bull; HN Score = upvotes. Higher score = more popular launch = more legit founder</li>
          <li>&bull; After importing, Jarvis will research each lead and draft personalized emails</li>
        </ul>
      </div>
    </div>
  );
}
