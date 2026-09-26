import { AppError } from '../../../shared/domain/errors.js';

export class PaymentFailedError extends AppError {
  constructor(subscriptionId: string, reason: string) {
    super('PAYMENT_FAILED', 'The payment was declined. The subscription has not been activated.', {
      subscriptionId,
      reason,
    });
  }
}

/** The requested change is not allowed in the subscription's current state. */
export class SubscriptionStateError extends AppError {
  constructor(message: string) {
    super('INVALID_STATE', message);
  }
}
