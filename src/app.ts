import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env.js';
import { createAdminRouter } from './modules/admin/controllers/admin.routes.js';
import type { MetricsService } from './modules/admin/domain/services/MetricsService.js';
import { AuthController } from './modules/auth/controllers/AuthController.js';
import { createAuthRouter } from './modules/auth/controllers/auth.routes.js';
import type { SessionService } from './modules/auth/domain/services/SessionService.js';
import { ChatController } from './modules/chat/controllers/ChatController.js';
import { createChatRouter } from './modules/chat/controllers/chat.routes.js';
import type { ChatService } from './modules/chat/domain/services/ChatService.js';
import { SubscriptionController } from './modules/subscriptions/controllers/SubscriptionController.js';
import { createSubscriptionRouter } from './modules/subscriptions/controllers/subscription.routes.js';
import type { SubscriptionService } from './modules/subscriptions/domain/services/SubscriptionService.js';
import type { AccessTokenVerifier } from './shared/auth/JwtAccessTokenVerifier.js';
import { errorHandler, notFoundHandler } from './shared/http/errorHandler.js';
import { createHealthRouter } from './shared/http/health.js';
import { authenticate } from './shared/http/middleware/authenticate.js';
import { requestTimeout } from './shared/http/middleware/requestTimeout.js';
import { requireJsonContentType } from './shared/http/middleware/requireJsonContentType.js';
import { requireSignedRequest } from './shared/http/middleware/requireSignedRequest.js';

export interface AppDependencies {
  config: Pick<AppConfig, 'http' | 'rateLimit'> & {
    security: Pick<AppConfig['security'], 'healthCheckToken'>;
  };
  logger: Logger;
  tokenVerifier: AccessTokenVerifier;
  sessionService: SessionService;
  chatService: ChatService;
  subscriptionService: SubscriptionService;
  metricsService: MetricsService;
  checkDatabase: () => Promise<void>;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Builds the HTTP application. Pure wiring, so tests can create it with test doubles. */
export function createApp(deps: AppDependencies): Express {
  const { config, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.http.trustProxyHops);

  // Structured access log: request id, user id and response time on every line.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customProps: (req) => ({ userId: req.actor?.userId ?? null }),
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      origin: config.http.corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'X-Request-Id',
        'X-Session-Id',
        'X-Timestamp',
        'X-Nonce',
        'X-Signature',
      ],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(requestTimeout(config.http.requestTimeoutMs));
  app.use(requireJsonContentType);
  app.use(
    express.json({
      limit: config.http.bodyLimit,
      strict: true,
      // Keep the exact bytes: the request signature covers the raw body.
      verify: (req: IncomingMessage, _res, buffer) => {
        (req as Request).rawBody = buffer;
      },
    }),
  );

  app.use(
    createHealthRouter({
      token: config.security.healthCheckToken,
      checkDatabase: deps.checkDatabase,
    }),
  );

  const requireToken = authenticate(deps.tokenVerifier);
  const requireSignature = requireSignedRequest(deps.sessionService);
  const { windowMs, ...limits } = config.rateLimit;
  const rule = (name: string, limit: number) => ({ name, windowMs, limit });

  app.use(
    '/api/v1/auth',
    createAuthRouter({
      controller: new AuthController(deps.sessionService),
      authenticate: requireToken,
      ipLimit: rule('auth', limits.authPerIp),
      userLimit: rule('auth', limits.authPerUser),
    }),
  );
  app.use(
    '/api/v1/chat',
    createChatRouter({
      controller: new ChatController(deps.chatService),
      authenticate: requireToken,
      requireSignature,
      ipLimit: rule('chat', limits.chatPerIp),
      userLimit: rule('chat', limits.chatPerUser),
    }),
  );
  app.use(
    '/api/v1/subscriptions',
    createSubscriptionRouter({
      controller: new SubscriptionController(deps.subscriptionService),
      authenticate: requireToken,
      requireSignature,
      ipLimit: rule('subscriptions', limits.subscriptionsPerIp),
      userLimit: rule('subscriptions', limits.subscriptionsPerUser),
    }),
  );
  app.use(
    '/api/v1/admin',
    createAdminRouter({
      metrics: deps.metricsService,
      authenticate: requireToken,
      requireSignature,
      ipLimit: rule('admin', limits.adminPerIp),
      userLimit: rule('admin', limits.adminPerUser),
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
