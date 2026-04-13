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
  AlertTriangle,
  Mail,
  Github,
  Twitter,
} from "lucide-react";

interface DiscoveredLead {
  name: string;
  company: string;
  url: string;
  source: string;
  description: string;
  postedAt: string;
  score?: number;
  email: string;
}

const SOURCES = [
  { id: "all", label: "All Sources", icon: Globe },
  { id: "github", label: "GitHub", icon: Github },
  { id: "twitter", label: "X / Twitter", icon: Twitter },
  { id: "google", label: "Google", icon: Search },
  { id: "hackernews", label: "Hacker News", icon: Flame },
  { id: "producthunt", label: "Product Hunt", icon: Zap },
];

const SOURCE_COLORS: Record<string, string> = {
  "GitHub": "bg-white/10 text-white",
  "X / Twitter": "bg-sky-400/10 text-sky-400",
  "Google": "bg-green-400/10 text-green-400",
  "Hacker News": "bg-orange-400/10 text-orange-400",
  "Product Hunt": "bg-red-400/10 text-red-400",
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
      const rawLeads = (data.leads ?? []) as DiscoveredLead[];
      setLeads(rawLeads.map((l) => ({ ...l, email: l.email ?? "" })));
    } catch {
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  function updateEmail(index: number, email: string) {
    setLeads((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], email };
      return next;
    });
  }

  function toggleSelect(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAllWithEmail() {
    const withEmail = new Set<number>();
    leads.forEach((l, i) => {
      if (l.email.trim() && l.email.includes("@")) withEmail.add(i);
    });
    setSelected(withEmail);
  }

  function toggleAll() {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((_, i) => i)));
    }
  }

  const selectedWithEmail = Array.from(selected).filter(
    (i) => leads[i]?.email?.trim() && leads[i].email.includes("@")
  );
  const selectedWithoutEmail = selected.size - selectedWithEmail.length;

  async function handleImport() {
    if (selectedWithEmail.length === 0 || !campaignId) return;

    setImporting(true);
    setImportResult(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setImportResult("Error: Not authenticated.");
      setImporting(false);
      return;
    }

    const leadsToImport = selectedWithEmail.map((i) => {
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
        email: lead.email.trim(),
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
    const skipped = selectedWithoutEmail;
    let msg = `${count} lead${count !== 1 ? "s" : ""} imported to your campaign.`;
    if (skipped > 0) msg += ` ${skipped} skipped (no email).`;
    msg += " Run the pipeline to research and draft emails.";
    setImportResult(msg);
    setSelected(new Set());
  }

  const leadsWithEmailCount = leads.filter(
    (l) => l.email.trim() && l.email.includes("@")
  ).length;

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
            Find founders with verified emails across GitHub, X, Google, HN, and Product Hunt.
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

      {/* Email Status Banner */}
      {leads.length > 0 && leadsWithEmailCount > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-jarvis-success/20 bg-jarvis-success/5 px-4 py-3 text-sm text-jarvis-success">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{leadsWithEmailCount} lead{leadsWithEmailCount > 1 ? "s" : ""} found with email addresses.</p>
            <p className="mt-0.5 text-xs text-jarvis-success/70">
              Jarvis scraped GitHub profiles, X bios, HN profiles, and websites to find these. Select and import to start outreach.
            </p>
          </div>
        </div>
      )}
      {leads.length > 0 && leadsWithEmailCount === 0 && !loading && (
        <div className="flex items-start gap-3 rounded-md border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">No emails found automatically.</p>
            <p className="mt-0.5 text-xs text-amber-400/70">
              Add emails manually in the Email column, or try a different search. You can find founder emails on their website, Twitter bio, or LinkedIn.
            </p>
          </div>
        </div>
      )}

      {/* Import Controls */}
      {leads.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-jarvis-border bg-jarvis-surface px-4 py-3">
          <span className="text-sm text-jarvis-muted">
            {selected.size} selected
            {selectedWithEmail.length > 0 && (
              <span className="text-jarvis-success"> ({selectedWithEmail.length} with email)</span>
            )}
            {selectedWithoutEmail > 0 && (
              <span className="text-amber-400"> ({selectedWithoutEmail} missing email)</span>
            )}
          </span>
          <button onClick={toggleAll} className="jarvis-btn-ghost text-xs">
            {selected.size === leads.length ? "Deselect all" : "Select all"}
          </button>
          {leadsWithEmailCount > 0 && (
            <button onClick={selectAllWithEmail} className="jarvis-btn-ghost text-xs">
              <Mail className="h-3 w-3" />
              Select all with email
            </button>
          )}

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
                disabled={importing || selectedWithEmail.length === 0}
                className="jarvis-btn-primary text-xs"
                title={
                  selectedWithEmail.length === 0
                    ? "Add email addresses first"
                    : undefined
                }
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {selectedWithEmail.length > 0
                  ? `Import ${selectedWithEmail.length} to Campaign`
                  : "Add emails first"}
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
            Searching GitHub, X, Google, HN &amp; Product Hunt for founders with emails...
          </p>
          <p className="mt-1 text-xs text-jarvis-muted/50">
            This may take 20-40 seconds as Jarvis checks profiles and websites across multiple platforms.
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
        <div className="overflow-x-auto rounded-md border border-jarvis-border">
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
                <th className="min-w-[200px] px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-jarvis-muted">
                  <div className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    Email (required to send)
                  </div>
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
              {leads.map((lead, i) => {
                const hasEmail = lead.email.trim() && lead.email.includes("@");
                return (
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
                      <p className="text-xs text-jarvis-muted">by {lead.name}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="email"
                        value={lead.email}
                        onChange={(e) => updateEmail(i, e.target.value)}
                        placeholder="founder@company.com"
                        className={`w-full rounded-md border bg-transparent px-2 py-1 text-xs outline-none transition-colors ${
                          hasEmail
                            ? "border-jarvis-success/30 text-jarvis-success"
                            : "border-jarvis-border text-jarvis-muted placeholder:text-jarvis-muted/30 focus:border-jarvis-blue/50"
                        }`}
                      />
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
                        title="Open in new tab — find their email on their site"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tips */}
      <div className="rounded-md border border-jarvis-border/50 bg-jarvis-surface/50 px-4 py-3">
        <p className="text-xs font-medium text-jarvis-muted">How to find founder emails:</p>
        <ul className="mt-1 space-y-0.5 text-xs text-jarvis-muted/80">
          <li>&bull; Click the link icon to visit their site — emails are often on the About or Contact page</li>
          <li>&bull; Check their Twitter/X bio — many founders list their email</li>
          <li>&bull; Try <span className="text-jarvis-blue">firstname@company.com</span> — works surprisingly often</li>
          <li>&bull; Use <a href="https://hunter.io" target="_blank" rel="noopener noreferrer" className="text-jarvis-blue hover:underline">hunter.io</a> (free tier) to find emails by domain</li>
          <li>&bull; Only leads with valid emails will be imported and can receive outreach</li>
        </ul>
      </div>
    </div>
  );
}
