import type { Request, RequestHandler } from 'express';
import type { Actor, Role } from '../../domain/Actor.js';
import { AppError, ForbiddenError } from '../../domain/errors.js';
import type { AccessTokenVerifier } from '../../auth/JwtAccessTokenVerifier.js';

const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

/** Requires a valid access token and attaches the caller as `req.actor`. */
export function authenticate(verifier: AccessTokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    const match = BEARER.exec(req.headers.authorization ?? '');
    if (!match?.[1]) {
      throw new AppError('UNAUTHENTICATED', 'A Bearer access token is required.');
    }
    const verified = await verifier.verify(match[1]);
    req.actor = verified.actor;
    req.accessToken = { fingerprint: verified.fingerprint, expiresAt: verified.expiresAt };
    next();
  };
}

/** Returns the verified access token's details; throws if `authenticate` did not run. */
export function currentAccessToken(req: Request): { fingerprint: string; expiresAt: Date } {
  if (!req.accessToken) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
  }
  return req.accessToken;
}

/** Controller-level role check. The domain policies check again, independently. */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    const actor = currentActor(req);
    if (!actor.roles.some((role) => allowed.includes(role))) {
      throw new ForbiddenError();
    }
    next();
  };
}

/** Returns the authenticated caller; throws if the route was not protected. */
export function currentActor(req: Request): Actor {
  if (!req.actor) {
    throw new AppError('UNAUTHENTICATED', 'Authentication is required.');
  }
  return req.actor;
}
