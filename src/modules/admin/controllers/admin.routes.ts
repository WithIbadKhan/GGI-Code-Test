import { Router, type Request, type RequestHandler, type Response } from 'express';
import { currentActor, requireRole } from '../../../shared/http/middleware/authenticate.js';
import {
  perIpRateLimit,
  perUserRateLimit,
  type RateLimitRule,
} from '../../../shared/http/middleware/rateLimit.js';
import type { MetricsService } from '../domain/services/MetricsService.js';

export interface AdminRouterOptions {
  metrics: MetricsService;
  authenticate: RequestHandler;
  requireSignature: RequestHandler;
  ipLimit: RateLimitRule;
  userLimit: RateLimitRule;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();

  router.use(
    perIpRateLimit(options.ipLimit),
    options.authenticate,
    perUserRateLimit(options.userLimit),
    options.requireSignature,
    requireRole('admin'),
  );

  /** GET /api/v1/admin/metrics */
  router.get('/metrics', async (req: Request, res: Response) => {
    res.json(await options.metrics.currentMonth(currentActor(req)));
  });

  return router;
}
