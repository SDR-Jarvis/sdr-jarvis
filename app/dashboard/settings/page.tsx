"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
} from "lucide-react";
import { BillingTab } from "./billing-tab";

type Tab = "profile" | "domain" | "billing";

export default function SettingsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const initialTab = (searchParams.get("tab") as Tab) ?? "profile";
  const [tab, setTab] = useState<Tab>(
    ["profile", "billing", "domain"].includes(initialTab) ? initialTab : "profile"
  );

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("");
  const [icpDescription, setIcpDescription] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [formality, setFormality] = useState("professional-casual");
  const [humor, setHumor] = useState(true);
  const [signoff, setSignoff] = useState("Best");

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

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
      }
      setLoading(false);
    }
    loadProfile();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("profiles")
      .update({
        full_name: fullName || null,
        company_name: companyName || null,
        role: role || null,
        icp_description: icpDescription || null,
        timezone,
        tone_preferences: { formality, humor, signoff },
        onboarded: true,
      })
      .eq("id", user.id);

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
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
          Configure your profile, outreach style, and email domain.
        </p>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 rounded-lg bg-jarvis-surface/40 p-1">
        <TabButton
          active={tab === "profile"}
          onClick={() => setTab("profile")}
          icon={User}
          label="Profile & Tone"
        />
        <TabButton
          active={tab === "billing"}
          onClick={() => setTab("billing")}
          icon={CreditCard}
          label="Billing"
        />
        <TabButton
          active={tab === "domain"}
          onClick={() => setTab("domain")}
          icon={Globe}
          label="Email Domain"
        />
      </div>

      {tab === "profile" && (
        <>
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
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="text-sm text-jarvis-success">Settings saved.</span>
            )}
            <button
              onClick={handleSave}
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
        </>
      )}

      {tab === "billing" && <BillingTab />}

      {tab === "domain" && <DomainSetupGuide />}
    </div>
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
      className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all ${
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

function DomainSetupGuide() {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const DNS_RECORDS = [
    {
      id: "spf",
      type: "TXT",
      name: "@",
      value: "v=spf1 include:amazonses.com ~all",
      purpose: "SPF — Tells receiving servers that Amazon SES (used by Resend) is authorized to send email for your domain.",
    },
    {
      id: "dkim1",
      type: "CNAME",
      name: "resend._domainkey",
      value: "resend._domainkey.yourdomain.com.resend-dns.com",
      purpose: "DKIM — Cryptographic signature so recipients can verify emails haven't been tampered with.",
    },
    {
      id: "dmarc",
      type: "TXT",
      name: "_dmarc",
      value: "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com",
      purpose: "DMARC — Policy that tells recipients what to do with emails that fail SPF/DKIM.",
    },
  ];

  const STEPS = [
    {
      num: 1,
      title: "Buy or use a secondary domain",
      body: "Don't use your main company domain for cold outreach. Buy a separate domain (e.g., tryjarvis.co or yourbrand-mail.com) to protect your primary domain's reputation. Namecheap, Cloudflare, or Google Domains all work.",
    },
    {
      num: 2,
      title: "Add your domain in Resend",
      body: "Go to resend.com/domains → Add Domain → enter your domain. Resend will show you the DNS records you need to add.",
      link: "https://resend.com/domains",
    },
    {
      num: 3,
      title: "Add DNS records",
      body: "Add these records in your domain registrar's DNS settings. The exact values will come from Resend — the records below are templates.",
    },
    {
      num: 4,
      title: "Verify in Resend",
      body: "After adding DNS records, click \"Verify\" in Resend. DNS propagation takes 5 minutes to 48 hours. Once verified, the status turns green.",
    },
    {
      num: 5,
      title: "Update your environment",
      body: "Change your FROM_EMAIL in .env.local to use the new domain: FROM_EMAIL=jarvis@yourdomain.com. Redeploy on Vercel.",
    },
    {
      num: 6,
      title: "Warm up your domain",
      body: "Start by sending 10-20 emails/day for the first week, then gradually increase. Sudden volume spikes from a new domain trigger spam filters.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="jarvis-card space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
          <Globe className="h-4 w-4" />
          Custom Email Domain
        </h2>
        <p className="text-sm text-jarvis-muted leading-relaxed">
          Sending from <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-jarvis-blue">onboarding@resend.dev</code> works
          for testing, but real outreach needs your own domain. This guide walks
          you through the full setup in about 15 minutes.
        </p>
      </div>

      {/* Step-by-step guide */}
      <div className="space-y-4">
        {STEPS.map((step) => (
          <div key={step.num} className="jarvis-card">
            <div className="flex items-start gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-jarvis-blue/10 text-sm font-bold text-jarvis-blue">
                {step.num}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-white">{step.title}</h3>
                <p className="mt-1 text-sm text-jarvis-muted leading-relaxed">
                  {step.body}
                </p>
                {step.link && (
                  <a
                    href={step.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-jarvis-blue hover:underline"
                  >
                    Open Resend Domains <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                {step.num === 3 && (
                  <div className="mt-4 space-y-3">
                    {DNS_RECORDS.map((rec) => (
                      <div
                        key={rec.id}
                        className="rounded-md border border-jarvis-border bg-jarvis-dark p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="rounded bg-jarvis-blue/10 px-1.5 py-0.5 font-mono text-jarvis-blue">
                              {rec.type}
                            </span>
                            <span className="font-mono text-white">{rec.name}</span>
                          </div>
                          <button
                            onClick={() => copy(rec.value, rec.id)}
                            className="flex items-center gap-1 text-[10px] text-jarvis-muted hover:text-white transition-colors"
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
                        <p className="mt-1.5 break-all font-mono text-[11px] text-jarvis-muted">
                          {rec.value}
                        </p>
                        <p className="mt-1.5 text-[11px] text-jarvis-muted/60">
                          {rec.purpose}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pro tips */}
      <div className="jarvis-card border-jarvis-gold/20">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-jarvis-gold">
          <CheckCircle className="h-4 w-4" />
          Pro Tips
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-jarvis-muted">
          <li className="flex gap-2">
            <span className="text-jarvis-gold">•</span>
            Use a domain that looks related to your brand but isn&apos;t your main one (e.g., acme-outreach.com if your brand is acme.com).
          </li>
          <li className="flex gap-2">
            <span className="text-jarvis-gold">•</span>
            Set up a simple redirect from the outreach domain to your main website.
          </li>
          <li className="flex gap-2">
            <span className="text-jarvis-gold">•</span>
            Keep daily send volume under 50 for the first 2 weeks, then scale to 100-200.
          </li>
          <li className="flex gap-2">
            <span className="text-jarvis-gold">•</span>
            Monitor your domain reputation at mail-tester.com and Google Postmaster Tools.
          </li>
        </ul>
      </div>
    </div>
  );
}
