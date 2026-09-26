import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeIdentityProvider, TEST_AUDIENCE } from '../support/authKit.js';
import { signRequest } from '../../src/shared/security/requestSigning.js';
import { SignedClient } from '../support/signedClient.js';
import { buildTestApp, createTestPool, resetData } from './helpers.js';

const SESSION = '/api/v1/auth/session';
const USAGE = '/api/v1/chat/usage';

describe('Authentication and request signing', () => {
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

  const openSession = (token: string) =>
    request(app).post(SESSION).set('Authorization', `Bearer ${token}`);

  describe('access token verification (at the only token-only endpoint)', () => {
    it('issues a session and signing key for a valid token, never cached', async () => {
      const res = await openSession(await idp.issueToken({ sub: 'auth0|alice' }));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        sessionId: expect.any(String),
        signingKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: expect.any(String),
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('never lets a session outlive its access token', async () => {
      const res = await openSession(await idp.issueToken({ sub: 'auth0|alice', expiresIn: 120 }));

      const lifetimeMs = Date.parse(res.body.expiresAt as string) - Date.now();
      expect(lifetimeMs).toBeLessThanOrEqual(120_000);
    });

    it('rejects a missing or malformed token', async () => {
      expect((await request(app).post(SESSION)).status).toBe(401);
      expect((await openSession('not-a-jwt')).status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const res = await openSession(await idp.issueToken({ sub: 'auth0|alice', expiresIn: -60 }));

      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/expired/);
    });

    it('rejects a token from the wrong issuer', async () => {
      const token = await idp.issueToken({ sub: 'x', issuer: 'https://evil.example/' });
      expect((await openSession(token)).status).toBe(401);
    });

    it('rejects a token meant for another API (wrong audience)', async () => {
      const token = await idp.issueToken({ sub: 'x', audience: `${TEST_AUDIENCE}/other` });
      expect((await openSession(token)).status).toBe(401);
    });

    it('rejects a token signed by a key the identity provider never published', async () => {
      const attacker = await FakeIdentityProvider.create('test-key-1');
      const forged = await attacker.issueToken({ sub: 'auth0|alice', roles: ['admin'] });
      expect((await openSession(forged)).status).toBe(401);
    });

    it('rejects a token without a subject', async () => {
      expect((await openSession(await idp.issueToken({}))).status).toBe(401);
    });
  });

  describe('signed requests', () => {
    let alice: SignedClient;
    beforeEach(async () => {
      alice = await SignedClient.create(app, idp, { sub: 'auth0|alice' });
    });

    const expectRejected = async (res: request.Response, reason?: string) => {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
      if (reason) expect(res.body.error.details.reason).toBe(reason);
    };

    it('accepts a correctly signed request', async () => {
      expect((await alice.get(USAGE)).status).toBe(200);
    });

    it('rejects a valid token with no signature at all', async () => {
      const res = await request(app).get(USAGE).set('Authorization', `Bearer ${alice.accessToken}`);
      await expectRejected(res);
    });

    it('rejects a replayed request (same nonce twice)', async () => {
      const nonce = SignedClient.newNonce();

      expect((await alice.get(USAGE, { nonce })).status).toBe(200);
      await expectRejected(await alice.get(USAGE, { nonce }), 'REPLAYED_NONCE');
    });

    it('rejects a stale or future timestamp', async () => {
      const now = Math.floor(Date.now() / 1000);

      await expectRejected(
        await alice.get(USAGE, { timestamp: String(now - 600) }),
        'STALE_TIMESTAMP',
      );
      await expectRejected(
        await alice.get(USAGE, { timestamp: String(now + 600) }),
        'STALE_TIMESTAMP',
      );
    });

    it('rejects a tampered body', async () => {
      const res = await alice.post(
        '/api/v1/chat/messages',
        { question: 'what the attacker sends' },
        { signedBody: JSON.stringify({ question: 'what the client signed' }) },
      );
      await expectRejected(res, 'BAD_SIGNATURE');
      expect((await pool.query('SELECT 1 FROM chat_messages')).rowCount).toBe(0);
    });

    it('rejects a request whose URL was changed after signing', async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = SignedClient.newNonce();
      const signature = signRequest(alice.signingKey, {
        method: 'GET',
        url: '/api/v1/chat/messages?limit=1',
        timestamp,
        nonce,
        body: '',
      });

      const res = await alice.get('/api/v1/chat/messages?limit=100', {
        timestamp,
        nonce,
        signature,
      });
      await expectRejected(res, 'BAD_SIGNATURE');
    });

    it('rejects a stolen access token used with a session it was not bound to', async () => {
      const bob = await SignedClient.create(app, idp, { sub: 'auth0|bob' });

      // Bob's key and session, but Alice's token (e.g. an attacker mixing credentials).
      const res = await request(app)
        .get(USAGE)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('X-Session-Id', bob.sessionId)
        .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
        .set('X-Nonce', SignedClient.newNonce())
        .set('X-Signature', 'A'.repeat(43));
      await expectRejected(res, 'INVALID_SESSION');
    });

    it('rejects the session when a different token of the same user is presented', async () => {
      const otherToken = await idp.issueToken({ sub: 'auth0|alice', expiresIn: 200 });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = SignedClient.newNonce();

      const res = await request(app)
        .get(USAGE)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('X-Session-Id', alice.sessionId)
        .set('X-Timestamp', timestamp)
        .set('X-Nonce', nonce)
        .set(
          'X-Signature',
          signRequest(alice.signingKey, { method: 'GET', url: USAGE, timestamp, nonce, body: '' }),
        );
      await expectRejected(res, 'INVALID_SESSION');
    });

    it('rejects a signature made with the wrong key', async () => {
      const bob = await SignedClient.create(app, idp, { sub: 'auth0|bob' });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = SignedClient.newNonce();

      const res = await alice.get(USAGE, {
        timestamp,
        nonce,
        signature: signRequest(bob.signingKey, {
          method: 'GET',
          url: USAGE,
          timestamp,
          nonce,
          body: '',
        }),
      });
      await expectRejected(res, 'BAD_SIGNATURE');
    });
  });

  it('has a strict rate limit on authentication endpoints', async () => {
    const limited = buildTestApp({ pool, idp, rateLimit: { authPerUser: 2 } });
    const token = await idp.issueToken({ sub: 'auth0|alice' });
    const open = () => request(limited).post(SESSION).set('Authorization', `Bearer ${token}`);

    expect((await open()).status).toBe(201);
    expect((await open()).status).toBe(201);
    const third = await open();

    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});
