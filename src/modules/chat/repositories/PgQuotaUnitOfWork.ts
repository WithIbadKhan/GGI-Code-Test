import type pg from 'pg';
import type { QuotaTransaction, QuotaUnitOfWork } from '../domain/ports/repositories.js';
import { PgChatRepository } from './PgChatRepository.js';
import { PgQuotaRepository } from './PgQuotaRepository.js';

/**
 * Serialises quota changes per user with a transaction-scoped advisory lock.
 *
 * Why an advisory lock rather than `SELECT ... FOR UPDATE`? On a user's very
 * first message of the month there is no `monthly_usage` row to lock yet, so two
 * concurrent requests could both see "0 used". Locking on the user id itself
 * closes that gap. The lock is released automatically on COMMIT or ROLLBACK.
 */
export class PgQuotaUnitOfWork implements QuotaUnitOfWork {
  constructor(private readonly pool: pg.Pool) {}

  async runExclusiveForUser<T>(
    userId: string,
    work: (tx: QuotaTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Fail fast instead of queueing forever if something holds the lock.
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      // hashtextextended maps the id to a 64-bit key. A rare hash collision only
      // means two users briefly share a lock, which is harmless.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `quota:${userId}`,
      ]);

      const result = await work({
        quota: new PgQuotaRepository(client),
        chats: new PgChatRepository(client),
      });

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
