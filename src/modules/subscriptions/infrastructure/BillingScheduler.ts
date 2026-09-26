import type { Logger } from 'pino';
import type { BillingService } from '../domain/services/BillingService.js';

/**
 * Runs the billing job on a fixed interval inside the API process. Runs never
 * overlap in one process. Across several processes, the row locks taken by
 * BillingService stop two instances from charging the same subscription.
 */
export class BillingScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly billing: BillingService,
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Do not keep the process alive just for billing.
    this.timer.unref();
    this.logger.info({ intervalMs: this.intervalMs }, 'Billing scheduler started');
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.billing.runRenewals();
      if (summary.due > 0) {
        this.logger.info({ billing: summary }, 'Billing run finished');
      }
    } catch (err) {
      this.logger.error({ err }, 'Billing run failed');
    } finally {
      this.running = false;
    }
  }
}
