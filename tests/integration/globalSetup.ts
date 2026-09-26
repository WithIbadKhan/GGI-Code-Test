import 'dotenv/config';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

/** Recreates the test database schema and applies every migration, once per test run. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set to run integration tests (see .env.example).');
  }
  // Safety net: this wipes the schema, so refuse anything that is not clearly a test database.
  if (!new URL(url).pathname.includes('test')) {
    throw new Error(`Refusing to reset "${url}": the database name must contain "test".`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }

  await runner({
    databaseUrl: url,
    dir: 'migrations',
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}
