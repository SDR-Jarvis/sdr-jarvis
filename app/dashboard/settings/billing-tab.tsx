"use client";

import { useState, useEffect } from "react";
import {
  CreditCard,
  Check,
  Loader2,
  Sparkles,
  Clock,
} from "lucide-react";

interface SubscriptionData {
  plan: string;
  status: string;
  leadsUsed: number;
  emailsSent: number;
  leadsLimit: number;
  emailsLimit: number;
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
    name: "Free (Beta)",
    price: 0,
    features: [
      "Unlimited leads (beta)",
      "Unlimited emails (beta)",
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

  useEffect(() => {
    fetch("/api/billing/subscription")
      .then((r) => r.json())
      .then(setSub)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-jarvis-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Plan Status */}
      <div className="jarvis-card">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
          <CreditCard className="h-4 w-4" />
          Current Plan
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-2xl font-bold text-white">
            Free (Beta)
          </span>
          <span className="rounded-full bg-jarvis-success/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-jarvis-success">
            active
          </span>
        </div>
        <p className="mt-2 text-sm text-jarvis-muted">
          You&apos;re on the free beta — all features are unlocked with no limits while we&apos;re in early access.
        </p>

        {/* Usage Meters */}
        <div className="mt-5 grid grid-cols-2 gap-4">
          <UsageMeter
            label="Leads"
            used={sub?.leadsUsed ?? 0}
            limit={sub?.leadsLimit ?? 9999}
          />
          <UsageMeter
            label="Emails"
            used={sub?.emailsSent ?? 0}
            limit={sub?.emailsLimit ?? 9999}
          />
        </div>
      </div>

      {/* Upcoming Plans */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-jarvis-muted">
            Plans
          </h3>
          <span className="rounded-full bg-jarvis-gold/10 px-2 py-0.5 text-[10px] font-medium text-jarvis-gold flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Coming Soon
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {PLAN_DISPLAY.map((plan) => {
            const isCurrent = plan.id === "free";

            return (
              <div
                key={plan.id}
                className={`relative rounded-lg border p-5 ${
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
                ) : (
                  <div className="rounded-md bg-white/5 py-2 text-center text-xs font-medium text-jarvis-muted/50">
                    Available soon
                  </div>
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
  const displayLimit = limit >= 9999 ? "∞" : limit.toLocaleString();
  const pct = limit >= 9999 ? 0 : Math.min((used / limit) * 100, 100);

  return (
    <div className="rounded-md border border-jarvis-border/50 bg-jarvis-dark p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-jarvis-muted">{label}</span>
        <span className="font-mono font-medium text-white">
          {used.toLocaleString()} / {displayLimit}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-jarvis-blue transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
