import { Pool, type PoolClient } from 'pg';

import { createLogger } from '../utils/logger.js';
import { convertPlaceholders, translateDialect } from './dialect.js';

const log = createLogger('pg');

/**
 * Async data access for the migration off SQLite.
 *
 * `better-sqlite3` is synchronous, so all 536 call sites read like
 * `db.prepare(sql).get(id)` and every caller above them is written as if the
 * database were free. Postgres is a network service; those call sites have to
 * become async, and so does everything up the stack.
 *
 * Two decisions keep that diff as small as it can be:
 *
 * - **`?` placeholders still work.** The existing SQL uses SQLite's `?`;
 *   rewriting every statement to `$1, $2` by hand would be thousands of edits
 *   whose only purpose is syntax. [convertPlaceholders] does it, so a ported
 *   query differs from the original by `await` and the method name.
 * - **The method names match.** `get`, `all` and `run` mirror better-sqlite3's
 *   statement API, so reviewing a ported module is reading the same shape.
 *
 * What is deliberately *not* provided is a synchronous facade. It is technically
 * possible with a worker thread and Atomics.wait, and it would make this a
 * drop-in change — but it would block the event loop on network I/O. Blocking on
 * a local file, which is what happens today, costs microseconds; blocking on a
 * socket would stall every streaming session in the process for the duration of
 * each query.
 */

let pool: Pool | null = null;

export interface PgConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
}

export function readPgConfig(): PgConfig {
  return {
    host: process.env.PGHOST || 'plum-postgres',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'plumcode',
    user: process.env.PGUSER || 'plumcode',
    password: process.env.PGPASSWORD || '',
    max: Number(process.env.PGPOOL_MAX || 10),
  };
}

export function getPool(): Pool {
  if (pool) return pool;
  const config = readPgConfig();
  pool = new Pool(config);
  // An idle client that dies (a restart of the database, a dropped connection)
  // emits on the pool, and an unhandled 'error' event takes the process down.
  pool.on('error', (error) => log.error('Idle client error', { error: String(error) }));

  // PGSCHEMA gives a test run its own tables in the same database. It is set
  // per connection rather than once, because the pool opens new clients
  // whenever it needs them and a client without it would silently read and
  // write `public` — the real data.
  const schema = process.env.PGSCHEMA;
  if (schema) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`PGSCHEMA is not a valid identifier: ${schema}`);
    }
    pool.on('connect', (client) => {
      void client.query(`SET search_path TO "${schema}"`);
    });
  }
  log.info('Postgres pool created', {
    host: config.host,
    database: config.database,
    max: config.max,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

type Queryable = Pick<Pool, 'query'> | PoolClient;

async function execute(
  client: Queryable,
  sql: string,
  params: unknown[]
): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
  return client.query(convertPlaceholders(translateDialect(sql)), params);
}

/** First row, or undefined — the shape `better-sqlite3`'s `.get()` returns. */
export async function get(sql: string, ...params: unknown[]): Promise<any> {
  return (await execute(getPool(), sql, params)).rows[0];
}

/** All rows, like `.all()`. */
export async function all(sql: string, ...params: unknown[]): Promise<any[]> {
  return (await execute(getPool(), sql, params)).rows;
}

/** Writes, like `.run()`; `changes` mirrors the field the callers already read. */
export async function run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  const result = await execute(getPool(), sql, params);
  return { changes: result.rowCount ?? 0 };
}

/**
 * The same three methods, pinned to one client.
 *
 * Deliberately not generic. `pg` ships an ESM entry without declarations, so a
 * generic constrained to its QueryResultRow resolves to two unrelated types in
 * one file. The existing code already casts every read — `.get(...) as { ok:
 * number } | undefined` — so returning rows and letting the caller name the
 * shape matches what is there rather than adding a type dance around it.
 */
export interface TransactionScope {
  get(sql: string, ...params: unknown[]): Promise<any>;
  all(sql: string, ...params: unknown[]): Promise<any[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}

/**
 * All statements inside `fn` run on one client, so they share the transaction.
 * Using the pool helpers there instead would silently take a different
 * connection per statement and commit nothing.
 */
export async function transaction<T>(fn: (tx: TransactionScope) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  const scope: TransactionScope = {
    async get(sql, ...params) {
      return (await execute(client, sql, params)).rows[0];
    },
    async all(sql, ...params) {
      return (await execute(client, sql, params)).rows;
    },
    async run(sql, ...params) {
      return { changes: (await execute(client, sql, params)).rowCount ?? 0 };
    },
  };

  try {
    await client.query('BEGIN');
    const result = await fn(scope);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export { convertPlaceholders, translateDialect } from './dialect.js';
