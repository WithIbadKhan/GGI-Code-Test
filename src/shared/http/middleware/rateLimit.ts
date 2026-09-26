import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../../domain/errors.js';

export interface RateLimitRule {
  /** Distinguishes counters, e.g. "chat" vs "subscriptions", so each route group has its own limits. */
  name: string;
  windowMs: number;
  limit: number;
}

/**
 * Per-IP limit. Runs *before* authentication so floods of unauthenticated
 * requests are rejected cheaply, before any token verification.
 */
export function perIpRateLimit(rule: RateLimitRule): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${rule.name}:ip:${ipKeyGenerator(req.ip ?? 'unknown')}`,
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests from this IP address.'));
    },
  });
}

/**
 * Per-user limit. Runs *after* authentication, keyed on the verified subject, so
 * a single account cannot get around it by switching IP address.
 *
 * Counters are kept in memory, which is correct for one instance. With several
 * instances, pass a shared store (e.g. Redis) through the `store` option.
 */
export function perUserRateLimit(rule: RateLimitRule): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${rule.name}:user:${req.actor?.userId ?? 'anonymous'}`,
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests for this account. Slow down.'));
    },
  });
}
