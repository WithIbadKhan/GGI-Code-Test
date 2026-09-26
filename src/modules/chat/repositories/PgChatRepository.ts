import type { Queryable } from '../../../shared/infrastructure/database.js';
import { ChatMessage, type ChatStatus } from '../domain/entities/ChatMessage.js';
import { bundleQuota, FREE_QUOTA } from '../domain/entities/QuotaSource.js';
import { TokenUsage } from '../domain/entities/TokenUsage.js';
import { UsagePeriod } from '../domain/entities/UsagePeriod.js';
import type { ChatRepository } from '../domain/ports/repositories.js';

interface ChatMessageRow {
  id: string;
  user_id: string;
  question: string;
  answer: string | null;
  status: ChatStatus;
  quota_source: 'FREE' | 'BUNDLE';
  subscription_id: string | null;
  usage_period: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  provider: string | null;
  model: string | null;
  request_id: string | null;
  latency_ms: number | null;
  failure_reason: string | null;
  created_at: Date;
  completed_at: Date | null;
}

const COLUMNS = `id, user_id, question, answer, status, quota_source, subscription_id, usage_period,
  prompt_tokens, completion_tokens, total_tokens, provider, model, request_id, latency_ms,
  failure_reason, created_at, completed_at`;

/** All queries are parameterised; user input never becomes part of the SQL text. */
export class PgChatRepository implements ChatRepository {
  constructor(private readonly db: Queryable) {}

  async insert(message: ChatMessage): Promise<void> {
    const source = message.quotaSource;
    await this.db.query(
      `INSERT INTO chat_messages (${COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        message.id,
        message.userId,
        message.question,
        message.answer,
        message.status,
        source.kind,
        source.kind === 'BUNDLE' ? source.subscriptionId : null,
        message.usagePeriod.toIsoDate(),
        message.tokenUsage?.promptTokens ?? null,
        message.tokenUsage?.completionTokens ?? null,
        message.tokenUsage?.totalTokens ?? null,
        message.provider,
        message.model,
        message.requestId,
        message.latencyMs,
        message.failureReason,
        message.createdAt,
        message.completedAt,
      ],
    );
  }

  async update(message: ChatMessage): Promise<void> {
    await this.db.query(
      `UPDATE chat_messages
          SET answer = $2, status = $3, prompt_tokens = $4, completion_tokens = $5,
              total_tokens = $6, provider = $7, model = $8, latency_ms = $9,
              failure_reason = $10, completed_at = $11
        WHERE id = $1`,
      [
        message.id,
        message.answer,
        message.status,
        message.tokenUsage?.promptTokens ?? null,
        message.tokenUsage?.completionTokens ?? null,
        message.tokenUsage?.totalTokens ?? null,
        message.provider,
        message.model,
        message.latencyMs,
        message.failureReason,
        message.completedAt,
      ],
    );
  }

  async findById(id: string): Promise<ChatMessage | null> {
    const result = await this.db.query<ChatMessageRow>(
      `SELECT ${COLUMNS} FROM chat_messages WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }

  async listByUser(
    userId: string,
    page: { limit: number; offset: number },
  ): Promise<ChatMessage[]> {
    const result = await this.db.query<ChatMessageRow>(
      `SELECT ${COLUMNS} FROM chat_messages
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return result.rows.map(toEntity);
  }
}

function toEntity(row: ChatMessageRow): ChatMessage {
  return ChatMessage.restore({
    id: row.id,
    userId: row.user_id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    quotaSource:
      row.quota_source === 'BUNDLE' && row.subscription_id
        ? bundleQuota(row.subscription_id)
        : FREE_QUOTA,
    usagePeriod: UsagePeriod.fromIsoDate(row.usage_period),
    tokenUsage:
      row.total_tokens === null
        ? null
        : TokenUsage.of({
            promptTokens: row.prompt_tokens ?? 0,
            completionTokens: row.completion_tokens ?? 0,
            totalTokens: row.total_tokens,
          }),
    provider: row.provider,
    model: row.model,
    requestId: row.request_id,
    latencyMs: row.latency_ms,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}
