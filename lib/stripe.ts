// Stripe integration is disabled for now.
// This file retains plan definitions so the rest of the app can reference them.
// When Stripe is enabled, uncomment the Stripe SDK import and client below.

// import Stripe from "stripe";
// export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export interface PlanConfig {
  name: string;
  price: number;
  leadsPerMonth: number;
  emailsPerMonth: number;
  features: string[];
  stripePriceId: string | null;
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    name: "Free",
    price: 0,
    leadsPerMonth: 9999,
    emailsPerMonth: 9999,
    features: [
      "Unlimited leads (beta)",
      "Unlimited emails (beta)",
      "AI research & drafting",
      "Human approval flow",
      "Basic analytics",
    ],
    stripePriceId: null,
  },
  starter: {
    name: "Starter",
    price: 49,
    leadsPerMonth: 500,
    emailsPerMonth: 500,
    features: [
      "500 leads / month",
      "500 emails / month",
      "AI research & drafting",
      "Human approval flow",
      "Full analytics",
      "Priority support",
      "Custom sending domain",
    ],
    stripePriceId: null,
  },
  growth: {
    name: "Growth",
    price: 99,
    leadsPerMonth: 2000,
    emailsPerMonth: 2000,
    features: [
      "2,000 leads / month",
      "2,000 emails / month",
      "Everything in Starter",
      "Multi-step sequences",
      "A/B subject testing",
      "Slack notifications",
      "Dedicated onboarding",
    ],
    stripePriceId: null,
  },
};

export function getPlanLimits(planId: string) {
  const plan = PLANS[planId] ?? PLANS.free;
  return {
    leadsPerMonth: plan.leadsPerMonth,
    emailsPerMonth: plan.emailsPerMonth,
  };
}
