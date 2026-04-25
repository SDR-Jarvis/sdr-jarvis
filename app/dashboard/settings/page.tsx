"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Save,
  Loader2,
  User,
  Building2,
  MessageSquare,
  Globe,
  CheckCircle,
  Copy,
  ExternalLink,
  CreditCard,
  Mail,
  Shield,
  Lock,
  KeyRound,
  Circle,
  Plug,
} from "lucide-react";
import {
  evaluatePassword,
  PASSWORD_MIN_LENGTH,
  passwordMeetsPolicy,
  passwordPolicyHint,
} from "@/lib/auth/password-policy";
import { BillingTab } from "./billing-tab";
import { TestEmailButton } from "../test-email-button";
import { TestSlackButton } from "../test-slack-button";
import { getFriendlyAuthError } from "@/lib/auth/error-messages";

type Tab = "profile" | "domain" | "billing" | "compliance" | "integrations";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-jarvis-blue" /></div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const initialTab = (searchParams.get("tab") as Tab) ?? "profile";
  const [tab, setTab] = useState<Tab>(
    ["profile", "billing", "domain", "compliance", "integrations"].includes(initialTab)
      ? initialTab
      : "profile"
  );

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("");
  const [icpDescription, setIcpDescription] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [formality, setFormality] = useState("professional-casual");
  const [humor, setHumor] = useState(true);
  const [signoff, setSignoff] = useState("Best");
  const [optOutFooter, setOptOutFooter] = useState(
    'If this isn\'t relevant, reply "no thanks" and I won\'t follow up again.'
  );
  const [postalAddress, setPostalAddress] = useState("");
  const [warmupDailyCap, setWarmupDailyCap] = useState(20);
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [savedCompliance, setSavedCompliance] = useState(false);
  const [sendingMode, setSendingMode] = useState<"shared" | "custom">("shared");
  const [sendingModeSaving, setSendingModeSaving] = useState(false);
  const [apolloApiKey, setApolloApiKey] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdResetSending, setPwdResetSending] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState("");
  const [profileSaveError, setProfileSaveError] = useState("");
  const [complianceSaveError, setComplianceSaveError] = useState("");

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) {
        console.error("[Profile Read] Error:", error.message);
      }

      if (user?.email) setLoginEmail(user.email);

      if (profile) {
        setFullName(profile.full_name ?? "");
        setCompanyName(profile.company_name ?? "");
        setRole(profile.role ?? "");
        setIcpDescription(profile.icp_description ?? "");
        setTimezone(profile.timezone ?? "America/Los_Angeles");
        const tone = (profile.tone_preferences ?? {}) as Record<string, unknown>;
        setFormality((tone.formality as string) ?? "professional-casual");
        setHumor(tone.humor !== false);
        setSignoff((tone.signoff as string) ?? "Best");
        const ext = profile as Record<string, unknown>;
        const optLine =
          (typeof ext.compliance_opt_out_line === "string" &&
            ext.compliance_opt_out_line.trim()) ||
          (typeof ext.email_opt_out_footer === "string" &&
            ext.email_opt_out_footer.trim());
        if (optLine) setOptOutFooter(optLine);
        const postal =
          typeof ext.compliance_postal_address === "string"
            ? ext.compliance_postal_address
            : typeof ext.postal_address === "string"
              ? ext.postal_address
              : "";
        setPostalAddress(postal);
        const cap =
          typeof ext.daily_send_cap === "number"
            ? ext.daily_send_cap
            : typeof ext.warmup_daily_send_cap === "number"
              ? ext.warmup_daily_send_cap
              : undefined;
        if (typeof cap === "number") setWarmupDailyCap(cap);
        if (ext.sending_mode === "custom" || ext.sending_mode === "shared") {
          setSendingMode(ext.sending_mode as "shared" | "custom");
        } else {
          setSendingMode("shared");
        }
        const admin = ext.is_admin === true;
        setIsAdmin(admin);
        if (admin) {
          if (typeof ext.apollo_api_key === "string") {
            setApolloApiKey(ext.apollo_api_key);
          } else {
            setApolloApiKey("");
          }
        }
      }
      setLoading(false);
    }
    loadProfile();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setProfileSaveError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        console.error("[Profile Save] FAILED: no authenticated user");
        setProfileSaveError("You are not signed in. Refresh and try again.");
        return;
      }

      const profileUpdate: Record<string, unknown> = {
        full_name: fullName.trim() || null,
        company_name: companyName.trim() || null,
        role: role.trim() || null,
        icp_description: icpDescription.trim() || null,
        timezone,
        tone_preferences: { formality, humor, signoff },
        compliance_opt_out_line: optOutFooter.trim() || null,
        compliance_postal_address: postalAddress.trim() || null,
        onboarded: true,
        sending_mode: sendingMode,
      };
      if (isAdmin) {
        profileUpdate.apollo_api_key = apolloApiKey.trim() || null;
      }

      const { data: updatedRows, error } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", user.id)
        .select("id, full_name, company_name, role, icp_description");

      if (error) {
        console.error("[Profile Save] FAILED:", error);
        setProfileSaveError(getFriendlyAuthError(error.message));
        return;
      }

      if (!updatedRows?.length) {
        console.warn("[Profile Save] Update affected 0 rows — upserting profile");
        const { data: upserted, error: upsertErr } = await supabase
          .from("profiles")
          .upsert({ id: user.id, ...profileUpdate }, { onConflict: "id" })
          .select("id, full_name, company_name");

        if (upsertErr) {
          console.error("[Profile Save] FAILED (upsert):", upsertErr);
          setProfileSaveError(getFriendlyAuthError(upsertErr.message));
          return;
        }
        if (!upserted?.length) {
          console.error("[Profile Save] FAILED: upsert returned no row");
          setProfileSaveError("Could not save profile. Try again or contact support.");
          return;
        }
        console.log("[Profile Save] SUCCESS (upsert):", upserted[0]);
      } else {
        console.log("[Profile Save] SUCCESS:", updatedRows[0]);
      }
      router.refresh();

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCompliance() {
    setSavingCompliance(true);
    setSavedCompliance(false);
    setComplianceSaveError("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        console.error("[Profile Save] Compliance FAILED: no authenticated user");
        setComplianceSaveError("You are not signed in.");
        return;
      }

      const line = optOutFooter.trim();
      if (!line) {
        return;
      }

      const complianceUpdate: Record<string, unknown> = {
        compliance_opt_out_line: line,
        compliance_postal_address: postalAddress.trim() || null,
        warmup_daily_send_cap: Math.min(500, Math.max(1, warmupDailyCap)),
      };

      const { data, error } = await supabase
        .from("profiles")
        .update(complianceUpdate)
        .eq("id", user.id)
        .select("id");

      if (error) {
        console.error("[Profile Save] Compliance FAILED:", error);
        setComplianceSaveError(getFriendlyAuthError(error.message));
        return;
      }

      if (!data?.length) {
        console.error("[Profile Save] Compliance FAILED: no row updated");
        setComplianceSaveError("Could not save. Try again.");
        return;
      }

      console.log("[Profile Save] Compliance SUCCESS:", data[0]);
      router.refresh();
      setSavedCompliance(true);
      setTimeout(() => setSavedCompliance(false), 3000);
    } finally {
      setSavingCompliance(false);
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError("");
    setPwdSuccess("");
    if (newPassword !== confirmNewPassword) {
      setPwdError("New password and confirmation do not match.");
      return;
    }
    const checks = evaluatePassword(newPassword);
    if (!passwordMeetsPolicy(checks)) {
      setPwdError(passwordPolicyHint(checks) ?? "Password does not meet requirements.");
      return;
    }
    setPwdSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwdSaving(false);
    if (error) {
      setPwdError(getFriendlyAuthError(error.message));
      return;
    }
    setNewPassword("");
    setConfirmNewPassword("");
    setPwdSuccess("Password updated. Use it next time you sign in.");
    setTimeout(() => setPwdSuccess(""), 5000);
  }

  async function handleSendPasswordResetEmail() {
    if (!loginEmail.trim()) {
      setPwdError("Could not read your login email. Sign out and back in.");
      return;
    }
    setPwdResetSending(true);
    setPwdError("");
    setPwdSuccess("");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail.trim(), {
      redirectTo: `${origin}/auth/callback?next=/dashboard/settings`,
    });
    setPwdResetSending(false);
    if (error) {
      setPwdError(getFriendlyAuthError(error.message));
      return;
    }
    setPwdSuccess("Check your email for a link to set a new password.");
    setTimeout(() => setPwdSuccess(""), 6000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-jarvis-blue" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-jarvis-muted">
          Your profile, sending address, and legal footer.
        </p>
      </div>

      {/* Tab Switcher */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-jarvis-surface/40 p-1">
        <TabButton
          active={tab === "profile"}
          onClick={() => setTab("profile")}
          icon={User}
          label="Your profile"
        />
        <TabButton
          active={tab === "billing"}
          onClick={() => setTab("billing")}
          icon={CreditCard}
          label="Plan & billing"
        />
        <TabButton
          active={tab === "integrations"}
          onClick={() => setTab("integrations")}
          icon={Plug}
          label="Integrations"
        />
        <TabButton
          active={tab === "domain"}
          onClick={() => setTab("domain")}
          icon={Globe}
          label="Sending address"
        />
        <TabButton
          active={tab === "compliance"}
          onClick={() => setTab("compliance")}
          icon={Shield}
          label="Legal footer"
        />
      </div>

      {tab === "profile" && (
        <>
          <div id="test-email" className="jarvis-card space-y-3 scroll-mt-24">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <Mail className="h-4 w-4" />
              Email delivery
            </h2>
            <p className="text-sm text-jarvis-muted">
              Sends one message to your login email so you can confirm outbound delivery and your domain are working
              before you email leads.
            </p>
            <TestEmailButton />
            <div className="border-t border-white/10 pt-4">
              <p className="mb-2 text-sm text-jarvis-muted">
                Optional Slack alerts. Paste an incoming Slack URL from your workspace if you want activity pings; leave blank to keep them off.
              </p>
              <TestSlackButton />
            </div>
          </div>

          {/* Password & security */}
          <div className="jarvis-card space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <Lock className="h-4 w-4" />
              Password &amp; security
            </h2>
            <p className="text-sm text-jarvis-muted">
              Signed in as <span className="text-jarvis-muted/90">{loginEmail || "—"}</span>. Change your password here, or use email reset if you prefer a magic link flow.
            </p>

            <form onSubmit={handleUpdatePassword} className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                  New password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="jarvis-input"
                  placeholder="Enter a strong new password"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                  Confirm new password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="jarvis-input"
                  placeholder="Repeat new password"
                />
              </div>
              <PasswordChecklist password={newPassword} />
              {pwdError && (
                <p className="text-sm text-jarvis-danger">{pwdError}</p>
              )}
              {pwdSuccess && (
                <p className="text-sm text-jarvis-success">{pwdSuccess}</p>
              )}
              <button
                type="submit"
                disabled={pwdSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-jarvis-blue px-4 py-2 text-sm font-bold text-jarvis-dark hover:brightness-110 disabled:opacity-50"
              >
                {pwdSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {pwdSaving ? "Updating…" : "Update password"}
              </button>
            </form>

            <div className="border-t border-white/10 pt-4">
              <p className="mb-2 text-sm text-jarvis-muted">
                Prefer to reset by email (same address as above)?
              </p>
              <button
                type="button"
                onClick={handleSendPasswordResetEmail}
                disabled={pwdResetSending}
                className="text-sm font-medium text-jarvis-blue hover:underline disabled:opacity-50"
              >
                {pwdResetSending ? "Sending…" : "Email me a password reset link"}
              </button>
            </div>
          </div>

          {/* Profile */}
          <div className="jarvis-card space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <User className="h-4 w-4" />
              Profile
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Tony Stark"
                  className="jarvis-input"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                  Role
                </label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Founder & CEO"
                  className="jarvis-input"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Stark Industries"
                className="jarvis-input"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="jarvis-input"
              >
                <option value="America/Los_Angeles">Pacific (LA)</option>
                <option value="America/Denver">Mountain (Denver)</option>
                <option value="America/Chicago">Central (Chicago)</option>
                <option value="America/New_York">Eastern (NYC)</option>
                <option value="Europe/London">London (GMT)</option>
                <option value="Europe/Berlin">Berlin (CET)</option>
                <option value="Asia/Kolkata">India (IST)</option>
                <option value="Asia/Tokyo">Tokyo (JST)</option>
              </select>
            </div>
          </div>

          {/* ICP */}
          <div className="jarvis-card space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <Building2 className="h-4 w-4" />
              Ideal Customer Profile
            </h2>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Describe your ideal customer
              </label>
              <textarea
                value={icpDescription}
                onChange={(e) => setIcpDescription(e.target.value)}
                placeholder="Series A SaaS founders in fintech who are scaling from 10 to 50 employees and need help with outbound sales automation…"
                rows={4}
                className="jarvis-input resize-none"
              />
              <p className="mt-1 text-xs text-jarvis-muted/50">
                Jarvis uses this to score leads and personalize outreach angles.
              </p>
            </div>
          </div>

          {/* Tone */}
          <div className="jarvis-card space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <MessageSquare className="h-4 w-4" />
              Outreach Tone
            </h2>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Formality
              </label>
              <select
                value={formality}
                onChange={(e) => setFormality(e.target.value)}
                className="jarvis-input"
              >
                <option value="formal">Formal</option>
                <option value="professional-casual">Professional-casual (recommended)</option>
                <option value="casual">Casual / friendly</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-jarvis-muted">Humor / wit</p>
                <p className="text-xs text-jarvis-muted/50">
                  Allow Jarvis to add personality to emails
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHumor(!humor)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  humor ? "bg-jarvis-blue" : "bg-jarvis-border"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    humor ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Email sign-off
              </label>
              <input
                type="text"
                value={signoff}
                onChange={(e) => setSignoff(e.target.value)}
                placeholder="Best"
                className="jarvis-input"
              />
            </div>
          </div>

          {/* Save */}
          <div className="flex flex-col items-end gap-2">
            {profileSaveError ? (
              <p className="max-w-md text-right text-sm text-jarvis-danger">{profileSaveError}</p>
            ) : null}
            <div className="flex items-center justify-end gap-3">
              {saved && (
                <span className="text-sm text-jarvis-success">Settings saved.</span>
              )}
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="jarvis-btn-primary"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "billing" && <BillingTab />}

      {tab === "integrations" && (
        <div className="space-y-6">
          <div className="jarvis-card space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <Plug className="h-4 w-4" />
              Integrations
            </h2>
            {isAdmin ? (
              <>
                <p className="text-sm text-jarvis-muted leading-relaxed">
                  Apollo-powered discovery uses the Apollo key configured on the server for the whole app (your hosting
                  provider’s environment). This field is reserved for a future per-account option and is not used by
                  Discover today. You can leave it blank.
                </p>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">Apollo (optional)</label>
                  <input
                    type="password"
                    value={apolloApiKey}
                    onChange={(e) => setApolloApiKey(e.target.value)}
                    placeholder="Paste key — stored on your account only"
                    autoComplete="off"
                    className="jarvis-input font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-jarvis-muted/50">
                    Only used for discovery and sync features you trigger. You can clear this field anytime.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
                  {saved && (
                    <span className="text-sm text-jarvis-success">Settings saved.</span>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="jarvis-btn-primary"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3 text-sm leading-relaxed text-jarvis-muted">
                <p>Lead discovery is powered by Jarvis.</p>
                <p>No setup needed — we handle it for you.</p>
                <p className="text-jarvis-muted/80">Coming soon: connect your own tools.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "domain" && (
        <div className="space-y-6">
          <SendingModeCard
            sendingMode={sendingMode}
            onChange={setSendingMode}
            saving={sendingModeSaving}
            onSave={async () => {
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (!user) {
                console.error("[Profile Save] Sending mode FAILED: no user");
                return;
              }
              setSendingModeSaving(true);
              try {
                const { data, error } = await supabase
                  .from("profiles")
                  .update({ sending_mode: sendingMode })
                  .eq("id", user.id)
                  .select("id");
                if (error) {
                  console.error("[Profile Save] Sending mode FAILED:", error);
                  return;
                }
                if (!data?.length) {
                  console.error("[Profile Save] Sending mode FAILED: no row updated");
                  return;
                }
                console.log("[Profile Save] Sending mode SUCCESS:", data[0]);
              } finally {
                setSendingModeSaving(false);
              }
            }}
          />
          <DomainSetupGuide />
        </div>
      )}

      {tab === "compliance" && (
        <div className="space-y-6">
          <div className="jarvis-card space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <Shield className="h-4 w-4" />
              Legal footer
            </h2>
            <p className="text-sm text-jarvis-muted leading-relaxed">
              Jarvis <strong className="text-white">appends</strong> your opt-out line and postal
              address to every draft. You are responsible for lawful outreach — read{" "}
              <a
                href="/legal/email-compliance"
                className="text-jarvis-blue hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Email compliance
              </a>
              .
            </p>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Opt-out line (required)
              </label>
              <textarea
                value={optOutFooter}
                onChange={(e) => setOptOutFooter(e.target.value)}
                rows={3}
                className="jarvis-input resize-none text-sm"
              />
              <p className="mt-1 text-xs text-jarvis-muted/50">
                Shown after the message body. Do not remove opt-out intent.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Physical mailing address
              </label>
              <textarea
                value={postalAddress}
                onChange={(e) => setPostalAddress(e.target.value)}
                placeholder="Company legal name, street, city, region, postal code, country"
                rows={3}
                className="jarvis-input resize-none text-sm"
              />
              <p className="mt-1 text-xs text-jarvis-muted/50">
                Required for many jurisdictions (e.g. CAN-SPAM). Shown below the opt-out line.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                Max sends per day (warmup guardrail)
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={warmupDailyCap}
                onChange={(e) => setWarmupDailyCap(parseInt(e.target.value, 10) || 1)}
                className="jarvis-input max-w-xs"
              />
              <p className="mt-1 text-xs text-jarvis-muted/50">
                UTC day. Start low (e.g. 5–20) on a new domain; increase as reputation builds.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {complianceSaveError ? (
                <p className="max-w-md text-right text-sm text-jarvis-danger">{complianceSaveError}</p>
              ) : null}
              <div className="flex items-center justify-end gap-3">
              {savedCompliance && (
                <span className="text-sm text-jarvis-success">Saved.</span>
              )}
              <button
                type="button"
                onClick={() => void handleSaveCompliance()}
                disabled={savingCompliance || !optOutFooter.trim()}
                className="jarvis-btn-primary"
              >
                {savingCompliance ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save compliance settings
              </button>
            </div>
          </div>
        </div>
          <div className="jarvis-card text-sm text-jarvis-muted leading-relaxed">
            <p className="font-medium text-white">Domain authentication</p>
            <p className="mt-2">
              Configure SPF, DKIM, and DMARC on a <strong className="text-white">separate</strong> sending domain when
              you&apos;re ready. Use the{" "}
              <button
                type="button"
                onClick={() => setTab("domain")}
                className="text-jarvis-blue hover:underline"
              >
                Sending address
              </button>{" "}
              tab. Daily pipeline volume is also capped automatically to protect deliverability.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PasswordChecklist({ password }: { password: string }) {
  const c = evaluatePassword(password);
  const rows = [
    { id: "len", ok: c.minLength, label: `At least ${PASSWORD_MIN_LENGTH} characters` },
    { id: "lo", ok: c.lowercase, label: "Lowercase letter" },
    { id: "up", ok: c.uppercase, label: "Uppercase letter" },
    { id: "d", ok: c.digit, label: "Number" },
    { id: "s", ok: c.symbol, label: "Symbol" },
  ];
  if (!password) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-2 text-[11px] text-jarvis-muted">
          {row.ok ? (
            <CheckCircle className="h-3 w-3 shrink-0 text-jarvis-success" aria-hidden />
          ) : (
            <Circle className="h-3 w-3 shrink-0 text-jarvis-muted/35" aria-hidden />
          )}
          {row.label}
        </li>
      ))}
    </ul>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-w-[calc(50%-4px)] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-all sm:min-w-0 sm:gap-2 sm:px-3 sm:text-sm ${
        active
          ? "bg-jarvis-surface text-white shadow-sm"
          : "text-jarvis-muted hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function SendingModeCard({
  sendingMode,
  onChange,
  saving,
  onSave,
}: {
  sendingMode: "shared" | "custom";
  onChange: (m: "shared" | "custom") => void;
  saving: boolean;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="jarvis-card space-y-4">
      <h2 className="text-base font-semibold text-white">How do you want to send?</h2>
      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-white/[0.02] ${
          sendingMode === "shared"
            ? "border-jarvis-blue/50 bg-jarvis-blue/[0.07]"
            : "border-jarvis-border/80"
        }`}
      >
        <input
          type="radio"
          name="sendingMode"
          className="mt-1"
          checked={sendingMode === "shared"}
          onChange={() => onChange("shared")}
        />
        <div>
          <p className="font-medium text-white">Send immediately</p>
          <p className="text-sm text-jarvis-muted">
            Recommended to start: mail from a verified shared address. No DNS — you can send your first batch right away.
          </p>
        </div>
      </label>
      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-white/[0.02] ${
          sendingMode === "custom"
            ? "border-jarvis-blue/50 bg-jarvis-blue/[0.07]"
            : "border-jarvis-border/80"
        }`}
      >
        <input
          type="radio"
          name="sendingMode"
          className="mt-1"
          checked={sendingMode === "custom"}
          onChange={() => onChange("custom")}
        />
        <div>
          <p className="font-medium text-white">Use my own domain</p>
          <p className="text-sm text-jarvis-muted">
            Better branding and deliverability once DNS is verified (about 10 minutes, one time). Your
            registrar&apos;s support can help with DNS.
          </p>
        </div>
      </label>
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-md bg-jarvis-blue px-4 py-2 text-sm font-bold text-jarvis-dark hover:brightness-110 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Save sending preference
      </button>
    </div>
  );
}

function normalizeSendingDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  let host = trimmed.replace(/^https?:\/\//, "").split("/")[0]?.trim() ?? "";
  host = host.replace(/^www\./, "");
  if (!host) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    return null;
  }
  return host;
}

function dnsRecordTemplates(domain: string) {
  return [
    {
      id: "spf",
      type: "TXT",
      name: "@",
      value: "v=spf1 include:amazonses.com ~all",
      purpose:
        "SPF — Tells receiving servers your outbound provider is allowed to send email for your domain.",
    },
    {
      id: "dkim1",
      type: "CNAME",
      name: "resend._domainkey",
      value: `resend._domainkey.${domain}.resend-dns.com`,
      purpose:
        "DKIM — Cryptographic signature so recipients can verify messages. Copy the exact host and value your provider shows.",
    },
    {
      id: "dmarc",
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
      purpose: "DMARC — Policy that tells recipients what to do with emails that fail SPF/DKIM.",
    },
  ];
}

type DomainStep = {
  num: number;
  title: string;
  body: string;
  link?: string;
  showDns?: boolean;
};

function DomainSetupGuide() {
  const supabase = createClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingDomain, setSendingDomain] = useState<string | null>(null);
  const [wantsBuyGuide, setWantsBuyGuide] = useState(false);
  const [draftDomain, setDraftDomain] = useState("");
  const [gateError, setGateError] = useState("");

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) {
        console.error("[Profile Read] Error:", error.message);
      }
      const row = profile as {
        sending_domain?: string | null;
        wants_domain_buy_guide?: boolean | null;
      } | null;
      setSendingDomain(row?.sending_domain?.trim() || null);
      setWantsBuyGuide(!!row?.wants_domain_buy_guide);
      setLoading(false);
    }
    load();
  }, [supabase]);

  async function persistDomainPrefs(next: {
    sending_domain: string | null;
    wants_domain_buy_guide: boolean;
  }) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setSaving(true);
    setGateError("");
    const { error } = await supabase
      .from("profiles")
      .update({
        sending_domain: next.sending_domain,
        wants_domain_buy_guide: next.wants_domain_buy_guide,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setGateError(getFriendlyAuthError(error.message));
      return;
    }
    setSendingDomain(next.sending_domain);
    setWantsBuyGuide(next.wants_domain_buy_guide);
  }

  async function handleSaveDomain() {
    const normalized = normalizeSendingDomain(draftDomain);
    if (!normalized) {
      setGateError("Enter a valid domain (e.g. mail.yourcompany.com or outreach.acme.com).");
      return;
    }
    await persistDomainPrefs({
      sending_domain: normalized,
      wants_domain_buy_guide: false,
    });
    setDraftDomain("");
  }

  async function handleShowBuyGuide() {
    await persistDomainPrefs({
      sending_domain: null,
      wants_domain_buy_guide: true,
    });
  }

  async function handleBackToDomainGate() {
    await persistDomainPrefs({
      sending_domain: null,
      wants_domain_buy_guide: false,
    });
    setDraftDomain("");
  }

  async function handleClearDomainForBuyGuide() {
    await persistDomainPrefs({
      sending_domain: null,
      wants_domain_buy_guide: true,
    });
  }

  const fullGuideSteps: DomainStep[] = [
    {
      num: 1,
      title: "Buy or use a secondary domain",
      body: "Don't use your main company domain for cold outreach. Buy a separate domain (e.g., tryjarvis.co or yourbrand-mail.com) to protect your primary domain's reputation. Namecheap, Cloudflare, or Google Domains all work.",
    },
    {
      num: 2,
      title: "Add your domain to your sending provider",
      body: "In your outbound email provider’s dashboard, add this domain. They will show the exact DNS records to copy.",
      link: "https://resend.com/domains",
    },
    {
      num: 3,
      title: "Add DNS records",
      body: "Add these records in your domain registrar’s DNS settings. Your registrar’s support can walk you through it — it usually takes about 10 minutes and only needs to be done once. The records below are examples; always use the values your provider shows.",
      showDns: true,
    },
    {
      num: 4,
      title: "Verify the domain",
      body: 'After adding DNS records, use “Verify” in your sending provider’s dashboard. DNS propagation can take from a few minutes up to 48 hours. Once verified, the status should show as ready.',
    },
    {
      num: 5,
      title: "Set your “from” address",
      body: "Ask whoever manages your app deployment to set the verified outbound address (for example hello@yourdomain.com) in your project configuration, then redeploy so new sends use your domain.",
    },
    {
      num: 6,
      title: "Warm up your domain",
      body: "Start low (e.g. 5–20 sends/day), then ramp gradually. Jarvis enforces your per-day send cap from Settings → Legal footer; keep pipeline batches small on new domains.",
    },
  ];

  const leanSteps = (domain: string): DomainStep[] => [
    {
      num: 1,
      title: `Add “${domain}” to your sending provider`,
      body: `In your outbound email provider’s dashboard, add the domain exactly as: ${domain}. They will show the DNS records to add at your DNS host.`,
      link: "https://resend.com/domains",
    },
    {
      num: 2,
      title: "Add DNS records",
      body: "Add the records your provider gives you at your registrar or DNS host. The templates below are examples — always prefer the values from your provider’s dashboard.",
      showDns: true,
    },
    {
      num: 3,
      title: "Verify the domain",
      body: 'After DNS propagates, use “Verify” in your sending provider’s dashboard until the domain shows as ready.',
    },
    {
      num: 4,
      title: "Update your deployment",
      body: `Ask your technical contact to set the outbound “from” address to an address on this domain (for example sales@${domain}) in your hosted project settings, then redeploy.`,
    },
    {
      num: 5,
      title: "Warm up your domain",
      body: "Start with a low daily cap in Settings → Legal footer and small pipeline batches until reputation builds.",
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-jarvis-blue" />
      </div>
    );
  }

  const showGate = !sendingDomain && !wantsBuyGuide;
  const domainForDns = sendingDomain ?? "yourdomain.com";
  const records = dnsRecordTemplates(domainForDns);

  return (
    <div className="space-y-6">
      <div className="jarvis-card space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
          <Globe className="h-4 w-4" />
          Custom Email Domain
        </h2>
        <p className="text-sm text-jarvis-muted leading-relaxed">
          Sending from our shared test address is fine for testing. For real outreach, mail should come from a domain you
          control (usually one your company already has).
        </p>
      </div>

      {showGate && (
        <div className="jarvis-card space-y-4">
          <h3 className="text-base font-semibold text-white">What domain will you send from?</h3>
          <p className="text-sm text-jarvis-muted leading-relaxed">
            Most teams use an existing subdomain or secondary domain (for example{" "}
            <span className="text-jarvis-blue/90">mail.company.com</span> or{" "}
            <span className="text-jarvis-blue/90">outreach.yourbrand.com</span>). Enter it below to see steps tailored to
            your DNS.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <input
              type="text"
              value={draftDomain}
              onChange={(e) => {
                setDraftDomain(e.target.value);
                setGateError("");
              }}
              placeholder="e.g. mail.yourcompany.com"
              className="w-full rounded-md border border-jarvis-border bg-jarvis-dark px-3 py-2 text-sm text-white placeholder:text-jarvis-muted focus:border-jarvis-blue focus:outline-none sm:max-w-md"
              autoComplete="off"
              disabled={saving}
            />
            <button
              type="button"
              onClick={handleSaveDomain}
              disabled={saving}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-jarvis-blue px-4 py-2 text-sm font-medium text-white transition hover:bg-jarvis-blue/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
            </button>
          </div>
          {gateError ? <p className="text-sm text-red-400">{gateError}</p> : null}
          <button
            type="button"
            onClick={handleShowBuyGuide}
            disabled={saving}
            className="text-left text-sm text-jarvis-blue hover:underline disabled:opacity-50"
          >
            I don&apos;t have a domain yet — show the full guide (buying a domain, DNS, verification, and warm-up)
          </button>
        </div>
      )}

      {!showGate && wantsBuyGuide && !sendingDomain && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-jarvis-border/80 bg-jarvis-dark/50 px-3 py-2">
            <p className="text-xs text-jarvis-muted">Showing the full setup including how to register a new domain.</p>
            <button
              type="button"
              onClick={handleBackToDomainGate}
              disabled={saving}
              className="text-xs font-medium text-jarvis-blue hover:underline disabled:opacity-50"
            >
              I have a domain — enter it
            </button>
          </div>
          <DomainStepsList
            steps={fullGuideSteps}
            records={dnsRecordTemplates("yourdomain.com")}
            copied={copied}
            onCopy={copy}
          />
          <ProTipsBlock variant="full" />
        </>
      )}

      {!showGate && sendingDomain && (
        <>
          <div className="jarvis-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-jarvis-muted">Your sending domain</p>
              <p className="mt-1 font-mono text-sm text-white">{sendingDomain}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftDomain(sendingDomain);
                  void persistDomainPrefs({ sending_domain: null, wants_domain_buy_guide: false });
                }}
                disabled={saving}
                className="rounded-md border border-jarvis-border px-3 py-1.5 text-xs text-jarvis-muted hover:text-white disabled:opacity-50"
              >
                Change domain
              </button>
              <button
                type="button"
                onClick={handleClearDomainForBuyGuide}
                disabled={saving}
                className="rounded-md border border-jarvis-border px-3 py-1.5 text-xs text-jarvis-muted hover:text-white disabled:opacity-50"
              >
                I need help buying a domain
              </button>
            </div>
          </div>
          <DomainStepsList
            steps={leanSteps(sendingDomain)}
            records={records}
            copied={copied}
            onCopy={copy}
          />
          <ProTipsBlock variant="lean" />
        </>
      )}
    </div>
  );
}

