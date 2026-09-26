import pg from 'pg';

// Postgres DATE columns (OID 1082) are returned as plain 'YYYY-MM-DD' strings.
// By default `pg` turns them into JS Dates at *local* midnight, which silently
// shifts the value by the server's timezone offset.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guard against runaway queries holding connections forever.
    statement_timeout: 10_000,
  });
}
