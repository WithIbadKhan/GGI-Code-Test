import { describe, expect, it } from 'vitest';
import {
  addBillingCycle,
  planTerms,
} from '../../../src/modules/subscriptions/domain/entities/Plan.js';

describe('planTerms', () => {
  it.each([
    ['BASIC', 'MONTHLY', 10, 999],
    ['PRO', 'MONTHLY', 100, 2999],
    ['ENTERPRISE', 'MONTHLY', null, 9999],
    ['BASIC', 'YEARLY', 120, 9990],
    ['PRO', 'YEARLY', 1200, 29990],
    ['ENTERPRISE', 'YEARLY', null, 99990],
  ] as const)('%s %s: %s messages for %s cents', (tier, cycle, maxMessages, priceCents) => {
    expect(planTerms(tier, cycle)).toEqual({
      tier,
      billingCycle: cycle,
      maxMessages,
      priceCents,
      currency: 'USD',
    });
  });
});

describe('addBillingCycle', () => {
  const at = (iso: string) => new Date(iso);

  it('adds one month, keeping the time of day', () => {
    expect(addBillingCycle(at('2026-09-15T10:30:00Z'), 'MONTHLY')).toEqual(
      at('2026-10-15T10:30:00Z'),
    );
  });

  it('clamps to the last day of a shorter month', () => {
    expect(addBillingCycle(at('2026-01-31T00:00:00Z'), 'MONTHLY')).toEqual(
      at('2026-02-28T00:00:00Z'),
    );
    expect(addBillingCycle(at('2028-01-31T00:00:00Z'), 'MONTHLY')).toEqual(
      at('2028-02-29T00:00:00Z'), // leap year
    );
  });

  it('rolls over the year for December', () => {
    expect(addBillingCycle(at('2026-12-10T00:00:00Z'), 'MONTHLY')).toEqual(
      at('2027-01-10T00:00:00Z'),
    );
  });

  it('adds twelve months for yearly plans', () => {
    expect(addBillingCycle(at('2028-02-29T00:00:00Z'), 'YEARLY')).toEqual(
      at('2029-02-28T00:00:00Z'),
    );
  });
});
