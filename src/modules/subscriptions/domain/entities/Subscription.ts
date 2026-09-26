import { InvariantViolationError } from '../../../../shared/domain/errors.js';
import { SubscriptionStateError } from '../errors.js';
import {
  addBillingCycle,
  type BillingCycle,
  type PlanTerms,
  type SubscriptionTier,
} from './Plan.js';

/**
 * Lifecycle:
 *
 *   ACTIVE -> ACTIVE     cycle ended, auto-renew on, payment ok (next cycle, usage reset)
 *   ACTIVE -> INACTIVE   cycle ended, auto-renew on, payment failed
 *   ACTIVE -> INACTIVE   cycle ended, auto-renew off
 *   ACTIVE -> CANCELLED  the user cancelled (the cycle ends now)
 *
 * INACTIVE and CANCELLED are final. Nothing is ever deleted, so usage history
 * (chat messages, payments) stays linked to the subscription.
 */
export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE' | 'CANCELLED';

export interface SubscriptionProps {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  maxMessages: number | null;
  usedMessages: number;
  priceCents: number;
  currency: string;
  autoRenew: boolean;
  status: SubscriptionStatus;
  startDate: Date;
  endDate: Date;
  /** When the next renewal is scheduled; `null` when none will happen. */
  renewalDate: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Subscription {
  private constructor(private props: SubscriptionProps) {}

  static purchase(input: {
    id: string;
    userId: string;
    terms: PlanTerms;
    autoRenew: boolean;
    now: Date;
  }): Subscription {
    const endDate = addBillingCycle(input.now, input.terms.billingCycle);
    return new Subscription({
      id: input.id,
      userId: input.userId,
      tier: input.terms.tier,
      billingCycle: input.terms.billingCycle,
      maxMessages: input.terms.maxMessages,
      usedMessages: 0,
      priceCents: input.terms.priceCents,
      currency: input.terms.currency,
      autoRenew: input.autoRenew,
      status: 'ACTIVE',
      startDate: input.now,
      endDate,
      renewalDate: input.autoRenew ? endDate : null,
      cancelledAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Rebuilds an entity from storage. No business rules are re-run. */
  static restore(props: SubscriptionProps): Subscription {
    return new Subscription({ ...props });
  }

  isActiveAt(now: Date): boolean {
    return (
      this.props.status === 'ACTIVE' && this.props.startDate <= now && now < this.props.endDate
    );
  }

  isDueForRenewal(now: Date): boolean {
    return this.props.status === 'ACTIVE' && this.props.endDate <= now;
  }

  setAutoRenew(enabled: boolean, now: Date): void {
    this.assertActive('change auto-renew on');
    this.update(now, {
      autoRenew: enabled,
      renewalDate: enabled ? this.props.endDate : null,
    });
  }

  /**
   * Ends the current billing cycle immediately and prevents any future renewal.
   * Messages already used stay recorded against this subscription.
   */
  cancel(now: Date): void {
    this.assertActive('cancel');
    this.update(now, {
      status: 'CANCELLED',
      autoRenew: false,
      renewalDate: null,
      cancelledAt: now,
      endDate: now < this.props.endDate ? maxDate(now, this.props.startDate) : this.props.endDate,
    });
  }

  /** Starts the next billing cycle after a successful renewal payment. */
  renew(now: Date): void {
    this.assertDue('renew', now);
    if (!this.props.autoRenew) {
      throw new InvariantViolationError('Cannot renew a subscription with auto-renew disabled.');
    }

    let startDate = this.props.endDate;
    let endDate = addBillingCycle(startDate, this.props.billingCycle);
    // If billing was down for more than a whole cycle, start the new cycle now
    // instead of charging for a period that has already passed.
    if (endDate <= now) {
      startDate = now;
      endDate = addBillingCycle(now, this.props.billingCycle);
    }

    this.update(now, { startDate, endDate, renewalDate: endDate, usedMessages: 0 });
  }

  /** The cycle ended and auto-renew is off. */
  expire(now: Date): void {
    this.assertDue('expire', now);
    if (this.props.autoRenew) {
      throw new InvariantViolationError(
        'A subscription with auto-renew must be renewed or failed.',
      );
    }
    this.update(now, { status: 'INACTIVE', renewalDate: null });
  }

  /** A purchase or renewal payment was declined. */
  markPaymentFailed(now: Date): void {
    this.assertActive('fail the payment of');
    this.update(now, { status: 'INACTIVE', renewalDate: null });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get tier(): SubscriptionTier {
    return this.props.tier;
  }
  get billingCycle(): BillingCycle {
    return this.props.billingCycle;
  }
  get maxMessages(): number | null {
    return this.props.maxMessages;
  }
  get usedMessages(): number {
    return this.props.usedMessages;
  }
  get remainingMessages(): number | null {
    if (this.props.maxMessages === null) return null;
    return Math.max(this.props.maxMessages - this.props.usedMessages, 0);
  }
  get priceCents(): number {
    return this.props.priceCents;
  }
  get currency(): string {
    return this.props.currency;
  }
  get autoRenew(): boolean {
    return this.props.autoRenew;
  }
  get status(): SubscriptionStatus {
    return this.props.status;
  }
  get startDate(): Date {
    return this.props.startDate;
  }
  get endDate(): Date {
    return this.props.endDate;
  }
  get renewalDate(): Date | null {
    return this.props.renewalDate;
  }
  get cancelledAt(): Date | null {
    return this.props.cancelledAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  private assertActive(action: string): void {
    if (this.props.status !== 'ACTIVE') {
      throw new SubscriptionStateError(
        `Cannot ${action} a subscription that is ${this.props.status.toLowerCase()}.`,
      );
    }
  }

  /** Renewal and expiry only make sense for an active subscription whose cycle has ended. */
  private assertDue(action: string, now: Date): void {
    if (!this.isDueForRenewal(now)) {
      throw new InvariantViolationError(
        `Cannot ${action} subscription ${this.props.id}: it is not due for renewal.`,
      );
    }
  }

  private update(now: Date, changes: Partial<SubscriptionProps>): void {
    this.props = { ...this.props, ...changes, updatedAt: now };
  }
}

function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}
