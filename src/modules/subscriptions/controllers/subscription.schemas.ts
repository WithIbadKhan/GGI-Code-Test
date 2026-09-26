import { z } from 'zod';
import { BILLING_CYCLES, SUBSCRIPTION_TIERS } from '../domain/entities/Plan.js';

/**
 * Only the plan choice is accepted. Price, message limit, dates and status
 * always come from the server, so sending `price` or `maxMessages` is rejected.
 */
export const purchaseSchema = z.strictObject({
  tier: z.enum(SUBSCRIPTION_TIERS),
  billingCycle: z.enum(BILLING_CYCLES),
  autoRenew: z.boolean().default(true),
});

export const updateSubscriptionSchema = z.strictObject({
  autoRenew: z.boolean(),
});

export const listSubscriptionsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  /** Admin only; the domain policy rejects it for regular users. */
  userId: z.string().min(1).max(255).optional(),
});

export const subscriptionIdParamsSchema = z.strictObject({
  id: z.uuid(),
});

export const emptyBodySchema = z.strictObject({});
