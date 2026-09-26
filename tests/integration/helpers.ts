import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { pino } from 'pino';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { createMetricsService } from '../../src/modules/admin/admin.module.js';
import { createSessionService } from '../../src/modules/auth/auth.module.js';
import { createChatService } from '../../src/modules/chat/chat.module.js';
import type { AiProvider } from '../../src/modules/chat/domain/ports/AiProvider.js';
import type { ChatService } from '../../src/modules/chat/domain/services/ChatService.js';
import { MockOpenAiProvider } from '../../src/modules/chat/infrastructure/ai/MockOpenAiProvider.js';
import { SanitizingAiProvider } from '../../src/modules/chat/infrastructure/ai/SanitizingAiProvider.js';
import type { PaymentGateway } from '../../src/modules/subscriptions/domain/ports/PaymentGateway.js';
import type { BillingService } from '../../src/modules/subscriptions/domain/services/BillingService.js';
import type { SubscriptionService } from '../../src/modules/subscriptions/domain/services/SubscriptionService.js';
import { MockPaymentGateway } from '../../src/modules/subscriptions/infrastructure/MockPaymentGateway.js';
import { createSubscriptionServices } from '../../src/modules/subscriptions/subscriptions.module.js';
import type { Clock } from '../../src/shared/domain/Clock.js';
import { createPool } from '../../src/shared/infrastructure/database.js';
import type { FakeIdentityProvider } from '../support/authKit.js';

export const ALLOWED_ORIGIN = 'https://app.ggi.test';
export const HEALTH_TOKEN = 'test-health-token-0123456789abcdef';
const SIGNING_SECRET = 'test-session-signing-secret-0123456789abcdef';

export function createTestPool(): pg.Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set.');
  return createPool(url);
}

export async function resetData(pool: pg.Pool): Promise<void> {
  await pool.query(
    'TRUNCATE chat_messages, monthly_usage, subscriptions, request_nonces, client_sessions',
  );
}

/** A fast mocked provider: same code path as production, without the artificial delay. */
export function fastMockAi(options: { failureRate?: number; latencyMs?: number } = {}): AiProvider {
  return new SanitizingAiProvider(
    new MockOpenAiProvider({
      minLatencyMs: options.latencyMs ?? 0,
      maxLatencyMs: options.latencyMs ?? 0,
      failureRate: options.failureRate ?? 0,
      timeoutMs: 5_000,
    }),
  );
}

export function buildChatService(
  pool: pg.Pool,
  options: { ai?: AiProvider; clock?: Clock } = {},
): ChatService {
  return createChatService({
    pool,
    ai: options.ai ?? fastMockAi(),
    freeMessagesPerMonth: 3,
    ...(options.clock ? { clock: options.clock } : {}),
  });
}

export function buildSubscriptionServices(
  pool: pg.Pool,
  options: { paymentFailureRate?: number; paymentGateway?: PaymentGateway; clock?: Clock } = {},
): { subscriptionService: SubscriptionService; billingService: BillingService } {
  return createSubscriptionServices({
    pool,
    paymentGateway:
      options.paymentGateway ??
      new MockPaymentGateway({ failureRate: options.paymentFailureRate ?? 0, latencyMs: 0 }),
    ...(options.clock ? { clock: options.clock } : {}),
  });
}

export function buildTestApp(options: {
  pool: pg.Pool;
  idp: FakeIdentityProvider;
  chatService?: ChatService;
  subscriptionService?: SubscriptionService;
  rateLimit?: Partial<AppConfig['rateLimit']>;
  requestTimeoutMs?: number;
  checkDatabase?: () => Promise<void>;
}): Express {
  const { pool } = options;
  return createApp({
    config: {
      http: {
        corsOrigins: [ALLOWED_ORIGIN],
        bodyLimit: '16kb',
        requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
        trustProxyHops: 0,
      },
      rateLimit: {
        windowMs: 60_000,
        chatPerIp: 1_000,
        chatPerUser: 1_000,
        subscriptionsPerIp: 1_000,
        subscriptionsPerUser: 1_000,
        authPerIp: 1_000,
        authPerUser: 1_000,
        adminPerIp: 1_000,
        adminPerUser: 1_000,
        ...options.rateLimit,
      },
      security: { healthCheckToken: HEALTH_TOKEN },
    },
    logger: pino({ level: 'silent' }),
    tokenVerifier: options.idp.verifier(),
    sessionService: createSessionService({
      pool,
      signingSecret: SIGNING_SECRET,
      maxClockSkewSeconds: 120,
      maxSessionTtlSeconds: 3600,
    }),
    chatService: options.chatService ?? buildChatService(pool),
    subscriptionService:
      options.subscriptionService ?? buildSubscriptionServices(pool).subscriptionService,
    metricsService: createMetricsService({ pool }),
    checkDatabase:
      options.checkDatabase ??
      (async () => {
        await pool.query('SELECT 1');
      }),
  });
}

export async function insertBundle(
  pool: pg.Pool,
  bundle: {
    userId: string;
    tier?: 'BASIC' | 'PRO' | 'ENTERPRISE';
    maxMessages: number | null;
    usedMessages?: number;
    createdAt?: Date;
    status?: 'ACTIVE' | 'INACTIVE' | 'CANCELLED';
    autoRenew?: boolean;
    startDate?: Date;
    endDate?: Date;
  },
): Promise<string> {
  const id = randomUUID();
  const status = bundle.status ?? 'ACTIVE';
  await pool.query(
    `INSERT INTO subscriptions (id, user_id, tier, billing_cycle, max_messages, used_messages,
                                price_cents, status, auto_renew, start_date, end_date,
                                cancelled_at, created_at)
     VALUES ($1, $2, $3, 'MONTHLY', $4, $5, 999, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      bundle.userId,
      bundle.tier ?? 'BASIC',
      bundle.maxMessages,
      bundle.usedMessages ?? 0,
      status,
      bundle.autoRenew ?? true,
      bundle.startDate ?? new Date(Date.now() - 86_400_000),
      bundle.endDate ?? new Date(Date.now() + 30 * 86_400_000),
      status === 'CANCELLED' ? new Date() : null,
      bundle.createdAt ?? new Date(),
    ],
  );
  return id;
}
