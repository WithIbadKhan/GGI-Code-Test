/**
 * Every error the application raises on purpose carries a stable, machine
 * readable `code`. The HTTP layer maps codes to status codes; the domain never
 * talks about HTTP.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_JSON'
  | 'UNAUTHENTICATED'
  | 'INVALID_SIGNATURE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'QUOTA_EXHAUSTED'
  | 'PAYMENT_FAILED'
  | 'INVALID_STATE'
  | 'CONCURRENCY_CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'INTERNAL_ERROR';

export type ErrorDetails = Readonly<Record<string, unknown>>;

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetails,
    /** `cause` is kept for logs only; it is never serialised to the client. */
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You are not allowed to perform this action.') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} was not found.`);
  }
}

/** A business rule was broken inside the domain model. This is always a bug. */
export class InvariantViolationError extends AppError {
  constructor(message: string) {
    super('INTERNAL_ERROR', message);
  }
}

/** A guarded write did not affect the expected row (e.g. a concurrent change). */
export class ConcurrencyConflictError extends AppError {
  constructor(message: string) {
    super('CONCURRENCY_CONFLICT', message);
  }
}
