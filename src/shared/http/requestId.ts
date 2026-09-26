import type { Request } from 'express';

/** The id assigned by pino-http's `genReqId` (always a string in this app). */
export function requestIdOf(req: Request): string {
  return typeof req.id === 'string' ? req.id : 'unknown';
}
