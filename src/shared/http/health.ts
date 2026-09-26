import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { AppError } from '../domain/errors.js';
import { perIpRateLimit } from './middleware/rateLimit.js';

export interface HealthRouterOptions {
  /** Shared secret for monitoring systems, sent as the X-Health-Token header. */
  token: string;
  checkDatabase: () => Promise<void>;
}

/**
 * GET /health. The brief allows no open endpoints, so even the health check
 * needs a credential: a static token meant for load balancers and uptime
 * monitors, which usually cannot obtain user JWTs. It only reveals up/down.
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();
  const expected = sha256(options.token);
  const startedAt = Date.now();

  router.get(
    '/health',
    perIpRateLimit({ name: 'health', windowMs: 60_000, limit: 60 }),
    async (req, res) => {
      const given = req.headers['x-health-token'];
      // Hashing both sides gives equal-length buffers for a constant-time comparison.
      if (typeof given !== 'string' || !timingSafeEqual(sha256(given), expected)) {
        throw new AppError('UNAUTHENTICATED', 'A valid X-Health-Token header is required.');
      }

      let database: 'up' | 'down' = 'up';
      try {
        await options.checkDatabase();
      } catch (err) {
        req.log.error({ err }, 'Health check: database is down');
        database = 'down';
      }

      res.setHeader('Cache-Control', 'no-store');
      res.status(database === 'up' ? 200 : 503).json({
        status: database === 'up' ? 'ok' : 'degraded',
        checks: { database },
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
    },
  );

  return router;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
