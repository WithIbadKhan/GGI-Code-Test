import { beforeEach, describe, expect, it } from 'vitest';
import { planTerms } from '../../../src/modules/subscriptions/domain/entities/Plan.js';
import { Subscription } from '../../../src/modules/subscriptions/domain/entities/Subscription.js';
import { BillingService } from '../../../src/modules/subscriptions/domain/services/BillingService.js';
import {
  InMemorySubscriptionStore,
  ScriptedPaymentGateway,
} from '../../support/InMemorySubscriptionStore.js';

const bought = new Date('2026-09-10T12:00:00Z');
const afterCycle = new Date('2026-10-10T12:00:01Z');

describe('BillingService', () => {
  let store: InMemorySubscriptionStore;
  let gateway: ScriptedPaymentGateway;
  let now: Date;
  let billing: BillingService;

  beforeEach(() => {
    store = new InMemorySubscriptionStore();
    gateway = new ScriptedPaymentGateway();
    now = afterCycle;
    billing = new BillingService({
      unitOfWork: store,
      subscriptions: store,
      paymentGateway: gateway,
      clock: { now: () => now },
    });
  });

  function add(id: string, autoRenew: boolean): Subscription {
    const s = Subscription.purchase({
      id,
      userId: 'alice',
      terms: planTerms('PRO', 'MONTHLY'),
      autoRenew,
      now: bought,
    });
    store.subscriptions.set(id, s);
    return s;
  }

  it('renews auto-renewing subscriptions after a successful charge', async () => {
    const s = add('sub-1', true);

    const summary = await billing.runRenewals();

    expect(summary).toEqual({ due: 1, renewed: 1, paymentFailed: 0, expired: 0, skipped: 0 });
    expect(s.status).toBe('ACTIVE');
    expect(s.endDate).toEqual(new Date('2026-11-10T12:00:00Z'));
    expect(gateway.charges).toEqual([expect.objectContaining({ amountCents: 2999 })]);
  });

  it('marks the subscription INACTIVE when the renewal payment fails', async () => {
    const s = add('sub-1', true);
    gateway.declineNextCharges();

    const summary = await billing.runRenewals();

    expect(summary.paymentFailed).toBe(1);
    expect(s.status).toBe('INACTIVE');
  });

  it('expires subscriptions without auto-renew, without charging', async () => {
    const s = add('sub-1', false);

    const summary = await billing.runRenewals();

    expect(summary.expired).toBe(1);
    expect(s.status).toBe('INACTIVE');
    expect(gateway.charges).toHaveLength(0);
  });

  it('leaves subscriptions that are not due yet alone', async () => {
    add('sub-1', true);
    now = new Date('2026-09-20T00:00:00Z');

    const summary = await billing.runRenewals();

    expect(summary.due).toBe(0);
    expect(gateway.charges).toHaveLength(0);
  });

  it('never renews a cancelled subscription', async () => {
    const s = add('sub-1', true);
    s.cancel(new Date('2026-09-15T00:00:00Z'));

    const summary = await billing.runRenewals();

    expect(summary.due).toBe(0);
    expect(s.status).toBe('CANCELLED');
  });
});
