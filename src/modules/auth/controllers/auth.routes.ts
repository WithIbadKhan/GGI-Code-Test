import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../../shared/http/middleware/authenticate.js';
import {
  perIpRateLimit,
  perUserRateLimit,
  type RateLimitRule,
} from '../../../shared/http/middleware/rateLimit.js';
import type { AuthController } from './AuthController.js';

export interface AuthRouterOptions {
  controller: AuthController;
  authenticate: RequestHandler;
  ipLimit: RateLimitRule;
  userLimit: RateLimitRule;
}

/**
 * Login itself happens at the external identity provider. This route opens the
 * signed session that sits on top of the access token, and has the strictest
 * rate limits in the API.
 */
export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();

  router.use(
    perIpRateLimit(options.ipLimit),
    options.authenticate,
    perUserRateLimit(options.userLimit),
    requireRole('user', 'admin'),
  );

  router.post('/session', options.controller.createSession);

  return router;
}
