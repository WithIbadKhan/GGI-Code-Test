import type { Actor } from '../../../../shared/domain/Actor.js';
import type { Clock } from '../../../../shared/domain/Clock.js';
import { ClientSession } from '../entities/ClientSession.js';
import { InvalidSignatureError } from '../errors.js';
import type { NonceStore, SessionKeys, SessionRepository, SignedRequestData } from '../ports.js';

export interface SessionServiceDependencies {
  sessions: SessionRepository;
  nonces: NonceStore;
  keys: SessionKeys;
  clock: Clock;
  generateId: () => string;
  /** How far a request timestamp may be from the server clock. */
  maxClockSkewSeconds: number;
  /** Upper bound on session lifetime, even if the access token lives longer. */
  maxSessionTtlSeconds: number;
}

export interface StartedSession {
  session: ClientSession;
  /** Returned to the client once; the server can re-derive it but never stores it. */
  signingKey: string;
}

export class SessionService {
  constructor(private readonly deps: SessionServiceDependencies) {}

  /** Creates a session bound to the caller's current access token. */
  async start(
    actor: Actor,
    token: { fingerprint: string; expiresAt: Date },
  ): Promise<StartedSession> {
    const now = this.deps.clock.now();
    const maxExpiry = new Date(now.getTime() + this.deps.maxSessionTtlSeconds * 1000);

    const session = ClientSession.start({
      id: this.deps.generateId(),
      userId: actor.userId,
      tokenFingerprint: token.fingerprint,
      now,
      expiresAt: token.expiresAt < maxExpiry ? token.expiresAt : maxExpiry,
    });
    await this.deps.sessions.insert(session);

    return { session, signingKey: this.deps.keys.keyFor(session.id) };
  }

  /**
   * Checks, in this order: timestamp freshness, session validity and binding,
   * signature, and finally nonce uniqueness. The nonce is only recorded after
   * the signature is proven, so nobody can burn another client's nonces.
   */
  async verifySignedRequest(
    actor: Actor,
    tokenFingerprint: string,
    request: SignedRequestData & { sessionId: string; signature: string },
  ): Promise<ClientSession> {
    const now = this.deps.clock.now();

    const skewSeconds = Math.abs(now.getTime() / 1000 - Number(request.timestamp));
    if (skewSeconds > this.deps.maxClockSkewSeconds) {
      throw new InvalidSignatureError('STALE_TIMESTAMP');
    }

    const session = await this.deps.sessions.findById(request.sessionId);
    if (!session?.isUsableBy(actor.userId, tokenFingerprint, now)) {
      throw new InvalidSignatureError('INVALID_SESSION');
    }

    const key = this.deps.keys.keyFor(session.id);
    if (!this.deps.keys.signatureMatches(key, request, request.signature)) {
      throw new InvalidSignatureError('BAD_SIGNATURE');
    }

    if (!(await this.deps.nonces.remember(session.id, request.nonce, now))) {
      throw new InvalidSignatureError('REPLAYED_NONCE');
    }

    return session;
  }
}
