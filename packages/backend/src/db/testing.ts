import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

export function useTestSchema(): string {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  process.env.PGSCHEMA = schema;
  return schema;
}

/**
 * Creates the schema, applies the baseline and every migration recorded since.
 *
 * The migrations matter: a schema built from schema.sql alone is the database
 * as it was when the baseline was captured, not as it is. Skipping them made
 * the gateway tests fail on a column the running system has had for days.
 */
export async function createTestSchema(): Promise<void> {
  const schema = process.env.PGSCHEMA;
  if (!schema) throw new Error('useTestSchema() must run before createTestSchema()');

  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);

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
