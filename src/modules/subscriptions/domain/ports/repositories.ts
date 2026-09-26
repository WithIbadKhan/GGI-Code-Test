import type { Subscription } from '../entities/Subscription.js';

export interface SubscriptionRepository {
  insert(subscription: Subscription): Promise<void>;
  update(subscription: Subscription): Promise<void>;
  findById(id: string): Promise<Subscription | null>;
  listByUser(userId: string, page: { limit: number; offset: number }): Promise<Subscription[]>;
  /** Ids of ACTIVE subscriptions whose billing cycle has ended, oldest first. */
  listDueIds(now: Date, limit: number): Promise<string[]>;
}

export interface SubscriptionUnitOfWork {
  /**
   * Runs `work` in one transaction while holding a row lock on the subscription,
   * so a user action and a renewal can never change it at the same time.
   *
   * `subscription` is null when the id does not exist or, with `skipLocked`,
   * when another worker currently holds the lock.
   */
  runLocked<T>(
    subscriptionId: string,
    options: { skipLocked: boolean },
    work: (subscription: Subscription | null, subscriptions: SubscriptionRepository) => Promise<T>,
  ): Promise<T>;
}
