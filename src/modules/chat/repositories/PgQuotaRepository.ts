import { ConcurrencyConflictError } from '../../../shared/domain/errors.js';
import type { Queryable } from '../../../shared/infrastructure/database.js';
import { BundleBalance } from '../domain/entities/BundleBalance.js';
import type { QuotaSource } from '../domain/entities/QuotaSource.js';
import type { UsagePeriod } from '../domain/entities/UsagePeriod.js';
import type { QuotaRepository } from '../domain/ports/repositories.js';
import type { QuotaSnapshot } from '../domain/services/QuotaCalculator.js';

interface BundleRow {
  id: string;
  max_messages: number | null;
  used_messages: number;
  created_at: Date;
}

/**
 * Quota writes are only called inside `PgQuotaUnitOfWork`, which holds a
 * per-user lock. Each write still carries its own guard in the WHERE clause,
 * and the table has CHECK constraints, so an unexpected concurrent change fails
 * loudly instead of overselling.
 */
export class PgQuotaRepository implements QuotaRepository {
  constructor(private readonly db: Queryable) {}

  async loadSnapshot(userId: string, period: UsagePeriod, now: Date): Promise<QuotaSnapshot> {
    const usage = await this.db.query<{ free_used: number }>(
      `SELECT free_used FROM monthly_usage WHERE user_id = $1 AND period = $2`,
      [userId, period.toIsoDate()],
    );

    const bundles = await this.db.query<BundleRow>(
      `SELECT id, max_messages, used_messages, created_at
         FROM subscriptions
        WHERE user_id = $1
          AND status = 'ACTIVE'
          AND start_date <= $2
          AND end_date > $2`,
      [userId, now],
    );

    return {
      period,
      freeUsed: usage.rows[0]?.free_used ?? 0,
      activeBundles: bundles.rows.map(
        (row) => new BundleBalance(row.id, row.max_messages, row.used_messages, row.created_at),
      ),
    };
  }

  async consume(userId: string, period: UsagePeriod, source: QuotaSource): Promise<void> {
    if (source.kind === 'FREE') {
      await this.incrementMonthlyUsage(userId, period, { free: 1 });
      return;
    }

    const result = await this.db.query(
      `UPDATE subscriptions
          SET used_messages = used_messages + 1, updated_at = now()
        WHERE id = $1
          AND user_id = $2
          AND status = 'ACTIVE'
          AND (max_messages IS NULL OR used_messages < max_messages)`,
      [source.subscriptionId, userId],
    );
    if (result.rowCount !== 1) {
      throw new ConcurrencyConflictError('The selected bundle has no messages left.');
    }
    await this.incrementMonthlyUsage(userId, period, { free: 0 });
  }

  async release(userId: string, period: UsagePeriod, source: QuotaSource): Promise<void> {
    if (source.kind === 'BUNDLE') {
      await this.db.query(
        `UPDATE subscriptions
            SET used_messages = used_messages - 1, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND used_messages > 0`,
        [source.subscriptionId, userId],
      );
    }

    const freeRefund = source.kind === 'FREE' ? 1 : 0;
    await this.db.query(
      `UPDATE monthly_usage
          SET free_used = free_used - $3, total_used = total_used - 1, updated_at = now()
        WHERE user_id = $1 AND period = $2 AND free_used >= $3 AND total_used > 0`,
      [userId, period.toIsoDate(), freeRefund],
    );
  }

  /** Creates the month's row on first use (this is what "resets" the free quota). */
  private async incrementMonthlyUsage(
    userId: string,
    period: UsagePeriod,
    { free }: { free: 0 | 1 },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO monthly_usage (user_id, period, free_used, total_used)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, period) DO UPDATE
         SET free_used  = monthly_usage.free_used + EXCLUDED.free_used,
             total_used = monthly_usage.total_used + 1,
             updated_at = now()`,
      [userId, period.toIsoDate(), free],
    );
  }
}
