export interface ChargeRequest {
  subscriptionId: string;
  userId: string;
  amountCents: number;
  currency: string;
  description: string;
}

export type ChargeOutcome =
  { succeeded: true; reference: string } | { succeeded: false; reason: string };

/**
 * Port for taking a payment. The only implementation is a simulator, which
 * declines a configurable share of charges at random. A declined charge is a
 * normal outcome (returned), not an exception.
 */
export interface PaymentGateway {
  charge(request: ChargeRequest): Promise<ChargeOutcome>;
}
