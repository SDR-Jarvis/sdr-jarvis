"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Zap, ArrowRight, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });

    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-jarvis-dark p-4">
      {/* Arc reactor background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-jarvis-blue/[0.03] blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-jarvis-blue/30 bg-jarvis-blue/10 arc-reactor">
            <Zap className="h-8 w-8 text-jarvis-blue" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            SDR Jarvis
          </h1>
          <p className="mt-2 text-jarvis-muted">
            Your AI Sales Development Rep
          </p>
        </div>

        {/* Login Card */}
        <div className="jarvis-card jarvis-glow space-y-6">
          {sent ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-jarvis-success/10">
                <ArrowRight className="h-6 w-6 text-jarvis-success" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                Check your email, sir.
              </h2>
              <p className="text-sm text-jarvis-muted">
                I&apos;ve sent a magic link to{" "}
                <span className="text-jarvis-blue">{email}</span>. Click it to
                access the command center.
              </p>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-medium text-jarvis-muted"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tony@starkindustries.com"
                  className="jarvis-input"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-jarvis-danger">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-jarvis-blue px-4 py-2.5 text-sm font-semibold text-jarvis-dark transition-all hover:brightness-110 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {loading ? "Initializing…" : "Access Jarvis"}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-jarvis-muted/60">
          No password needed. We use magic links because even Jarvis hates
          remembering passwords.
        </p>
      </div>
    </div>
  );
}
