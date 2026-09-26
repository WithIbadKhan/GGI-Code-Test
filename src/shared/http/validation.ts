import type { z } from 'zod';
import { AppError } from '../domain/errors.js';

/**
 * Parses untrusted input with a schema, or throws a typed VALIDATION_FAILED
 * error listing every problem. Schemas are declared `strict`, so unknown fields
 * are rejected rather than silently copied (this prevents mass assignment).
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'The request is invalid.', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
