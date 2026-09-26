import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { AppError, type ErrorCode } from '../domain/errors.js';
import { requestIdOf } from './requestId.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_JSON: 400,
  UNAUTHENTICATED: 401,
  INVALID_SIGNATURE: 401,
  QUOTA_EXHAUSTED: 402,
  PAYMENT_FAILED: 402,
  INVALID_STATE: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONCURRENCY_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  AI_PROVIDER_UNAVAILABLE: 503,
  REQUEST_TIMEOUT: 503,
  AI_TIMEOUT: 504,
};

interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Readonly<Record<string, unknown>>;
    requestId: string;
  };
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} does not exist.`));
};

/**
 * The single place where errors become HTTP responses. Every error body has the
 * same shape, and internal details (stack traces, SQL, upstream messages) are
 * logged but never returned to the client.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (res.headersSent) {
    // e.g. the handler finished after the global timeout had already answered.
    req.log.warn({ err }, 'Error raised after the response was sent');
    return;
  }

  const appError = toAppError(err);
  if (STATUS_BY_CODE[appError.code] >= 500) {
    req.log.error({ err }, 'Request failed');
  } else {
    req.log.warn({ code: appError.code, reason: appError.message }, 'Request rejected');
  }
  sendError(req, res, appError);
};

/** Writes the standard error body. Also used by middleware that must answer directly. */
export function sendError(req: Request, res: Response, appError: AppError): void {
  const status = STATUS_BY_CODE[appError.code];
  if (appError.code === 'UNAUTHENTICATED') {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
  }

  const body: ErrorResponseBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId: requestIdOf(req),
    },
  };
  res.status(status).json(body);
}

/** Converts framework errors (e.g. from express.json) and unknown throws into AppErrors. */
function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const bodyParserType = (err as { type?: unknown } | null)?.type;
  if (bodyParserType === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  if (bodyParserType === 'entity.parse.failed') {
    return new AppError('INVALID_JSON', 'The request body is not valid JSON.');
  }
  if (bodyParserType === 'encoding.unsupported' || bodyParserType === 'charset.unsupported') {
    return new AppError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported request body encoding.');
  }

  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.');
}
