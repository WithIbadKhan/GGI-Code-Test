import { isAdmin, type Actor } from '../../../../shared/domain/Actor.js';
import type { Clock } from '../../../../shared/domain/Clock.js';
import { ForbiddenError } from '../../../../shared/domain/errors.js';
import type { MetricsReader, SystemMetrics } from '../ports.js';

export class MetricsService {
  constructor(
    private readonly reader: MetricsReader,
    private readonly clock: Clock,
  ) {}

  /** System-wide usage and subscription figures for the current month. Admins only. */
  async currentMonth(actor: Actor): Promise<SystemMetrics> {
    if (!isAdmin(actor)) {
      throw new ForbiddenError('Only admins can view system metrics.');
    }

    const now = this.clock.now();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    return {
      period: start.toISOString().slice(0, 7),
      ...(await this.reader.read(start, end)),
    };
  }
}
