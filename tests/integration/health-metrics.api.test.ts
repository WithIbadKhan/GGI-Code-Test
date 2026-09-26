import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeIdentityProvider } from '../support/authKit.js';
import { SignedClient } from '../support/signedClient.js';
import { buildTestApp, createTestPool, HEALTH_TOKEN, insertBundle, resetData } from './helpers.js';

describe('Health check and metrics', () => {
  let pool: pg.Pool;
  let idp: FakeIdentityProvider;
  let app: Express;

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
  });

  describe('GET /health', () => {
    it('is not open: it requires the monitoring token', async () => {
      expect((await request(app).get('/health')).status).toBe(401);
      expect((await request(app).get('/health').set('X-Health-Token', 'wrong')).status).toBe(401);
    });

    it('reports the database as up', async () => {
      const res = await request(app).get('/health').set('X-Health-Token', HEALTH_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
    });

    it('returns 503 when the database is down', async () => {
      const broken = buildTestApp({
        pool,
        idp,
        checkDatabase: () => Promise.reject(new Error('connection refused')),
      });

      const res = await request(broken).get('/health').set('X-Health-Token', HEALTH_TOKEN);

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'degraded', checks: { database: 'down' } });
    });
  });

  describe('GET /api/v1/admin/metrics', () => {
    it('is admin-only', async () => {
      const user = await SignedClient.create(app, idp, { sub: 'auth0|alice' });

      const res = await user.get('/api/v1/admin/metrics');

      expect(res.status).toBe(403);
    });

    it('requires a signed request, even for admins', async () => {
      const token = await idp.issueToken({ sub: 'auth0|root', roles: ['admin'] });

      const res = await request(app)
        .get('/api/v1/admin/metrics')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it('reports usage and subscriptions for the current month', async () => {
      const alice = await SignedClient.create(app, idp, { sub: 'auth0|alice' });
      const bob = await SignedClient.create(app, idp, { sub: 'auth0|bob' });
      const admin = await SignedClient.create(app, idp, { sub: 'auth0|root', roles: ['admin'] });
      await alice.post('/api/v1/chat/messages', { question: 'one' });
      await alice.post('/api/v1/chat/messages', { question: 'two' });
      await bob.post('/api/v1/chat/messages', { question: 'three' });
      await alice.post('/api/v1/subscriptions', { tier: 'PRO', billingCycle: 'MONTHLY' });
      await insertBundle(pool, { userId: 'auth0|bob', maxMessages: 10, status: 'CANCELLED' });

      const res = await admin.get('/api/v1/admin/metrics');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        period: new Date().toISOString().slice(0, 7),
        usage: {
          messages: { completed: 3, failed: 0, inProgress: 0 },
          bySource: { free: 3, bundle: 0 },
          activeUsers: 2,
        },
        subscriptions: {
          byStatus: { ACTIVE: 1, INACTIVE: 0, CANCELLED: 1 },
          activeByTier: { BASIC: 0, PRO: 1, ENTERPRISE: 0 },
          autoRenewEnabled: 1,
        },
      });
      expect(res.body).not.toHaveProperty('payments');
      expect(res.body.usage.tokens.total).toBeGreaterThan(0);
    });
  });
});
