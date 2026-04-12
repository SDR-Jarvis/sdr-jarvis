"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  Zap,
  Loader2,
  Target,
  Mail,
  Brain,
  ShieldCheck,
  BarChart3,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";

type AuthStep = "email" | "password";

export default function LandingPage() {
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const supabase = createClient();
  const router = useRouter();

  function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setStep("password");
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }

    // Try sign in first
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!signInError) {
      router.push("/dashboard");
      return;
    }

    // If "Invalid login credentials" — could be new user or wrong password
    // Try sign up
    if (signInError.message.includes("Invalid login")) {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      setLoading(false);

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      // Supabase may auto-confirm or require email confirmation
      // Check if user is immediately signed in
      if (signUpData.user && signUpData.session) {
        router.push("/dashboard");
        return;
      }

      // If email confirmation is required
      if (signUpData.user && !signUpData.session) {
        setSuccess("Account created! Check your email to confirm, then sign in with the same password.");
        return;
      }

      // Fallback: user may already exist with different password
      setError("Wrong password. If you forgot it, try a different one to create a new account.");
      return;
    }

    // Other errors (rate limit, etc.)
    setLoading(false);
    setError(signInError.message);
  }

  return (
    <div className="min-h-screen bg-jarvis-dark">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/4 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-jarvis-blue/[0.04] blur-[150px]" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-jarvis-blue/20 to-transparent" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-jarvis-blue/30 bg-jarvis-blue/10">
            <Zap className="h-4 w-4 text-jarvis-blue" />
          </div>
          <span className="text-lg font-bold text-white">SDR Jarvis</span>
        </div>
        <a
          href="#login"
          className="rounded-md bg-jarvis-blue/10 px-4 py-2 text-sm font-medium text-jarvis-blue transition-colors hover:bg-jarvis-blue/20"
        >
          Sign In
        </a>
      </nav>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-20 pt-16 text-center">
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full border border-jarvis-blue/30 bg-jarvis-blue/10 arc-reactor">
          <Zap className="h-10 w-10 text-jarvis-blue" />
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
          Your AI Sales Rep
          <br />
          <span className="text-jarvis-blue">That Actually Sells</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-jarvis-muted leading-relaxed">
          Jarvis researches your prospects, writes hyper-personalized cold emails,
          and waits for your approval before sending. Like having a full-time SDR —
          minus the $85K salary.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm text-jarvis-muted">
          <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-jarvis-success" />
            Human approval on every email
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5">
            <Brain className="h-3.5 w-3.5 text-jarvis-blue" />
            GPT-4o powered research
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5">
            <Clock className="h-3.5 w-3.5 text-jarvis-gold" />
            5 min setup
          </span>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-16">
        <h2 className="mb-12 text-center text-2xl font-bold text-white">
          How Jarvis Works
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          <StepCard
            num={1}
            icon={Target}
            title="Define Your ICP"
            description="Tell Jarvis who your ideal customers are. Upload a CSV of leads or discover founders from Hacker News and Product Hunt."
          />
          <StepCard
            num={2}
            icon={Brain}
            title="Jarvis Researches & Drafts"
            description="AI searches Google, LinkedIn, and company sites to write personalized 3-5 sentence emails for each lead."
          />
          <StepCard
            num={3}
            icon={Mail}
            title="You Approve, Jarvis Sends"
            description="Review every email before it goes out. Edit the copy, approve, or reject — you stay in control."
          />
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-16">
        <h2 className="mb-12 text-center text-2xl font-bold text-white">
          Built for Solo Founders
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={Brain}
            title="Deep Prospect Research"
            description="Google-powered scraping of LinkedIn, company websites, and recent news."
          />
          <FeatureCard
            icon={Mail}
            title="Hyper-Personalized Emails"
            description="3-5 sentence cold emails that reference specific details about each prospect."
          />
          <FeatureCard
            icon={ShieldCheck}
            title="Human-in-the-Loop"
            description="Every email requires your explicit approval. Edit inline before sending."
          />
          <FeatureCard
            icon={BarChart3}
            title="Campaign Analytics"
            description="Track opens, replies, and meetings booked. See what messaging works."
          />
          <FeatureCard
            icon={Target}
            title="Lead Discovery"
            description="Find founders from Hacker News, Product Hunt, and Indie Hackers in one click."
          />
          <FeatureCard
            icon={Clock}
            title="Pipeline Logging"
            description="See every step Jarvis takes in real-time. Full transparency, no black boxes."
          />
        </div>
      </section>

      {/* CTA / Login */}
      <section
        id="login"
        className="relative z-10 mx-auto max-w-md px-6 py-20"
      >
        <div className="jarvis-card jarvis-glow space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-bold text-white">
              {step === "email" ? "Get Started" : `Hello, ${email.split("@")[0]}`}
            </h2>
            <p className="mt-1 text-sm text-jarvis-muted">
              {step === "email"
                ? "Enter your email to sign in or create an account."
                : "Set a password to secure your account. If you already have one, just enter it."}
            </p>
          </div>

          {step === "email" ? (
            <form onSubmit={handleEmailContinue} className="space-y-4">
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

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-md bg-jarvis-blue px-4 py-2.5 text-sm font-semibold text-jarvis-dark transition-all hover:brightness-110"
              >
                <Zap className="h-4 w-4" />
                Continue
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="flex items-center gap-2 rounded-md bg-jarvis-blue/5 border border-jarvis-blue/20 px-3 py-2 text-xs text-jarvis-blue">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{email}</span>
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setPassword("");
                    setError("");
                    setSuccess("");
                  }}
                  className="ml-auto shrink-0 text-jarvis-muted hover:text-white transition-colors"
                >
                  Change
                </button>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-sm font-medium text-jarvis-muted"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="jarvis-input pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-jarvis-muted hover:text-white transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-jarvis-muted/60">
                  New here? Pick a password. Returning? Enter your existing one.
                </p>
              </div>

              {error && (
                <p className="text-sm text-jarvis-danger">{error}</p>
              )}

              {success && (
                <p className="text-sm text-jarvis-success">{success}</p>
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
                {loading ? "Initializing…" : "Sign In"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-jarvis-muted/60">
          No magic links, no redirects. Just email and password.
        </p>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-jarvis-border/30 py-8 text-center text-xs text-jarvis-muted/40">
        SDR Jarvis — Built for founders who&apos;d rather close deals than write
        cold emails.
      </footer>
    </div>
  );
}

function StepCard({
  num,
  icon: Icon,
  title,
  description,
}: {
  num: number;
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="jarvis-card relative">
      <span className="absolute -top-3 left-4 flex h-6 w-6 items-center justify-center rounded-full bg-jarvis-blue text-xs font-bold text-jarvis-dark">
        {num}
      </span>
      <div className="mt-2">
        <Icon className="mb-3 h-6 w-6 text-jarvis-blue" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-1 text-sm text-jarvis-muted leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-jarvis-border/50 bg-jarvis-surface/20 p-5 transition-colors hover:border-jarvis-blue/20">
      <Icon className="mb-3 h-5 w-5 text-jarvis-blue" />
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs text-jarvis-muted leading-relaxed">
        {description}
      </p>
    </div>
  );
}
