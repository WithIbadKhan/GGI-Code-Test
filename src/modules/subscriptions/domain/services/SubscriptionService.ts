import type { Actor } from '../../../../shared/domain/Actor.js';
import type { Clock } from '../../../../shared/domain/Clock.js';
import { ForbiddenError, NotFoundError } from '../../../../shared/domain/errors.js';
import { planTerms, type BillingCycle, type SubscriptionTier } from '../entities/Plan.js';
import { Subscription } from '../entities/Subscription.js';
import { PaymentFailedError } from '../errors.js';
import { SubscriptionAccessPolicy } from '../policies/SubscriptionAccessPolicy.js';
import type { PaymentGateway } from '../ports/PaymentGateway.js';
import type { SubscriptionRepository, SubscriptionUnitOfWork } from '../ports/repositories.js';

export interface SubscriptionServiceDependencies {
  unitOfWork: SubscriptionUnitOfWork;
  subscriptions: SubscriptionRepository;
  paymentGateway: PaymentGateway;
  clock: Clock;
  generateId: () => string;
}

export interface PurchaseCommand {
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  autoRenew: boolean;
}

export class SubscriptionService {
  constructor(private readonly deps: SubscriptionServiceDependencies) {}

  /**
   * Buys a bundle for the caller. The price and message limit always come from
   * the plan catalog, never from the request.
   *
   * If the first payment is declined, the subscription is still stored, as
   * INACTIVE, so the attempt is on record.
   */
  async purchase(actor: Actor, command: PurchaseCommand): Promise<Subscription> {
    if (!SubscriptionAccessPolicy.canPurchase(actor)) {
      throw new ForbiddenError('Your role is not allowed to buy subscriptions.');
    }

    const now = this.deps.clock.now();
    const subscription = Subscription.purchase({
      id: this.deps.generateId(),
      userId: actor.userId,
      terms: planTerms(command.tier, command.billingCycle),
      autoRenew: command.autoRenew,
      now,
    });

    const outcome = await this.deps.paymentGateway.charge({
      subscriptionId: subscription.id,
      userId: subscription.userId,
      amountCents: subscription.priceCents,
      currency: subscription.currency,
      description: `${subscription.tier} ${subscription.billingCycle} subscription`,
    });
    if (!outcome.succeeded) {
      subscription.markPaymentFailed(now);
    }

    await this.deps.subscriptions.insert(subscription);

    if (!outcome.succeeded) {
      throw new PaymentFailedError(subscription.id, outcome.reason);
    }
    return subscription;
  }

  async get(actor: Actor, subscriptionId: string): Promise<Subscription> {
    const subscription = await this.deps.subscriptions.findById(subscriptionId);
    // Reported as "not found" so other users' subscription ids cannot be probed.
    if (!subscription || !SubscriptionAccessPolicy.canView(actor, subscription)) {
      throw new NotFoundError('Subscription');
    }
    return subscription;
  }

  async list(
    actor: Actor,
    query: { userId?: string | undefined; limit: number; offset: number },
  ): Promise<Subscription[]> {
    const targetUserId = query.userId ?? actor.userId;
    if (!SubscriptionAccessPolicy.canListFor(actor, targetUserId)) {
      throw new ForbiddenError('You can only list your own subscriptions.');
    }
    return this.deps.subscriptions.listByUser(targetUserId, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  setAutoRenew(actor: Actor, subscriptionId: string, enabled: boolean): Promise<Subscription> {
    return this.modify(actor, subscriptionId, (subscription, now) => {
      subscription.setAutoRenew(enabled, now);
    });
  }

  cancel(actor: Actor, subscriptionId: string): Promise<Subscription> {
    return this.modify(actor, subscriptionId, (subscription, now) => {
      subscription.cancel(now);
    });
  }

  /** Loads the subscription under a row lock, checks access, applies the change and saves it. */
  private modify(
    actor: Actor,
    subscriptionId: string,
    change: (subscription: Subscription, now: Date) => void,
  ): Promise<Subscription> {
    return this.deps.unitOfWork.runLocked(
      subscriptionId,
      { skipLocked: false },
      async (subscription, subscriptions) => {
        if (!subscription || !SubscriptionAccessPolicy.canManage(actor, subscription)) {
          throw new NotFoundError('Subscription');
        }
        change(subscription, this.deps.clock.now());
        await subscriptions.update(subscription);
        return subscription;
      },
    );
  }
}
