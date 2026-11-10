import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// For its side effect: config reads the repository's .env, which is where the
// database password lives. Without it a test run finds no credentials and
// skips itself, reporting success for a suite that never ran.
import '../config.js';
import { closePool, getPool } from './pg.js';

/**
 * A private schema per test run.
 *
 * Tests used to open `:memory:` or a throwaway file, which a server gives no
 * equivalent of. A schema does: `search_path` points every statement at it, so
 * two runs on the same database cannot see each other's tables, and dropping it
 * afterwards is one statement rather than a directory to clean up.
 *
 * PGSCHEMA is read by db/pg.ts when it hands out a connection, so this has to
 * be set before the pool is created — which is why every caller sets it at
 * module scope, before importing anything that touches the database.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Test schemas older than this are leftovers of a run that never cleaned up. */
const STALE_TEST_SCHEMA_SECONDS = 3 * 60 * 60;

/**
 * `test_<unix seconds, base 36>_<random>`: the time is in the name because
 * Postgres does not record when a schema was created, and a run that crashes
 * before `dropTestSchema()` leaves its schema behind — 37 of them had piled up
 * in the production database, which these tests share.
 */
export function useTestSchema(): string {
  const stamp = Math.floor(Date.now() / 1000).toString(36);
  const schema = `test_${stamp}_${randomBytes(4).toString('hex')}`;
  process.env.PGSCHEMA = schema;
  return schema;
}

/** Whether a schema name is a test schema old enough to be a leftover. */
export function isStaleTestSchema(name: string, nowSeconds = Date.now() / 1000): boolean {
  const stamped = /^test_([0-9a-z]{6,8})_[0-9a-f]{8}$/.exec(name);
  if (stamped) {
    const created = parseInt(stamped[1]!, 36);
    return Number.isFinite(created) && nowSeconds - created > STALE_TEST_SCHEMA_SECONDS;
  }
  // The scheme before the timestamp: nothing creates these any more.
  return /^test_[0-9a-f]{12}$/.test(name);
}

/** Drops leftovers of earlier runs; never the schema of this run. */
async function sweepStaleTestSchemas(current: string): Promise<void> {
  try {
    const { rows } = await getPool().query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'test\\_%'"
    );
    for (const { nspname } of rows) {
      if (nspname === current || !isStaleTestSchema(nspname)) continue;
      await getPool().query(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
    }
  } catch {
    // Housekeeping only; a test run must not fail because of it.
  }
}

/**
 * Creates the schema, applies the baseline and every migration recorded since.
 *
 * The migrations matter: a schema built from schema.sql alone is the database
 * as it was when the baseline was captured, not as it is. Skipping them made
 * the gateway tests fail on a column the running system has had for days.
 */
export async function createTestSchema(options: { runMigrations?: boolean } = {}): Promise<void> {
  const schema = process.env.PGSCHEMA;
  if (!schema) throw new Error('useTestSchema() must run before createTestSchema()');

  const pool = getPool();
  await sweepStaleTestSchemas(schema);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);

  // Opt out only to compare the baseline against the migrated shape — see
  // schema-drift.test.ts. Everything else wants the database as it is.
  if (options.runMigrations === false) return;

  const { runPendingMigrations } = await import('./migrations.js');
  await runPendingMigrations();
}

export async function dropTestSchema(): Promise<void> {
  const schema = process.env.PGSCHEMA;
  if (!schema) return;
  try {
    await getPool().query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await closePool();
  }
}

/**
 * Whether a database is reachable at all.
 *
 * These are integration tests: without a server there is nothing to assert
 * against, and a connection error would be reported as a hundred failures that
 * say nothing about the code. They skip instead, and say why.
 */
export async function databaseReachable(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
