"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
  ClipboardList,
} from "lucide-react";
import { IMPORT_INVITE, PRODUCT_TAGLINE } from "@/lib/product-copy";

type CsvRow = Record<string, string>;

const LEAD_FIELDS = [
  { key: "full_name", label: "Full Name" },
  { key: "first_name", label: "First Name", required: true },
  { key: "last_name", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "company_url", label: "Company URL" },
] as const;

function parseDelimitedLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values.map((v) => v.replace(/^"|"$/g, ""));
}

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseDelimitedLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseDelimitedLine(lines[i]);
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }

  return { headers, rows };
}

function autoMapColumns(
  csvHeaders: string[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lower = csvHeaders.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));

  LEAD_FIELDS.forEach((field) => {
    const normalized = field.key.replace(/_/g, "");
    const idx = lower.findIndex(
      (h) =>
        h === normalized ||
        h.includes(normalized) ||
        (field.key === "full_name" && (h === "name" || h === "fullname" || h === "contact")) ||
        (field.key === "first_name" && (h === "firstname" || h === "first")) ||
        (field.key === "last_name" && (h === "lastname" || h === "last")) ||
        (field.key === "email" && h.includes("email")) ||
        (field.key === "linkedin_url" && (h.includes("linkedin") || h.includes("profile"))) ||
        (field.key === "title" && (h === "title" || h === "jobtitle" || h === "role" || h === "position")) ||
        (field.key === "company" && (h === "company" || h === "companyname" || h === "organization")) ||
        (field.key === "company_url" && (h.includes("companyurl") || h.includes("website") || h === "url" || h === "domain"))
    );
    if (idx >= 0) {
      mapping[field.key] = csvHeaders[idx];
    }
  });

  return mapping;
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Contact", last: " " };
  if (parts.length === 1) return { first: parts[0], last: " " };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function extractEmailsFromPaste(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return matches ? [...new Set(matches.map((e) => e.toLowerCase()))] : [];
}

function namePartsFromEmail(email: string): { first: string; last: string } {
  const local = (email.split("@")[0] ?? "contact").replace(/[^a-zA-Z0-9._-]+/g, ".");
  const segments = local.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) =>
    s.length ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
  if (segments.length >= 2) {
    return { first: cap(segments[0]), last: cap(segments.slice(1).join(" ")) };
  }
  if (segments[0]) return { first: cap(segments[0]), last: " " };
  return { first: "Contact", last: " " };
}

function companyGuessFromEmail(email: string): string {
  const domain = email.split("@")[1]?.split(".")[0] ?? "";
  if (!domain) return "Unknown";
  return domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase();
}

type LeadInsertRow = {
  first_name: string;
  last_name: string;
  email: string | null;
  linkedin_url: string | null;
  title: string | null;
  company: string | null;
  company_url: string | null;
  discovery_source: string;
  status: "new";
};

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function leadRowFromMappedCsv(
  row: CsvRow,
  map: Record<string, string>
): LeadInsertRow {
  const mappedFullName = map.full_name ? row[map.full_name] ?? "" : "";
  const fromFullName = splitName(mappedFullName);
  const email = map.email ? (row[map.email] ?? "").trim().toLowerCase() : "";
  const fromEmail = email ? namePartsFromEmail(email) : { first: "Contact", last: " " };
  const firstName = (map.first_name ? row[map.first_name] : "")?.trim() || fromFullName.first || fromEmail.first;
  const lastName = (map.last_name ? row[map.last_name] : "")?.trim() || fromFullName.last || fromEmail.last;

  return {
    first_name: firstName,
    last_name: lastName,
    email: email || null,
    linkedin_url: map.linkedin_url ? normalizeUrl(row[map.linkedin_url] ?? "") : null,
    title: map.title ? (row[map.title] || null) : null,
    company: map.company ? (row[map.company] || null) : email ? companyGuessFromEmail(email) : null,
    company_url: map.company_url ? normalizeUrl(row[map.company_url] ?? "") : null,
    discovery_source: "manual",
    status: "new",
  };
}

