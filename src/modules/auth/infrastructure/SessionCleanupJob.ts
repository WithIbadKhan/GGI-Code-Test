import type { Logger } from 'pino';
import type { PgNonceStore } from '../repositories/PgNonceStore.js';
import type { PgSessionRepository } from '../repositories/PgSessionRepository.js';

const ONE_DAY_MS = 86_400_000;

/** Periodically removes nonces that can no longer be replayed and long-expired sessions. */
export class SessionCleanupJob {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly nonces: PgNonceStore,
    private readonly sessions: PgSessionRepository,
    private readonly options: { intervalMs: number; nonceRetentionMs: number; logger: Logger },
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.run();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const now = Date.now();
      const nonces = await this.nonces.deleteOlderThan(
        new Date(now - this.options.nonceRetentionMs),
      );
      const sessions = await this.sessions.deleteExpired(new Date(now - ONE_DAY_MS));
      if (nonces + sessions > 0) {
        this.options.logger.debug({ nonces, sessions }, 'Session cleanup finished');
      }
    } catch (err) {
      this.options.logger.error({ err }, 'Session cleanup failed');
    }
  }
}
