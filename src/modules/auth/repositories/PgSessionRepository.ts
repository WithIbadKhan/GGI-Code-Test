import type { Queryable } from '../../../shared/infrastructure/database.js';
import { ClientSession } from '../domain/entities/ClientSession.js';
import type { SessionRepository } from '../domain/ports.js';

interface SessionRow {
  id: string;
  user_id: string;
  token_fingerprint: string;
  created_at: Date;
  expires_at: Date;
}

export class PgSessionRepository implements SessionRepository {
  constructor(private readonly db: Queryable) {}

  async insert(s: ClientSession): Promise<void> {
    await this.db.query(
      `INSERT INTO client_sessions (id, user_id, token_fingerprint, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [s.id, s.userId, s.tokenFingerprint, s.createdAt, s.expiresAt],
    );
  }

  async findById(id: string): Promise<ClientSession | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT id, user_id, token_fingerprint, created_at, expires_at
         FROM client_sessions WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? ClientSession.restore({
          id: row.id,
          userId: row.user_id,
          tokenFingerprint: row.token_fingerprint,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        })
      : null;
  }

  /** Housekeeping: drops sessions (and, by cascade, their nonces) expired before `before`. */
  async deleteExpired(before: Date): Promise<number> {
    const result = await this.db.query('DELETE FROM client_sessions WHERE expires_at < $1', [
      before,
    ]);
    return result.rowCount ?? 0;
  }
}
