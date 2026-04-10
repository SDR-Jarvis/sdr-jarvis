// Stripe billing is disabled for now. All usage checks return "allowed".
// When Stripe is enabled, restore the Supabase queries against the subscriptions table.

import { getPlanLimits } from "@/lib/stripe";

export interface SubscriptionData {
  plan: string;
  status: string;
  leadsUsed: number;
  emailsSent: number;
  leadsLimit: number;
  emailsLimit: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

export async function getUserSubscription(
  _userId: string
): Promise<SubscriptionData> {
  const limits = getPlanLimits("free");

  return {
    plan: "free",
    status: "active",
    leadsUsed: 0,
    emailsSent: 0,
    leadsLimit: limits.leadsPerMonth,
    emailsLimit: limits.emailsPerMonth,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  };
}

export async function canProcessLeads(
  _userId: string,
  _count: number
): Promise<{ allowed: boolean; reason?: string }> {
  return { allowed: true };
}

export async function canSendEmail(
  _userId: string
): Promise<{ allowed: boolean; reason?: string }> {
  return { allowed: true };
}

export async function incrementLeadsUsed(_userId: string, _count: number) {
  // No-op while billing is disabled
}

export async function incrementEmailsSent(_userId: string) {
  // No-op while billing is disabled
}
