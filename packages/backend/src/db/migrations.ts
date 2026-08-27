import type Database from 'better-sqlite3';

/**
 * One-way migrations that must run exactly once.
 *
 * Schema creation in initDatabase() is idempotent — `CREATE TABLE IF NOT EXISTS`
 * and guarded `ALTER TABLE` can be re-run forever. Destructive or data-rewriting
 * steps cannot: a DROP that also has to delete rows, a backfill, a column
 * rename. Those went in as bare `try { db.exec(...) } catch {}` blocks with no
 * record of whether they had already happened, so there was no way to tell a
 * fresh database from a migrated one, and no way to see what a given deployment
 * had actually applied.
 *
 * This records each step by id in `schema_migrations`, runs it inside a
 * transaction, and skips it forever after. There is deliberately no automatic
 * down-migration: SQLite cannot roll back a dropped table's data, so the honest
 * recovery path is the backup that `scripts/plum-maintenance.mjs` writes.
 */

export interface AppliedMigration {
  id: string;
  appliedAt: string;
}

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function listAppliedMigrations(db: Database.Database): AppliedMigration[] {
  ensureTable(db);
  return db
    .prepare('SELECT id, applied_at AS appliedAt FROM schema_migrations ORDER BY applied_at, id')
    .all() as AppliedMigration[];
}

export function hasMigrationRun(db: Database.Database, id: string): boolean {
  ensureTable(db);
  const row = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(id);
  return !!row;
}

/**
 * Runs `migrate` once and records it. The work and the bookkeeping share one
 * transaction, so a crash halfway leaves the migration unrecorded *and* undone
 * rather than half-applied.
 *
 * @returns true if it ran now, false if it had already been applied.
 */
export function runMigration(
  db: Database.Database,
  id: string,
  migrate: (db: Database.Database) => void
): boolean {
  ensureTable(db);
  if (hasMigrationRun(db, id)) return false;

  const apply = db.transaction(() => {
    migrate(db);
    db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(id);
  });

  try {
    apply();
    console.log(`[migrations] Applied ${id}`);
    return true;
  } catch (err) {
    // Left unrecorded on purpose: the next boot retries it rather than silently
    // treating a failed step as done.
    console.error(`[migrations] ${id} failed and was rolled back:`, err);
    throw err;
  }
}

/**
 * Marks a migration as applied without running it — for steps that already ran
 * on existing deployments through the old unguarded blocks, so they are not
 * repeated against databases that have long since moved on.
 */
export function markMigrationApplied(db: Database.Database, id: string): void {
  ensureTable(db);
  db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(id);
}
