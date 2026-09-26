export const SUBSCRIPTION_TIERS = ['BASIC', 'PRO', 'ENTERPRISE'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** What a customer gets and pays for one billing cycle of a given plan. */
export interface PlanTerms {
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  /** Messages per billing cycle; `null` means unlimited. */
  maxMessages: number | null;
  priceCents: number;
  currency: 'USD';
}

const CATALOG: Record<SubscriptionTier, { messagesPerMonth: number | null; monthlyCents: number }> =
  {
    BASIC: { messagesPerMonth: 10, monthlyCents: 999 },
    PRO: { messagesPerMonth: 100, monthlyCents: 2999 },
    ENTERPRISE: { messagesPerMonth: null, monthlyCents: 9999 },
  };

/**
 * Yearly plans include twelve months of messages for the price of ten.
 * The quota belongs to the billing cycle and is reset on every renewal.
 */
export function planTerms(tier: SubscriptionTier, billingCycle: BillingCycle): PlanTerms {
  const { messagesPerMonth, monthlyCents } = CATALOG[tier];
  const yearly = billingCycle === 'YEARLY';
  return {
    tier,
    billingCycle,
    maxMessages: messagesPerMonth === null ? null : messagesPerMonth * (yearly ? 12 : 1),
    priceCents: monthlyCents * (yearly ? 10 : 1),
    currency: 'USD',
  };
}

/**
 * Adds one billing cycle in UTC. Month ends are clamped, so a subscription
 * started on 31 January renews on 28/29 February, not in March.
 */
export function addBillingCycle(from: Date, cycle: BillingCycle): Date {
  const months = cycle === 'MONTHLY' ? 1 : 12;
  const target = new Date(from.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), lastDayOfTargetMonth));
  return target;
}
