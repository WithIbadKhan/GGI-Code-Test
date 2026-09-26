import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QuotaExhaustedError } from '../../src/modules/chat/domain/errors.js';
import type { ChatService } from '../../src/modules/chat/domain/services/ChatService.js';
import type { Actor } from '../../src/shared/domain/Actor.js';
import {
  buildChatService,
  createTestPool,
  fastMockAi,
  insertBundle,
  resetData,
} from './helpers.js';

const alice: Actor = { userId: 'auth0|alice', roles: ['user'] };

function askMany(service: ChatService, actor: Actor, count: number) {
  return Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      service.ask(actor, { question: `Question number ${String(i)}`, requestId: null }),
    ),
  );
}

function countOutcomes(results: PromiseSettledResult<unknown>[]) {
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { fulfilled, rejected };
}

async function monthlyUsage(pool: pg.Pool, userId: string) {
  const { rows } = await pool.query<{ free_used: number; total_used: number }>(
    'SELECT free_used, total_used FROM monthly_usage WHERE user_id = $1',
    [userId],
  );
  return rows[0];
}

describe('Quota deduction against real PostgreSQL', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createTestPool();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await resetData(pool);
  });

  it('lets exactly 3 of 10 simultaneous requests through on the free quota', async () => {
    const service = buildChatService(pool, { ai: fastMockAi({ latencyMs: 25 }) });

    const { fulfilled, rejected } = countOutcomes(await askMany(service, alice, 10));

    expect(fulfilled).toBe(3);
    expect(rejected).toHaveLength(7);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(QuotaExhaustedError);
    expect(await monthlyUsage(pool, alice.userId)).toEqual({ free_used: 3, total_used: 3 });

    const { rows } = await pool.query(
      `SELECT status, count(*)::int AS n FROM chat_messages GROUP BY status`,
    );
    expect(rows).toEqual([{ status: 'COMPLETED', n: 3 }]);
  });

  it('never oversells the last messages of a bundle', async () => {
    await pool.query(
      `INSERT INTO monthly_usage (user_id, period, free_used, total_used)
       VALUES ($1, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 3, 3)`,
      [alice.userId],
    );
    const bundleId = await insertBundle(pool, {
      userId: alice.userId,
      maxMessages: 10,
      usedMessages: 8,
    });
    const service = buildChatService(pool, { ai: fastMockAi({ latencyMs: 25 }) });

    const { fulfilled, rejected } = countOutcomes(await askMany(service, alice, 6));

    expect(fulfilled).toBe(2);
    expect(rejected).toHaveLength(4);
    const { rows } = await pool.query<{ used_messages: number }>(
      'SELECT used_messages FROM subscriptions WHERE id = $1',
      [bundleId],
    );
    expect(rows[0]?.used_messages).toBe(10);
  });

  it('keeps users independent: one user running out does not affect another', async () => {
    const bob: Actor = { userId: 'google-oauth2|bob', roles: ['user'] };
    const service = buildChatService(pool);

    const [aliceResults, bobResults] = await Promise.all([
      askMany(service, alice, 5),
      askMany(service, bob, 3),
    ]);

    expect(countOutcomes(aliceResults).fulfilled).toBe(3);
    expect(countOutcomes(bobResults).fulfilled).toBe(3);
  });

  it('charges the most recently purchased bundle once free messages are used', async () => {
    await insertBundle(pool, {
      userId: alice.userId,
      maxMessages: 100,
      tier: 'PRO',
      createdAt: new Date(Date.now() - 10 * 86_400_000),
    });
    const newest = await insertBundle(pool, {
      userId: alice.userId,
      maxMessages: 10,
      createdAt: new Date(Date.now() - 86_400_000),
    });
    const service = buildChatService(pool);

    await askMany(service, alice, 3);
    const fourth = await service.ask(alice, { question: 'fourth', requestId: null });

    expect(fourth.quotaSource).toEqual({ kind: 'BUNDLE', subscriptionId: newest });
  });

  it('ignores inactive and expired bundles', async () => {
    await insertBundle(pool, { userId: alice.userId, maxMessages: 10, status: 'INACTIVE' });
    await insertBundle(pool, {
      userId: alice.userId,
      maxMessages: 10,
      startDate: new Date(Date.now() - 60 * 86_400_000),
      endDate: new Date(Date.now() - 30 * 86_400_000),
    });
    const service = buildChatService(pool);
    await askMany(service, alice, 3);

    await expect(
      service.ask(alice, { question: 'one more', requestId: null }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXHAUSTED',
      details: { reason: 'SUBSCRIPTION_REQUIRED' },
    });
  });

  it('refunds the quota in the database when the AI provider fails', async () => {
    const service = buildChatService(pool, { ai: fastMockAi({ failureRate: 1 }) });

    await expect(
      service.ask(alice, { question: 'will fail', requestId: null }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });

    expect(await monthlyUsage(pool, alice.userId)).toEqual({ free_used: 0, total_used: 0 });
    const { rows } = await pool.query('SELECT status, failure_reason FROM chat_messages');
    expect(rows).toEqual([{ status: 'FAILED', failure_reason: 'AI_PROVIDER_UNAVAILABLE' }]);
  });

  it('resets the free quota on the 1st of the next month and keeps the old month as history', async () => {
    let now = new Date('2026-09-30T23:59:00Z');
    const service = buildChatService(pool, { clock: { now: () => now } });
    await askMany(service, alice, 3);
    await expect(service.ask(alice, { question: 'x', requestId: null })).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );

    now = new Date('2026-10-01T00:00:00Z');
    const october = await service.ask(alice, { question: 'new month', requestId: null });

    expect(october.usagePeriod.toIsoDate()).toBe('2026-10-01');
    const { rows } = await pool.query(
      `SELECT to_char(period, 'YYYY-MM') AS period, free_used FROM monthly_usage
        WHERE user_id = $1 ORDER BY period`,
      [alice.userId],
    );
    expect(rows).toEqual([
      { period: '2026-09', free_used: 3 },
      { period: '2026-10', free_used: 1 },
    ]);
  });
});
