import type pg from 'pg';
import type { Subscription } from '../domain/entities/Subscription.js';
import type {
  SubscriptionRepository,
  SubscriptionUnitOfWork,
} from '../domain/ports/repositories.js';
import { PgSubscriptionRepository } from './PgSubscriptionRepository.js';

export class PgSubscriptionUnitOfWork implements SubscriptionUnitOfWork {
  constructor(private readonly pool: pg.Pool) {}

  async runLocked<T>(
    subscriptionId: string,
    options: { skipLocked: boolean },
    work: (subscription: Subscription | null, subscriptions: SubscriptionRepository) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);

      const subscriptions = new PgSubscriptionRepository(client);
      const subscription = await subscriptions.findByIdForUpdate(
        subscriptionId,
        options.skipLocked,
      );
      const result = await work(subscription, subscriptions);

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
