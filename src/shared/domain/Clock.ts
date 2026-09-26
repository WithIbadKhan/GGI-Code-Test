/** Injected wherever "now" matters, so month boundaries can be tested deterministically. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
