import type { Clock } from '../../../../shared/domain/Clock.js';
import type { Subscription } from '../entities/Subscription.js';
import type { PaymentGateway } from '../ports/PaymentGateway.js';
import type { SubscriptionRepository, SubscriptionUnitOfWork } from '../ports/repositories.js';

export interface BillingServiceDependencies {
  unitOfWork: SubscriptionUnitOfWork;
  subscriptions: SubscriptionRepository;
  paymentGateway: PaymentGateway;
  clock: Clock;
}

export interface BillingRunSummary {
  due: number;
  renewed: number;
  paymentFailed: number;
  expired: number;
  /** Already handled by another worker, or no longer due. */
  skipped: number;
}

type Outcome = 'renewed' | 'paymentFailed' | 'expired' | 'skipped';

/**
 * Processes subscriptions whose billing cycle has ended:
 * - auto-renew on: charge. Success starts a new cycle, failure makes it INACTIVE.
 * - auto-renew off: the subscription simply becomes INACTIVE.
 *
 * Each subscription is handled in its own transaction under a row lock taken
 * with SKIP LOCKED. Several app instances can run billing at the same time, and
 * a subscription is still never charged twice for the same cycle.
 */
export class BillingService {
  constructor(private readonly deps: BillingServiceDependencies) {}

  async runRenewals(batchSize = 100): Promise<BillingRunSummary> {
    const now = this.deps.clock.now();
    const dueIds = await this.deps.subscriptions.listDueIds(now, batchSize);
    const summary: BillingRunSummary = {
      due: dueIds.length,
      renewed: 0,
      paymentFailed: 0,
      expired: 0,
      skipped: 0,
    };

    for (const id of dueIds) {
      const outcome = await this.deps.unitOfWork.runLocked(
        id,
        { skipLocked: true },
        (subscription, subscriptions) => this.process(subscription, subscriptions, now),
      );
      summary[outcome] += 1;
    }
    return summary;
  }

  private async process(
    subscription: Subscription | null,
    subscriptions: SubscriptionRepository,
    now: Date,
  ): Promise<Outcome> {
    // Re-checked under the lock: another worker may have handled it already.
    if (!subscription?.isDueForRenewal(now)) return 'skipped';

    if (!subscription.autoRenew) {
      subscription.expire(now);
      await subscriptions.update(subscription);
      return 'expired';
    }

    // The row lock is held while charging on purpose: it is what guarantees a
    // single charge per cycle. The simulated gateway answers in milliseconds.
    const outcome = await this.deps.paymentGateway.charge({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      amountCents: subscription.priceCents,
      currency: subscription.currency,
      description: `Renewal of ${subscription.tier} ${subscription.billingCycle} subscription`,
    });

    if (outcome.succeeded) {
      subscription.renew(now);
    } else {
      subscription.markPaymentFailed(now);
    }
    await subscriptions.update(subscription);
    return outcome.succeeded ? 'renewed' : 'paymentFailed';
  }
}
