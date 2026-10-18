import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { type CLIProvider } from '@plum-code-webui/shared';

import { bootstrapAdmin, seedUserFromEnv } from './bootstrap.js';
import { runPendingMigrations } from './migrations.js';
import {
  get as pgGet,
  getPool,
  run as pgRun,
  transaction as pgTransaction,
} from './pg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIRECTORY = process.env.WEBUI_DATA_DIR
  ? path.resolve(process.env.WEBUI_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

/**
 * Where files that used to live beside the database file go.
 *
 * Backups, chat media and uploads were all located relative to
 * `claude-webui.db`. With the rows in Postgres there is no such file, but those
 * are still local files and still need a directory, so the directory is now
 * named directly instead of being derived from a path that no longer exists.
 */
export function getDataDirectory(): string {
  return DATA_DIRECTORY;
}

/**
 * Applies the baseline schema, then any migration recorded since.
 *
 * The SQLite version of this function was two thousand lines: CREATE TABLE
 * IF NOT EXISTS for every table, followed by ALTER TABLE ADD COLUMN wrapped in
 * try/catch for every column added since, replayed from scratch on every boot.
 * That worked, but the schema could only be read by executing it.
 *
 * The Postgres schema is a file. `schema.sql` is the state that history
 * produced, generated from it by scripts/sqlite-to-postgres.mjs, and applied
 * idempotently; anything after it is a numbered migration with a row in
 * `schema_migrations` saying whether it ran.
 */
/**
 * Applies the baseline schema. Separate from [initDatabase] so `pnpm
 * db:migrate` can do the schema work without also starting the bootstrapping a
 * booting server needs.
 */
export async function applySchema(): Promise<void> {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // One call: without parameters `pg` uses the simple query protocol, which
  // takes the whole file as a single implicit transaction. A statement-by-
  // statement loop would leave a half-created schema behind on failure.
  await getPool().query(schema);
}

export async function initDatabase(): Promise<void> {
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }

  await applySchema();
  await runPendingMigrations();

  await bootstrapAdmin();
  await seedUserFromEnv();

  // The in-memory process registry starts empty after every backend restart.
  // Any persisted `running` rows therefore describe processes owned by the old
  // backend instance and must not be presented as live sessions.
  const reconciled = await reconcileStaleRunningSessions();
  if (reconciled > 0) {
    console.log(`[DB] Reconciled ${reconciled} stale running session(s) to stopped.`);
  }
}

export interface UsageHistoryTurnInput {
  userId: string;
  sessionId: string;
  /**
   * Usually a CLIProvider, but a routed subagent upstream books under its own
   * label slug — the column is TEXT and the analytics label falls back to the
   * model's family for providers it does not recognise.
   */
  provider: CLIProvider | (string & {});
  turnId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number;
  model: string | null;
  createdAt?: string;
}

export interface UsageSubagentTurnInput {
  userId: string;
  sessionId: string;
  provider: CLIProvider;
  turnId: string;
  agentId: string;
  parentAgentId: string | null;
  agentType: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number;
}

/**
 * Record the per-subagent split of a turn. Purely additive detail — the turn's
 * usage_history row already contains these tokens, so never sum both.
 */
export async function insertUsageSubagentTurns(rows: UsageSubagentTurnInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  return pgTransaction(async (tx) => {
    let inserted = 0;
    for (const row of rows) {
      const result = await tx.run(
        `INSERT INTO usage_subagent_turns (
           user_id, session_id, provider, turn_id, agent_id, parent_agent_id, agent_type, model,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
           total_tokens, cost_usd
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id, provider, turn_id, agent_id) DO NOTHING`,
        row.userId,
        row.sessionId,
        row.provider,
        row.turnId,
        row.agentId,
        row.parentAgentId,
        row.agentType,
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens,
        row.cacheCreationTokens,
        row.totalTokens,
        toMicroDollars(row.costUsd)
      );
      inserted += result.changes;
    }
    return inserted;
  });
}

