import { describe, expect, it } from 'vitest';
import { BundleBalance } from '../../../src/modules/chat/domain/entities/BundleBalance.js';
import { UsagePeriod } from '../../../src/modules/chat/domain/entities/UsagePeriod.js';
import {
  QuotaCalculator,
  type QuotaSnapshot,
} from '../../../src/modules/chat/domain/services/QuotaCalculator.js';

const period = UsagePeriod.containing(new Date('2026-09-15T12:00:00Z'));
const calculator = new QuotaCalculator(3);

function snapshot(freeUsed: number, bundles: BundleBalance[] = []): QuotaSnapshot {
  return { period, freeUsed, activeBundles: bundles };
}

function bundle(id: string, max: number | null, used: number, createdAt: string): BundleBalance {
  return new BundleBalance(id, max, used, new Date(createdAt));
}

describe('QuotaCalculator.decide', () => {
  it('uses the free quota while any free messages are left', () => {
    const withBundle = [bundle('basic', 10, 0, '2026-09-01')];

    expect(calculator.decide(snapshot(0, withBundle))).toEqual({
      granted: true,
      source: { kind: 'FREE' },
    });
    expect(calculator.decide(snapshot(2, withBundle))).toEqual({
      granted: true,
      source: { kind: 'FREE' },
    });
  });

  it('requires a subscription once the 3 free messages are used and no bundle exists', () => {
    expect(calculator.decide(snapshot(3))).toEqual({
      granted: false,
      reason: 'SUBSCRIPTION_REQUIRED',
    });
  });

  it('charges the most recently purchased bundle that still has messages', () => {
    const decision = calculator.decide(
      snapshot(3, [
        bundle('older-pro', 100, 5, '2026-08-01'),
        bundle('newest-basic', 10, 2, '2026-09-10'),
        bundle('middle-basic', 10, 0, '2026-09-01'),
      ]),
    );

    expect(decision).toEqual({
      granted: true,
      source: { kind: 'BUNDLE', subscriptionId: 'newest-basic' },
    });
  });

  it('skips a newer bundle that is already used up', () => {
    const decision = calculator.decide(
      snapshot(3, [
        bundle('newest-full', 10, 10, '2026-09-10'),
        bundle('older-pro', 100, 99, '2026-08-01'),
      ]),
    );

    expect(decision).toEqual({
      granted: true,
      source: { kind: 'BUNDLE', subscriptionId: 'older-pro' },
    });
  });

  it('treats an Enterprise bundle (no max) as unlimited', () => {
    const decision = calculator.decide(
      snapshot(3, [bundle('enterprise', null, 1_000_000, '2026-01-01')]),
    );

    expect(decision).toEqual({
      granted: true,
      source: { kind: 'BUNDLE', subscriptionId: 'enterprise' },
    });
  });

  it('reports BUNDLES_EXHAUSTED when every active bundle is used up', () => {
    const decision = calculator.decide(
      snapshot(3, [bundle('a', 10, 10, '2026-09-01'), bundle('b', 100, 100, '2026-08-01')]),
    );

    expect(decision).toEqual({ granted: false, reason: 'BUNDLES_EXHAUSTED' });
  });

  it('breaks ties between bundles bought at the same moment deterministically', () => {
    const sameTime = '2026-09-01T00:00:00Z';
    const first = calculator.decide(
      snapshot(3, [bundle('aaa', 10, 0, sameTime), bundle('bbb', 10, 0, sameTime)]),
    );
    const reversed = calculator.decide(
      snapshot(3, [bundle('bbb', 10, 0, sameTime), bundle('aaa', 10, 0, sameTime)]),
    );

    expect(first).toEqual(reversed);
  });

  it('honours a configurable free allowance, including zero', () => {
    expect(new QuotaCalculator(0).decide(snapshot(0))).toEqual({
      granted: false,
      reason: 'SUBSCRIPTION_REQUIRED',
    });
  });
});

describe('QuotaCalculator.summarize', () => {
  it('reports remaining free and bundle messages and the next reset', () => {
    const summary = calculator.summarize(
      snapshot(1, [bundle('a', 10, 4, '2026-09-01'), bundle('b', 100, 90, '2026-08-01')]),
    );

    expect(summary).toEqual({
      freeLimit: 3,
      freeUsed: 1,
      freeRemaining: 2,
      activeBundles: 2,
      bundleMessagesRemaining: 16,
      resetsAt: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('reports unlimited bundle messages as null', () => {
    const summary = calculator.summarize(snapshot(3, [bundle('ent', null, 5, '2026-09-01')]));

    expect(summary.bundleMessagesRemaining).toBeNull();
    expect(summary.freeRemaining).toBe(0);
  });
});
