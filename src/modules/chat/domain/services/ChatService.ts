import type { Actor } from '../../../../shared/domain/Actor.js';
import type { Clock } from '../../../../shared/domain/Clock.js';
import { AppError, ForbiddenError, NotFoundError } from '../../../../shared/domain/errors.js';
import { ChatMessage } from '../entities/ChatMessage.js';
import { TokenUsage } from '../entities/TokenUsage.js';
import { UsagePeriod } from '../entities/UsagePeriod.js';
import { QuotaExhaustedError } from '../errors.js';
import { ChatAccessPolicy } from '../policies/ChatAccessPolicy.js';
import type { AiCompletion, AiProvider } from '../ports/AiProvider.js';
import type { ChatRepository, QuotaRepository, QuotaUnitOfWork } from '../ports/repositories.js';
import type { QuotaCalculator, QuotaSummary } from './QuotaCalculator.js';

export interface ChatServiceDependencies {
  unitOfWork: QuotaUnitOfWork;
  chats: ChatRepository;
  quota: QuotaRepository;
  ai: AiProvider;
  calculator: QuotaCalculator;
  clock: Clock;
  generateId: () => string;
}

export interface AskQuestionCommand {
  question: string;
  requestId: string | null;
}

export class ChatService {
  constructor(private readonly deps: ChatServiceDependencies) {}

  /**
   * Answers a question and charges one message of quota.
   *
   * 1. Reserve: in a short transaction holding the user's lock, decide where the
   *    quota comes from, deduct it, and store the message as RESERVED.
   * 2. Ask the AI, outside any transaction, so a slow provider never holds a
   *    database connection or lock.
   * 3. Complete the message, or on failure refund the quota and mark it FAILED.
   */
  async ask(actor: Actor, command: AskQuestionCommand): Promise<ChatMessage> {
    if (!ChatAccessPolicy.canAsk(actor)) {
      throw new ForbiddenError('Your role is not allowed to use the chat.');
    }

    const message = await this.reserveQuota(actor.userId, command);

    let completion: AiCompletion;
    try {
      completion = await this.deps.ai.ask(message.question);
    } catch (error) {
      await this.refundQuota(message, error);
      throw error;
    }

    message.complete(
      {
        answer: completion.answer,
        tokenUsage: TokenUsage.of({
          promptTokens: completion.promptTokens,
          completionTokens: completion.completionTokens,
          totalTokens: completion.totalTokens,
        }),
        provider: completion.provider,
        model: completion.model,
      },
      this.deps.clock.now(),
    );
    await this.deps.chats.update(message);
    return message;
  }

  async getMessage(actor: Actor, messageId: string): Promise<ChatMessage> {
    const message = await this.deps.chats.findById(messageId);
    // Someone else's message is reported as "not found" rather than "forbidden",
    // so callers cannot probe which message ids exist.
    if (!message || !ChatAccessPolicy.canView(actor, message)) {
      throw new NotFoundError('Chat message');
    }
    return message;
  }

  async listMessages(
    actor: Actor,
    query: { userId?: string | undefined; limit: number; offset: number },
  ): Promise<ChatMessage[]> {
    const targetUserId = query.userId ?? actor.userId;
    if (!ChatAccessPolicy.canAccessUserData(actor, targetUserId)) {
      throw new ForbiddenError('You can only list your own chat messages.');
    }
    return this.deps.chats.listByUser(targetUserId, { limit: query.limit, offset: query.offset });
  }

  async getUsage(actor: Actor, userId?: string): Promise<QuotaSummary> {
    const targetUserId = userId ?? actor.userId;
    if (!ChatAccessPolicy.canAccessUserData(actor, targetUserId)) {
      throw new ForbiddenError('You can only view your own usage.');
    }
    const now = this.deps.clock.now();
    const snapshot = await this.deps.quota.loadSnapshot(
      targetUserId,
      UsagePeriod.containing(now),
      now,
    );
    return this.deps.calculator.summarize(snapshot);
  }

  private reserveQuota(userId: string, command: AskQuestionCommand): Promise<ChatMessage> {
    return this.deps.unitOfWork.runExclusiveForUser(userId, async ({ quota, chats }) => {
      const now = this.deps.clock.now();
      const period = UsagePeriod.containing(now);

      const snapshot = await quota.loadSnapshot(userId, period, now);
      const decision = this.deps.calculator.decide(snapshot);
      if (!decision.granted) {
        throw new QuotaExhaustedError(decision.reason, this.deps.calculator.summarize(snapshot));
      }

      await quota.consume(userId, period, decision.source);

      const message = ChatMessage.reserve({
        id: this.deps.generateId(),
        userId,
        question: command.question,
        quotaSource: decision.source,
        usagePeriod: period,
        requestId: command.requestId,
        now,
      });
      await chats.insert(message);
      return message;
    });
  }

  private async refundQuota(message: ChatMessage, cause: unknown): Promise<void> {
    const reason = cause instanceof AppError ? cause.code : 'UNEXPECTED_ERROR';

    await this.deps.unitOfWork.runExclusiveForUser(message.userId, async ({ quota, chats }) => {
      // Refund into the period the message was charged to, even if the month
      // has rolled over while the AI was answering.
      await quota.release(message.userId, message.usagePeriod, message.quotaSource);
      message.fail(reason, this.deps.clock.now());
      await chats.update(message);
    });
  }
}
