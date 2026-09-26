import { z } from 'zod';
import { sanitizePlainText } from '../../../shared/security/sanitize.js';

const QUESTION_MAX_LENGTH = 2000;

/** `strictObject` rejects unknown fields, e.g. a client trying to send `userId` or `answer`. */
export const askQuestionSchema = z.strictObject({
  question: z
    .string()
    .trim()
    .min(1, 'question must not be empty')
    .max(QUESTION_MAX_LENGTH, `question must be at most ${QUESTION_MAX_LENGTH} characters`)
    .transform(sanitizePlainText)
    .refine((value) => value.length > 0, 'question must contain text, not only markup'),
});

export const listMessagesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  /** Admin only; the domain policy rejects it for regular users. */
  userId: z.string().min(1).max(255).optional(),
});

export const usageQuerySchema = z.strictObject({
  userId: z.string().min(1).max(255).optional(),
});

export const messageIdParamsSchema = z.strictObject({
  id: z.uuid(),
});
