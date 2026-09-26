import type { ClientSession } from './entities/ClientSession.js';

export interface SessionRepository {
  insert(session: ClientSession): Promise<void>;
  findById(id: string): Promise<ClientSession | null>;
}

export interface NonceStore {
  /**
   * Records that `nonce` was used by the session. Returns false if it had
   * already been used, which means the request is a replay. Must be atomic.
   */
  remember(sessionId: string, nonce: string, now: Date): Promise<boolean>;
}

export interface SignedRequestData {
  method: string;
  url: string;
  timestamp: string;
  nonce: string;
  body: Buffer | string;
}

/** Cryptography behind request signing, kept out of the domain. */
export interface SessionKeys {
  /** The signing key for a session, derived from a server-side secret (never stored). */
  keyFor(sessionId: string): string;
  signatureMatches(signingKey: string, request: SignedRequestData, signature: string): boolean;
}
