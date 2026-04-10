import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
    leadsPerMonth: 25,
    emailsPerMonth: 25,
    features: [
      "25 leads / month",
      "25 emails / month",
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
    stripePriceId: process.env.STRIPE_STARTER_PRICE_ID ?? "",
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
    stripePriceId: process.env.STRIPE_GROWTH_PRICE_ID ?? "",
  },
};

export function getPlanLimits(planId: string) {
  const plan = PLANS[planId] ?? PLANS.free;
  return {
    leadsPerMonth: plan.leadsPerMonth,
    emailsPerMonth: plan.emailsPerMonth,
  };
}
