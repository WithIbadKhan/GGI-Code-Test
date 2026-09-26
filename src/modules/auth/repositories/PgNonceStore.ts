import type { Queryable } from '../../../shared/infrastructure/database.js';
import type { NonceStore } from '../domain/ports.js';

export class PgNonceStore implements NonceStore {
  constructor(private readonly db: Queryable) {}

  /**
   * One INSERT decides everything: the primary key (session_id, nonce) makes a
   * second use of the same nonce insert nothing, even when two copies of the
   * request arrive at two app instances at the same moment.
   */
  async remember(sessionId: string, nonce: string, now: Date): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO request_nonces (session_id, nonce, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, nonce) DO NOTHING`,
      [sessionId, nonce, now],
    );
    return result.rowCount === 1;
  }

  /**
   * Nonces only need to be kept while their timestamp is still accepted; after
   * that the timestamp check alone rejects a replay.
   */
  async deleteOlderThan(before: Date): Promise<number> {
    const result = await this.db.query('DELETE FROM request_nonces WHERE created_at < $1', [
      before,
    ]);
    return result.rowCount ?? 0;
  }
}
