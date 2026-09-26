import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../../shared/http/middleware/authenticate.js';
import {
  perIpRateLimit,
  perUserRateLimit,
  type RateLimitRule,
} from '../../../shared/http/middleware/rateLimit.js';
import type { ChatController } from './ChatController.js';

export interface ChatRouterOptions {
  controller: ChatController;
  authenticate: RequestHandler;
  requireSignature: RequestHandler;
  ipLimit: RateLimitRule;
  userLimit: RateLimitRule;
}

/**
 * Every chat route passes through the same chain, in this order:
 *   per-IP limit, access token, per-user limit, request signature, role, handler
 * There are no public chat routes.
 */
export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();

  router.use(
    perIpRateLimit(options.ipLimit),
    options.authenticate,
    perUserRateLimit(options.userLimit),
    options.requireSignature,
    requireRole('user', 'admin'),
  );

  router.post('/messages', options.controller.ask);
  router.get('/messages', options.controller.list);
  router.get('/messages/:id', options.controller.getById);
  router.get('/usage', options.controller.usage);

  return router;
}
