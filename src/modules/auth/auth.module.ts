import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { systemClock, type Clock } from '../../shared/domain/Clock.js';
import { SessionService } from './domain/services/SessionService.js';
import { HmacSessionKeys } from './infrastructure/HmacSessionKeys.js';
import { PgNonceStore } from './repositories/PgNonceStore.js';
import { PgSessionRepository } from './repositories/PgSessionRepository.js';

export function createSessionService(deps: {
  pool: pg.Pool;
  signingSecret: string;
  maxClockSkewSeconds: number;
  maxSessionTtlSeconds: number;
  clock?: Clock;
}): SessionService {
  return new SessionService({
    sessions: new PgSessionRepository(deps.pool),
    nonces: new PgNonceStore(deps.pool),
    keys: new HmacSessionKeys(deps.signingSecret),
    clock: deps.clock ?? systemClock,
    generateId: randomUUID,
    maxClockSkewSeconds: deps.maxClockSkewSeconds,
    maxSessionTtlSeconds: deps.maxSessionTtlSeconds,
  });
}
