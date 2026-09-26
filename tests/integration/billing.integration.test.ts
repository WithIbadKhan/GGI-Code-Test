import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScriptedPaymentGateway } from '../support/InMemorySubscriptionStore.js';
import { buildSubscriptionServices, createTestPool, insertBundle, resetData } from './helpers.js';

const DAY = 86_400_000;

describe('Billing job against real PostgreSQL', () => {
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

  /** A subscription whose billing cycle ended an hour ago. */
  const insertDue = (options: { autoRenew: boolean; usedMessages?: number }) =>
    insertBundle(pool, {
      userId: 'auth0|alice',
      maxMessages: 10,
      startDate: new Date(Date.now() - 31 * DAY),
      endDate: new Date(Date.now() - 3_600_000),
      ...options,
    });

  const load = async (id: string) =>
    (
      await pool.query<{
        status: string;
        used_messages: number;
        end_date: Date;
        renewal_date: Date | null;
      }>('SELECT status, used_messages, end_date, renewal_date FROM subscriptions WHERE id = $1', [
        id,
      ])
    ).rows[0];

  it('renews a due subscription: charges it, starts a new cycle, resets usage', async () => {
    const id = await insertDue({ autoRenew: true, usedMessages: 9 });
    const gateway = new ScriptedPaymentGateway();
    const { billingService } = buildSubscriptionServices(pool, { paymentGateway: gateway });

    const summary = await billingService.runRenewals();

    expect(summary).toMatchObject({ due: 1, renewed: 1 });
    expect(gateway.charges).toEqual([expect.objectContaining({ subscriptionId: id })]);
    const row = await load(id);
    expect(row?.status).toBe('ACTIVE');
    expect(row?.used_messages).toBe(0);
    expect(row?.end_date.getTime()).toBeGreaterThan(Date.now());
    expect(row?.renewal_date).toEqual(row?.end_date);
  });

  it('deactivates the subscription when the renewal payment fails', async () => {
    const id = await insertDue({ autoRenew: true });
    const { billingService } = buildSubscriptionServices(pool, { paymentFailureRate: 1 });

    const summary = await billingService.runRenewals();

    expect(summary.paymentFailed).toBe(1);
    expect((await load(id))?.status).toBe('INACTIVE');
  });

  it('lets a subscription without auto-renew lapse, without charging', async () => {
    const id = await insertDue({ autoRenew: false });
    const gateway = new ScriptedPaymentGateway();
    const { billingService } = buildSubscriptionServices(pool, { paymentGateway: gateway });

    await billingService.runRenewals();

    expect((await load(id))?.status).toBe('INACTIVE');
    expect(gateway.charges).toHaveLength(0);
  });

  it('never charges a subscription twice when several workers run at once', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => insertDue({ autoRenew: true })));
    // One gateway shared by all workers, so it sees every charge any of them makes.
    const gateway = new ScriptedPaymentGateway();
    const workers = Array.from(
      { length: 3 },
      () => buildSubscriptionServices(pool, { paymentGateway: gateway }).billingService,
    );

    const summaries = await Promise.all(workers.map((w) => w.runRenewals()));

    expect(summaries.reduce((sum, s) => sum + s.renewed, 0)).toBe(5);
    for (const id of ids) {
      expect(gateway.charges.filter((c) => c.subscriptionId === id)).toHaveLength(1);
    }
  });

  it('ignores cancelled subscriptions', async () => {
    const id = await insertBundle(pool, {
      userId: 'auth0|alice',
      maxMessages: 10,
      status: 'CANCELLED',
      autoRenew: false,
      startDate: new Date(Date.now() - 31 * DAY),
      endDate: new Date(Date.now() - DAY),
    });
    const { billingService } = buildSubscriptionServices(pool);

    const summary = await billingService.runRenewals();

    expect(summary.due).toBe(0);
    expect((await load(id))?.status).toBe('CANCELLED');
  });
});
