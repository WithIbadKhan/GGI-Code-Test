import { InvariantViolationError } from '../../../../shared/domain/errors.js';

const ISO_MONTH_START = /^(\d{4})-(\d{2})-01$/;

/**
 * A calendar month in UTC. Usage is counted per period, so the free quota
 * "resets" on the 1st simply because a new period starts; nothing is deleted.
 */
export class UsagePeriod {
  private constructor(
    readonly year: number,
    /** 1 = January, 12 = December */
    readonly month: number,
  ) {}

  static containing(instant: Date): UsagePeriod {
    return new UsagePeriod(instant.getUTCFullYear(), instant.getUTCMonth() + 1);
  }

  /** Parses the `YYYY-MM-01` form used in the database. */
  static fromIsoDate(value: string): UsagePeriod {
    const match = ISO_MONTH_START.exec(value);
    if (!match) {
      throw new InvariantViolationError(`"${value}" is not the first day of a month.`);
    }
    const month = Number(match[2]);
    if (month < 1 || month > 12) {
      throw new InvariantViolationError(`"${value}" has an invalid month.`);
    }
    return new UsagePeriod(Number(match[1]), month);
  }

  /** Inclusive start of the period. */
  get startsAt(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, 1));
  }

  /** Exclusive end of the period, which is also when the free quota resets. */
  get endsAt(): Date {
    return new Date(Date.UTC(this.year, this.month, 1));
  }

  toIsoDate(): string {
    return `${String(this.year)}-${String(this.month).padStart(2, '0')}-01`;
  }

  equals(other: UsagePeriod): boolean {
    return this.year === other.year && this.month === other.month;
  }
}
