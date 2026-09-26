import type { Queryable } from '../../../shared/infrastructure/database.js';
import type { BillingCycle, SubscriptionTier } from '../domain/entities/Plan.js';
import { Subscription, type SubscriptionStatus } from '../domain/entities/Subscription.js';
import type { SubscriptionRepository } from '../domain/ports/repositories.js';

interface SubscriptionRow {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  billing_cycle: BillingCycle;
  max_messages: number | null;
  used_messages: number;
  price_cents: number;
  currency: string;
  auto_renew: boolean;
  status: SubscriptionStatus;
  start_date: Date;
  end_date: Date;
  renewal_date: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, user_id, tier, billing_cycle, max_messages, used_messages, price_cents,
  currency, auto_renew, status, start_date, end_date, renewal_date, cancelled_at, created_at,
  updated_at`;

export class PgSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: Queryable) {}

  async insert(s: Subscription): Promise<void> {
    await this.db.query(
      `INSERT INTO subscriptions (${COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        s.id,
        s.userId,
        s.tier,
        s.billingCycle,
        s.maxMessages,
        s.usedMessages,
        s.priceCents,
        s.currency,
        s.autoRenew,
        s.status,
        s.startDate,
        s.endDate,
        s.renewalDate,
        s.cancelledAt,
        s.createdAt,
        s.updatedAt,
      ],
    );
  }

  /**
   * Writes the lifecycle fields. Callers hold the row lock (see
   * PgSubscriptionUnitOfWork), so `used_messages` cannot be overwritten by a
   * concurrent chat request.
   */
  async update(s: Subscription): Promise<void> {
    await this.db.query(
      `UPDATE subscriptions
          SET used_messages = $2, auto_renew = $3, status = $4, start_date = $5, end_date = $6,
              renewal_date = $7, cancelled_at = $8, updated_at = $9
        WHERE id = $1`,
      [
        s.id,
        s.usedMessages,
        s.autoRenew,
        s.status,
        s.startDate,
        s.endDate,
        s.renewalDate,
        s.cancelledAt,
        s.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<Subscription | null> {
    const result = await this.db.query<SubscriptionRow>(
      `SELECT ${COLUMNS} FROM subscriptions WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }

  /** Used by the unit of work to lock one row inside its transaction. */
  async findByIdForUpdate(id: string, skipLocked: boolean): Promise<Subscription | null> {
    const result = await this.db.query<SubscriptionRow>(
      `SELECT ${COLUMNS} FROM subscriptions WHERE id = $1
       FOR UPDATE${skipLocked ? ' SKIP LOCKED' : ''}`,
      [id],
    );
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }

  async listByUser(
    userId: string,
    page: { limit: number; offset: number },
  ): Promise<Subscription[]> {
    const result = await this.db.query<SubscriptionRow>(
      `SELECT ${COLUMNS} FROM subscriptions
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return result.rows.map(toEntity);
  }

  async listDueIds(now: Date, limit: number): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      `SELECT id FROM subscriptions
        WHERE status = 'ACTIVE' AND end_date <= $1
        ORDER BY end_date
        LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => row.id);
  }
}

function toEntity(row: SubscriptionRow): Subscription {
  return Subscription.restore({
    id: row.id,
    userId: row.user_id,
    tier: row.tier,
    billingCycle: row.billing_cycle,
    maxMessages: row.max_messages,
    usedMessages: row.used_messages,
    priceCents: row.price_cents,
    currency: row.currency,
    autoRenew: row.auto_renew,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    renewalDate: row.renewal_date,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
