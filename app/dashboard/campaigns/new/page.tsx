"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Loader2, Zap } from "lucide-react";
import Link from "next/link";

const CHANNELS = ["email", "linkedin"] as const;

const INDUSTRY_OPTIONS = [
  "SaaS",
  "Fintech",
  "Healthcare",
  "E-commerce",
  "AI/ML",
  "Developer Tools",
  "Cybersecurity",
  "EdTech",
  "MarTech",
  "Other",
];

export default function NewCampaignPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [titles, setTitles] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [steps, setSteps] = useState(3);
  const [delayDays, setDelayDays] = useState("0, 3, 7");
  const [channels, setChannels] = useState<string[]>(["email"]);

  function toggleIndustry(ind: string) {
    setIndustries((prev) =>
      prev.includes(ind) ? prev.filter((i) => i !== ind) : [...prev, ind]
    );
  }

  function toggleChannel(ch: string) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    if (channels.length === 0) {
      setError("Select at least one channel.");
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

    const icpCriteria = {
      industries: industries.length ? industries : undefined,
      titles: titles
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      companySize: companySize || undefined,
    };

    const delays = delayDays
      .split(",")
      .map((d) => parseInt(d.trim(), 10))
      .filter((n) => !isNaN(n));

    const { data, error: insertError } = await supabase
      .from("campaigns")
      .insert({
        user_id: user.id,
        name: name.trim(),
        description: description.trim() || null,
        status: "draft",
        icp_criteria: icpCriteria,
        sequence_config: {
          steps,
          delay_days: delays.length ? delays : [0, 3, 7],
          channels,
        },
      })
      .select("id")
      .single();

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push(`/dashboard/campaigns`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/campaigns"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4 text-jarvis-muted" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">New Campaign</h1>
          <p className="text-sm text-jarvis-muted">
            Define your target audience and outreach sequence.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basics */}
        <div className="jarvis-card space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            Basics
          </h2>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
              Campaign Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Series A Founders — Q2 2026"
              className="jarvis-input"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the campaign goal…"
              rows={3}
              className="jarvis-input resize-none"
            />
          </div>
        </div>

        {/* ICP */}
        <div className="jarvis-card space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            Ideal Customer Profile
          </h2>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
              Target Titles (comma-separated)
            </label>
            <input
              type="text"
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
              placeholder="VP Engineering, CTO, Head of Product"
              className="jarvis-input"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-jarvis-muted">
              Industries
            </label>
            <div className="flex flex-wrap gap-2">
              {INDUSTRY_OPTIONS.map((ind) => (
                <button
                  key={ind}
                  type="button"
                  onClick={() => toggleIndustry(ind)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    industries.includes(ind)
                      ? "border-jarvis-blue/50 bg-jarvis-blue/10 text-jarvis-blue"
                      : "border-jarvis-border text-jarvis-muted hover:border-jarvis-blue/30 hover:text-white"
                  }`}
                >
                  {ind}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
              Company Size
            </label>
            <select
              value={companySize}
              onChange={(e) => setCompanySize(e.target.value)}
              className="jarvis-input"
            >
              <option value="">Any size</option>
              <option value="1-10">1–10 employees</option>
              <option value="11-50">11–50 employees</option>
              <option value="51-200">51–200 employees</option>
              <option value="201-1000">201–1,000 employees</option>
              <option value="1000+">1,000+ employees</option>
            </select>
          </div>
        </div>

        {/* Sequence */}
        <div className="jarvis-card space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            Outreach Sequence
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Steps
              </label>
              <input
                type="number"
                min={1}
                max={7}
                value={steps}
                onChange={(e) => setSteps(parseInt(e.target.value, 10) || 1)}
                className="jarvis-input"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Delay between steps (days)
              </label>
              <input
                type="text"
                value={delayDays}
                onChange={(e) => setDelayDays(e.target.value)}
                placeholder="0, 3, 7"
                className="jarvis-input font-mono"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-jarvis-muted">
              Channels
            </label>
            <div className="flex gap-3">
              {CHANNELS.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleChannel(ch)}
                  className={`rounded-md border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                    channels.includes(ch)
                      ? "border-jarvis-blue/50 bg-jarvis-blue/10 text-jarvis-blue"
                      : "border-jarvis-border text-jarvis-muted hover:border-jarvis-blue/30 hover:text-white"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Error + Submit */}
        {error && (
          <p className="text-sm text-jarvis-danger">{error}</p>
        )}

        <div className="flex justify-end gap-3">
          <Link href="/dashboard/campaigns" className="jarvis-btn-ghost">
            Cancel
          </Link>
          <button type="submit" disabled={loading} className="jarvis-btn-primary">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            {loading ? "Creating…" : "Create Campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