function parsePastedLeadRows(text: string): LeadInsertRow[] {
  const parsedCsv = parseCsv(text);
  if (parsedCsv.headers.length > 0) {
    const mapped = autoMapColumns(parsedCsv.headers);
    if (mapped.full_name || mapped.first_name || mapped.email || mapped.company || mapped.company_url) {
      return parsedCsv.rows.map((row) => leadRowFromMappedCsv(row, mapped));
    }
  }

  const lineRows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.includes("\t") ? line.split("\t").map((v) => v.trim()) : parseDelimitedLine(line))
    .filter((cols) => cols.length > 1);

  if (lineRows.length > 0) {
    return lineRows.map((cols) => {
      const email = cols.find((v) => /@/.test(v))?.toLowerCase() ?? "";
      const urls = cols.map(normalizeUrl).filter((v): v is string => Boolean(v));
      const linkedin = urls.find((u) => /linkedin\.com/i.test(u)) ?? null;
      const companyUrl = urls.find((u) => !/linkedin\.com/i.test(u)) ?? null;
      const { first, last } = splitName(cols[0] ?? "");
      return {
        first_name: first,
        last_name: last,
        email: email || null,
        title: cols[1] && !/@/.test(cols[1]) ? cols[1] : null,
        company: cols[2] && !/@|https?:\/\//i.test(cols[2]) ? cols[2] : email ? companyGuessFromEmail(email) : null,
        company_url: companyUrl,
        linkedin_url: linkedin,
        discovery_source: "manual",
        status: "new",
      };
    });
  }

  return extractEmailsFromPaste(text).map((email) => {
    const { first, last } = namePartsFromEmail(email);
    return {
      first_name: first,
      last_name: last,
      email,
      company: companyGuessFromEmail(email),
      company_url: null,
      linkedin_url: null,
      title: null,
      discovery_source: "manual",
      status: "new",
    };
  });
}

