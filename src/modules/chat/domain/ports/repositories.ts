import type { ChatMessage } from '../entities/ChatMessage.js';
import type { QuotaSource } from '../entities/QuotaSource.js';
import type { UsagePeriod } from '../entities/UsagePeriod.js';
import type { QuotaSnapshot } from '../services/QuotaCalculator.js';

export interface ChatRepository {
  insert(message: ChatMessage): Promise<void>;
  update(message: ChatMessage): Promise<void>;
  findById(id: string): Promise<ChatMessage | null>;
  listByUser(userId: string, page: { limit: number; offset: number }): Promise<ChatMessage[]>;
}

export interface QuotaRepository {
  loadSnapshot(userId: string, period: UsagePeriod, now: Date): Promise<QuotaSnapshot>;
  /** Spends one message from the given source. Throws if the guarded write fails. */
  consume(userId: string, period: UsagePeriod, source: QuotaSource): Promise<void>;
  /** Gives one message back to the given source (used when the AI call fails). */
  release(userId: string, period: UsagePeriod, source: QuotaSource): Promise<void>;
}

export interface QuotaTransaction {
  quota: QuotaRepository;
  chats: ChatRepository;
}

/**
 * Runs `work` inside a single database transaction while holding an exclusive
 * lock for this user. All quota reads and writes for one user are therefore
 * serialised, across every application instance, while different users never
 * wait for each other.
 */
export interface QuotaUnitOfWork {
  runExclusiveForUser<T>(userId: string, work: (tx: QuotaTransaction) => Promise<T>): Promise<T>;
}
