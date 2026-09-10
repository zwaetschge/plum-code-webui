import { all as pgAll, get as pgGet, transaction as pgTransaction } from './pg.js';
import type { TransactionScope } from './pg.js';
import { REPRICE_MIGRATION_ID, repriceUsageHistory } from './reprice.js';

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
  /**
   * Optional code step, run after `statements` in the same transaction. For
   * work that cannot be written as fixed SQL because it depends on values only
   * TypeScript knows — the price table, for instance, is a function with
   * pattern matching, not an enumerable table.
   */
  run?: (tx: TransactionScope) => Promise<void>;
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
  {
    /**
     * The unread badge on the session list.
     *
     * The list runs one correlated subquery per session, each counting
     * assistant messages past a read marker. With 116 sessions over 99k
     * messages that measured 81ms and 11420 buffer hits — on every page load,
     * because the list is the first thing the UI asks for. Indexing the three
     * columns the subquery actually filters on takes it to 19ms and 1250
     * buffers.
     *
     * Partial on purpose: only assistant messages are ever counted, so
     * restricting the index keeps it a fraction of the size of the table and
     * off the write path for user messages.
     */
    id: '002-messages-unread-index',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_messages_unread
         ON messages (session_id, chat_id, seq) WHERE role = 'assistant'`,
    ],
  },
  {
    // Per-session subagent model override for Claude-transport sessions. The
    // value goes out as CLAUDE_CODE_SUBAGENT_MODEL at CLI spawn, so one session
    // can run its subagents on GLM while another stays fully on Claude.
    id: '003-session-subagent-model',
    statements: [`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS subagent_model TEXT DEFAULT NULL`],
  },
  {
    /**
     * Recompute stored costs from stored tokens with the current price table.
     *
     * The id carries `LLM_PRICING_RATE_CARD_VERSION`, so this is not one step
     * but one step *per rate card*: change the constant and the next boot sees
     * an id it has never recorded, reprices once, and writes it down. Until now
     * the constant was read by nothing at all, while both AGENTS.md and
     * CLAUDE.md described exactly this behaviour.
     */
    id: REPRICE_MIGRATION_ID,
    statements: [],
    run: async (tx) => {
      await repriceUsageHistory(tx);
    },
  },
  {
    /**
     * Make the usage dedup index actually cover every row.
     *
     * `turn_id` was nullable, and Postgres treats NULLs as distinct inside a
     * unique index — so every legacy row with no turn id sat outside the one
     * constraint that stops a turn being booked twice, and any future writer
     * that left the column out would have inherited that hole. The backfill
     * value is derived from the primary key, which is unique by construction.
     */
    id: '005-usage-history-turn-id-not-null',
    statements: [
      `UPDATE usage_history SET turn_id = 'legacy-' || id WHERE turn_id IS NULL`,
      `ALTER TABLE usage_history ALTER COLUMN turn_id SET NOT NULL`,
    ],
  },
  {
    /**
     * The snapshot retention pass deletes by `recorded_at` every 15 minutes and
     * had no index to do it with — a sequential scan of the whole table on a
     * schedule, growing with the table it is meant to keep small.
     */
    id: '006-usage-limit-snapshots-recorded-index',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_usage_limit_snapshots_recorded ON usage_limit_snapshots (recorded_at)`,
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
      if (migration.run) await migration.run(tx);
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
