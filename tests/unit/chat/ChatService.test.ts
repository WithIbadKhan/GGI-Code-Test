import { beforeEach, describe, expect, it } from 'vitest';
import { UsagePeriod } from '../../../src/modules/chat/domain/entities/UsagePeriod.js';
import {
  AiProviderUnavailableError,
  QuotaExhaustedError,
} from '../../../src/modules/chat/domain/errors.js';
import type {
  AiCompletion,
  AiProvider,
} from '../../../src/modules/chat/domain/ports/AiProvider.js';
import { ChatService } from '../../../src/modules/chat/domain/services/ChatService.js';
import { QuotaCalculator } from '../../../src/modules/chat/domain/services/QuotaCalculator.js';
import type { Actor } from '../../../src/shared/domain/Actor.js';
import { ForbiddenError, NotFoundError } from '../../../src/shared/domain/errors.js';
import { InMemoryChatStore } from '../../support/InMemoryChatStore.js';

const alice: Actor = { userId: 'alice', roles: ['user'] };
const bob: Actor = { userId: 'bob', roles: ['user'] };
const admin: Actor = { userId: 'root', roles: ['user', 'admin'] };

class StubAi implements AiProvider {
  fail = false;
  ask(question: string): Promise<AiCompletion> {
    if (this.fail) return Promise.reject(new AiProviderUnavailableError());
    return Promise.resolve({
      answer: `answer to ${question}`,
      promptTokens: 4,
      completionTokens: 6,
      totalTokens: 10,
      provider: 'stub',
      model: 'stub-1',
    });
  }
}

describe('ChatService', () => {
  let store: InMemoryChatStore;
  let ai: StubAi;
  let now: Date;
  let service: ChatService;
  let ids: number;

  beforeEach(() => {
    store = new InMemoryChatStore();
    ai = new StubAi();
    now = new Date('2026-09-26T12:00:00Z');
    ids = 0;
    service = new ChatService({
      unitOfWork: store,
      chats: store,
      quota: store,
      ai,
      calculator: new QuotaCalculator(3),
      clock: { now: () => now },
      generateId: () => `msg-${String(++ids)}`,
    });
  });

  const ask = (actor: Actor = alice) => service.ask(actor, { question: 'Hi?', requestId: 'req' });

  it('answers, stores the message and charges the free quota', async () => {
    const message = await ask();

    expect(message.status).toBe('COMPLETED');
    expect(message.answer).toBe('answer to Hi?');
    expect(message.tokenUsage?.totalTokens).toBe(10);
    expect(message.quotaSource).toEqual({ kind: 'FREE' });
    expect(store.messages.get(message.id)?.status).toBe('COMPLETED');
    expect(store.freeUsedFor('alice', UsagePeriod.containing(now))).toBe(1);
  });

  it('rejects the 4th message of the month with a typed error when there is no bundle', async () => {
    await ask();
    await ask();
    await ask();

    const error = await ask().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect((error as QuotaExhaustedError).details).toMatchObject({
      reason: 'SUBSCRIPTION_REQUIRED',
      freeLimit: 3,
      freeUsed: 3,
      freeQuotaResetsAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('switches to a bundle after the free messages are used', async () => {
    store.addBundle({
      id: 'basic-1',
      userId: 'alice',
      maxMessages: 10,
      usedMessages: 0,
      createdAt: new Date('2026-09-01'),
    });
    await ask();
    await ask();
    await ask();

    const fourth = await ask();

    expect(fourth.quotaSource).toEqual({ kind: 'BUNDLE', subscriptionId: 'basic-1' });
    expect(store.bundles[0]?.usedMessages).toBe(1);
  });

  it('gives fresh free messages when a new month starts', async () => {
    await ask();
    await ask();
    await ask();
    await expect(ask()).rejects.toBeInstanceOf(QuotaExhaustedError);

    now = new Date('2026-10-01T00:00:00Z');

    await expect(ask()).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('refunds the quota and marks the message FAILED when the AI fails', async () => {
    ai.fail = true;

    await expect(ask()).rejects.toBeInstanceOf(AiProviderUnavailableError);

    const [stored] = [...store.messages.values()];
    expect(stored?.status).toBe('FAILED');
    expect(stored?.failureReason).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(store.freeUsedFor('alice', UsagePeriod.containing(now))).toBe(0);
  });

  it('refunds to the bundle that was charged', async () => {
    store.addBundle({
      id: 'basic-1',
      userId: 'alice',
      maxMessages: 10,
      usedMessages: 4,
      createdAt: new Date('2026-09-01'),
    });
    await ask();
    await ask();
    await ask();
    ai.fail = true;

    await expect(ask()).rejects.toThrow();

    expect(store.bundles[0]?.usedMessages).toBe(4);
  });

  it('refuses callers without a chat role', async () => {
    await expect(ask({ userId: 'ghost', roles: [] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides other users' messages as not found, but shows them to admins", async () => {
    const message = await ask(alice);

    await expect(service.getMessage(bob, message.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getMessage(admin, message.id)).resolves.toBe(message);
  });

  it("forbids listing another user's history unless admin", async () => {
    await ask(alice);

    await expect(
      service.listMessages(bob, { userId: 'alice', limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.listMessages(admin, { userId: 'alice', limit: 10, offset: 0 }),
    ).resolves.toHaveLength(1);
  });
});
