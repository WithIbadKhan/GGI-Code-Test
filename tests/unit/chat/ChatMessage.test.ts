import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../../../src/modules/chat/domain/entities/ChatMessage.js';
import { FREE_QUOTA } from '../../../src/modules/chat/domain/entities/QuotaSource.js';
import { TokenUsage } from '../../../src/modules/chat/domain/entities/TokenUsage.js';
import { UsagePeriod } from '../../../src/modules/chat/domain/entities/UsagePeriod.js';

const createdAt = new Date('2026-09-26T10:00:00.000Z');

function reserved(): ChatMessage {
  return ChatMessage.reserve({
    id: 'msg-1',
    userId: 'user-1',
    question: 'What is DDD?',
    quotaSource: FREE_QUOTA,
    usagePeriod: UsagePeriod.containing(createdAt),
    requestId: 'req-1',
    now: createdAt,
  });
}

const result = {
  answer: 'Domain-Driven Design.',
  tokenUsage: TokenUsage.of({ promptTokens: 3, completionTokens: 5 }),
  provider: 'openai-mock',
  model: 'mock',
};

describe('ChatMessage', () => {
  it('starts as RESERVED with no answer', () => {
    const message = reserved();

    expect(message.status).toBe('RESERVED');
    expect(message.answer).toBeNull();
    expect(message.tokenUsage).toBeNull();
  });

  it('rejects an empty question', () => {
    expect(() =>
      ChatMessage.reserve({
        id: 'x',
        userId: 'u',
        question: '   ',
        quotaSource: FREE_QUOTA,
        usagePeriod: UsagePeriod.containing(createdAt),
        requestId: null,
        now: createdAt,
      }),
    ).toThrow(/non-empty question/);
  });

  it('completes with the answer, token usage and latency', () => {
    const message = reserved();

    message.complete(result, new Date('2026-09-26T10:00:00.750Z'));

    expect(message.status).toBe('COMPLETED');
    expect(message.answer).toBe('Domain-Driven Design.');
    expect(message.tokenUsage?.totalTokens).toBe(8);
    expect(message.latencyMs).toBe(750);
  });

  it('records a failure reason', () => {
    const message = reserved();

    message.fail('AI_TIMEOUT', new Date('2026-09-26T10:00:10.000Z'));

    expect(message.status).toBe('FAILED');
    expect(message.failureReason).toBe('AI_TIMEOUT');
  });

  it('cannot be completed twice, or completed after failing', () => {
    const completed = reserved();
    completed.complete(result, createdAt);
    expect(() => {
      completed.complete(result, createdAt);
    }).toThrow(/already COMPLETED/);

    const failed = reserved();
    failed.fail('AI_TIMEOUT', createdAt);
    expect(() => {
      failed.complete(result, createdAt);
    }).toThrow(/already FAILED/);
  });
});

describe('TokenUsage', () => {
  it('defaults total to prompt + completion', () => {
    expect(TokenUsage.of({ promptTokens: 10, completionTokens: 20 }).totalTokens).toBe(30);
  });

  it('allows a provider-reported total above the sum (e.g. thinking tokens)', () => {
    expect(
      TokenUsage.of({ promptTokens: 1, completionTokens: 1, totalTokens: 5 }).totalTokens,
    ).toBe(5);
  });

  it.each([
    { promptTokens: -1, completionTokens: 0 },
    { promptTokens: 1.5, completionTokens: 0 },
    { promptTokens: 5, completionTokens: 5, totalTokens: 9 },
  ])('rejects invalid usage %o', (input) => {
    expect(() => TokenUsage.of(input)).toThrow();
  });
});
