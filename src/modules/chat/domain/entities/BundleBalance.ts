/**
 * Read model of an active subscription bundle, from the chat module's point of
 * view: how many messages it still allows. The subscription lifecycle itself
 * (billing, renewal, cancellation) belongs to the subscriptions module.
 */
export class BundleBalance {
  constructor(
    readonly subscriptionId: string,
    /** `null` means unlimited (Enterprise). */
    readonly maxMessages: number | null,
    readonly usedMessages: number,
    readonly createdAt: Date,
  ) {}

  get isUnlimited(): boolean {
    return this.maxMessages === null;
  }

  get remaining(): number {
    if (this.maxMessages === null) return Number.POSITIVE_INFINITY;
    return Math.max(this.maxMessages - this.usedMessages, 0);
  }

  hasRemaining(): boolean {
    return this.remaining > 0;
  }
}
