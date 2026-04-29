"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Lock, Loader2 } from "lucide-react";
import { ApprovalActions } from "@/app/dashboard/approval-actions";

type Step = "product" | "icp" | "preview" | "unlock" | "launch";
type FitLabel = "hot" | "maybe" | "weak";

type PreviewLead = {
  name: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  url: string | null;
  source?: string | null;
  icp_label?: FitLabel;
  icp_score?: number;
  icp_match_reason?: string;
};

type ApprovalRow = {
  id: string;
  preview_subject: string;
  preview_body: string;
  leads: {
    first_name: string;
    last_name: string;
    email: string | null;
    company: string | null;
  } | null;
};

const STEP_ORDER: Step[] = ["product", "icp", "preview", "unlock", "launch"];
const SUGGESTIONS = [
  "B2B SaaS founders building dev tools",
  "Seed-stage AI startup founders",
  "Solo founders with paying customers",
] as const;
const PREVIEW_LOADING = [
  "Searching the web for your perfect customers...",
  "Scoring matches against your ICP...",
  "Building your persona profile...",
] as const;

function isStep(value: string): value is Step {
  return STEP_ORDER.includes(value as Step);
}

function progressPercent(step: Step): number {
  if (step === "product") return 25;
  if (step === "icp") return 50;
  if (step === "preview") return 75;
  if (step === "unlock") return 100;
  return 100;
}

function maskName(name: string | null): string {
  const raw = (name ?? "").trim();
  if (!raw) return "Le****d Fo****r";
  const parts = raw.split(/\s+/).filter(Boolean);
  const maskPart = (p: string) => {
    if (p.length <= 2) return `${p[0] ?? ""}****`;
    const start = p.slice(0, Math.min(2, p.length));
    const end = p.slice(-1);
    return `${start}****${end}`;
  };
  return parts.slice(0, 2).map(maskPart).join(" ");
}

function maskEmail(email: string | null): string {
  const e = (email ?? "").trim();
  if (!e || !e.includes("@")) return "██████████@██████.com";
  const [, domain] = e.split("@");
  const [host = "domain", tld = "com"] = domain.split(".");
  return `██████████@${"█".repeat(Math.max(4, host.length))}.${tld}`;
}

function sanitizeCampaignName(input: string): string {
  return input.replace(/[^\w\s-]/g, "").trim().slice(0, 48);
}

