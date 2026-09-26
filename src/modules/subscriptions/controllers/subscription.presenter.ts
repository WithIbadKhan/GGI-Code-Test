import type { Subscription } from '../domain/entities/Subscription.js';

/**
 * Explicit response mapping: only the fields listed here ever leave the API,
 * so adding a column to the entity can never leak it by accident.
 */
export function presentSubscription(s: Subscription, now: Date) {
  return {
    id: s.id,
    userId: s.userId,
    tier: s.tier,
    billingCycle: s.billingCycle,
    status: s.status,
    active: s.isActiveAt(now),
    autoRenew: s.autoRenew,
    maxMessages: s.maxMessages,
    usedMessages: s.usedMessages,
    remainingMessages: s.remainingMessages,
    price: {
      amount: (s.priceCents / 100).toFixed(2),
      amountCents: s.priceCents,
      currency: s.currency,
    },
    startDate: s.startDate.toISOString(),
    endDate: s.endDate.toISOString(),
    renewalDate: s.renewalDate?.toISOString() ?? null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}
