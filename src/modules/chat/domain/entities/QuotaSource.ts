/** Where the quota for a single chat message was taken from. */
export type QuotaSource =
  { readonly kind: 'FREE' } | { readonly kind: 'BUNDLE'; readonly subscriptionId: string };

export const FREE_QUOTA: QuotaSource = { kind: 'FREE' };

export function bundleQuota(subscriptionId: string): QuotaSource {
  return { kind: 'BUNDLE', subscriptionId };
}
