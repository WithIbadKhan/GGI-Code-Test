import { InvariantViolationError } from '../../../../shared/domain/errors.js';
import type { QuotaSource } from './QuotaSource.js';
import type { TokenUsage } from './TokenUsage.js';
import type { UsagePeriod } from './UsagePeriod.js';

/**
 * Lifecycle of a message:
 *
 *   RESERVED -> COMPLETED   the AI answered
 *   RESERVED -> FAILED      the AI failed, and the quota is refunded
 *
 * The quota is taken when the message is RESERVED, before the AI is called, so
 * that two concurrent requests can never both spend the last free message.
 */
export type ChatStatus = 'RESERVED' | 'COMPLETED' | 'FAILED';

export interface ChatMessageProps {
  id: string;
  userId: string;
  question: string;
  answer: string | null;
  status: ChatStatus;
  quotaSource: QuotaSource;
  usagePeriod: UsagePeriod;
  tokenUsage: TokenUsage | null;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  latencyMs: number | null;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CompletionResult {
  answer: string;
  tokenUsage: TokenUsage;
  provider: string;
  model: string;
}

export class ChatMessage {
  private constructor(private props: ChatMessageProps) {}

  static reserve(input: {
    id: string;
    userId: string;
    question: string;
    quotaSource: QuotaSource;
    usagePeriod: UsagePeriod;
    requestId: string | null;
    now: Date;
  }): ChatMessage {
    if (input.question.trim().length === 0) {
      throw new InvariantViolationError('A chat message needs a non-empty question.');
    }
    return new ChatMessage({
      ...input,
      answer: null,
      status: 'RESERVED',
      tokenUsage: null,
      provider: null,
      model: null,
      latencyMs: null,
      failureReason: null,
      createdAt: input.now,
      completedAt: null,
    });
  }

  /** Rebuilds an entity from storage. No business rules are re-run. */
  static restore(props: ChatMessageProps): ChatMessage {
    return new ChatMessage({ ...props });
  }

  complete(result: CompletionResult, completedAt: Date): void {
    this.assertReserved('complete');
    if (result.answer.trim().length === 0) {
      throw new InvariantViolationError('A completed chat message needs an answer.');
    }
    this.props = {
      ...this.props,
      status: 'COMPLETED',
      answer: result.answer,
      tokenUsage: result.tokenUsage,
      provider: result.provider,
      model: result.model,
      latencyMs: this.elapsedMs(completedAt),
      completedAt,
    };
  }

  fail(reason: string, failedAt: Date): void {
    this.assertReserved('fail');
    this.props = {
      ...this.props,
      status: 'FAILED',
      failureReason: reason,
      latencyMs: this.elapsedMs(failedAt),
      completedAt: failedAt,
    };
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get question(): string {
    return this.props.question;
  }
  get answer(): string | null {
    return this.props.answer;
  }
  get status(): ChatStatus {
    return this.props.status;
  }
  get quotaSource(): QuotaSource {
    return this.props.quotaSource;
  }
  get usagePeriod(): UsagePeriod {
    return this.props.usagePeriod;
  }
  get tokenUsage(): TokenUsage | null {
    return this.props.tokenUsage;
  }
  get provider(): string | null {
    return this.props.provider;
  }
  get model(): string | null {
    return this.props.model;
  }
  get requestId(): string | null {
    return this.props.requestId;
  }
  get latencyMs(): number | null {
    return this.props.latencyMs;
  }
  get failureReason(): string | null {
    return this.props.failureReason;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get completedAt(): Date | null {
    return this.props.completedAt;
  }

  private assertReserved(action: string): void {
    if (this.props.status !== 'RESERVED') {
      throw new InvariantViolationError(
        `Cannot ${action} chat message ${this.props.id}: it is already ${this.props.status}.`,
      );
    }
  }

  private elapsedMs(until: Date): number {
    return Math.max(until.getTime() - this.props.createdAt.getTime(), 0);
  }
}
