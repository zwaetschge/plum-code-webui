import { all as pgAll, get as pgGet, transaction as pgTransaction } from './pg.js';

/**
 * Schema changes made after the baseline, each run exactly once.
 *
 * `schema.sql` is idempotent and describes the schema as it stands. Anything
 * that changes it from here — a new column, a backfill, a drop — belongs in
 * [MIGRATIONS] below. Each step is recorded by id in `schema_migrations`, runs
 * inside a transaction with its own bookkeeping row, and is skipped forever
 * after.
 *
 * The work and the bookkeeping share one transaction on purpose: a crash
 * halfway leaves the migration unrecorded *and* undone, so the next boot
 * retries it rather than treating a failed step as done. Postgres makes that
 * stronger than it was under SQLite, where DDL and data changes could not
 * always be rolled back together.
 *
 * There is deliberately no automatic down-migration. A DROP that also deletes
 * rows cannot be reversed by running SQL backwards; the honest recovery path is
 * a restore.
 */

export interface AppliedMigration {
  id: string;
  appliedAt: string;
}

interface Migration {
  id: string;
  /** Statements run in order, inside one transaction with the bookkeeping. */
  statements: string[];
}

/**
 * Ordered, append-only. Never edit an entry that has shipped: a deployment that
 * already recorded the id will not run it again, so a changed step reaches new
 * databases and not existing ones — the exact divergence versioning is for.
 */
const MIGRATIONS: Migration[] = [
  {
    // Read-only gateway tokens. Added after the baseline was captured, so it is
    // a migration rather than part of schema.sql.
    id: '001-gateway-token-scope',
    statements: [
      `ALTER TABLE gateway_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'write'`,
    ],
  },
];

async function ensureTable(): Promise<void> {
  await pgTransaction(async (tx) => {
    await tx.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

export async function listAppliedMigrations(): Promise<AppliedMigration[]> {
  await ensureTable();
  return (await pgAll(
    'SELECT id, applied_at AS "appliedAt" FROM schema_migrations ORDER BY applied_at, id'
  )) as unknown as AppliedMigration[];
}

export async function hasMigrationRun(id: string): Promise<boolean> {
  await ensureTable();
  return !!(await pgGet('SELECT 1 FROM schema_migrations WHERE id = ?', id));
}

/**
 * Runs one migration and records it in the same transaction.
 *
 * @returns true if it ran now, false if it had already been applied.
 */
export async function runMigration(migration: Migration): Promise<boolean> {
  await ensureTable();
  if (await hasMigrationRun(migration.id)) return false;

  try {
    await pgTransaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.run(statement);
      }
      await tx.run('INSERT INTO schema_migrations (id) VALUES (?)', migration.id);
    });
    console.log(`[migrations] Applied ${migration.id}`);
    return true;
  } catch (error) {
    // Left unrecorded on purpose: the next boot retries it rather than silently
    // treating a failed step as done.
    console.error(`[migrations] ${migration.id} failed and was rolled back:`, error);
    throw error;
  }
}

/** Applies every migration not yet recorded, in order. */
export async function runPendingMigrations(): Promise<number> {
  let applied = 0;
  for (const migration of MIGRATIONS) {
    if (await runMigration(migration)) applied += 1;
  }
  return applied;
}

/**
 * Marks a migration as applied without running it — for a step that already
 * happened on an existing deployment through some other route, so it is not
 * repeated against a database that has long since moved on.
 */
export async function markMigrationApplied(id: string): Promise<void> {
  await ensureTable();
  await pgTransaction(async (tx) => {
    await tx.run('INSERT INTO schema_migrations (id) VALUES (?) ON CONFLICT (id) DO NOTHING', id);
  });
}
