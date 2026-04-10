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
} from "lucide-react";

type CsvRow = Record<string, string>;

const LEAD_FIELDS = [
  { key: "first_name", label: "First Name", required: true },
  { key: "last_name", label: "Last Name", required: true },
  { key: "email", label: "Email" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "company_url", label: "Company URL" },
] as const;

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
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
        (field.key === "first_name" && (h === "firstname" || h === "first")) ||
        (field.key === "last_name" && (h === "lastname" || h === "last")) ||
        (field.key === "email" && h.includes("email")) ||
        (field.key === "linkedin_url" && (h.includes("linkedin") || h.includes("profile"))) ||
        (field.key === "title" && (h === "title" || h === "jobtitle" || h === "role")) ||
        (field.key === "company" && (h === "company" || h === "companyname" || h === "organization")) ||
        (field.key === "company_url" && (h.includes("companyurl") || h.includes("website")))
    );
    if (idx >= 0) {
      mapping[field.key] = csvHeaders[idx];
    }
  });

  return mapping;
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
  const [result, setResult] = useState<{ success: number; errors: number } | null>(null);
  const [error, setError] = useState("");

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
    if (!mapping.first_name || !mapping.last_name) {
      setError("First Name and Last Name mappings are required.");
      return;
    }

    setLoading(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }

    const leadsToInsert = csvRows.map((row) => ({
      campaign_id: campaignId,
      user_id: user.id,
      first_name: row[mapping.first_name] ?? "",
      last_name: row[mapping.last_name] ?? "",
      email: mapping.email ? row[mapping.email] || null : null,
      linkedin_url: mapping.linkedin_url ? row[mapping.linkedin_url] || null : null,
      title: mapping.title ? row[mapping.title] || null : null,
      company: mapping.company ? row[mapping.company] || null : null,
      company_url: mapping.company_url ? row[mapping.company_url] || null : null,
      status: "new" as const,
    }));

    const { data, error: insertError } = await supabase
      .from("leads")
      .insert(leadsToInsert)
      .select("id");

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    // Update campaign stats
    await supabase
      .from("campaigns")
      .update({
        stats: {
          total_leads: (data?.length ?? 0),
          researched: 0,
          drafted: 0,
          sent: 0,
          replied: 0,
          booked: 0,
        },
      })
      .eq("id", campaignId);

    setResult({ success: data?.length ?? 0, errors: csvRows.length - (data?.length ?? 0) });
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
          <h1 className="text-2xl font-bold text-white">Import Leads</h1>
          <p className="text-sm text-jarvis-muted">
            Upload a CSV and map columns to lead fields.
          </p>
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
              Ready for research. Head to{" "}
              <Link href="/dashboard/leads" className="text-jarvis-blue hover:underline">
                Leads
              </Link>{" "}
              to review, or start the campaign pipeline.
            </p>
          </div>
        </div>
      )}

      {/* Step 1: Upload */}
      {csvRows.length === 0 && !result && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`jarvis-card flex cursor-pointer flex-col items-center justify-center py-16 transition-all ${
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
          <Upload
            className={`mb-4 h-10 w-10 ${dragOver ? "text-jarvis-blue" : "text-jarvis-muted/40"}`}
          />
          <p className="text-sm font-medium text-white">
            Drag & drop a CSV file, or click to browse
          </p>
          <p className="mt-1 text-xs text-jarvis-muted">
            Expected columns: First Name, Last Name, Email, Company, Title, LinkedIn URL
          </p>
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
                    {field.required && (
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
