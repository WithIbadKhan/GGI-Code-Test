import { z } from 'zod';

const commaSeparatedList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: commaSeparatedList.default([]),
    BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i)
      .default('16kb'),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    /** Number of reverse proxies in front of the app; needed for correct client IPs. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    AUTH_ISSUER: z.url(),
    AUTH_AUDIENCE: z.string().min(1),
    AUTH_JWKS_URI: z.url({ protocol: /^https?$/ }),
    AUTH_ROLES_CLAIM: z.string().min(1).default('roles'),

    /** Server secret from which every session's request-signing key is derived. */
    SESSION_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters'),
    SESSION_MAX_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
    SIGNATURE_MAX_SKEW_SECONDS: z.coerce.number().int().min(5).max(900).default(120),
    /** Shared secret for monitoring systems calling GET /health. */
    HEALTH_CHECK_TOKEN: z.string().min(24, 'must be at least 24 characters'),

    AI_PROVIDER: z.enum(['mock', 'gemini']).default('mock'),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
    MOCK_AI_MIN_LATENCY_MS: z.coerce.number().int().min(0).default(300),
    MOCK_AI_MAX_LATENCY_MS: z.coerce.number().int().min(0).default(1200),
    MOCK_AI_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().min(1).default('gemini-flash-latest'),

    FREE_MESSAGES_PER_MONTH: z.coerce.number().int().min(0).default(3),

    PAYMENT_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    BILLING_JOB_ENABLED: z.enum(['true', 'false']).default('true'),
    BILLING_INTERVAL_MS: z.coerce.number().int().min(1_000).default(60_000),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    CHAT_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(60),
    CHAT_RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(10),
    SUBSCRIPTION_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(60),
    SUBSCRIPTION_RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(20),
    AUTH_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(20),
    AUTH_RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(10),
    ADMIN_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(30),
    ADMIN_RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(30),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when AI_PROVIDER=gemini',
      });
    }
    if (env.MOCK_AI_MIN_LATENCY_MS > env.MOCK_AI_MAX_LATENCY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOCK_AI_MIN_LATENCY_MS'],
        message: 'must not be greater than MOCK_AI_MAX_LATENCY_MS',
      });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'at least one allowed origin is required in production',
      });
    }
    // Otherwise the global timeout cuts the request off before the AI can answer,
    // and the client gets a generic timeout instead of the typed AI_TIMEOUT error.
    if (env.REQUEST_TIMEOUT_MS <= env.AI_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['REQUEST_TIMEOUT_MS'],
        message: 'must be greater than AI_TIMEOUT_MS',
      });
    }
    // Plain-http identity providers (like scripts/dev-idp.ts) are for local development only.
    for (const key of ['AUTH_ISSUER', 'AUTH_JWKS_URI'] as const) {
      if (env.NODE_ENV === 'production' && !env[key].startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must use https in production' });
      }
    }
  });

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  http: {
    corsOrigins: string[];
    bodyLimit: string;
    requestTimeoutMs: number;
    trustProxyHops: number;
  };
  databaseUrl: string;
  auth: {
    issuer: string;
    audience: string;
    jwksUri: string;
    rolesClaim: string;
  };
  security: {
    sessionSigningSecret: string;
    sessionMaxTtlSeconds: number;
    signatureMaxSkewSeconds: number;
    healthCheckToken: string;
  };
  ai: {
    provider: 'mock' | 'gemini';
    timeoutMs: number;
    mock: { minLatencyMs: number; maxLatencyMs: number; failureRate: number };
    gemini: { apiKey: string; model: string };
  };
  quota: { freeMessagesPerMonth: number };
  billing: {
    paymentFailureRate: number;
    jobEnabled: boolean;
    intervalMs: number;
  };
  rateLimit: {
    windowMs: number;
    chatPerIp: number;
    chatPerUser: number;
    subscriptionsPerIp: number;
    subscriptionsPerUser: number;
    authPerIp: number;
    authPerUser: number;
    adminPerIp: number;
    adminPerUser: number;
  };
}

/** Reads and validates configuration once at start-up. Invalid config stops the process. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;

  return {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    http: {
      corsOrigins: env.CORS_ORIGINS,
      bodyLimit: env.BODY_LIMIT,
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
      trustProxyHops: env.TRUST_PROXY_HOPS,
    },
    databaseUrl: env.DATABASE_URL,
    auth: {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
      jwksUri: env.AUTH_JWKS_URI,
      rolesClaim: env.AUTH_ROLES_CLAIM,
    },
    security: {
      sessionSigningSecret: env.SESSION_SIGNING_SECRET,
      sessionMaxTtlSeconds: env.SESSION_MAX_TTL_SECONDS,
      signatureMaxSkewSeconds: env.SIGNATURE_MAX_SKEW_SECONDS,
      healthCheckToken: env.HEALTH_CHECK_TOKEN,
    },
    ai: {
      provider: env.AI_PROVIDER,
      timeoutMs: env.AI_TIMEOUT_MS,
      mock: {
        minLatencyMs: env.MOCK_AI_MIN_LATENCY_MS,
        maxLatencyMs: env.MOCK_AI_MAX_LATENCY_MS,
        failureRate: env.MOCK_AI_FAILURE_RATE,
      },
      gemini: { apiKey: env.GEMINI_API_KEY ?? '', model: env.GEMINI_MODEL },
    },
    quota: { freeMessagesPerMonth: env.FREE_MESSAGES_PER_MONTH },
    billing: {
      paymentFailureRate: env.PAYMENT_FAILURE_RATE,
      jobEnabled: env.BILLING_JOB_ENABLED === 'true',
      intervalMs: env.BILLING_INTERVAL_MS,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      chatPerIp: env.CHAT_RATE_LIMIT_PER_IP,
      chatPerUser: env.CHAT_RATE_LIMIT_PER_USER,
      subscriptionsPerIp: env.SUBSCRIPTION_RATE_LIMIT_PER_IP,
      subscriptionsPerUser: env.SUBSCRIPTION_RATE_LIMIT_PER_USER,
      authPerIp: env.AUTH_RATE_LIMIT_PER_IP,
      authPerUser: env.AUTH_RATE_LIMIT_PER_USER,
      adminPerIp: env.ADMIN_RATE_LIMIT_PER_IP,
      adminPerUser: env.ADMIN_RATE_LIMIT_PER_USER,
    },
  };
}
