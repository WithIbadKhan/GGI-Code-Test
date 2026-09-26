import 'dotenv/config';
import { createRemoteJWKSet } from 'jose';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createMetricsService } from './modules/admin/admin.module.js';
import { createSessionService } from './modules/auth/auth.module.js';
import { SessionCleanupJob } from './modules/auth/infrastructure/SessionCleanupJob.js';
import { PgNonceStore } from './modules/auth/repositories/PgNonceStore.js';
import { PgSessionRepository } from './modules/auth/repositories/PgSessionRepository.js';
import { createAiProvider, createChatService } from './modules/chat/chat.module.js';
import { BillingScheduler } from './modules/subscriptions/infrastructure/BillingScheduler.js';
import { MockPaymentGateway } from './modules/subscriptions/infrastructure/MockPaymentGateway.js';
import { createSubscriptionServices } from './modules/subscriptions/subscriptions.module.js';
import { JwtAccessTokenVerifier } from './shared/auth/JwtAccessTokenVerifier.js';
import { createPool } from './shared/infrastructure/database.js';
import { createLogger } from './shared/infrastructure/logger.js';

/** Composition root: the only place where concrete implementations are chosen. */
const config = loadConfig();
const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });
const pool = createPool(config.databaseUrl);

const tokenVerifier = new JwtAccessTokenVerifier({
  issuer: config.auth.issuer,
  audience: config.auth.audience,
  rolesClaim: config.auth.rolesClaim,
  // Keys are fetched from the identity provider and cached; rotation is handled by `kid`.
  keys: createRemoteJWKSet(new URL(config.auth.jwksUri)),
});

const sessionService = createSessionService({
  pool,
  signingSecret: config.security.sessionSigningSecret,
  maxClockSkewSeconds: config.security.signatureMaxSkewSeconds,
  maxSessionTtlSeconds: config.security.sessionMaxTtlSeconds,
});

const chatService = createChatService({
  pool,
  ai: createAiProvider(config.ai),
  freeMessagesPerMonth: config.quota.freeMessagesPerMonth,
});

const { subscriptionService, billingService } = createSubscriptionServices({
  pool,
  paymentGateway: new MockPaymentGateway({ failureRate: config.billing.paymentFailureRate }),
});

const app = createApp({
  config,
  logger,
  tokenVerifier,
  sessionService,
  chatService,
  subscriptionService,
  metricsService: createMetricsService({ pool }),
  checkDatabase: async () => {
    await pool.query('SELECT 1');
  },
});

// Background jobs.
const billingScheduler = new BillingScheduler(billingService, config.billing.intervalMs, logger);
if (config.billing.jobEnabled) {
  billingScheduler.start();
}
const sessionCleanup = new SessionCleanupJob(
  new PgNonceStore(pool),
  new PgSessionRepository(pool),
  {
    intervalMs: 5 * 60_000,
    // Twice the accepted clock skew: older nonces are rejected by the timestamp check anyway.
    nonceRetentionMs: 2 * config.security.signatureMaxSkewSeconds * 1000,
    logger,
  },
);
sessionCleanup.start();

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, aiProvider: config.ai.provider, env: config.env },
    'Server started',
  );
});
// Node-level limits against slow clients (e.g. slowloris).
server.headersTimeout = 20_000;
server.requestTimeout = config.http.requestTimeoutMs + 5_000;

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  billingScheduler.stop();
  sessionCleanup.stop();
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
  // Force exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
