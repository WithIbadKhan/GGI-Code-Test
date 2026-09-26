import { AppError } from '../../../shared/domain/errors.js';
import type { QuotaSummary } from './services/QuotaCalculator.js';

export type QuotaDeniedReason = 'SUBSCRIPTION_REQUIRED' | 'BUNDLES_EXHAUSTED';

export class QuotaExhaustedError extends AppError {
  constructor(reason: QuotaDeniedReason, summary: QuotaSummary) {
    super(
      'QUOTA_EXHAUSTED',
      reason === 'SUBSCRIPTION_REQUIRED'
        ? 'Your free messages for this month are used up. Subscribe to a bundle to keep chatting.'
        : 'Your free messages and all of your subscription bundles are used up.',
      {
        reason,
        freeLimit: summary.freeLimit,
        freeUsed: summary.freeUsed,
        activeBundles: summary.activeBundles,
        freeQuotaResetsAt: summary.resetsAt.toISOString(),
      },
    );
  }
}

/** The AI provider failed or rejected the request (e.g. HTTP 429/5xx). */
export class AiProviderUnavailableError extends AppError {
  constructor(
    message = 'The AI provider is temporarily unavailable. Please try again later.',
    cause?: unknown,
  ) {
    super('AI_PROVIDER_UNAVAILABLE', message, undefined, { cause });
  }
}

export class AiTimeoutError extends AppError {
  constructor(cause?: unknown) {
    super('AI_TIMEOUT', 'The AI provider did not answer in time. Please try again.', undefined, {
      cause,
    });
  }
}
