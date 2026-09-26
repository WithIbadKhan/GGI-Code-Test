import type { RequestHandler } from 'express';
import { AppError } from '../../domain/errors.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Strict content-type validation: a request that carries a body must declare it
 * as `application/json`. Without this, `express.json()` would simply skip
 * unknown types and the handler would see an empty body.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  const hasBody =
    req.headers['transfer-encoding'] !== undefined ||
    Number(req.headers['content-length'] ?? 0) > 0;

  if (METHODS_WITH_BODY.has(req.method) && hasBody && !req.is('application/json')) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
  }
  next();
};