export default function ImportLeadsPage() {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: number; skipped?: number } | null>(null);
  const [error, setError] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);

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
  }, []);

  const handleFile = useCallback((file: File) => {
    setError("");
    setResult(null);

    if (!file.name.endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCsv(text);

      if (headers.length === 0) {
        setError("Could not parse CSV. Make sure it has headers and data.");
        return;
      }

      setCsvHeaders(headers);
      setCsvRows(rows);
      setMapping(autoMapColumns(headers));
    };
    reader.readAsText(file);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function updateMapping(fieldKey: string, csvHeader: string) {
    setMapping((prev) => ({ ...prev, [fieldKey]: csvHeader }));
  }

  async function handleImport() {
    if (!campaignId) {
      setError("Select a campaign first.");
      return;
    }
    if (!mapping.full_name && !mapping.first_name) {
      setError("Map either Full Name or First Name before importing.");
      return;
    }
    if (!mapping.company) {
      setError("Map Company before importing.");
      return;
    }

    setLoading(true);
    setError("");

    const leadsToInsert = csvRows.map((row) => leadRowFromMappedCsv(row, mapping));
    let data: {
      error?: string;
      added?: number;
      skipped?: number;
      rejected?: Array<{ index: number; reason: string }>;
    } = {};
    try {
      const response = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, leads: leadsToInsert }),
      });
      data = (await response.json()) as typeof data;

      if (!response.ok) {
        setError(data.error ?? "Could not import leads.");
        setLoading(false);
        return;
      }
    } catch {
      setError("Could not import leads. Check your connection and try again.");
      setLoading(false);
      return;
    }

    setLoading(false);

    const added = data.added ?? 0;
    const rejected = data.rejected?.length ?? 0;
    setResult({ success: added, errors: rejected, skipped: data.skipped ?? 0 });
  }

  async function handlePasteImport() {
    setError("");
    setResult(null);
    if (!campaignId) {
      setError("Select a campaign first.");
      return;
    }
    setPasteLoading(true);
    const rows = parsePastedLeadRows(pasteText);
    if (rows.length === 0) {
      setError("Paste at least one lead with a name, company, URL, or email.");
      setPasteLoading(false);
      return;
    }

    let data: {
      error?: string;
      added?: number;
      skipped?: number;
      rejected?: Array<{ index: number; reason: string }>;
    } = {};
    try {
      const response = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, leads: rows }),
      });
      data = (await response.json()) as typeof data;

      if (!response.ok) {
        setError(data.error ?? "Could not add those contacts. Try again or use a CSV.");
        setPasteLoading(false);
        return;
      }
    } catch {
      setError("Could not add those contacts. Check your connection and try again.");
      setPasteLoading(false);
      return;
    }
    setPasteLoading(false);

    setPasteText("");
    setResult({
      success: data.added ?? 0,
      errors: data.rejected?.length ?? 0,
      skipped: data.skipped ?? 0,
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/leads"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 text-jarvis-muted" />
        </Link>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-jarvis-blue/80">{PRODUCT_TAGLINE}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-white">Import leads</h1>
          <p className="mt-1 max-w-xl text-sm text-jarvis-muted leading-relaxed">{IMPORT_INVITE}</p>
        </div>
      </div>

      {/* Success State */}
      {result && (
        <div className="jarvis-card jarvis-glow flex items-center gap-4 border-jarvis-success/30">
          <CheckCircle className="h-8 w-8 text-jarvis-success" />
          <div>
            <p className="font-semibold text-white">
              {result.success} lead{result.success !== 1 ? "s" : ""} imported
              successfully.
            </p>
            <p className="text-sm text-jarvis-muted">
              {result.skipped || result.errors
                ? `${result.skipped ?? 0} duplicate${result.skipped === 1 ? "" : "s"} skipped, ${result.errors} invalid row${result.errors === 1 ? "" : "s"} rejected. `
                : ""}
              Ready for research. Head to{" "}
              <Link href="/dashboard/leads" className="text-jarvis-blue hover:underline">
                Leads
              </Link>{" "}
              to review, or start the campaign pipeline.
            </p>
          </div>
        </div>
      )}

      {/* Step 1: Paste or CSV */}
      {csvRows.length === 0 && !result && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="jarvis-card flex flex-col space-y-3">
            <div className="flex items-center gap-2 text-jarvis-muted">
              <ClipboardList className="h-4 w-4 text-jarvis-blue" />
              <span className="text-xs font-semibold uppercase tracking-wider">Paste emails</span>
            </div>
            <p className="text-xs text-jarvis-muted/80">
              Paste rows with name, title, company, email, company URL, and LinkedIn URL. Headers are optional.
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={"Jane Doe, VP Sales, Acme, jane@acme.com, https://acme.com, https://linkedin.com/in/janedoe\nSam Lee, Founder, BrightAI, https://bright.ai"}
              className="jarvis-input resize-none font-mono text-xs"
            />
            <div>
              <label className="mb-1.5 block text-xs font-medium text-jarvis-muted">Campaign</label>
              {campaigns.length === 0 ? (
                <p className="text-xs text-jarvis-danger">
                  <Link href="/dashboard/campaigns/new" className="text-jarvis-blue hover:underline">
                    Create a campaign
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="jarvis-input text-sm"
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handlePasteImport()}
              disabled={pasteLoading || !campaignId || !pasteText.trim()}
              className="jarvis-btn-primary text-sm"
            >
              {pasteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pasteLoading ? "Adding…" : "Add pasted leads"}
            </button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`jarvis-card flex cursor-pointer flex-col items-center justify-center py-12 transition-all ${
              dragOver
                ? "border-jarvis-blue bg-jarvis-blue/5 jarvis-glow"
                : "hover:border-jarvis-blue/30"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="hidden"
            />
            <FileSpreadsheet
              className={`mb-3 h-10 w-10 ${dragOver ? "text-jarvis-blue" : "text-jarvis-muted/40"}`}
            />
            <p className="text-sm font-semibold text-white">Upload a CSV</p>
            <p className="mt-1 max-w-[220px] text-center text-xs text-jarvis-muted">
              Best for spreadsheets. Include name, title, company, email, company URL, and LinkedIn URL when available.
            </p>
            <p className="mt-3 text-xs font-medium text-jarvis-blue/90">Click or drag file here</p>
          </div>
        </div>
      )}

      {/* Step 2: Map Columns */}
      {csvRows.length > 0 && !result && (
        <>
          <div className="jarvis-card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
                Column Mapping
              </h2>
              <button
                onClick={() => {
                  setCsvHeaders([]);
                  setCsvRows([]);
                  setMapping({});
                }}
                className="jarvis-btn-ghost text-xs"
              >
                <X className="h-3 w-3" /> Reset
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-md bg-jarvis-blue/5 border border-jarvis-blue/20 px-3 py-2 text-xs text-jarvis-blue">
              <FileSpreadsheet className="h-4 w-4" />
              {csvRows.length} row{csvRows.length !== 1 ? "s" : ""} detected
              with {csvHeaders.length} columns
            </div>

            {/* Campaign Selector */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Assign to Campaign *
              </label>
              {campaigns.length === 0 ? (
                <p className="text-sm text-jarvis-danger">
                  No campaigns found.{" "}
                  <Link
                    href="/dashboard/campaigns/new"
                    className="text-jarvis-blue hover:underline"
                  >
                    Create one first.
                  </Link>
                </p>
              ) : (
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="jarvis-input"
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Field Mapping */}
            <div className="grid gap-3">
              {LEAD_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="w-32 text-sm text-jarvis-muted">
                    {field.label}
                    {"required" in field && field.required && (
                      <span className="text-jarvis-danger"> *</span>
                    )}
                  </span>
                  <select
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => updateMapping(field.key, e.target.value)}
                    className="jarvis-input flex-1"
                  >
                    <option value="">— Skip —</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="jarvis-card space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              Preview (first 5 rows)
            </h2>
            <div className="overflow-x-auto rounded-md border border-jarvis-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-jarvis-border bg-jarvis-surface">
                    {LEAD_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th
                        key={f.key}
                        className="px-3 py-2 text-left font-semibold text-jarvis-muted"
                      >
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-jarvis-border">
                  {csvRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="text-jarvis-muted">
                      {LEAD_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="px-3 py-2">
                          {row[mapping[f.key]] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Error + Import */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-jarvis-danger">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Link href="/dashboard/leads" className="jarvis-btn-ghost">
              Cancel
            </Link>
            <button
              onClick={handleImport}
              disabled={loading || campaigns.length === 0}
              className="jarvis-btn-primary"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {loading ? "Importing…" : `Import ${csvRows.length} Leads`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
