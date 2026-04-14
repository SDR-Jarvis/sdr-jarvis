// Stripe integration is paused until after launch. Plan definitions stay for UI/subscription helpers.

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
    name: "Free (Beta)",
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
    price: 29,
    leadsPerMonth: 200,
    emailsPerMonth: 200,
    features: [
      "200 leads / month",
      "200 emails / month",
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
    price: 79,
    leadsPerMonth: 1000,
    emailsPerMonth: 1000,
    features: [
      "1,000 leads / month",
      "1,000 emails / month",
      "Everything in Starter",
      "Multi-step sequences",
      "Reply intelligence",
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
