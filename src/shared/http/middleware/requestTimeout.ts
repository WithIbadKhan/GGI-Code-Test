import type { RequestHandler } from 'express';
import { AppError } from '../../domain/errors.js';
import { sendError } from '../errorHandler.js';

/**
 * Global request timeout. If no response has been sent after `timeoutMs`, the
 * client gets a structured 503. Handlers still bound their own work (the AI
 * provider and the database each have their own, shorter timeouts), so a timed
 * out request does not keep running for long.
 */
export function requestTimeout(timeoutMs: number): RequestHandler {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        req.log.warn({ timeoutMs }, 'Request timed out');
        sendError(req, res, new AppError('REQUEST_TIMEOUT', 'The request took too long.'));
      }
    }, timeoutMs);

    const clear = (): void => {
      clearTimeout(timer);
    };
    res.once('finish', clear);
    res.once('close', clear);
    next();
  };
}
