import { createServiceClient } from "@/lib/supabase/server";
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
  userId: string
): Promise<SubscriptionData> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single();

  const plan = data?.plan ?? "free";
  const limits = getPlanLimits(plan);

  return {
    plan,
    status: data?.status ?? "active",
    leadsUsed: data?.leads_used_this_period ?? 0,
    emailsSent: data?.emails_sent_this_period ?? 0,
    leadsLimit: limits.leadsPerMonth,
    emailsLimit: limits.emailsPerMonth,
    stripeCustomerId: data?.stripe_customer_id ?? null,
    stripeSubscriptionId: data?.stripe_subscription_id ?? null,
    cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
    currentPeriodEnd: data?.current_period_end ?? null,
  };
}

export async function canProcessLeads(
  userId: string,
  count: number
): Promise<{ allowed: boolean; reason?: string }> {
  const sub = await getUserSubscription(userId);

  if (sub.status !== "active" && sub.status !== "trialing") {
    return {
      allowed: false,
      reason: "Your subscription is not active. Please update your billing.",
    };
  }

  if (sub.leadsUsed + count > sub.leadsLimit) {
    return {
      allowed: false,
      reason: `Lead limit reached (${sub.leadsUsed}/${sub.leadsLimit} this period). Upgrade your plan to process more.`,
    };
  }

  return { allowed: true };
}

export async function canSendEmail(
  userId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const sub = await getUserSubscription(userId);

  if (sub.status !== "active" && sub.status !== "trialing") {
    return {
      allowed: false,
      reason: "Your subscription is not active. Please update your billing.",
    };
  }

  if (sub.emailsSent >= sub.emailsLimit) {
    return {
      allowed: false,
      reason: `Email limit reached (${sub.emailsSent}/${sub.emailsLimit} this period). Upgrade to send more.`,
    };
  }

  return { allowed: true };
}

export async function incrementLeadsUsed(userId: string, count: number) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("leads_used_this_period")
    .eq("user_id", userId)
    .single();

  await supabase
    .from("subscriptions")
    .update({
      leads_used_this_period:
        (data?.leads_used_this_period ?? 0) + count,
    })
    .eq("user_id", userId);
}

export async function incrementEmailsSent(userId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("emails_sent_this_period")
    .eq("user_id", userId)
    .single();

  await supabase
    .from("subscriptions")
    .update({
      emails_sent_this_period:
        (data?.emails_sent_this_period ?? 0) + 1,
    })
    .eq("user_id", userId);
}
