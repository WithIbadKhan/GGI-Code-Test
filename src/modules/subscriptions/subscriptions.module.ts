import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { systemClock, type Clock } from '../../shared/domain/Clock.js';
import type { PaymentGateway } from './domain/ports/PaymentGateway.js';
import { BillingService } from './domain/services/BillingService.js';
import { SubscriptionService } from './domain/services/SubscriptionService.js';
import { PgSubscriptionRepository } from './repositories/PgSubscriptionRepository.js';
import { PgSubscriptionUnitOfWork } from './repositories/PgSubscriptionUnitOfWork.js';

/** Wires the subscription module's use cases to their concrete adapters. */
export function createSubscriptionServices(deps: {
  pool: pg.Pool;
  paymentGateway: PaymentGateway;
  clock?: Clock;
}): { subscriptionService: SubscriptionService; billingService: BillingService } {
  const shared = {
    unitOfWork: new PgSubscriptionUnitOfWork(deps.pool),
    subscriptions: new PgSubscriptionRepository(deps.pool),
    paymentGateway: deps.paymentGateway,
    clock: deps.clock ?? systemClock,
  };

  return {
    subscriptionService: new SubscriptionService({ ...shared, generateId: randomUUID }),
    billingService: new BillingService(shared),
  };
}
