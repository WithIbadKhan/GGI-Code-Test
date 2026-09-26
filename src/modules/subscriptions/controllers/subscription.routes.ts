import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../../shared/http/middleware/authenticate.js';
import {
  perIpRateLimit,
  perUserRateLimit,
  type RateLimitRule,
} from '../../../shared/http/middleware/rateLimit.js';
import type { SubscriptionController } from './SubscriptionController.js';

export interface SubscriptionRouterOptions {
  controller: SubscriptionController;
  authenticate: RequestHandler;
  requireSignature: RequestHandler;
  ipLimit: RateLimitRule;
  userLimit: RateLimitRule;
}

/**
 * Same protection chain as chat, with its own rate-limit counters:
 *   per-IP limit, access token, per-user limit, request signature, role, handler
 */
export function createSubscriptionRouter(options: SubscriptionRouterOptions): Router {
  const router = Router();
  const c = options.controller;

  router.use(
    perIpRateLimit(options.ipLimit),
    options.authenticate,
    perUserRateLimit(options.userLimit),
    options.requireSignature,
    requireRole('user', 'admin'),
  );

  router.post('/', c.purchase);
  router.get('/', c.list);
  router.get('/:id', c.getById);
  router.patch('/:id', c.update);
  router.post('/:id/cancel', c.cancel);

  return router;
}
