import pg from 'pg';

import { createLogger } from '../utils/logger.js';

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

let pool: pg.Pool | null = null;

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

export function getPool(): pg.Pool {
  if (pool) return pool;
  const config = readPgConfig();
  pool = new pg.Pool(config);
  // An idle client that dies (a restart of the database, a dropped connection)
  // emits on the pool, and an unhandled 'error' event takes the process down.
  pool.on('error', (error) => log.error('Idle client error', { error: String(error) }));
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

/**
 * Rewrites SQLite's `?` into Postgres's `$n`, leaving anything inside string
 * literals alone — `WHERE note = '?'` must not become `WHERE note = '$1'`.
 */
export function convertPlaceholders(sql: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;

    if (quote) {
      out += char;
      // '' inside a single-quoted string is an escaped quote, not the end.
      if (char === quote) {
        if (quote === "'" && sql[i + 1] === "'") {
          out += sql[++i]!;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }

    if (char === '?') {
      out += `$${++index}`;
      continue;
    }

    out += char;
  }

  return out;
}

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient;

async function execute<T extends pg.QueryResultRow>(
  client: Queryable,
  sql: string,
  params: unknown[]
): Promise<pg.QueryResult<T>> {
  return client.query<T>(convertPlaceholders(sql), params);
}

/** First row, or undefined — the shape `better-sqlite3`'s `.get()` returns. */
export async function get<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  ...params: unknown[]
): Promise<T | undefined> {
  const result = await execute<T>(getPool(), sql, params);
  return result.rows[0];
}

/** All rows, like `.all()`. */
export async function all<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const result = await execute<T>(getPool(), sql, params);
  return result.rows;
}

/** Writes, like `.run()`; `changes` mirrors the field the callers already read. */
export async function run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  const result = await execute(getPool(), sql, params);
  return { changes: result.rowCount ?? 0 };
}

export interface TransactionScope {
  get<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    ...params: unknown[]
  ): Promise<T | undefined>;
  all<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    ...params: unknown[]
  ): Promise<T[]>;
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
    get: async (sql, ...params) => (await execute(client, sql, params)).rows[0],
    all: async (sql, ...params) => (await execute(client, sql, params)).rows,
    run: async (sql, ...params) => ({
      changes: (await execute(client, sql, params)).rowCount ?? 0,
    }),
  };

  try {
    await client.query('BEGIN');
    const result = await fn(scope as TransactionScope);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