function DomainStepsList({
  steps,
  records,
  copied,
  onCopy,
}: {
  steps: DomainStep[];
  records: ReturnType<typeof dnsRecordTemplates>;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {steps.map((step) => (
        <div key={step.num} className="jarvis-card">
          <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-jarvis-blue/10 text-sm font-bold text-jarvis-blue">
              {step.num}
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">{step.title}</h3>
              <p className="mt-1 text-sm text-jarvis-muted leading-relaxed">{step.body}</p>
              {step.link && (
                <a
                  href={step.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-jarvis-blue hover:underline"
                >
                  Open provider domains <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {step.showDns && (
                <div className="mt-4 space-y-3">
                  {records.map((rec) => (
                    <div key={rec.id} className="rounded-md border border-jarvis-border bg-jarvis-dark p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded bg-jarvis-blue/10 px-1.5 py-0.5 font-mono text-jarvis-blue">
                            {rec.type}
                          </span>
                          <span className="font-mono text-white">{rec.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onCopy(rec.value, rec.id)}
                          className="flex items-center gap-1 text-[10px] text-jarvis-muted transition-colors hover:text-white"
                        >
                          {copied === rec.id ? (
                            <>
                              <CheckCircle className="h-3 w-3 text-jarvis-success" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copy value
                            </>
                          )}
                        </button>
                      </div>
                      <p className="mt-1.5 break-all font-mono text-[11px] text-jarvis-muted">{rec.value}</p>
                      <p className="mt-1.5 text-[11px] text-jarvis-muted/60">{rec.purpose}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProTipsBlock({ variant }: { variant: "full" | "lean" }) {
  return (
    <div className="jarvis-card border-jarvis-gold/20">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-jarvis-gold">
        <CheckCircle className="h-4 w-4" />
        Pro tips
      </h3>
      <ul className="mt-3 space-y-2 text-sm text-jarvis-muted">
        {variant === "full" ? (
          <>
            <li className="flex gap-2">
              <span className="text-jarvis-gold">•</span>
              Use a domain that looks related to your brand but isn&apos;t your main one (e.g., acme-outreach.com if
              your brand is acme.com).
            </li>
            <li className="flex gap-2">
              <span className="text-jarvis-gold">•</span>
              Set up a simple redirect from the outreach domain to your main website.
            </li>
          </>
        ) : (
          <li className="flex gap-2">
            <span className="text-jarvis-gold">•</span>
            Prefer a dedicated sending domain for cold outreach so your primary company domain&apos;s reputation stays
            protected.
          </li>
        )}
        <li className="flex gap-2">
          <span className="text-jarvis-gold">•</span>
          Keep daily send volume low at first, then ramp using your compliance cap.
        </li>
        <li className="flex gap-2">
          <span className="text-jarvis-gold">•</span>
          Check reputation at mail-tester.com and Google Postmaster Tools.
        </li>
      </ul>
    </div>
  );
}
