import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeIdentityProvider } from '../support/authKit.js';
import { SignedClient } from '../support/signedClient.js';
import { buildSubscriptionServices, buildTestApp, createTestPool, resetData } from './helpers.js';

const SUBS = '/api/v1/subscriptions';

describe('Subscriptions API (HTTP, real auth verification, real PostgreSQL)', () => {
  let pool: pg.Pool;
  let idp: FakeIdentityProvider;
  let app: Express;
  let alice: SignedClient;
  let bob: SignedClient;
  let admin: SignedClient;

  beforeAll(async () => {
    pool = createTestPool();
    idp = await FakeIdentityProvider.create();
    app = buildTestApp({ pool, idp });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await resetData(pool);
    alice = await SignedClient.create(app, idp, { sub: 'auth0|alice' });
    bob = await SignedClient.create(app, idp, { sub: 'auth0|bob' });
    admin = await SignedClient.create(app, idp, { sub: 'auth0|root', roles: ['admin'] });
  });

  const buy = (client: SignedClient, body: object = { tier: 'BASIC', billingCycle: 'MONTHLY' }) =>
    client.post(SUBS, body);

  it('requires authentication on every route', async () => {
    expect((await request(app).get(SUBS)).status).toBe(401);
    expect((await request(app).post(SUBS).send({})).status).toBe(401);
  });

  it('creates a subscription with all required fields', async () => {
    const res = await buy(alice, { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: false });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`${SUBS}/${res.body.id as string}`);
    expect(res.body).toMatchObject({
      userId: 'auth0|alice',
      tier: 'PRO',
      billingCycle: 'MONTHLY',
      status: 'ACTIVE',
      active: true,
      autoRenew: false,
      maxMessages: 100,
      usedMessages: 0,
      price: { amountCents: 2999, currency: 'USD' },
      renewalDate: null,
    });
    expect(Date.parse(res.body.endDate as string)).toBeGreaterThan(
      Date.parse(res.body.startDate as string),
    );
  });

  it('rejects client-controlled price, limits or owner (mass assignment)', async () => {
    for (const extra of [{ price: 0 }, { maxMessages: 1_000_000 }, { userId: 'auth0|bob' }]) {
      const res = await buy(alice, { tier: 'BASIC', billingCycle: 'MONTHLY', ...extra });
      expect(res.status).toBe(400);
    }
    expect((await pool.query('SELECT 1 FROM subscriptions')).rowCount).toBe(0);
  });

  it('rejects an unknown tier or billing cycle', async () => {
    expect((await buy(alice, { tier: 'GOLD', billingCycle: 'MONTHLY' })).status).toBe(400);
    expect((await buy(alice, { tier: 'BASIC', billingCycle: 'WEEKLY' })).status).toBe(400);
  });

  it('returns a typed 402 when the payment is declined, and marks the subscription inactive', async () => {
    const declining = buildTestApp({
      pool,
      idp,
      subscriptionService: buildSubscriptionServices(pool, { paymentFailureRate: 1 })
        .subscriptionService,
    });

    const client = await SignedClient.create(declining, idp, { sub: 'auth0|alice' });

    const res = await client.post(SUBS, { tier: 'BASIC', billingCycle: 'MONTHLY' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PAYMENT_FAILED');
    const { rows } = await pool.query('SELECT status FROM subscriptions');
    expect(rows).toEqual([{ status: 'INACTIVE' }]);
  });

  it('toggles auto-renew', async () => {
    const { body } = await buy(alice);

    const res = await alice.patch(`${SUBS}/${body.id as string}`, { autoRenew: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ autoRenew: false, renewalDate: null });
  });

  it('cancels: ends the cycle now, stops renewals, keeps the history', async () => {
    const { body } = await buy(alice);
    const id = body.id as string;
    // Use the bundle once so there is usage history to preserve.
    for (let i = 0; i < 4; i++) {
      await alice.post('/api/v1/chat/messages', { question: `q${String(i)}` });
    }

    const res = await alice.post(`${SUBS}/${id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      active: false,
      autoRenew: false,
      renewalDate: null,
      usedMessages: 1,
    });
    expect(res.body.cancelledAt).toEqual(expect.any(String));

    const history = await pool.query(
      'SELECT count(*)::int AS n FROM chat_messages WHERE subscription_id = $1',
      [id],
    );
    expect(history.rows[0].n).toBe(1);

    // The cancelled bundle is no longer usable for chat.
    const chat = await alice.post('/api/v1/chat/messages', { question: 'after cancel' });
    expect(chat.status).toBe(402);
  });

  it('rejects cancelling twice with a typed 409', async () => {
    const { body } = await buy(alice);
    await alice.post(`${SUBS}/${body.id as string}/cancel`);

    const res = await alice.post(`${SUBS}/${body.id as string}/cancel`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  describe('authorisation', () => {
    it("hides another user's subscription (404) and blocks changes to it", async () => {
      const { body } = await buy(alice);
      const id = body.id as string;

      expect((await bob.get(`${SUBS}/${id}`)).status).toBe(404);
      expect((await bob.post(`${SUBS}/${id}/cancel`)).status).toBe(404);
      expect((await bob.patch(`${SUBS}/${id}`, { autoRenew: false })).status).toBe(404);
      expect((await alice.get(`${SUBS}/${id}`)).body.status).toBe('ACTIVE');
    });

    it("lets an admin see any user's subscriptions", async () => {
      const { body } = await buy(alice);

      expect((await admin.get(`${SUBS}/${body.id as string}`)).status).toBe(200);
      const list = await admin.get(`${SUBS}?userId=auth0|alice`);
      expect(list.body.data).toHaveLength(1);
    });

    it("forbids users from listing someone else's subscriptions", async () => {
      expect((await bob.get(`${SUBS}?userId=auth0|alice`)).status).toBe(403);
    });
  });

  it('has its own rate limit, separate from chat', async () => {
    const limited = buildTestApp({ pool, idp, rateLimit: { subscriptionsPerUser: 2 } });
    const client = await SignedClient.create(limited, idp, { sub: 'auth0|alice' });
    const get = (path: string) => client.get(path);

    expect((await get(SUBS)).status).toBe(200);
    expect((await get(SUBS)).status).toBe(200);
    expect((await get(SUBS)).status).toBe(429);
    // Chat has separate counters, so it is still available.
    expect((await get('/api/v1/chat/usage')).status).toBe(200);
  });
});
