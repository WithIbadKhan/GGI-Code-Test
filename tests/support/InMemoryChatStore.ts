import { BundleBalance } from '../../src/modules/chat/domain/entities/BundleBalance.js';
import type { ChatMessage } from '../../src/modules/chat/domain/entities/ChatMessage.js';
import type { QuotaSource } from '../../src/modules/chat/domain/entities/QuotaSource.js';
import type { UsagePeriod } from '../../src/modules/chat/domain/entities/UsagePeriod.js';
import type {
  ChatRepository,
  QuotaRepository,
  QuotaTransaction,
  QuotaUnitOfWork,
} from '../../src/modules/chat/domain/ports/repositories.js';
import type { QuotaSnapshot } from '../../src/modules/chat/domain/services/QuotaCalculator.js';

interface StoredBundle {
  id: string;
  userId: string;
  maxMessages: number | null;
  usedMessages: number;
  createdAt: Date;
}

/**
 * In-memory implementation of the chat module's ports, for unit-testing
 * ChatService without a database. Concurrency is covered by the integration
 * tests against real PostgreSQL.
 */
export class InMemoryChatStore implements ChatRepository, QuotaRepository, QuotaUnitOfWork {
  readonly messages = new Map<string, ChatMessage>();
  readonly freeUsed = new Map<string, number>();
  readonly bundles: StoredBundle[] = [];

  addBundle(bundle: StoredBundle): void {
    this.bundles.push(bundle);
  }

  freeUsedFor(userId: string, period: UsagePeriod): number {
    return this.freeUsed.get(`${userId}|${period.toIsoDate()}`) ?? 0;
  }

  // --- QuotaUnitOfWork ---
  async runExclusiveForUser<T>(
    _userId: string,
    work: (tx: QuotaTransaction) => Promise<T>,
  ): Promise<T> {
    return work({ quota: this, chats: this });
  }

  // --- QuotaRepository ---
  async loadSnapshot(userId: string, period: UsagePeriod): Promise<QuotaSnapshot> {
    return {
      period,
      freeUsed: this.freeUsedFor(userId, period),
      activeBundles: this.bundles
        .filter((b) => b.userId === userId)
        .map((b) => new BundleBalance(b.id, b.maxMessages, b.usedMessages, b.createdAt)),
    };
  }

  async consume(userId: string, period: UsagePeriod, source: QuotaSource): Promise<void> {
    if (source.kind === 'FREE') {
      this.freeUsed.set(`${userId}|${period.toIsoDate()}`, this.freeUsedFor(userId, period) + 1);
    } else {
      this.bundle(source.subscriptionId).usedMessages += 1;
    }
  }

  async release(userId: string, period: UsagePeriod, source: QuotaSource): Promise<void> {
    if (source.kind === 'FREE') {
      this.freeUsed.set(`${userId}|${period.toIsoDate()}`, this.freeUsedFor(userId, period) - 1);
    } else {
      this.bundle(source.subscriptionId).usedMessages -= 1;
    }
  }

  // --- ChatRepository ---
  async insert(message: ChatMessage): Promise<void> {
    this.messages.set(message.id, message);
  }

  async update(message: ChatMessage): Promise<void> {
    this.messages.set(message.id, message);
  }

  async findById(id: string): Promise<ChatMessage | null> {
    return this.messages.get(id) ?? null;
  }

  async listByUser(userId: string): Promise<ChatMessage[]> {
    return [...this.messages.values()].filter((m) => m.userId === userId);
  }

  private bundle(id: string): StoredBundle {
    const found = this.bundles.find((b) => b.id === id);
    if (!found) throw new Error(`Unknown bundle ${id}`);
    return found;
  }
}
