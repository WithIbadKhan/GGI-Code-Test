import { describe, expect, it } from 'vitest';
import { planTerms } from '../../../src/modules/subscriptions/domain/entities/Plan.js';
import { Subscription } from '../../../src/modules/subscriptions/domain/entities/Subscription.js';
import { SubscriptionStateError } from '../../../src/modules/subscriptions/domain/errors.js';

const bought = new Date('2026-09-10T12:00:00Z');
const cycleEnd = new Date('2026-10-10T12:00:00Z');

function basic(autoRenew = true): Subscription {
  return Subscription.purchase({
    id: 'sub-1',
    userId: 'alice',
    terms: planTerms('BASIC', 'MONTHLY'),
    autoRenew,
    now: bought,
  });
}

describe('Subscription lifecycle', () => {
  it('starts ACTIVE with the plan terms and one billing cycle', () => {
    const s = basic();

    expect(s.status).toBe('ACTIVE');
    expect(s.maxMessages).toBe(10);
    expect(s.priceCents).toBe(999);
    expect(s.startDate).toEqual(bought);
    expect(s.endDate).toEqual(cycleEnd);
    expect(s.renewalDate).toEqual(cycleEnd);
    expect(s.isActiveAt(new Date('2026-09-20T00:00:00Z'))).toBe(true);
  });

  it('has no renewal date when auto-renew is off', () => {
    expect(basic(false).renewalDate).toBeNull();
  });

  it('toggles auto-renew and the renewal date with it', () => {
    const s = basic();

    s.setAutoRenew(false, bought);
    expect(s.autoRenew).toBe(false);
    expect(s.renewalDate).toBeNull();

    s.setAutoRenew(true, bought);
    expect(s.renewalDate).toEqual(cycleEnd);
  });

  it('becomes due for renewal once the cycle has ended', () => {
    const s = basic();

    expect(s.isDueForRenewal(new Date('2026-10-10T11:59:59Z'))).toBe(false);
    expect(s.isDueForRenewal(cycleEnd)).toBe(true);
    expect(s.isActiveAt(cycleEnd)).toBe(false);
  });

  it('renews into the next cycle and resets the message count', () => {
    const s = Subscription.restore({ ...snapshot(basic()), usedMessages: 7 });

    s.renew(cycleEnd);

    expect(s.status).toBe('ACTIVE');
    expect(s.startDate).toEqual(cycleEnd);
    expect(s.endDate).toEqual(new Date('2026-11-10T12:00:00Z'));
    expect(s.renewalDate).toEqual(new Date('2026-11-10T12:00:00Z'));
    expect(s.usedMessages).toBe(0);
  });

  it('starts the new cycle now if billing was down for longer than a whole cycle', () => {
    const s = basic();
    const muchLater = new Date('2027-01-05T00:00:00Z');

    s.renew(muchLater);

    expect(s.startDate).toEqual(muchLater);
    expect(s.endDate).toEqual(new Date('2027-02-05T00:00:00Z'));
  });

  it('becomes INACTIVE when the cycle ends without auto-renew', () => {
    const s = basic(false);

    s.expire(cycleEnd);

    expect(s.status).toBe('INACTIVE');
    expect(s.renewalDate).toBeNull();
  });

  it('becomes INACTIVE when a payment fails', () => {
    const s = basic();

    s.markPaymentFailed(cycleEnd);

    expect(s.status).toBe('INACTIVE');
    expect(s.renewalDate).toBeNull();
    expect(s.isDueForRenewal(cycleEnd)).toBe(false);
  });

  describe('cancel', () => {
    const cancelledAt = new Date('2026-09-20T08:00:00Z');

    it('ends the current cycle now and prevents renewal', () => {
      const s = basic();

      s.cancel(cancelledAt);

      expect(s.status).toBe('CANCELLED');
      expect(s.endDate).toEqual(cancelledAt);
      expect(s.autoRenew).toBe(false);
      expect(s.renewalDate).toBeNull();
      expect(s.cancelledAt).toEqual(cancelledAt);
      expect(s.isActiveAt(cancelledAt)).toBe(false);
      expect(s.isDueForRenewal(new Date('2027-01-01'))).toBe(false);
    });

    it('keeps the usage history', () => {
      const s = Subscription.restore({ ...snapshot(basic()), usedMessages: 4 });

      s.cancel(cancelledAt);

      expect(s.usedMessages).toBe(4);
    });

    it('cannot cancel twice or cancel an inactive subscription', () => {
      const cancelled = basic();
      cancelled.cancel(cancelledAt);
      expect(() => {
        cancelled.cancel(cancelledAt);
      }).toThrow(SubscriptionStateError);

      const inactive = basic();
      inactive.markPaymentFailed(cancelledAt);
      expect(() => {
        inactive.cancel(cancelledAt);
      }).toThrow(SubscriptionStateError);
    });

    it('cannot change auto-renew after cancelling', () => {
      const s = basic();
      s.cancel(cancelledAt);

      expect(() => {
        s.setAutoRenew(true, cancelledAt);
      }).toThrow(/cancelled/);
    });
  });

  it('reports remaining messages, or null for unlimited plans', () => {
    const enterprise = Subscription.purchase({
      id: 'e',
      userId: 'u',
      terms: planTerms('ENTERPRISE', 'YEARLY'),
      autoRenew: true,
      now: bought,
    });

    expect(Subscription.restore({ ...snapshot(basic()), usedMessages: 3 }).remainingMessages).toBe(
      7,
    );
    expect(enterprise.remainingMessages).toBeNull();
  });
});

/** Copies an entity's state so a test can start from a modified version of it. */
function snapshot(s: Subscription) {
  return {
    id: s.id,
    userId: s.userId,
    tier: s.tier,
    billingCycle: s.billingCycle,
    maxMessages: s.maxMessages,
    usedMessages: s.usedMessages,
    priceCents: s.priceCents,
    currency: s.currency,
    autoRenew: s.autoRenew,
    status: s.status,
    startDate: s.startDate,
    endDate: s.endDate,
    renewalDate: s.renewalDate,
    cancelledAt: s.cancelledAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
