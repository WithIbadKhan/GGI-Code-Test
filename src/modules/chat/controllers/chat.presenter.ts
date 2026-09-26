import type { ChatMessage } from '../domain/entities/ChatMessage.js';
import type { QuotaSummary } from '../domain/services/QuotaCalculator.js';

/**
 * Explicit response mapping: only the fields listed here ever leave the API,
 * so adding a column to the entity can never leak it by accident.
 */
export function presentMessage(message: ChatMessage) {
  const source = message.quotaSource;
  return {
    id: message.id,
    question: message.question,
    answer: message.answer,
    status: message.status,
    quota: {
      source: source.kind,
      subscriptionId: source.kind === 'BUNDLE' ? source.subscriptionId : null,
      period: message.usagePeriod.toIsoDate().slice(0, 7),
    },
    tokenUsage: message.tokenUsage && {
      prompt: message.tokenUsage.promptTokens,
      completion: message.tokenUsage.completionTokens,
      total: message.tokenUsage.totalTokens,
    },
    provider: message.provider,
    model: message.model,
    latencyMs: message.latencyMs,
    createdAt: message.createdAt.toISOString(),
    completedAt: message.completedAt?.toISOString() ?? null,
  };
}

export function presentUsage(summary: QuotaSummary) {
  return {
    free: {
      limit: summary.freeLimit,
      used: summary.freeUsed,
      remaining: summary.freeRemaining,
      resetsAt: summary.resetsAt.toISOString(),
    },
    bundles: {
      active: summary.activeBundles,
      /** `null` means unlimited (an Enterprise bundle is active). */
      remaining: summary.bundleMessagesRemaining,
    },
  };
}
