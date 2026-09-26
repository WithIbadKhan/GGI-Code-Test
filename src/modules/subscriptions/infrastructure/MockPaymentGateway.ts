import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type {
  ChargeOutcome,
  ChargeRequest,
  PaymentGateway,
} from '../domain/ports/PaymentGateway.js';

export interface MockPaymentGatewayOptions {
  /** Probability between 0 and 1 that a charge is declined. */
  failureRate: number;
  latencyMs?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

const DECLINE_REASONS = ['CARD_DECLINED', 'INSUFFICIENT_FUNDS', 'PROCESSOR_ERROR'] as const;

/** Simulated payment processor: short latency, random declines, fake references. */
export class MockPaymentGateway implements PaymentGateway {
  private readonly random: () => number;

  constructor(private readonly options: MockPaymentGatewayOptions) {
    this.random = options.random ?? Math.random;
  }

  async charge(_request: ChargeRequest): Promise<ChargeOutcome> {
    await sleep(this.options.latencyMs ?? 50);

    if (this.random() < this.options.failureRate) {
      const reason =
        DECLINE_REASONS[Math.floor(this.random() * DECLINE_REASONS.length)] ?? 'CARD_DECLINED';
      return { succeeded: false, reason };
    }
    return { succeeded: true, reference: `pay_${randomUUID()}` };
  }
}
