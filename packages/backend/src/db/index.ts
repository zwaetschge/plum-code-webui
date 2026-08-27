import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { estimateModelCost, type CLIProvider } from '@plum-code-webui/shared';

import {
  readAllKimiUsageRecords,
  readKimiRootPrompts,
  summarizeKimiUsageBetween,
} from '../utils/kimiTurnUsage.js';
import { bootstrapAdmin, seedUserFromEnv } from './bootstrap.js';
import { runPendingMigrations } from './migrations.js';
import {
  all as pgAll,
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

  await backfillKimiUsageHistory();

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
        row.costUsd
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
    input.costUsd,
    input.model,
    createdAt
  );
  return result.changes > 0;
}

export async function reconcileStaleRunningSessions(): Promise<number> {
  const result = await pgRun(
    `UPDATE sessions
        SET status = 'stopped', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running'`
  );
  return result.changes;
}

export async function backfillKimiUsageHistory(): Promise<number> {
  const kimiHome = (
    process.env.CLI_PROVIDER_KIMI_CREDENTIALS_PATH || path.join(os.homedir(), '.kimi-code')
  ).replace(/^~/, os.homedir());
  const sessions = (await pgAll(
    `SELECT id, user_id as userId, claude_session_id as nativeSessionId, cli_model as model
       FROM sessions
      WHERE cli_provider = 'kimi' AND claude_session_id IS NOT NULL`
  )) as unknown as Array<{
    id: string;
    userId: string;
    nativeSessionId: string;
    model: string | null;
  }>;

  let inserted = 0;
  for (const session of sessions) {
    try {
      const messages = (await pgAll(
        `SELECT id, content, created_at as createdAt
           FROM messages
          WHERE session_id = ? AND role = 'user'
          ORDER BY created_at ASC, id ASC`,
        session.id
      )) as unknown as Array<{ id: string; content: string; createdAt: string }>;
      if (messages.length === 0) continue;

      const prompts = readKimiRootPrompts(kimiHome, session.nativeSessionId);
      const usageRecords = readAllKimiUsageRecords(kimiHome, session.nativeSessionId);
      if (prompts.length === 0 || usageRecords.length === 0) continue;

      const mappedPrompts: Array<{ messageId: string; recordedAt: number }> = [];
      let promptCursor = 0;
      for (const message of messages) {
        const sqlTime = Date.parse(`${message.createdAt.replace(' ', 'T')}Z`);
        let match = -1;
        for (let index = promptCursor; index < prompts.length; index += 1) {
          const prompt = prompts[index]!;
          if (Number.isFinite(sqlTime) && prompt.recordedAt < sqlTime - 5_000) continue;
          if (message.content && prompt.text.includes(message.content)) {
            match = index;
            break;
          }
        }
        if (match < 0) {
          match = prompts.findIndex(
            (prompt, index) =>
              index >= promptCursor &&
              (!Number.isFinite(sqlTime) || prompt.recordedAt >= sqlTime - 2_000)
          );
        }
        if (match < 0) continue;
        mappedPrompts.push({ messageId: message.id, recordedAt: prompts[match]!.recordedAt });
        promptCursor = match + 1;
      }

      for (let index = 0; index < mappedPrompts.length; index += 1) {
        const prompt = mappedPrompts[index]!;
        const nextPrompt = mappedPrompts[index + 1];
        const usage = summarizeKimiUsageBetween(
          usageRecords,
          prompt.recordedAt,
          nextPrompt?.recordedAt ?? Number.POSITIVE_INFINITY
        );
        if (usage.totalTokens <= 0) continue;
        const dominantModel = Object.entries(usage.models).sort((a, b) => b[1] - a[1])[0]?.[0];
        const model = dominantModel || session.model;
        const cost = estimateModelCost(
          model,
          {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
          },
          null
        ).cost;
        if (
          await insertUsageHistoryTurn({
            userId: session.userId,
            sessionId: session.id,
            provider: 'kimi',
            turnId: prompt.messageId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            totalTokens: usage.totalTokens,
            costUsd: cost,
            model,
            createdAt: usage.lastRecordedAt
              ? new Date(usage.lastRecordedAt).toISOString()
              : new Date(prompt.recordedAt).toISOString(),
          })
        ) {
          inserted += 1;
        }
      }
    } catch (error) {
      console.warn(`[DB] Kimi usage backfill skipped for session ${session.id}:`, error);
    }
  }

  if (inserted > 0) {
    console.log(`[DB] Backfilled ${inserted} Kimi usage turn(s) from native ACP ledgers.`);
  }
  return inserted;
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
