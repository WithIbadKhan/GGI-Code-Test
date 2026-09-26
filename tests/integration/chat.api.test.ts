import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeIdentityProvider } from '../support/authKit.js';
import { SignedClient } from '../support/signedClient.js';
import {
  ALLOWED_ORIGIN,
  buildChatService,
  buildTestApp,
  createTestPool,
  fastMockAi,
  insertBundle,
  resetData,
} from './helpers.js';

const CHAT = '/api/v1/chat/messages';

describe('Chat API (HTTP, signed requests, real PostgreSQL)', () => {
  let pool: pg.Pool;
  let idp: FakeIdentityProvider;
  let app: Express;
  let alice: SignedClient;

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
  });

  const ask = (client: SignedClient, body: unknown = { question: 'What is DDD?' }) =>
    client.post(CHAT, body);

  it('rejects a request without a token', async () => {
    const res = await request(app).post(CHAT).send({ question: 'hi' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.headers['www-authenticate']).toContain('Bearer');
  });

  it('rejects a valid access token on its own, without a request signature', async () => {
    const res = await request(app)
      .post(CHAT)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ question: 'hi' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  describe('asking questions', () => {
    it('answers with a mocked AI response and stores question, answer, tokens and metadata', async () => {
      const res = await ask(alice).set('X-Request-Id', 'test-request-123');

      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`${CHAT}/${res.body.id as string}`);
      expect(res.body).toMatchObject({
        question: 'What is DDD?',
        status: 'COMPLETED',
        quota: { source: 'FREE', subscriptionId: null },
        provider: 'openai-mock',
      });
      expect(res.body.tokenUsage.total).toBeGreaterThan(0);

      const { rows } = await pool.query(
        'SELECT user_id, question, answer, total_tokens, request_id FROM chat_messages',
      );
      expect(rows).toEqual([
        expect.objectContaining({
          user_id: 'auth0|alice',
          question: 'What is DDD?',
          request_id: 'test-request-123',
        }),
      ]);
      expect(rows[0].answer).toBeTruthy();
      expect(rows[0].total_tokens).toBeGreaterThan(0);
    });

    it('returns a typed 402 once the free quota is used up', async () => {
      for (let i = 0; i < 3; i++) expect((await ask(alice)).status).toBe(201);

      const res = await ask(alice);

      expect(res.status).toBe(402);
      expect(res.body.error).toMatchObject({
        code: 'QUOTA_EXHAUSTED',
        details: { reason: 'SUBSCRIPTION_REQUIRED', freeLimit: 3, freeUsed: 3 },
      });
      expect(res.body.error.requestId).toEqual(expect.any(String));
    });

    it('continues on a subscription bundle after the free quota', async () => {
      const bundleId = await insertBundle(pool, { userId: 'auth0|alice', maxMessages: 10 });
      for (let i = 0; i < 3; i++) await ask(alice);

      const res = await ask(alice);

      expect(res.status).toBe(201);
      expect(res.body.quota).toMatchObject({ source: 'BUNDLE', subscriptionId: bundleId });
    });

    it('reports usage for the current month', async () => {
      await ask(alice);

      const res = await alice.get('/api/v1/chat/usage');

      expect(res.status).toBe(200);
      expect(res.body.free).toMatchObject({ limit: 3, used: 1, remaining: 2 });
    });

    it('returns 503 with a typed error and refunds quota when the AI fails', async () => {
      const failingApp = buildTestApp({
        pool,
        idp,
        chatService: buildChatService(pool, { ai: fastMockAi({ failureRate: 1 }) }),
      });
      const client = await SignedClient.create(failingApp, idp, { sub: 'auth0|alice' });

      const res = await client.post(CHAT, { question: 'hello' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect((await alice.get('/api/v1/chat/usage')).body.free.used).toBe(0);
    });
  });

  describe('input validation and sanitisation', () => {
    it('rejects unknown fields (mass assignment)', async () => {
      const res = await ask(alice, { question: 'hi', userId: 'someone-else', answer: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await pool.query('SELECT 1 FROM chat_messages')).toHaveProperty('rowCount', 0);
    });

    it.each<[unknown, string]>([
      [{}, 'missing question'],
      [{ question: '' }, 'empty question'],
      [{ question: 42 }, 'wrong type'],
      [{ question: 'x'.repeat(2001) }, 'too long'],
      [{ question: '<b></b>' }, 'markup only'],
    ])('rejects %o (%s)', async (body) => {
      const res = await ask(alice, body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('strips HTML/script from the question before storing it', async () => {
      const res = await ask(alice, { question: 'Hello <script>alert("x")</script><b>world</b>' });

      expect(res.status).toBe(201);
      expect(res.body.question).toBe('Hello world');
    });

    it('treats SQL-looking input as plain data', async () => {
      const payload = "'; DROP TABLE chat_messages; --";

      const res = await ask(alice, { question: payload });

      expect(res.status).toBe(201);
      expect(res.body.question).toBe(payload);
      expect((await pool.query('SELECT count(*)::int AS n FROM chat_messages')).rows[0].n).toBe(1);
    });

    it('rejects an unknown query parameter', async () => {
      expect((await alice.get(`${CHAT}?limit=5&isAdmin=true`)).status).toBe(400);
    });
  });

  describe('authorisation', () => {
    it("hides another user's message (404), while an admin can read it", async () => {
      const created = await ask(alice);
      const bob = await SignedClient.create(app, idp, { sub: 'auth0|bob' });
      const admin = await SignedClient.create(app, idp, { sub: 'auth0|root', roles: ['admin'] });

      expect((await bob.get(`${CHAT}/${created.body.id as string}`)).status).toBe(404);
      expect((await admin.get(`${CHAT}/${created.body.id as string}`)).status).toBe(200);
    });

    it("forbids a user from listing another user's messages", async () => {
      const res = await alice.get(`${CHAT}?userId=auth0|bob`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it("lists only the caller's own messages", async () => {
      await ask(alice);
      await ask(await SignedClient.create(app, idp, { sub: 'auth0|bob' }));

      const res = await alice.get(CHAT);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toEqual({ limit: 20, offset: 0, count: 1 });
    });
  });

  describe('security middleware', () => {
    it('sets secure HTTP headers and hides the framework', async () => {
      const res = await request(app).get(CHAT);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows CORS only for configured origins', async () => {
      const allowed = await request(app).options(CHAT).set('Origin', ALLOWED_ORIGIN);
      const denied = await request(app).options(CHAT).set('Origin', 'https://evil.example');

      expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(allowed.headers['access-control-allow-headers']).toContain('X-Signature');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects a body that is not declared as JSON (415)', async () => {
      const res = await request(app)
        .post(CHAT)
        .set('Content-Type', 'text/plain')
        .send('question=hi');

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects malformed JSON with a structured error', async () => {
      const res = await request(app)
        .post(CHAT)
        .set('Content-Type', 'application/json')
        .send('{"question": ');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });

    it('rejects bodies over the size limit (413)', async () => {
      const res = await ask(alice, { question: 'x'.repeat(20_000) });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('returns a structured 404 for unknown routes', async () => {
      const res = await request(app).get('/api/v1/nope');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('answers with a structured 503 when a request exceeds the global timeout', async () => {
      const slowApp = buildTestApp({
        pool,
        idp,
        requestTimeoutMs: 300,
        chatService: buildChatService(pool, { ai: fastMockAi({ latencyMs: 800 }) }),
      });
      const client = await SignedClient.create(slowApp, idp, { sub: 'auth0|alice' });

      const res = await client.post(CHAT, { question: 'slow' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
      // The handler keeps running in the background; let it finish before the next test.
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
  });

  describe('rate limiting', () => {
    it('limits each user, independently of other users', async () => {
      const limited = buildTestApp({ pool, idp, rateLimit: { chatPerUser: 2 } });
      const a = await SignedClient.create(limited, idp, { sub: 'auth0|alice' });
      const b = await SignedClient.create(limited, idp, { sub: 'auth0|bob' });

      expect((await a.get(CHAT)).status).toBe(200);
      expect((await a.get(CHAT)).status).toBe(200);
      const third = await a.get(CHAT);

      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('RATE_LIMITED');
      expect(third.headers.ratelimit).toBeDefined();
      expect((await b.get(CHAT)).status).toBe(200);
    });

    it('limits each IP address, even before authentication', async () => {
      const limited = buildTestApp({ pool, idp, rateLimit: { chatPerIp: 2 } });

      await request(limited).get(CHAT);
      await request(limited).get(CHAT);
      const third = await request(limited).get(CHAT);

      expect(third.status).toBe(429);
      expect(third.body.error.message).toMatch(/IP address/);
    });
  });
});