/** True when this provider turn has already been booked into usage_history. */
export async function usageHistoryTurnExists(
  sessionId: string,
  provider: CLIProvider,
  turnId: string
): Promise<boolean> {
  const row = await pgGet(
    `SELECT 1 FROM usage_history
      WHERE session_id = ? AND provider = ? AND turn_id = ?
      LIMIT 1`,
    sessionId,
    provider,
    turnId
  );
  return !!row;
}

/** Persist one provider turn exactly once. Returns false for a duplicate turn. */
/**
 * Costs are stored in DOUBLE PRECISION. Changing the column type would rewrite
 * a table that only grows, for a precision nobody needs — an estimate derived
 * from a per-million-token rate card is not an invoice. What does matter is
 * that the same turn priced twice yields the same number, so the value is
 * quantised to micro-dollars before it is written, the same unit the repricing
 * migration rounds to.
 */
function toMicroDollars(cost: number): number {
  return Number.isFinite(cost) ? Math.round(cost * 1e6) / 1e6 : 0;
}

export async function insertUsageHistoryTurn(input: UsageHistoryTurnInput): Promise<boolean> {
  const createdAt = input.createdAt
    ? new Date(input.createdAt).toISOString().slice(0, 19).replace('T', ' ')
    : null;
  const result = await pgRun(
    `INSERT INTO usage_history (
       user_id,
       session_id,
       provider,
       turn_id,
       input_tokens,
       output_tokens,
       cache_read_tokens,
       cache_creation_tokens,
       total_tokens,
       cost_usd,
       model,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
     ON CONFLICT (session_id, provider, turn_id) DO NOTHING`,
    input.userId,
    input.sessionId,
    input.provider,
    input.turnId,
    input.inputTokens,
    input.outputTokens,
    input.cacheReadTokens,
    input.cacheCreationTokens,
    input.totalTokens,
    toMicroDollars(input.costUsd),
    input.model,
    createdAt
  );
  return result.changes > 0;
}

/**
 * Age out old analytics rows.
 *
 * `usage_limit_snapshots` has had a 180-day retention since it was written;
 * `usage_history` had none, and it grows faster than one row per turn — routed
 * subagent requests and CLI-subagent runs all write here
 * too. Seven indexes ride along with it, and the analytics timeline scans
 * `(user_id, created_at)` ranges whose plan cost grows with the table. On a
 * box that stays up for years that is not a rounding error.
 *
 * Default is a year, which covers every range the analytics UI offers with
 * room to spare. `USAGE_HISTORY_RETENTION_DAYS=0` turns it off for anyone who
 * wants to keep the lot.
 */
export async function pruneUsageHistory(): Promise<number> {
  const days = Number(process.env.USAGE_HISTORY_RETENTION_DAYS ?? 365);
  if (!Number.isFinite(days) || days <= 0) return 0;

  return pgTransaction(async (tx) => {
    // created_at is TEXT in the shape the schema kept, so the cutoff is
    // formatted to match rather than compared as a timestamp.
    const cutoff = `to_char(now() - interval '${Math.floor(days)} days', 'YYYY-MM-DD HH24:MI:SS')`;
    // The subagent breakdown is keyed by (session, provider, turn) rather than
    // by a foreign key, so it is pruned on its own timestamp — same cutoff, same
    // transaction, so the two tables cannot disagree even for a moment.
    await tx.run(`DELETE FROM usage_subagent_turns WHERE created_at < ${cutoff}`);
    const result = await tx.run(`DELETE FROM usage_history WHERE created_at < ${cutoff}`);
    if (result.changes > 0) {
      console.log(`[USAGE] Pruned ${result.changes} usage_history rows older than ${days} days`);
    }
    return result.changes;
  });
}

export async function reconcileStaleRunningSessions(): Promise<number> {
  const result = await pgRun(
    `UPDATE sessions
        SET status = 'stopped', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running'`
  );
  return result.changes;
}

export async function getAppConfig(key: string): Promise<string | null> {
  const row = (await pgGet('SELECT value FROM app_config WHERE key = ?', key)) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export async function setAppConfig(key: string, value: string): Promise<void> {
  await pgRun(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    key,
    value
  );
}
