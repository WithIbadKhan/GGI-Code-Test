import type { BundleBalance } from '../entities/BundleBalance.js';
import { bundleQuota, FREE_QUOTA, type QuotaSource } from '../entities/QuotaSource.js';
import type { UsagePeriod } from '../entities/UsagePeriod.js';
import type { QuotaDeniedReason } from '../errors.js';

/** Everything needed to decide where the next message's quota comes from. */
export interface QuotaSnapshot {
  period: UsagePeriod;
  freeUsed: number;
  /** Bundles that are ACTIVE and inside their billing period right now. */
  activeBundles: readonly BundleBalance[];
}

export type QuotaDecision =
  { granted: true; source: QuotaSource } | { granted: false; reason: QuotaDeniedReason };

export interface QuotaSummary {
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number;
  activeBundles: number;
  /** `null` when at least one active bundle is unlimited. */
  bundleMessagesRemaining: number | null;
  resetsAt: Date;
}

/**
 * Pure quota rules, with no I/O, so they are easy to unit test:
 *
 * 1. Free messages are used first (N per calendar month).
 * 2. Then a bundle is used: "the bundle with the latest remaining quota",
 *    which we read as the most recently purchased bundle that still has
 *    messages left. Unlimited (Enterprise) bundles always have messages left.
 * 3. Otherwise the request is denied with a typed reason.
 */
export class QuotaCalculator {
  constructor(readonly freeMessagesPerMonth: number) {}

  decide(snapshot: QuotaSnapshot): QuotaDecision {
    if (snapshot.freeUsed < this.freeMessagesPerMonth) {
      return { granted: true, source: FREE_QUOTA };
    }

    const chosen = [...snapshot.activeBundles]
      .filter((bundle) => bundle.hasRemaining())
      .sort(latestFirst)[0];

    if (chosen) {
      return { granted: true, source: bundleQuota(chosen.subscriptionId) };
    }

    return {
      granted: false,
      reason: snapshot.activeBundles.length === 0 ? 'SUBSCRIPTION_REQUIRED' : 'BUNDLES_EXHAUSTED',
    };
  }

  summarize(snapshot: QuotaSnapshot): QuotaSummary {
    const hasUnlimited = snapshot.activeBundles.some((bundle) => bundle.isUnlimited);
    const bundleMessagesRemaining = hasUnlimited
      ? null
      : snapshot.activeBundles.reduce((sum, bundle) => sum + bundle.remaining, 0);

    return {
      freeLimit: this.freeMessagesPerMonth,
      freeUsed: Math.min(snapshot.freeUsed, this.freeMessagesPerMonth),
      freeRemaining: Math.max(this.freeMessagesPerMonth - snapshot.freeUsed, 0),
      activeBundles: snapshot.activeBundles.length,
      bundleMessagesRemaining,
      resetsAt: snapshot.period.endsAt,
    };
  }
}

/** Newest bundle first; the id breaks ties so the choice is always deterministic. */
function latestFirst(a: BundleBalance, b: BundleBalance): number {
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  return byDate !== 0 ? byDate : b.subscriptionId.localeCompare(a.subscriptionId);
}
