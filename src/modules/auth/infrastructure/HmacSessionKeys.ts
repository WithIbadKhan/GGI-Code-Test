import { createHmac } from 'node:crypto';
import { signatureMatches } from '../../../shared/security/requestSigning.js';
import type { SessionKeys, SignedRequestData } from '../domain/ports.js';

/**
 * Derives each session's signing key as HMAC-SHA256(serverSecret, sessionId).
 * Nothing secret is stored in the database, so leaking the sessions table does
 * not let anyone sign requests. Rotating the server secret invalidates every
 * existing session at once.
 */
export class HmacSessionKeys implements SessionKeys {
  constructor(private readonly serverSecret: string) {
    if (serverSecret.length < 32) {
      throw new Error('The session signing secret must be at least 32 characters.');
    }
  }

  keyFor(sessionId: string): string {
    return createHmac('sha256', this.serverSecret)
      .update(`client-session:${sessionId}`)
      .digest('base64url');
  }

  signatureMatches(signingKey: string, request: SignedRequestData, signature: string): boolean {
    return signatureMatches(signingKey, request, signature);
  }
}
