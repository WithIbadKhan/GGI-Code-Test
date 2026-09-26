import type { Subscription } from '../../src/modules/subscriptions/domain/entities/Subscription.js';
import type {
  ChargeOutcome,
  ChargeRequest,
  PaymentGateway,
} from '../../src/modules/subscriptions/domain/ports/PaymentGateway.js';
import type {
  SubscriptionRepository,
  SubscriptionUnitOfWork,
} from '../../src/modules/subscriptions/domain/ports/repositories.js';

/** In-memory ports for unit-testing the subscription use cases without a database. */
export class InMemorySubscriptionStore implements SubscriptionRepository, SubscriptionUnitOfWork {
  readonly subscriptions = new Map<string, Subscription>();

  async runLocked<T>(
    subscriptionId: string,
    _options: { skipLocked: boolean },
    work: (subscription: Subscription | null, subscriptions: SubscriptionRepository) => Promise<T>,
  ): Promise<T> {
    return work(this.subscriptions.get(subscriptionId) ?? null, this);
  }

  async insert(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.id, subscription);
  }

  async update(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.id, subscription);
  }

  async findById(id: string): Promise<Subscription | null> {
    return this.subscriptions.get(id) ?? null;
  }

  async listByUser(userId: string): Promise<Subscription[]> {
    return [...this.subscriptions.values()].filter((s) => s.userId === userId);
  }

  async listDueIds(now: Date): Promise<string[]> {
    return [...this.subscriptions.values()].filter((s) => s.isDueForRenewal(now)).map((s) => s.id);
  }
}

/** Payment gateway that records every charge and whose declines are scripted by the test. */
export class ScriptedPaymentGateway implements PaymentGateway {
  readonly charges: ChargeRequest[] = [];
  private declinesLeft = 0;

  declineNextCharges(count = 1): void {
    this.declinesLeft = count;
  }

  async charge(request: ChargeRequest): Promise<ChargeOutcome> {
    this.charges.push(request);
    if (this.declinesLeft > 0) {
      this.declinesLeft -= 1;
      return { succeeded: false, reason: 'CARD_DECLINED' };
    }
    return { succeeded: true, reference: `pay_${String(this.charges.length)}` };
  }
}
