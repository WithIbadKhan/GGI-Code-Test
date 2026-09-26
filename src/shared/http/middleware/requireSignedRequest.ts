import type { RequestHandler } from 'express';
import type { Actor } from '../../domain/Actor.js';
import { AppError } from '../../domain/errors.js';
import { SIGNATURE_HEADERS } from '../../security/requestSigning.js';
import { currentAccessToken, currentActor } from './authenticate.js';

interface SignedRequest {
  sessionId: string;
  timestamp: string;
  nonce: string;
  signature: string;
  method: string;
  url: string;
  body: Buffer | string;
}

/** Implemented by the auth module's SessionService. */
export interface SignedRequestVerifier {
  verifySignedRequest(
    actor: Actor,
    tokenFingerprint: string,
    request: SignedRequest,
  ): Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{1,12}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/; // base64url of a 32-byte HMAC-SHA256

/**
 * Second factor on top of the access token: the request must be signed with
 * the key of a session bound to that same token, and carry a fresh timestamp
 * and a nonce never used before. A stolen token alone is therefore not enough,
 * and a captured request cannot be replayed or modified.
 *
 * Must run after `authenticate`.
 */
export function requireSignedRequest(verifier: SignedRequestVerifier): RequestHandler {
  return async (req, _res, next) => {
    const header = (name: string): string => {
      const value = req.headers[name];
      return typeof value === 'string' ? value : '';
    };
    const sessionId = header(SIGNATURE_HEADERS.sessionId);
    const timestamp = header(SIGNATURE_HEADERS.timestamp);
    const nonce = header(SIGNATURE_HEADERS.nonce);
    const signature = header(SIGNATURE_HEADERS.signature);

    if (
      !UUID.test(sessionId) ||
      !TIMESTAMP.test(timestamp) ||
      !NONCE.test(nonce) ||
      !SIGNATURE.test(signature)
    ) {
      throw new AppError(
        'INVALID_SIGNATURE',
        'This endpoint requires a signed request: X-Session-Id, X-Timestamp, X-Nonce and X-Signature headers.',
      );
    }

    await verifier.verifySignedRequest(currentActor(req), currentAccessToken(req).fingerprint, {
      sessionId,
      timestamp,
      nonce,
      signature,
      method: req.method,
      url: req.originalUrl,
      body: req.rawBody ?? '',
    });
    next();
  };
}
