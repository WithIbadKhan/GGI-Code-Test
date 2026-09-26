import type pg from 'pg';
import { systemClock, type Clock } from '../../shared/domain/Clock.js';
import { MetricsService } from './domain/services/MetricsService.js';
import { PgMetricsReader } from './repositories/PgMetricsReader.js';

export function createMetricsService(deps: { pool: pg.Pool; clock?: Clock }): MetricsService {
  return new MetricsService(new PgMetricsReader(deps.pool), deps.clock ?? systemClock);
}
