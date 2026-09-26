import type { Actor } from '../domain/Actor.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `authenticate` after the access token is verified. */
    actor?: Actor;
    /** Set by `authenticate`: identifies the exact token used, without storing it. */
    accessToken?: { fingerprint: string; expiresAt: Date };
    /** Raw request body bytes, kept by the JSON parser for signature checks. */
    rawBody?: Buffer;
  }
}
