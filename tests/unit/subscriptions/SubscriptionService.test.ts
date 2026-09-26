import { beforeEach, describe, expect, it } from 'vitest';
import { PaymentFailedError } from '../../../src/modules/subscriptions/domain/errors.js';
import { SubscriptionService } from '../../../src/modules/subscriptions/domain/services/SubscriptionService.js';
import type { Actor } from '../../../src/shared/domain/Actor.js';
import { ForbiddenError, NotFoundError } from '../../../src/shared/domain/errors.js';
import {
  InMemorySubscriptionStore,
  ScriptedPaymentGateway,
} from '../../support/InMemorySubscriptionStore.js';

const alice: Actor = { userId: 'alice', roles: ['user'] };
const bob: Actor = { userId: 'bob', roles: ['user'] };
const admin: Actor = { userId: 'root', roles: ['user', 'admin'] };

describe('SubscriptionService', () => {
  let store: InMemorySubscriptionStore;
  let gateway: ScriptedPaymentGateway;
  let service: SubscriptionService;
  let ids: number;

  beforeEach(() => {
    store = new InMemorySubscriptionStore();
    gateway = new ScriptedPaymentGateway();
    ids = 0;
    service = new SubscriptionService({
      unitOfWork: store,
      subscriptions: store,
      paymentGateway: gateway,
      clock: { now: () => new Date('2026-09-10T12:00:00Z') },
      generateId: () => `id-${String(++ids)}`,
    });
  });

  const buyBasic = (actor: Actor = alice) =>
    service.purchase(actor, { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });

  it('charges the plan price and activates the subscription for the caller', async () => {
    const subscription = await buyBasic();

    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.userId).toBe('alice');
    expect(gateway.charges).toEqual([
      expect.objectContaining({ userId: 'alice', amountCents: 999, currency: 'USD' }),
    ]);
  });

  it('stores a declined purchase as INACTIVE and throws a typed error', async () => {
    gateway.declineNextCharges();

    const error = await buyBasic().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PaymentFailedError);
    const [stored] = [...store.subscriptions.values()];
    expect(stored?.status).toBe('INACTIVE');
  });

  it('refuses callers without a role', async () => {
    await expect(buyBasic({ userId: 'ghost', roles: [] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides other users' subscriptions, but shows them to admins", async () => {
    const subscription = await buyBasic(alice);

    await expect(service.get(bob, subscription.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.get(admin, subscription.id)).resolves.toBe(subscription);
  });

  it("does not let another user cancel or modify someone's subscription", async () => {
    const subscription = await buyBasic(alice);

    await expect(service.cancel(bob, subscription.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.setAutoRenew(bob, subscription.id, false)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(subscription.status).toBe('ACTIVE');
  });

  it('lets the owner cancel', async () => {
    const subscription = await buyBasic(alice);

    const cancelled = await service.cancel(alice, subscription.id);

    expect(cancelled.status).toBe('CANCELLED');
  });

  it("forbids listing another user's subscriptions unless admin", async () => {
    await buyBasic(alice);

    await expect(
      service.list(bob, { userId: 'alice', limit: 10, offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.list(admin, { userId: 'alice', limit: 10, offset: 0 }),
    ).resolves.toHaveLength(1);
  });
});
