"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Save, Loader2, User, Building2, MessageSquare } from "lucide-react";

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
          Configure your profile and Jarvis&apos;s outreach style.
        </p>
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
    </div>
  );
}
