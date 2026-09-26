import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AppConfig } from '../../config/env.js';
import { systemClock, type Clock } from '../../shared/domain/Clock.js';
import type { AiProvider } from './domain/ports/AiProvider.js';
import { ChatService } from './domain/services/ChatService.js';
import { QuotaCalculator } from './domain/services/QuotaCalculator.js';
import { GeminiAiProvider } from './infrastructure/ai/GeminiAiProvider.js';
import { MockOpenAiProvider } from './infrastructure/ai/MockOpenAiProvider.js';
import { SanitizingAiProvider } from './infrastructure/ai/SanitizingAiProvider.js';
import { PgChatRepository } from './repositories/PgChatRepository.js';
import { PgQuotaRepository } from './repositories/PgQuotaRepository.js';
import { PgQuotaUnitOfWork } from './repositories/PgQuotaUnitOfWork.js';

export function createAiProvider(config: AppConfig['ai']): AiProvider {
  const provider =
    config.provider === 'gemini'
      ? new GeminiAiProvider({
          apiKey: config.gemini.apiKey,
          model: config.gemini.model,
          timeoutMs: config.timeoutMs,
        })
      : new MockOpenAiProvider({ ...config.mock, timeoutMs: config.timeoutMs });

  return new SanitizingAiProvider(provider);
}

/** Wires the chat module's use case to its concrete adapters. */
export function createChatService(deps: {
  pool: pg.Pool;
  ai: AiProvider;
  freeMessagesPerMonth: number;
  clock?: Clock;
}): ChatService {
  return new ChatService({
    unitOfWork: new PgQuotaUnitOfWork(deps.pool),
    chats: new PgChatRepository(deps.pool),
    quota: new PgQuotaRepository(deps.pool),
    ai: deps.ai,
    calculator: new QuotaCalculator(deps.freeMessagesPerMonth),
    clock: deps.clock ?? systemClock,
    generateId: randomUUID,
  });
}
