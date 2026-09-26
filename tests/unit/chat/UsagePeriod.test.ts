import { describe, expect, it } from 'vitest';
import { UsagePeriod } from '../../../src/modules/chat/domain/entities/UsagePeriod.js';

describe('UsagePeriod', () => {
  it('maps any instant to its calendar month in UTC', () => {
    const period = UsagePeriod.containing(new Date('2026-09-26T18:45:00Z'));

    expect(period.toIsoDate()).toBe('2026-09-01');
    expect(period.startsAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(period.endsAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('starts a new period (the free quota reset) exactly at 00:00 UTC on the 1st', () => {
    const lastMoment = UsagePeriod.containing(new Date('2026-09-30T23:59:59.999Z'));
    const firstMoment = UsagePeriod.containing(new Date('2026-10-01T00:00:00.000Z'));

    expect(lastMoment.toIsoDate()).toBe('2026-09-01');
    expect(firstMoment.toIsoDate()).toBe('2026-10-01');
    expect(lastMoment.equals(firstMoment)).toBe(false);
  });

  it('rolls over from December to January', () => {
    const december = UsagePeriod.containing(new Date('2026-12-31T10:00:00Z'));

    expect(december.endsAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('round-trips through the database representation', () => {
    const period = UsagePeriod.fromIsoDate('2027-02-01');

    expect(period.toIsoDate()).toBe('2027-02-01');
    expect(period.equals(UsagePeriod.containing(new Date('2027-02-14T00:00:00Z')))).toBe(true);
  });

  it.each(['2026-09-15', '2026-13-01', 'not-a-date'])('rejects %s', (value) => {
    expect(() => UsagePeriod.fromIsoDate(value)).toThrow();
  });
});
