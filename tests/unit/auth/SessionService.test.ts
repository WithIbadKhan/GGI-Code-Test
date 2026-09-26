import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientSession } from '../../../src/modules/auth/domain/entities/ClientSession.js';
import { InvalidSignatureError } from '../../../src/modules/auth/domain/errors.js';
import type { NonceStore, SessionRepository } from '../../../src/modules/auth/domain/ports.js';
import { SessionService } from '../../../src/modules/auth/domain/services/SessionService.js';
import { HmacSessionKeys } from '../../../src/modules/auth/infrastructure/HmacSessionKeys.js';
import { signRequest } from '../../../src/shared/security/requestSigning.js';
import type { Actor } from '../../../src/shared/domain/Actor.js';

const alice: Actor = { userId: 'alice', roles: ['user'] };
const token = { fingerprint: 'fp-alice-token', expiresAt: new Date('2026-09-26T13:00:00Z') };

class MemorySessions implements SessionRepository {
  readonly rows = new Map<string, ClientSession>();
  async insert(s: ClientSession) {
    this.rows.set(s.id, s);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
}

class MemoryNonces implements NonceStore {
  private readonly seen = new Set<string>();
  async remember(sessionId: string, nonce: string) {
    const key = `${sessionId}|${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

describe('SessionService', () => {
  let now: Date;
  let service: SessionService;

  beforeEach(() => {
    now = new Date('2026-09-26T12:00:00Z');
    service = new SessionService({
      sessions: new MemorySessions(),
      nonces: new MemoryNonces(),
      keys: new HmacSessionKeys('unit-test-secret-that-is-long-enough-123'),
      clock: { now: () => now },
      generateId: () => 'session-1',
      maxClockSkewSeconds: 120,
      maxSessionTtlSeconds: 3600,
    });
  });

  function signed(signingKey: string, overrides: { timestamp?: string; nonce?: string } = {}) {
    const request = {
      method: 'POST',
      url: '/api/v1/chat/messages',
      timestamp: overrides.timestamp ?? String(now.getTime() / 1000),
      nonce: overrides.nonce ?? 'nonce-0000000000000001',
      body: '{"question":"hi"}',
    };
    return { ...request, sessionId: 'session-1', signature: signRequest(signingKey, request) };
  }

  const reasonOf = (promise: Promise<unknown>) =>
    promise.then(
      () => 'accepted',
      (e: unknown) => (e instanceof InvalidSignatureError ? e.reason : String(e)),
    );

  it('caps the session at the token expiry', async () => {
    const { session } = await service.start(alice, token);

    expect(session.expiresAt).toEqual(token.expiresAt);
  });

  it('caps the session at the maximum lifetime for long-lived tokens', async () => {
    const { session } = await service.start(alice, {
      ...token,
      expiresAt: new Date('2026-09-27T12:00:00Z'),
    });

    expect(session.expiresAt).toEqual(new Date('2026-09-26T13:00:00Z'));
  });

  it('accepts a correctly signed request', async () => {
    const { signingKey } = await service.start(alice, token);

    await expect(
      service.verifySignedRequest(alice, token.fingerprint, signed(signingKey)),
    ).resolves.toMatchObject({
      id: 'session-1',
    });
  });

  it('rejects a replay of the same nonce', async () => {
    const { signingKey } = await service.start(alice, token);
    await service.verifySignedRequest(alice, token.fingerprint, signed(signingKey));

    expect(
      await reasonOf(service.verifySignedRequest(alice, token.fingerprint, signed(signingKey))),
    ).toBe('REPLAYED_NONCE');
  });

  it('rejects timestamps outside the allowed window', async () => {
    const { signingKey } = await service.start(alice, token);
    const old = String(now.getTime() / 1000 - 121);

    expect(
      await reasonOf(
        service.verifySignedRequest(
          alice,
          token.fingerprint,
          signed(signingKey, { timestamp: old }),
        ),
      ),
    ).toBe('STALE_TIMESTAMP');
  });

  it('rejects the session for another token or another user', async () => {
    const { signingKey } = await service.start(alice, token);
    const request = (nonce: string) => signed(signingKey, { nonce });

    expect(
      await reasonOf(
        service.verifySignedRequest(alice, 'other-token', request('n-a-000000000001')),
      ),
    ).toBe('INVALID_SESSION');
    expect(
      await reasonOf(
        service.verifySignedRequest(
          { userId: 'mallory', roles: ['user'] },
          token.fingerprint,
          request('n-b-000000000001'),
        ),
      ),
    ).toBe('INVALID_SESSION');
  });

  it('rejects requests once the session has expired', async () => {
    const { signingKey } = await service.start(alice, token);
    now = new Date('2026-09-26T13:00:01Z');

    expect(
      await reasonOf(service.verifySignedRequest(alice, token.fingerprint, signed(signingKey))),
    ).toBe('INVALID_SESSION');
  });

  it('rejects a signature made with a different key', async () => {
    await service.start(alice, token);
    const otherKey = new HmacSessionKeys('another-server-secret-that-is-long-enough').keyFor(
      'session-1',
    );

    expect(
      await reasonOf(service.verifySignedRequest(alice, token.fingerprint, signed(otherKey))),
    ).toBe('BAD_SIGNATURE');
  });

  it('does not burn the nonce when the signature is wrong', async () => {
    const { signingKey } = await service.start(alice, token);
    const forged = { ...signed(signingKey), signature: 'A'.repeat(43) };

    await reasonOf(service.verifySignedRequest(alice, token.fingerprint, forged));

    // The legitimate request with the same nonce still goes through.
    expect(
      await reasonOf(service.verifySignedRequest(alice, token.fingerprint, signed(signingKey))),
    ).toBe('accepted');
  });
});

describe('HmacSessionKeys', () => {
  it('derives a stable key per session and refuses a short secret', () => {
    const keys = new HmacSessionKeys('unit-test-secret-that-is-long-enough-123');

    expect(keys.keyFor('s1')).toBe(keys.keyFor('s1'));
    expect(keys.keyFor('s1')).not.toBe(keys.keyFor('s2'));
    expect(() => new HmacSessionKeys('too-short')).toThrow();
  });
});
