"use client";

import { useState, useEffect } from "react";
import {
  CreditCard,
  Check,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

interface SubscriptionData {
  plan: string;
  status: string;
  leadsUsed: number;
  emailsSent: number;
  leadsLimit: number;
  emailsLimit: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

interface PlanDisplay {
  id: string;
  name: string;
  price: number;
  features: string[];
  popular?: boolean;
}

const PLAN_DISPLAY: PlanDisplay[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    features: [
      "25 leads / month",
      "25 emails / month",
      "AI research & drafting",
      "Human approval flow",
      "Basic analytics",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    price: 49,
    popular: true,
    features: [
      "500 leads / month",
      "500 emails / month",
      "AI research & drafting",
      "Human approval flow",
      "Full analytics",
      "Priority support",
      "Custom sending domain",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 99,
    features: [
      "2,000 leads / month",
      "2,000 emails / month",
      "Everything in Starter",
      "Multi-step sequences",
      "A/B subject testing",
      "Slack notifications",
      "Dedicated onboarding",
    ],
  },
];

export function BillingTab() {
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch("/api/billing/subscription")
      .then((r) => r.json())
      .then(setSub)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleCheckout(planId: string) {
    setCheckoutLoading(planId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error(err);
    }
    setCheckoutLoading(null);
  }

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error(err);
    }
    setPortalLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-jarvis-blue" />
      </div>
    );
  }

  const currentPlan = sub?.plan ?? "free";
  const isActive = sub?.status === "active" || sub?.status === "trialing";

  return (
    <div className="space-y-6">
      {/* Current Plan Status */}
      <div className="jarvis-card">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
              <CreditCard className="h-4 w-4" />
              Current Plan
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-2xl font-bold text-white capitalize">
                {currentPlan}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                  isActive
                    ? "bg-jarvis-success/10 text-jarvis-success"
                    : "bg-jarvis-danger/10 text-jarvis-danger"
                }`}
              >
                {sub?.status ?? "active"}
              </span>
            </div>
            {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-jarvis-gold">
                <AlertTriangle className="h-3.5 w-3.5" />
                Cancels at end of period ({new Date(sub.currentPeriodEnd).toLocaleDateString()})
              </p>
            )}
          </div>
          {currentPlan !== "free" && (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="jarvis-btn-ghost text-xs"
            >
              {portalLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Manage Billing
            </button>
          )}
        </div>

        {/* Usage Meters */}
        <div className="mt-5 grid grid-cols-2 gap-4">
          <UsageMeter
            label="Leads"
            used={sub?.leadsUsed ?? 0}
            limit={sub?.leadsLimit ?? 25}
          />
          <UsageMeter
            label="Emails"
            used={sub?.emailsSent ?? 0}
            limit={sub?.emailsLimit ?? 25}
          />
        </div>
      </div>

      {/* Plan Cards */}
      <div>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
          {currentPlan === "free" ? "Upgrade Your Plan" : "Plans"}
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {PLAN_DISPLAY.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const isDowngrade =
              PLAN_DISPLAY.findIndex((p) => p.id === currentPlan) >
              PLAN_DISPLAY.findIndex((p) => p.id === plan.id);

            return (
              <div
                key={plan.id}
                className={`relative rounded-lg border p-5 transition-colors ${
                  plan.popular
                    ? "border-jarvis-blue/40 bg-jarvis-blue/[0.03]"
                    : "border-jarvis-border bg-jarvis-surface/20"
                } ${isCurrent ? "ring-1 ring-jarvis-blue/30" : ""}`}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 left-4 rounded-full bg-jarvis-blue px-2.5 py-0.5 text-[10px] font-semibold text-jarvis-dark">
                    <Sparkles className="mr-1 inline h-3 w-3" />
                    Most Popular
                  </span>
                )}

                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-white">
                    {plan.name}
                  </h4>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-white">
                      ${plan.price}
                    </span>
                    {plan.price > 0 && (
                      <span className="text-xs text-jarvis-muted">/month</span>
                    )}
                  </div>
                </div>

                <ul className="mb-5 space-y-2">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-xs text-jarvis-muted"
                    >
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-jarvis-success" />
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="rounded-md bg-white/5 py-2 text-center text-xs font-medium text-jarvis-muted">
                    Current Plan
                  </div>
                ) : isDowngrade ? (
                  <button
                    onClick={handlePortal}
                    className="jarvis-btn-ghost w-full text-xs"
                  >
                    Manage Billing
                  </button>
                ) : plan.id === "free" ? null : (
                  <button
                    onClick={() => handleCheckout(plan.id)}
                    disabled={checkoutLoading !== null}
                    className={`w-full rounded-md px-4 py-2 text-xs font-semibold transition-all ${
                      plan.popular
                        ? "bg-jarvis-blue text-jarvis-dark hover:brightness-110"
                        : "bg-white/10 text-white hover:bg-white/15"
                    }`}
                  >
                    {checkoutLoading === plan.id ? (
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    ) : (
                      `Upgrade to ${plan.name}`
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UsageMeter({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = Math.min((used / limit) * 100, 100);
  const isWarning = pct >= 80;
  const isMaxed = pct >= 100;

  return (
    <div className="rounded-md border border-jarvis-border/50 bg-jarvis-dark p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-jarvis-muted">{label}</span>
        <span
          className={`font-mono font-medium ${
            isMaxed
              ? "text-jarvis-danger"
              : isWarning
                ? "text-jarvis-gold"
                : "text-white"
          }`}
        >
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full transition-all ${
            isMaxed
              ? "bg-jarvis-danger"
              : isWarning
                ? "bg-jarvis-gold"
                : "bg-jarvis-blue"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
