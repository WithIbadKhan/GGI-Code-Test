import { describe, expect, it, vi } from 'vitest';
import {
  AiProviderUnavailableError,
  AiTimeoutError,
} from '../../../src/modules/chat/domain/errors.js';
import {
  estimateTokens,
  MockOpenAiProvider,
} from '../../../src/modules/chat/infrastructure/ai/MockOpenAiProvider.js';
import { SanitizingAiProvider } from '../../../src/modules/chat/infrastructure/ai/SanitizingAiProvider.js';
import type { AiProvider } from '../../../src/modules/chat/domain/ports/AiProvider.js';

function provider(overrides: { random?: () => number; failureRate?: number; timeoutMs?: number }) {
  const wait = vi.fn(() => Promise.resolve());
  const instance = new MockOpenAiProvider({
    minLatencyMs: 100,
    maxLatencyMs: 500,
    failureRate: overrides.failureRate ?? 0,
    timeoutMs: overrides.timeoutMs ?? 10_000,
    random: overrides.random ?? (() => 0.5),
    wait,
  });
  return { instance, wait };
}

describe('MockOpenAiProvider', () => {
  it('simulates latency inside the configured range', async () => {
    const { instance, wait } = provider({ random: () => 0.5 });

    await instance.ask('Hello?');

    expect(wait).toHaveBeenCalledWith(300); // 100 + floor(0.5 * 401)
  });

  it('returns an answer with OpenAI-style token usage', async () => {
    const { instance } = provider({});

    const completion = await instance.ask('What is the capital of France?');

    expect(completion.answer).toContain('What is the capital of France?');
    expect(completion.provider).toBe('openai-mock');
    expect(completion.promptTokens).toBe(estimateTokens('What is the capital of France?'));
    expect(completion.totalTokens).toBe(completion.promptTokens + completion.completionTokens);
  });

  it('fails randomly according to the failure rate', async () => {
    const { instance } = provider({ failureRate: 0.5, random: () => 0.1 });

    await expect(instance.ask('hi')).rejects.toBeInstanceOf(AiProviderUnavailableError);
  });

  it('times out when the simulated latency exceeds the timeout', async () => {
    const { instance } = provider({ timeoutMs: 200, random: () => 0.99 });

    await expect(instance.ask('hi')).rejects.toBeInstanceOf(AiTimeoutError);
  });
});

describe('SanitizingAiProvider', () => {
  it('strips markup from AI answers before they are stored or returned', async () => {
    const malicious: AiProvider = {
      ask: () =>
        Promise.resolve({
          answer: 'Sure! <script>alert(1)</script><img src=x onerror=alert(2)>Paris',
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          provider: 'test',
          model: 'test',
        }),
    };

    const completion = await new SanitizingAiProvider(malicious).ask('capital of France?');

    expect(completion.answer).toBe('Sure! Paris');
  });
});
