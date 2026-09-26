import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request-signing protocol shared by the server and its clients.
 *
 * Every signed request carries four headers:
 *   X-Session-Id  session created with POST /api/v1/auth/session
 *   X-Timestamp   Unix time in seconds
 *   X-Nonce       random, single-use value (16 to 64 chars of [A-Za-z0-9_-])
 *   X-Signature   base64url HMAC-SHA256 of the canonical request below,
 *                 using the session's signing key
 *
 * Canonical request (lines joined with "\n"):
 *   METHOD
 *   path and query exactly as sent, e.g. /api/v1/chat/messages?limit=5
 *   timestamp
 *   nonce
 *   hex SHA-256 of the raw body (of the empty string when there is no body)
 */
export const SIGNATURE_HEADERS = {
  sessionId: 'x-session-id',
  timestamp: 'x-timestamp',
  nonce: 'x-nonce',
  signature: 'x-signature',
} as const;

export interface SignableRequest {
  method: string;
  url: string;
  timestamp: string;
  nonce: string;
  body: string | Buffer;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function canonicalRequest(request: SignableRequest): string {
  return [
    request.method.toUpperCase(),
    request.url,
    request.timestamp,
    request.nonce,
    sha256Hex(request.body),
  ].join('\n');
}

/** `signingKey` is the base64url key returned when the session was created. */
export function signRequest(signingKey: string, request: SignableRequest): string {
  return createHmac('sha256', Buffer.from(signingKey, 'base64url'))
    .update(canonicalRequest(request))
    .digest('base64url');
}

/** Constant-time comparison, so response timing reveals nothing about the expected value. */
export function signatureMatches(
  signingKey: string,
  request: SignableRequest,
  signature: string,
): boolean {
  const expected = Buffer.from(signRequest(signingKey, request));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Stable, non-reversible identifier of an access token. The raw token is never stored. */
export function tokenFingerprint(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('base64url');
}