export default function OnboardingStepPage() {
  const params = useParams<{ step: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const mounted = useRef(false);

  const rawStep = params?.step ?? "product";
  const step: Step = isStep(rawStep) ? rawStep : "product";

  const [authReady, setAuthReady] = useState(false);
  const [productDescription, setProductDescription] = useState("");
  const [icpDescription, setIcpDescription] = useState("");
  const [previewLeads, setPreviewLeads] = useState<PreviewLead[]>([]);
  const [fromEmail, setFromEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [runDone, setRunDone] = useState(false);
  const [campaignId, setCampaignId] = useState<string>("");
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [sentCount, setSentCount] = useState(0);
  const [didCelebrate, setDidCelebrate] = useState(false);
  const [launchStarted, setLaunchStarted] = useState(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select(
          "onboarded, product_description, icp_description, preview_leads, from_email"
        )
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.onboarded !== false && step !== "launch") {
        router.replace("/dashboard");
        return;
      }

      const p = profile as {
        product_description?: string | null;
        icp_description?: string | null;
        preview_leads?: PreviewLead[] | null;
        from_email?: string | null;
      } | null;
      setProductDescription(p?.product_description ?? "");
      setIcpDescription(p?.icp_description ?? "");
      setPreviewLeads(Array.isArray(p?.preview_leads) ? p.preview_leads : []);
      setFromEmail(p?.from_email ?? user.email ?? "");
      setAuthReady(true);
    })();
  }, [router, step, supabase]);

  useEffect(() => {
    if (!loading || step !== "preview") return;
    const timer = setInterval(() => {
      setLoadingTextIndex((v) => (v + 1) % PREVIEW_LOADING.length);
    }, 1200);
    return () => clearInterval(timer);
  }, [loading, step]);

  const updateProfile = useCallback(
    async (patch: Record<string, unknown>) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error: updateError } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", user.id);
      if (updateError) throw new Error(updateError.message);
    },
    [supabase]
  );

  async function handleProductContinue() {
    const v = productDescription.trim();
    if (v.length < 10) return;
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select(
          "full_name, timezone, tone_preferences, compliance_opt_out_line, company_name, role"
        )
        .eq("id", user.id)
        .maybeSingle();

      const oauthName =
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null;
      const existing = (existingProfile ?? {}) as {
        full_name?: string | null;
        timezone?: string | null;
        tone_preferences?: Record<string, unknown> | null;
        compliance_opt_out_line?: string | null;
        company_name?: string | null;
        role?: string | null;
      };

      const nextTone =
        existing.tone_preferences && Object.keys(existing.tone_preferences).length > 0
          ? existing.tone_preferences
          : {
              formality: "professional-casual",
              humor: true,
            };

      await updateProfile({
        product_description: v,
        full_name: existing.full_name ?? oauthName ?? null,
        timezone: existing.timezone ?? "America/Los_Angeles",
        tone_preferences: nextTone,
        compliance_opt_out_line:
          existing.compliance_opt_out_line ??
          "Reply 'no thanks' if not relevant.",
        company_name:
          existing.company_name ??
          ((user.user_metadata?.company as string | undefined) ?? null),
        role:
          existing.role ??
          ((user.user_metadata?.job_title as string | undefined) ?? null),
      });
      router.push("/onboarding/icp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setLoading(false);
    }
  }

  async function handleIcpContinue() {
    const v = icpDescription.trim();
    if (v.length < 10) return;
    setLoading(true);
    setError("");
    try {
      await updateProfile({ icp_description: v });
      router.push("/onboarding/preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setLoading(false);
    }
  }

  const loadPreviewLeads = useCallback(async () => {
    if (!authReady || step !== "preview" || previewLeads.length > 0) return;
    if (!icpDescription.trim()) {
      router.replace("/onboarding/icp");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/discover/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icpDescription: icpDescription.trim() }),
      });
      const data = (await res.json()) as { leads?: PreviewLead[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Discovery failed (${res.status})`);
      }
      const top = (data.leads ?? []).slice(0, 5);
      setPreviewLeads(top);
      await updateProfile({ preview_leads: top });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Jarvis could not load preview leads right now."
      );
    } finally {
      setLoading(false);
    }
  }, [
    authReady,
    icpDescription,
    previewLeads.length,
    router,
    step,
    updateProfile,
  ]);

  useEffect(() => {
    void loadPreviewLeads();
  }, [loadPreviewLeads]);

  async function handleUnlockContinue() {
    const cleanEmail = fromEmail.trim();
    const emailOk = /^\S+@\S+\.\S+$/.test(cleanEmail);
    if (!emailOk || previewLeads.length === 0) return;

    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      await updateProfile({ from_email: cleanEmail, onboarded: true });

      const campaignName = sanitizeCampaignName(
        `Jarvis Launch ${new Date().toLocaleDateString()}`
      );
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .insert({
          user_id: user.id,
          name: campaignName || "Jarvis Launch",
          description: productDescription.trim() || null,
          status: "draft",
          icp_criteria: { icp_description: icpDescription.trim() || null },
          sequence_config: { steps: 1, delay_days: [0], channels: ["email"] },
        })
        .select("id")
        .single();
      if (campaignError || !campaign?.id) {
        throw new Error(campaignError?.message ?? "Could not create campaign.");
      }

      const rows = previewLeads.slice(0, 5).map((lead) => {
        const name = (lead.name ?? "Contact").trim();
        const parts = name.split(/\s+/).filter(Boolean);
        const firstName = parts[0] ?? "Contact";
        const lastName = parts.slice(1).join(" ") || " ";
        return {
          campaign_id: campaign.id,
          user_id: user.id,
          first_name: firstName,
          last_name: lastName,
          email: lead.email ?? `${firstName.toLowerCase()}@example.com`,
          title: lead.title ?? null,
          company: lead.company ?? null,
          company_url: lead.url ?? null,
          linkedin_url:
            typeof lead.url === "string" && lead.url.includes("linkedin.com")
              ? lead.url
              : null,
          status: "new",
          discovery_source: lead.source ?? "manual",
          icp_label: lead.icp_label ?? "hot",
          icp_score: lead.icp_score ?? null,
          icp_match_reason: lead.icp_match_reason ?? null,
        };
      });

      const { error: insertLeadsError } = await supabase.from("leads").insert(rows);
      if (insertLeadsError) throw new Error(insertLeadsError.message);

      router.push(`/onboarding/launch?campaignId=${campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock leads.");
    } finally {
      setLoading(false);
    }
  }

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => [...prev, line]);
  }, []);

  const refreshApprovals = useCallback(async () => {
    if (!campaignId) return;
    const { data } = await supabase
      .from("approvals")
      .select(
        "id, preview_subject, preview_body, leads(first_name, last_name, email, company)"
      )
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    setApprovals((data ?? []) as unknown as ApprovalRow[]);

    const { count } = await supabase
      .from("interactions")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent");
    setSentCount(count ?? 0);
  }, [campaignId, supabase]);

  useEffect(() => {
    if (step !== "launch" || launchStarted) return;
    const cid = searchParams.get("campaignId");
    if (!cid) {
      setError("Missing campaign. Please restart from unlock.");
      return;
    }
    setCampaignId(cid);
    setLaunchStarted(true);
    setLoading(true);
    setLogs([]);
    setRunDone(false);
    setError("");
    appendLog("Jarvis is writing your emails...");

    void (async () => {
      try {
        const res = await fetch("/api/agents/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: cid }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `Run failed (${res.status})`);
        }
        if (!res.body) throw new Error("No pipeline stream received.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event: unknown;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            const parsed = event as {
              type?: string;
              error?: string;
              data?: Record<string, { messages?: unknown[] }>;
            };
            if (parsed.type === "error") {
              throw new Error(parsed.error ?? "Pipeline error");
            }
            if (parsed.type === "update" && parsed.data) {
              Object.values(parsed.data).forEach((node) => {
                node?.messages?.forEach((m) => {
                  const content =
                    typeof m === "string"
                      ? m
                      : typeof m === "object" && m !== null
                        ? (m as { content?: string }).content
                        : "";
                  if (content) appendLog(content);
                });
              });
            }
            if (parsed.type === "done") {
              appendLog("Your first 5 emails are ready.");
            }
          }
        }
        setRunDone(true);
        await refreshApprovals();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Pipeline failed.");
      } finally {
        setLoading(false);
      }
    })();
  }, [
    appendLog,
    launchStarted,
    refreshApprovals,
    searchParams,
    step,
  ]);

  useEffect(() => {
    if (step !== "launch" || !runDone || !campaignId) return;
    void refreshApprovals();
    const timer = setInterval(() => {
      void refreshApprovals();
    }, 3000);
    return () => clearInterval(timer);
  }, [campaignId, refreshApprovals, runDone, step]);

  useEffect(() => {
    if (sentCount > 0 && !didCelebrate) {
      setDidCelebrate(true);
    }
  }, [didCelebrate, sentCount]);

  if (!authReady && step !== "launch") {
    return (
      <div className="jarvis-card flex items-center justify-center py-16 text-jarvis-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  if (!isStep(rawStep)) {
    return null;
  }

  const progress = progressPercent(step);
  const canContinueProduct = productDescription.trim().length >= 10;
  const canContinueIcp = icpDescription.trim().length >= 10;
  const canContinueUnlock =
    /^\S+@\S+\.\S+$/.test(fromEmail.trim()) && previewLeads.length > 0;

  return (
    <div className="jarvis-card space-y-6 animate-in fade-in duration-300">
      {step !== "launch" && (
        <div className="space-y-2">
          <p className="text-sm text-jarvis-muted">
            Step {Math.min(STEP_ORDER.indexOf(step) + 1, 4)} of 4
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-jarvis-blue transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {step === "product" && (
        <>
          <h1 className="text-3xl font-semibold text-white">
            What does your product do?
          </h1>
          <textarea
            value={productDescription}
            onChange={(e) => setProductDescription(e.target.value)}
            rows={4}
            className="jarvis-input resize-none text-base"
            placeholder="One sentence is fine."
          />
          <p className="text-sm text-jarvis-muted">
            We&apos;ll use this to find you the right customers automatically.
          </p>
          {error && <p className="text-sm text-jarvis-danger">{error}</p>}
          <button
            onClick={handleProductContinue}
            disabled={!canContinueProduct || loading}
            className="jarvis-btn-primary w-full justify-center text-base py-3"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue →
          </button>
        </>
      )}

      {step === "icp" && (
        <>
          <h1 className="text-3xl font-semibold text-white">
            Who&apos;s your perfect customer?
          </h1>
          <textarea
            value={icpDescription}
            onChange={(e) => setIcpDescription(e.target.value)}
            rows={4}
            className="jarvis-input resize-none text-base"
            placeholder="B2B SaaS founders, 1-10 employees, post-launch but pre-Series A"
          />
          <p className="text-sm text-jarvis-muted">
            Be specific. The clearer your ICP, the better leads Jarvis finds.
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((text) => (
              <button
                key={text}
                type="button"
                className="rounded-full border border-jarvis-border px-3 py-1 text-xs text-jarvis-muted hover:text-white"
                onClick={() => setIcpDescription(text)}
              >
                {text}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-jarvis-danger">{error}</p>}
          {loading && (
            <p className="text-sm text-jarvis-blue">Jarvis is finding your customers...</p>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-sm text-jarvis-muted hover:text-white"
              onClick={() => router.push("/onboarding/product")}
            >
              ← Back
            </button>
            <button
              onClick={handleIcpContinue}
              disabled={!canContinueIcp || loading}
              className="jarvis-btn-primary text-base px-5 py-3"
            >
              Continue →
            </button>
          </div>
        </>
      )}

      {step === "preview" && (
        <>
          <h1 className="text-3xl font-semibold text-white">
            We found {previewLeads.length || 5} perfect leads for you.
          </h1>
          <p className="text-sm text-jarvis-muted">
            Jarvis is now optimized to sell:
            <span className="block mt-1 text-white">
              &quot;{productDescription || "your product"}&quot;
            </span>
            <span className="block mt-1 text-white">
              to: &quot;{icpDescription || "your ICP"}&quot;
            </span>
          </p>
          {loading && (
            <div className="rounded-lg border border-jarvis-border bg-white/[0.02] p-4 text-sm text-jarvis-muted">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              {PREVIEW_LOADING[loadingTextIndex]}
            </div>
          )}
          {!loading &&
            previewLeads.slice(0, 2).map((lead, idx) => (
              <div
                key={`${lead.email ?? idx}`}
                className="rounded-xl border border-jarvis-border bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-jarvis-gold">
                  {lead.icp_label === "weak"
                    ? "Potential fit"
                    : lead.icp_label === "maybe"
                      ? "Good fit"
                      : "High fit"}
                </p>
                <p className="mt-1 text-base font-medium text-white">
                  {maskName(lead.name)} · {lead.company ?? "Stealth company"}
                </p>
                <p className="text-sm text-jarvis-muted">
                  {lead.title ?? "Founder"}
                </p>
                <p className="mt-2 text-sm text-jarvis-muted">
                  {maskEmail(lead.email)} <Lock className="ml-1 inline h-3 w-3" />
                </p>
              </div>
            ))}
          {!loading && previewLeads.length > 2 && (
            <p className="text-sm text-jarvis-muted">
              [{previewLeads.length - 2} more leads ready to unlock]
            </p>
          )}
          {error && <p className="text-sm text-jarvis-danger">{error}</p>}
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-sm text-jarvis-muted hover:text-white"
              onClick={() => router.push("/onboarding/icp")}
            >
              ← Back
            </button>
            <button
              onClick={() => router.push("/onboarding/unlock")}
              disabled={previewLeads.length === 0 || loading}
              className="jarvis-btn-primary text-base px-5 py-3"
            >
              Unlock my leads →
            </button>
          </div>
        </>
      )}

      {step === "unlock" && (
        <>
          <h1 className="text-3xl font-semibold text-white">
            Ready to send your first 5 emails?
          </h1>
          <div className="space-y-2 text-sm text-jarvis-muted">
            <p>✓ 5 personalized emails written by Jarvis</p>
            <p>✓ You approve every send</p>
            <p>✓ Replies go to your inbox</p>
            <p className="pt-2">Free for your first 5 sends. No credit card required.</p>
          </div>
          <div>
            <label className="mb-2 block text-sm text-jarvis-muted">
              Add your sending email below:
            </label>
            <input
              className="jarvis-input"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="you@company.com"
              type="email"
            />
          </div>
          {error && <p className="text-sm text-jarvis-danger">{error}</p>}
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-sm text-jarvis-muted hover:text-white"
              onClick={() => router.push("/onboarding/preview")}
            >
              ← Back
            </button>
            <button
              onClick={handleUnlockContinue}
              disabled={!canContinueUnlock || loading}
              className="jarvis-btn-primary text-base px-5 py-3"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Generate my 5 emails →
            </button>
          </div>
        </>
      )}

      {step === "launch" && (
        <>
          <h1 className="text-3xl font-semibold text-white">
            {runDone ? "Your first 5 emails are ready 🎉" : "Jarvis is writing your emails..."}
          </h1>
          {didCelebrate && (
            <p className="rounded-md border border-jarvis-success/40 bg-jarvis-success/10 p-3 text-sm text-jarvis-success">
              Sent! Most founders get a reply within 24 hours.
            </p>
          )}
          {!runDone && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-3/5 animate-pulse rounded-full bg-jarvis-blue" />
            </div>
          )}
          {error && <p className="text-sm text-jarvis-danger">{error}</p>}
          <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-jarvis-border bg-jarvis-dark p-3 text-sm">
            {logs.map((line, idx) => (
              <p key={`${idx}-${line.slice(0, 20)}`} className="text-jarvis-muted">
                {line}
              </p>
            ))}
            {logs.length === 0 && (
              <p className="text-jarvis-muted">Starting pipeline...</p>
            )}
          </div>

          {runDone && (
            <div className="space-y-4">
              <p className="text-sm text-jarvis-muted">
                Read each one. Edit if needed. Send when you&apos;re ready.
              </p>
              {approvals.length === 0 ? (
                <p className="text-sm text-jarvis-muted">
                  No pending approvals right now. Refreshing...
                </p>
              ) : (
                approvals.map((approval) => (
                  <div
                    key={approval.id}
                    className="rounded-lg border border-jarvis-border bg-white/[0.02] p-4"
                  >
                    <p className="text-sm text-jarvis-muted">
                      To: {approval.leads?.email ?? "lead"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      Subject: {approval.preview_subject}
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap text-sm text-jarvis-muted">
                      {approval.preview_body}
                    </pre>
                    <div className="mt-3">
                      <ApprovalActions
                        approvalId={approval.id}
                        initialSubject={approval.preview_subject}
                        initialBody={approval.preview_body}
                      />
                    </div>
                  </div>
                ))
              )}
              <button
                className="jarvis-btn-primary w-full justify-center text-base py-3"
                onClick={() => router.push("/dashboard?welcome=onboarding")}
              >
                Go to dashboard
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
