import type { Queryable } from '../../../shared/infrastructure/database.js';
import type { MetricsReader, SystemMetrics } from '../domain/ports.js';

/** Aggregates with plain SQL. COUNT/SUM return bigint, so everything is cast to int. */
export class PgMetricsReader implements MetricsReader {
  constructor(private readonly db: Queryable) {}

  async read(periodStart: Date, periodEnd: Date): Promise<Omit<SystemMetrics, 'period'>> {
    const [usage, subscriptions] = await Promise.all([
      this.db.query<{
        completed: number;
        failed: number;
        in_progress: number;
        free: number;
        bundle: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        active_users: number;
      }>(
        `SELECT count(*) FILTER (WHERE status = 'COMPLETED')::int              AS completed,
                count(*) FILTER (WHERE status = 'FAILED')::int                 AS failed,
                count(*) FILTER (WHERE status = 'RESERVED')::int               AS in_progress,
                count(*) FILTER (WHERE status = 'COMPLETED' AND quota_source = 'FREE')::int   AS free,
                count(*) FILTER (WHERE status = 'COMPLETED' AND quota_source = 'BUNDLE')::int AS bundle,
                coalesce(sum(prompt_tokens), 0)::int                           AS prompt_tokens,
                coalesce(sum(completion_tokens), 0)::int                       AS completion_tokens,
                coalesce(sum(total_tokens), 0)::int                            AS total_tokens,
                count(DISTINCT user_id) FILTER (WHERE status = 'COMPLETED')::int AS active_users
           FROM chat_messages
          WHERE created_at >= $1 AND created_at < $2`,
        [periodStart, periodEnd],
      ),
      this.db.query<{ status: string; tier: string; count: number; auto_renew: number }>(
        `SELECT status, tier, count(*)::int AS count,
                count(*) FILTER (WHERE auto_renew)::int AS auto_renew
           FROM subscriptions
          GROUP BY status, tier`,
      ),
    ]);

    const u = usage.rows[0];
    const byStatus = { ACTIVE: 0, INACTIVE: 0, CANCELLED: 0 };
    const activeByTier = { BASIC: 0, PRO: 0, ENTERPRISE: 0 };
    let autoRenewEnabled = 0;
    for (const row of subscriptions.rows) {
      byStatus[row.status as keyof typeof byStatus] += row.count;
      if (row.status === 'ACTIVE') {
        activeByTier[row.tier as keyof typeof activeByTier] += row.count;
        autoRenewEnabled += row.auto_renew;
      }
    }

    return {
      usage: {
        messages: {
          completed: u?.completed ?? 0,
          failed: u?.failed ?? 0,
          inProgress: u?.in_progress ?? 0,
        },
        bySource: { free: u?.free ?? 0, bundle: u?.bundle ?? 0 },
        tokens: {
          prompt: u?.prompt_tokens ?? 0,
          completion: u?.completion_tokens ?? 0,
          total: u?.total_tokens ?? 0,
        },
        activeUsers: u?.active_users ?? 0,
      },
      subscriptions: { byStatus, activeByTier, autoRenewEnabled },
    };
  }
}
