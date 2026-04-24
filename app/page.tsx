"use client";

import { useState, useEffect, useRef } from "react";
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
  ArrowRight,
  Search,
  CheckCircle,
  Circle,
  Users,
  MessageSquare,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import {
  evaluatePassword,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-policy";
import { getFriendlyAuthError } from "@/lib/auth/error-messages";
import { signInWithOAuth, type OAuthProvider } from "@/lib/auth/oauth";
import { PRODUCT_SUBLINE, PRODUCT_TAGLINE } from "@/lib/product-copy";

type AuthStep = "email" | "password";
/** `signin` = existing user only. `signup` = new account only (no auto sign-up after failed login). */
type AccountMode = "signin" | "signup";

export default function LandingPage() {
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode>("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resendSending, setResendSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [visibleStats, setVisibleStats] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();
  const router = useRouter();

  const googleOAuthEnabled =
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";
  const githubOAuthEnabled =
    process.env.NEXT_PUBLIC_GITHUB_OAUTH_ENABLED === "true";
  const linkedinOAuthEnabled =
    process.env.NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED === "true";
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL?.trim() ?? "";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const err = p.get("error");
    if (err === "auth_failed" || err === "oauth_failed") {
      setError(
        "We could not finish sign-in. Try again. If it keeps failing, add this exact URL to allowed redirect URLs in your auth project settings: " +
          `${window.location.origin}/auth/callback`
      );
      const path = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", path);
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleStats(true); },
      { threshold: 0.3 }
    );
    if (statsRef.current) observer.observe(statsRef.current);
    return () => observer.disconnect();
  }, []);

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

    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      setLoading(false);
      return;
    }

    if (accountMode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      setLoading(false);

      if (!signInError) {
        router.push("/dashboard");
        return;
      }

      const msg = signInError.message.toLowerCase();
      if (msg.includes("email not confirmed") || msg.includes("confirm your email")) {
        setError(
          "Confirm your email before signing in. Use the link in your inbox, or resend below."
        );
        return;
      }

      if (
        signInError.status === 400 ||
        msg.includes("invalid login") ||
        msg.includes("invalid email or password") ||
        msg.includes("invalid credentials") ||
        msg.includes("wrong password")
      ) {
        setError(
          "That email or password does not match. Try again, reset your password below, or switch to “Create an account” if you are new here."
        );
        return;
      }

      setError(getFriendlyAuthError(signInError.message));
      return;
    }

    // signup
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);

    if (signUpError) {
      const raw = signUpError.message;
      if (/already|registered|exists|identity/i.test(raw)) {
        setError(
          "That email already has an account. Use “Sign in instead” above with your password, or reset it below."
        );
        setAccountMode("signin");
        return;
      }
      setError(getFriendlyAuthError(raw));
      return;
    }

    if (signUpData.user && signUpData.session) {
      router.push("/dashboard");
      return;
    }

    if (signUpData.user && !signUpData.session) {
      setSuccess("Account created! Check your email to confirm, then sign in with “Sign in instead”.");
      return;
    }

    setError("Could not complete sign-up. Try again.");
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError("Enter your email above, then click Forgot password again.");
      return;
    }
    setResetSending(true);
    setError("");
    setSuccess("");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/auth/callback?next=/dashboard`,
    });
    setResetSending(false);
    if (resetErr) {
      setError(getFriendlyAuthError(resetErr.message));
      return;
    }
    setSuccess("Check your email for a password reset link.");
  }

  async function handleOAuth(provider: OAuthProvider) {
    setError("");
    setSuccess("");
    setOauthLoading(provider);
    try {
      await signInWithOAuth(provider);
    } catch (e) {
      setError(
        e instanceof Error ? getFriendlyAuthError(e.message) : "Something went wrong."
      );
      setOauthLoading(null);
    }
  }

  async function handleResendConfirmation() {
    if (!email.trim()) return;
    setResendSending(true);
    setError("");
    const { error: resendErr } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
    });
    setResendSending(false);
    if (resendErr) {
      setError(getFriendlyAuthError(resendErr.message));
      return;
    }
    setSuccess("Confirmation email sent. Check your inbox.");
  }

  return (
    <div className="min-h-dvh bg-jarvis-dark pb-[env(safe-area-inset-bottom)]">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[1000px] w-[1000px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-jarvis-blue/[0.03] blur-[200px]" />
        <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-jarvis-blue/[0.02] blur-[150px]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-jarvis-blue/30 bg-jarvis-blue/10">
            <Zap className="h-4.5 w-4.5 text-jarvis-blue" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight">SDR Jarvis</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#how-it-works" className="hidden sm:block text-sm text-jarvis-muted hover:text-white transition-colors">
            How It Works
          </a>
          <a href="#features" className="hidden sm:block text-sm text-jarvis-muted hover:text-white transition-colors">
            Features
          </a>
          {calendlyUrl ? (
            <a
              href={calendlyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex rounded-lg border border-jarvis-border px-4 py-2 text-sm font-medium text-jarvis-muted transition-all hover:border-jarvis-blue/30 hover:text-white"
            >
              Book a demo
            </a>
          ) : null}
          <a
            href="#get-started"
            className="rounded-lg bg-jarvis-blue px-4 py-2 text-sm font-semibold text-jarvis-dark transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Get Started Free
          </a>
        </div>
      </nav>

      {/* ═══════════ HERO ═══════════ */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-20 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-jarvis-blue/90">
          {PRODUCT_TAGLINE}
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl leading-[1.12]">
          Outbound that respects
          <br />
          <span className="bg-gradient-to-r from-jarvis-blue to-jarvis-cyan bg-clip-text text-transparent">
            your time and your brand
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-jarvis-muted leading-relaxed">
          {PRODUCT_SUBLINE} Built for solo founders — no spam blasts, no fake &ldquo;team.&rdquo;
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#get-started"
            className="flex h-12 items-center justify-center gap-2 rounded-lg bg-jarvis-blue px-6 text-sm font-bold text-jarvis-dark transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Get Started Free
            <ArrowRight className="h-4 w-4" />
          </a>
          {calendlyUrl ? (
            <a
              href={calendlyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="outlined-button"
            >
              Book a demo
            </a>
          ) : null}
          <a
            href="#how-it-works"
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-jarvis-border px-6 text-sm font-medium text-jarvis-muted transition-all hover:border-jarvis-blue/30 hover:text-white"
          >
            See How It Works
            <ChevronRight className="h-4 w-4" />
          </a>
        </div>

        {/* Trust badges */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-4 text-xs text-jarvis-muted/60">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-jarvis-success/60" />
            Human approval on every email
          </span>
          <span className="hidden sm:block text-jarvis-border">|</span>
          <span className="flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5 text-jarvis-blue/60" />
            Learns your tone over time
          </span>
          <span className="hidden sm:block text-jarvis-border">|</span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-jarvis-gold/60" />
            Set up in 5 minutes
          </span>
        </div>
      </section>

      {/* ═══════════ PAIN → SOLUTION ═══════════ */}
      <section className="relative z-10 border-y border-jarvis-border/30 bg-jarvis-surface/30">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center">
            <div>
              <h2 className="text-2xl font-bold text-white sm:text-3xl">
                Outbound is broken for
                <span className="text-jarvis-danger"> solo founders</span>
              </h2>
              <div className="mt-8 space-y-5">
                <PainPoint text="You can't afford a $6K/month SDR" />
                <PainPoint text="You spend 3+ hours/day researching and emailing" />
                <PainPoint text="Generic cold email tools get you flagged as spam" />
                <PainPoint text="You forget to follow up and lose warm leads" />
              </div>
            </div>
            <div className="rounded-xl border border-jarvis-blue/20 bg-jarvis-dark p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-jarvis-blue">
                <Zap className="h-4 w-4" />
                With SDR Jarvis
              </div>
              <SolutionPoint icon={Search} text="Finds leads with verified emails automatically" />
              <SolutionPoint icon={Brain} text="Researches each prospect before writing a word" />
              <SolutionPoint icon={Mail} text="Writes unique, personalized emails (not templates)" />
              <SolutionPoint icon={ShieldCheck} text="You approve every email before it sends" />
              <SolutionPoint icon={MessageSquare} text="Classifies replies and suggests follow-ups" />
              <SolutionPoint icon={BarChart3} text="Tracks opens, replies, and conversions" />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <section id="how-it-works" className="relative z-10 mx-auto max-w-5xl px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            From zero to sent in 3 steps
          </h2>
          <p className="mt-3 text-jarvis-muted">
            No complex setup. No sales training. Just results.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          <StepCard
            num={1}
            icon={Target}
            title="Find Your Prospects"
            description="Search Hacker News and Product Hunt to discover founders — Jarvis scrapes their profiles and websites to find real email addresses."
          />
          <StepCard
            num={2}
            icon={Brain}
            title="Jarvis Researches & Writes"
            description="AI uses public web search and pages you supply (company sites, etc.) — not logged-in LinkedIn automation. Personalized 3–5 sentence drafts; you verify facts."
          />
          <StepCard
            num={3}
            icon={Mail}
            title="You Approve, Jarvis Sends"
            description="Review every draft in your approval queue. Edit the copy, approve, or reject. Nothing leaves your outbox without your sign-off."
          />
        </div>

        {/* Connector line */}
        <div className="hidden sm:block relative mt-[-180px] mb-[140px] mx-auto max-w-[80%]">
          <div className="h-px bg-gradient-to-r from-jarvis-blue/0 via-jarvis-blue/30 to-jarvis-blue/0" />
        </div>
      </section>

      {/* ═══════════ FEATURES GRID ═══════════ */}
      <section id="features" className="relative z-10 border-y border-jarvis-border/30 bg-jarvis-surface/20">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Everything you need to fill your pipeline
            </h2>
            <p className="mt-3 text-jarvis-muted">
              Built by a solo founder, for solo founders.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={Search}
              title="Lead Discovery"
              description="Find founders from Hacker News and Product Hunt with verified email addresses. No more dead-end contacts."
            />
            <FeatureCard
              icon={Brain}
              title="Deep Research"
              description="Public-web research (Google CSE, company sites, news). No promise of private LinkedIn access — use public profiles and URLs you provide."
            />
            <FeatureCard
              icon={Mail}
              title="Personalized Emails"
              description="3-5 sentence cold emails that reference specific details about each prospect. Every email is unique."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Human Approval"
              description="Every email goes through your approval queue. Edit inline, approve, or reject. You're always in control."
            />
            <FeatureCard
              icon={MessageSquare}
              title="Reply Intelligence"
              description="AI classifies replies as Hot, Warm, or Cold. Get instant alerts on interested prospects."
            />
            <FeatureCard
              icon={TrendingUp}
              title="Follow-Up Sequences"
              description="Automated, context-aware follow-ups that stop when the prospect replies. No more dropped leads."
            />
            <FeatureCard
              icon={BarChart3}
              title="Campaign Analytics"
              description="Track your full funnel: sent → opened → replied → qualified → meeting booked. See what messaging converts."
            />
            <FeatureCard
              icon={Users}
              title="Multi-Campaign"
              description="Run different campaigns for different ICPs. Test messaging, track performance, and iterate."
            />
            <FeatureCard
              icon={Clock}
              title="Real-Time Pipeline Logs"
              description="Watch Jarvis work in real-time. See every research step, every email draft. Full transparency."
            />
          </div>
        </div>
      </section>

      {/* ═══════════ STATS / SOCIAL PROOF ═══════════ */}
      <section ref={statsRef} className="relative z-10 mx-auto max-w-5xl px-6 py-24">
        <div className="grid gap-8 sm:grid-cols-3 text-center">
          <AnimatedStat visible={visibleStats} value="30s" label="Per personalized email" sublabel="vs 15 min manually" />
          <AnimatedStat visible={visibleStats} value="$0" label="To get started" sublabel="Free forever plan" />
          <AnimatedStat visible={visibleStats} value="100%" label="You control" sublabel="Approve before it sends" />
        </div>
      </section>

      {/* ═══════════ COMPARISON ═══════════ */}
      <section className="relative z-10 border-y border-jarvis-border/30 bg-jarvis-surface/20">
        <div className="mx-auto max-w-4xl px-6 py-24">
          <h2 className="text-center text-2xl font-bold text-white sm:text-3xl mb-12">
            Why founders choose Jarvis
          </h2>

          <div className="overflow-hidden rounded-xl border border-jarvis-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-jarvis-border bg-jarvis-surface">
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-jarvis-muted" />
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-jarvis-muted">
                    Cold Email Tools
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-jarvis-blue">
                    SDR Jarvis
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-jarvis-border">
                <ComparisonRow label="Lead Discovery" them="Bring your own list" us="Finds leads + emails for you" />
                <ComparisonRow label="Personalization" them="Mail merge tokens" us="AI researches each prospect" />
                <ComparisonRow label="Email Quality" them="Same template, 1000x" us="Unique email per lead" />
                <ComparisonRow label="Before Sending" them="Auto-sends everything" us="You approve every email" />
                <ComparisonRow label="Reply Handling" them="Check inbox manually" us="AI classifies & suggests" />
                <ComparisonRow label="Built For" them="Sales teams" us="Solo founders" />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══════════ CTA / LOGIN ═══════════ */}
      <section id="get-started" className="relative z-10 mx-auto max-w-lg px-6 py-24">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            Start outbound in minutes
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-jarvis-muted leading-relaxed">
            The fastest way for a founder to start outbound. AI researches leads, writes personalized emails, and
            lets you approve before sending.
          </p>
          <p className="mt-2 text-xs text-jarvis-muted/70">Free to start. No credit card.</p>
        </div>

        <div className="jarvis-card jarvis-glow space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-bold text-white">
              {step === "email" ? "Create Your Account" : `Welcome, ${email.split("@")[0]}`}
            </h3>
            <p className="mt-1 text-sm text-jarvis-muted">
              {step === "email"
                ? "Continue with Google or email — same account, your choice."
                : accountMode === "signin"
                  ? "Sign in with the password you use for this email."
                  : "Create a strong password for your new account."}
            </p>
          </div>

          {(googleOAuthEnabled || githubOAuthEnabled || linkedinOAuthEnabled) && (
            <div className="space-y-2">
              {googleOAuthEnabled && (
                <button
                  type="button"
                  onClick={() => void handleOAuth("google")}
                  disabled={!!oauthLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-900 bg-white px-4 py-3 text-sm font-bold text-neutral-900 transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-50"
                >
                  {oauthLoading === "google" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-900" />
                  ) : (
                    <GoogleIcon />
                  )}
                  Continue with Google
                </button>
              )}
              {githubOAuthEnabled && (
                <button
                  type="button"
                  onClick={() => void handleOAuth("github")}
                  disabled={!!oauthLoading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-jarvis-border bg-transparent px-4 text-sm font-medium text-white transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  {oauthLoading === "github" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <GithubIcon />
                  )}
                  Continue with GitHub
                </button>
              )}
              {linkedinOAuthEnabled && (
                <button
                  type="button"
                  onClick={() => void handleOAuth("linkedin_oidc")}
                  disabled={!!oauthLoading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-jarvis-border bg-transparent px-4 text-sm font-medium text-white transition-colors hover:bg-white/5 disabled:opacity-50"
                >
                  {oauthLoading === "linkedin_oidc" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LinkedinIcon />
                  )}
                  Continue with LinkedIn
                </button>
              )}
              <div className="relative py-2 text-center">
                <span className="relative z-10 bg-jarvis-surface px-3 text-xs text-jarvis-muted">or</span>
                <div className="absolute left-0 right-0 top-1/2 z-0 h-px bg-jarvis-border" />
              </div>
            </div>
          )}

          {step === "email" ? (
            <form onSubmit={handleEmailContinue} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="jarvis-input"
                  autoFocus
                />
              </div>
              <div
                className={
                  calendlyUrl
                    ? "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3"
                    : "flex w-full"
                }
              >
                <button
                  type="submit"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-jarvis-blue px-4 text-sm font-bold text-jarvis-dark transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </button>
                {calendlyUrl ? (
                  <a
                    href={calendlyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-jarvis-border px-4 text-sm font-medium text-white transition-all hover:border-jarvis-blue/40 hover:bg-white/[0.03]"
                  >
                    Book a demo
                    <ArrowRight className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={resetSending}
                  className="text-xs font-medium text-jarvis-blue hover:underline disabled:opacity-50"
                >
                  {resetSending ? "Sending reset link…" : "Forgot password? Email me a reset link"}
                </button>
                <p className="text-[11px] text-jarvis-muted/70">
                  Enter your email above first. After the link, you will return to the app signed in.
                </p>
              </div>
              {error && (
                <div className="rounded-lg border border-jarvis-danger/25 bg-jarvis-danger/5 px-3 py-2.5 text-sm text-jarvis-danger">
                  {error}
                </div>
              )}
              {success && (
                <p className="text-sm text-jarvis-success">{success}</p>
              )}
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-jarvis-blue/5 border border-jarvis-blue/20 px-3 py-2 text-xs text-jarvis-blue">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{email}</span>
                <button
                  type="button"
                  onClick={() => {
                  setStep("email");
                  setPassword("");
                  setAccountMode("signin");
                  setError("");
                  setSuccess("");
                }}
                  className="ml-auto shrink-0 text-jarvis-muted hover:text-white transition-colors"
                >
                  Change
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-jarvis-muted">I want to</span>
                <div className="flex rounded-lg border border-jarvis-border/60 p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMode("signin");
                      setError("");
                      setSuccess("");
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      accountMode === "signin"
                        ? "bg-jarvis-blue text-jarvis-dark"
                        : "text-jarvis-muted hover:text-white"
                    }`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMode("signup");
                      setError("");
                      setSuccess("");
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                      accountMode === "signup"
                        ? "bg-jarvis-blue text-jarvis-dark"
                        : "text-jarvis-muted hover:text-white"
                    }`}
                  >
                    Create account
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-jarvis-muted">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    autoComplete={
                      accountMode === "signup" ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    className="jarvis-input pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-jarvis-muted hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-jarvis-muted">
                  {accountMode === "signin" ? (
                    <>
                      Use the password for this email.{" "}
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={resetSending || loading}
                        className="text-jarvis-blue hover:underline disabled:opacity-50"
                      >
                        {resetSending ? "Sending link…" : "Forgot password?"}
                      </button>
                    </>
                  ) : (
                    <>Meet every checklist row — required for new accounts.</>
                  )}
                </p>
              </div>

              {accountMode === "signup" && <PasswordRequirements password={password} />}

              {error && (
                <div className="rounded-lg border border-jarvis-danger/25 bg-jarvis-danger/5 px-3 py-2.5 text-sm text-jarvis-danger">
                  {error}
                </div>
              )}
              {success && <p className="text-sm text-jarvis-success">{success}</p>}

              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-jarvis-muted">
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resendSending || loading || !email.trim()}
                  className="text-jarvis-blue hover:underline disabled:opacity-50"
                >
                  {resendSending ? "Sending…" : "Resend confirmation email"}
                </button>
                <span className="text-jarvis-border">·</span>
                <span>Didn&apos;t get a reset? Check spam.</span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-jarvis-blue px-4 py-3 text-sm font-bold text-jarvis-dark transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {loading
                  ? accountMode === "signin"
                    ? "Signing in…"
                    : "Creating account…"
                  : accountMode === "signin"
                    ? "Sign in"
                    : "Create account & continue"}
              </button>
            </form>
          )}

          <div className="flex items-center justify-center gap-4 text-[11px] text-jarvis-muted/50">
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-jarvis-success/50" />
              Free forever plan
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-jarvis-success/50" />
              No credit card
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-jarvis-success/50" />
              5 min setup
            </span>
          </div>
        </div>
      </section>

      {calendlyUrl ? (
        <section className="relative z-10 mx-auto max-w-2xl px-6 pb-16">
          <div className="jarvis-card border-jarvis-blue/25 bg-jarvis-surface/40 p-8 text-center">
            <h2 className="text-lg font-semibold text-white sm:text-xl">
              Want to see it work on your pipeline?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-jarvis-muted">
              I&apos;ll personally walk you through a live demo using your actual ICP and targets. Usually 20 minutes.
            </p>
            <a
              href={calendlyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex h-12 items-center justify-center rounded-lg bg-jarvis-blue px-6 text-sm font-bold text-jarvis-dark transition-all hover:brightness-110"
            >
              Book a demo call →
            </a>
          </div>
        </section>
      ) : null}

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="relative z-10 border-t border-jarvis-border/30">
        <div className="mx-auto max-w-5xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-jarvis-blue/30 bg-jarvis-blue/10">
              <Zap className="h-3.5 w-3.5 text-jarvis-blue" />
            </div>
            <span className="text-sm font-bold text-white">SDR Jarvis</span>
          </div>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            <p className="text-xs text-jarvis-muted/40 text-center sm:text-right">
              AI-powered outbound for solo founders — your first sales hire, minus the salary.
            </p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-jarvis-muted/50">
              <a href="/legal/privacy" className="hover:text-jarvis-blue transition-colors">
                Privacy
              </a>
              <a href="/legal/email-compliance" className="hover:text-jarvis-blue transition-colors">
                Email compliance
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════ SUBCOMPONENTS ═══════════ */

function PasswordRequirements({ password }: { password: string }) {
  const c = evaluatePassword(password);
  const rows: { id: string; ok: boolean; label: string }[] = [
    {
      id: "len",
      ok: c.minLength,
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    },
    { id: "lower", ok: c.lowercase, label: "One lowercase letter (a–z)" },
    { id: "upper", ok: c.uppercase, label: "One uppercase letter (A–Z)" },
    { id: "num", ok: c.digit, label: "One number (0–9)" },
    {
      id: "sym",
      ok: c.symbol,
      label: "One symbol (! @ # $ % …)",
    },
  ];

  return (
    <div
      className="rounded-lg border border-white/[0.08] bg-jarvis-surface/40 px-3.5 py-3"
      role="region"
      aria-label="Password requirements"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-jarvis-muted">
        New accounts — use all of the following
      </p>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-2.5 text-xs leading-snug">
            {row.ok ? (
              <CheckCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jarvis-success"
                aria-hidden
              />
            ) : (
              <Circle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-jarvis-muted/35"
                aria-hidden
              />
            )}
            <span
              className={
                row.ok ? "text-jarvis-muted/70" : "text-jarvis-muted"
              }
            >
              {row.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 border-t border-white/[0.06] pt-2 text-[11px] leading-relaxed text-jarvis-muted/55">
        If you still see an error after meeting every line above, try a longer phrase or a different mix of
        characters. Still stuck? Contact support — we can help.
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908C16.658 14.03 17.64 11.72 17.64 9.2z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.59.102-1.166.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.826.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.962L3.964 6.294C4.672 4.167 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.929.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function PainPoint({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-jarvis-danger/10">
        <span className="h-1.5 w-1.5 rounded-full bg-jarvis-danger" />
      </span>
      <p className="text-sm text-jarvis-muted">{text}</p>
    </div>
  );
}

function SolutionPoint({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-jarvis-success/10">
        <Icon className="h-3 w-3 text-jarvis-success" />
      </span>
      <p className="text-sm text-white/80">{text}</p>
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
    <div className="jarvis-card relative group hover:border-jarvis-blue/20 transition-colors">
      <span className="absolute -top-3 left-4 flex h-6 w-6 items-center justify-center rounded-full bg-jarvis-blue text-xs font-bold text-jarvis-dark">
        {num}
      </span>
      <div className="mt-3">
        <Icon className="mb-3 h-6 w-6 text-jarvis-blue" />
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm text-jarvis-muted leading-relaxed">
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
    <div className="rounded-xl border border-jarvis-border/50 bg-jarvis-dark p-6 transition-all hover:border-jarvis-blue/20 hover:bg-jarvis-surface/30">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-jarvis-blue/10">
        <Icon className="h-4.5 w-4.5 text-jarvis-blue" />
      </div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1.5 text-xs text-jarvis-muted leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function AnimatedStat({
  visible,
  value,
  label,
  sublabel,
}: {
  visible: boolean;
  value: string;
  label: string;
  sublabel: string;
}) {
  return (
    <div className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
      <p className="text-4xl font-extrabold bg-gradient-to-r from-jarvis-blue to-jarvis-cyan bg-clip-text text-transparent">
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-white">{label}</p>
      <p className="text-xs text-jarvis-muted/60">{sublabel}</p>
    </div>
  );
}

function ComparisonRow({ label, them, us }: { label: string; them: string; us: string }) {
  return (
    <tr className="bg-jarvis-dark hover:bg-jarvis-surface/30 transition-colors">
      <td className="px-6 py-3.5 text-sm font-medium text-white">{label}</td>
      <td className="px-6 py-3.5 text-center text-xs text-jarvis-muted">{them}</td>
      <td className="px-6 py-3.5 text-center text-xs text-jarvis-blue font-medium">{us}</td>
    </tr>
  );
}
