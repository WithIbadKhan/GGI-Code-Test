import { InvariantViolationError } from '../../../../shared/domain/errors.js';

export class TokenUsage {
  private constructor(
    readonly promptTokens: number,
    readonly completionTokens: number,
    readonly totalTokens: number,
  ) {}

  /**
   * `totalTokens` may be larger than prompt + completion: some providers (e.g.
   * Gemini "thinking" models) bill extra internal tokens. It can never be smaller.
   */
  static of(input: {
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
  }): TokenUsage {
    const { promptTokens, completionTokens } = input;
    const totalTokens = input.totalTokens ?? promptTokens + completionTokens;

    assertTokenCount('promptTokens', promptTokens);
    assertTokenCount('completionTokens', completionTokens);
    assertTokenCount('totalTokens', totalTokens);
    if (totalTokens < promptTokens + completionTokens) {
      throw new InvariantViolationError('totalTokens cannot be less than prompt + completion.');
    }

    return new TokenUsage(promptTokens, completionTokens, totalTokens);
  }
}

function assertTokenCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvariantViolationError(`${name} must be a non-negative integer.`);
  }
}
