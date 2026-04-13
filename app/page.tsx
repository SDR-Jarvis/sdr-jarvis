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
  Users,
  Sparkles,
  MessageSquare,
  TrendingUp,
  ChevronRight,
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
  const [visibleStats, setVisibleStats] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();
  const router = useRouter();

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

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!signInError) {
      router.push("/dashboard");
      return;
    }

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

      if (signUpData.user && signUpData.session) {
        router.push("/dashboard");
        return;
      }

      if (signUpData.user && !signUpData.session) {
        setSuccess("Account created! Check your email to confirm, then sign in.");
        return;
      }

      setError("Wrong password. Try again or use a different email to create a new account.");
      return;
    }

    setLoading(false);
    setError(signInError.message);
  }

  return (
    <div className="min-h-screen bg-jarvis-dark">
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
        <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-jarvis-blue/20 bg-jarvis-blue/5 px-4 py-1.5 text-xs font-medium text-jarvis-blue">
          <Sparkles className="h-3.5 w-3.5" />
          AI-powered outbound for solo founders
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl leading-[1.1]">
          Stop writing cold emails.
          <br />
          <span className="bg-gradient-to-r from-jarvis-blue to-jarvis-cyan bg-clip-text text-transparent">
            Start closing deals.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-jarvis-muted leading-relaxed">
          SDR Jarvis finds your ideal prospects, researches them deeply, writes
          hyper-personalized emails, and sends them — but only after you approve.
          Your AI sales rep that never sleeps.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#get-started"
            className="flex items-center gap-2 rounded-lg bg-jarvis-blue px-6 py-3 text-sm font-bold text-jarvis-dark transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Start Free — No Credit Card
            <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href="#how-it-works"
            className="flex items-center gap-2 rounded-lg border border-jarvis-border px-6 py-3 text-sm font-medium text-jarvis-muted transition-all hover:border-jarvis-blue/30 hover:text-white"
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
            Powered by GPT-4o
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
            description="AI searches Google, LinkedIn, and company sites. Then writes a personalized 3-5 sentence email for each lead — no templates, no filler."
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
              description="Google-powered scraping of LinkedIn profiles, company websites, funding data, and recent news — before a single word is written."
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
            Ready to automate your outbound?
          </h2>
          <p className="mt-3 text-jarvis-muted">
            Free to start. No credit card required. Set up in 5 minutes.
          </p>
        </div>

        <div className="jarvis-card jarvis-glow space-y-6">
          <div className="text-center">
            <h3 className="text-lg font-bold text-white">
              {step === "email" ? "Create Your Account" : `Welcome, ${email.split("@")[0]}`}
            </h3>
            <p className="mt-1 text-sm text-jarvis-muted">
              {step === "email"
                ? "Enter your email to get started — or sign in to your existing account."
                : "Set a password to secure your account."}
            </p>
          </div>

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
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-jarvis-blue px-4 py-3 text-sm font-bold text-jarvis-dark transition-all hover:brightness-110 active:scale-[0.98]"
              >
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-jarvis-blue/5 border border-jarvis-blue/20 px-3 py-2 text-xs text-jarvis-blue">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{email}</span>
                <button
                  type="button"
                  onClick={() => { setStep("email"); setPassword(""); setError(""); setSuccess(""); }}
                  className="ml-auto shrink-0 text-jarvis-muted hover:text-white transition-colors"
                >
                  Change
                </button>
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
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-jarvis-muted/60">
                  New here? Pick a password. Returning? Enter your existing one.
                </p>
              </div>

              {error && <p className="text-sm text-jarvis-danger">{error}</p>}
              {success && <p className="text-sm text-jarvis-success">{success}</p>}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-jarvis-blue px-4 py-3 text-sm font-bold text-jarvis-dark transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {loading ? "Setting up your account…" : "Launch Jarvis"}
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

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="relative z-10 border-t border-jarvis-border/30">
        <div className="mx-auto max-w-5xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-jarvis-blue/30 bg-jarvis-blue/10">
              <Zap className="h-3.5 w-3.5 text-jarvis-blue" />
            </div>
            <span className="text-sm font-bold text-white">SDR Jarvis</span>
          </div>
          <p className="text-xs text-jarvis-muted/40">
            Built for founders who&apos;d rather close deals than write cold emails.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════ SUBCOMPONENTS ═══════════ */

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
