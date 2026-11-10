import { CHAT_SCHEDULE_SCHEMA } from '../services/assistant/chatSchedules.js';
import { LIBRARY_ACCESS_SCHEMA } from '../services/assistant/libraryAccess.js';
import { DEFAULT_CODEX_MODEL } from '@plum-code-webui/shared';
import { CHAT_CAPABILITIES_SCHEMA } from '../services/assistant/chatCapabilitiesSchema.js';
import { CHAT_COMPACTION_SCHEMA } from '../services/assistant/chatCompactionSchema.js';
import { MEMORY_SCHEMA, MEMORY_COMPLETION_SCHEMA } from '../services/assistant/memorySchema.js';
import { all as pgAll, get as pgGet, transaction as pgTransaction } from './pg.js';
import type { TransactionScope } from './pg.js';
import {
  ASSISTANT_SCHEMA,
  ASSISTANT_DOCUMENT_SCHEMA,
  ASSISTANT_PUBLICATION_SCHEMA,
} from '../services/assistant/schema.js';
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
  {
    id: '007-session-agent-runs',
    statements: [
      `CREATE TABLE IF NOT EXISTS session_agent_runs (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 id TEXT NOT NULL, chat_id TEXT, updated_at BIGINT NOT NULL, payload JSONB NOT NULL,
 PRIMARY KEY (session_id, id)
)`,
      `CREATE INDEX IF NOT EXISTS idx_session_agent_runs_chat ON session_agent_runs(session_id, chat_id, updated_at DESC)`,
    ],
  },
  {
    /**
     * Bare Fable/Opus/Sonnet ids now mean "200k" (CLAUDE_CODE_DISABLE_1M_CONTEXT=1)
     * and `[1m]` means "1M". Sessions stored before that split ran the CLI's
     * native 1M window; forcing them to 200k makes a long session autocompact
     * in a loop. Keep them on the window they were created with.
     */
    id: '008-claude-legacy-models-keep-1m',
    statements: [
      `UPDATE sessions SET cli_model = cli_model || '[1m]'
 WHERE cli_provider = 'claude' AND cli_model ~ '^claude-(fable|opus|sonnet)-' AND cli_model NOT LIKE '%[1m]'`,
    ],
  },
  {
    // Pairing tokens for the Firefox browser-control extension. Kept apart
    // from gateway_tokens so they can never authenticate against the REST API.
    id: '009-browser-tokens',
    statements: [
      `CREATE TABLE IF NOT EXISTS browser_tokens (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
 token_hash TEXT NOT NULL, token_prefix TEXT NOT NULL, revoked BIGINT NOT NULL DEFAULT 0,
 last_used_at TEXT,
 created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
)`,
      `CREATE INDEX IF NOT EXISTS idx_browser_tokens_user ON browser_tokens(user_id)`,
    ],
  },
  { id: '010-assistant-resources', statements: ASSISTANT_SCHEMA },
  { id: '011-assistant-document-members', statements: ASSISTANT_DOCUMENT_SCHEMA },
  { id: '012-assistant-publications', statements: ASSISTANT_PUBLICATION_SCHEMA },
  { id: '013-assistant-long-term-memory', statements: MEMORY_SCHEMA },
  { id: '014-assistant-semantic-memory', statements: MEMORY_COMPLETION_SCHEMA },
  {
    /**
     * Verbindungen: user-owned connection targets (SSH hosts today) and which
     * sessions they are attached to. `secret_enc` holds an uploaded private key,
     * encrypted with utils/encryption; it never leaves the backend.
     */
    id: '015-connections',
    statements: [
      `CREATE TABLE IF NOT EXISTS connections (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
 config_json TEXT NOT NULL DEFAULT '{}', secret_enc TEXT,
 created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
)`,
      `CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id, kind)`,
      `CREATE TABLE IF NOT EXISTS session_connections (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
 created_at TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY (session_id, connection_id)
)`,
      `CREATE INDEX IF NOT EXISTS idx_session_connections_connection ON session_connections(connection_id)`,
    ],
  },
  {
    id: '016-context-handoff',
    statements: [
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_handoff_json TEXT DEFAULT NULL`,
    ],
  },
  {
    id: '017-retire-kimi-code',
    statements: [
      `UPDATE sessions SET cli_provider='codex',cli_model='${DEFAULT_CODEX_MODEL}',claude_session_id=NULL,status='stopped' WHERE cli_provider='kimi'`,
    ],
  },
  {
    // Regenerated/edited answers stay as hidden versions instead of new chats.
    id: '018-api-turn-versions',
    statements: [
      `ALTER TABLE assistant_api_turns ADD COLUMN IF NOT EXISTS version_of TEXT DEFAULT NULL`,
      `ALTER TABLE assistant_api_turns ADD COLUMN IF NOT EXISTS hidden_by TEXT DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS assistant_api_turns_versions ON assistant_api_turns(chat_id,version_of)`,
    ],
  },
  {
    id: '019-api-chat-workbench',
    statements: [
      `ALTER TABLE assistant_shares ADD COLUMN IF NOT EXISTS snapshot_json TEXT`,
      `ALTER TABLE assistant_api_turns ADD COLUMN IF NOT EXISTS workbench_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE assistant_source_chunks ADD COLUMN IF NOT EXISTS embedding DOUBLE PRECISION[]`,
      `ALTER TABLE assistant_source_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT`,
    ],
  },
  { id: '020-api-chat-capabilities', statements: CHAT_CAPABILITIES_SCHEMA },
  {
    id: '021-api-chat-queue',
    statements: [
      "CREATE INDEX IF NOT EXISTS assistant_api_turns_queue ON assistant_api_turns(chat_id,status,seq) WHERE status IN ('queued','preparing','running')",
    ],
  },
  { id: '022-api-chat-compaction', statements: CHAT_COMPACTION_SCHEMA },
  { id: '023-library-access', statements: LIBRARY_ACCESS_SCHEMA },
  { id: '024-chat-schedules', statements: CHAT_SCHEDULE_SCHEMA },
  {
    /**
     * OpenCode left Plum on 2026-10-27; Pi runs the same registry endpoints.
     * OpenCode session ids cannot be resumed by Pi, so the native id is cleared
     * and the session stops. Usage rows keep provider `opencode` on purpose:
     * analytics still label that history.
     */
    id: '025-retire-opencode',
    statements: [
      `UPDATE sessions SET cli_provider='pi',claude_session_id=NULL,status='stopped' WHERE cli_provider='opencode'`,
    ],
    run: retireOpenCodeSettings,
  },
  {
    // Wear OS pairing tokens share browser_tokens; `scope` keeps a watch token
    // out of the browser and desktop roles (services/browserBridge/tokens.ts).
    id: '026-browser-token-scope',
    statements: [
      `ALTER TABLE browser_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'browser'`,
    ],
  },
  {
    // Dynamic UI v2: server-fetched data of live widgets (weather, stock …),
    // node ID → result envelope, kept with the turn so reloads show it again.
    id: '027-api-turn-ui-results',
    statements: [
      `ALTER TABLE assistant_api_turns ADD COLUMN IF NOT EXISTS ui_results_json TEXT NOT NULL DEFAULT '{}'`,
    ],
  },
  {
    // The unread badge is polled by every open tab. One user owns nearly all
    // rows, so the user index did not narrow anything and each poll read the
    // whole table; the unread rows alone are a handful.
    id: '028-notifications-unread-index',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL`,
    ],
  },
];

/** Per-provider settings maps that may still carry an `opencode` entry. */
const OPENCODE_PROVIDER_MAP_KEYS = [
  'cliProviderModels',
  'cliProviderModelLists',
  'cliProviderReasoning',
  'cliProviderServiceTiers',
  'localUsageBudgets',
  'usagePlans',
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rewrites one `settings_json` blob for the OpenCode removal. Returns null when
 * nothing changes, so re-running it over migrated data is a no-op. Exported for
 * the regression suite.
 */
export function retireOpenCodeSettingsJson(raw: string | null): string | null {
  let settings: unknown;
  try {
    settings = JSON.parse(raw || '{}');
  } catch {
    return null;
  }
  if (!isPlainRecord(settings)) return null;
  const next: Record<string, unknown> = { ...settings };
  let changed = false;

  // The model provider registry moves to a provider-neutral key. A row that
  // already has `modelProviders` keeps it; the stale copy is dropped.
  if ('opencodeProviders' in next) {
    if (!Array.isArray(next.modelProviders) && Array.isArray(next.opencodeProviders)) {
      next.modelProviders = next.opencodeProviders;
    }
    delete next.opencodeProviders;
    changed = true;
  }
  // The OpenCode Go dashboard cookie is a credential for a feature that is gone.
  if ('opencodeGoQuota' in next) {
    delete next.opencodeGoQuota;
    changed = true;
  }
  for (const key of ['defaultCliProvider', 'uiProvider'] as const) {
    if (next[key] === 'opencode') {
      next[key] = 'pi';
      changed = true;
    }
  }
  if (Array.isArray(next.enabledCliProviders) && next.enabledCliProviders.includes('opencode')) {
    const remaining = next.enabledCliProviders.filter((provider) => provider !== 'opencode');
    // Dropping the only enabled harness would read as "never configured" and
    // re-enable everything; Pi is what the user's OpenCode endpoints run on now.
    next.enabledCliProviders = remaining.length > 0 ? remaining : ['pi'];
    changed = true;
  }
  for (const key of OPENCODE_PROVIDER_MAP_KEYS) {
    const map = next[key];
    if (isPlainRecord(map) && 'opencode' in map) {
      const rest = { ...map };
      delete rest.opencode;
      next[key] = rest;
      changed = true;
    }
  }
  if (Array.isArray(next.cliSubagents)) {
    const kept = next.cliSubagents.filter(
      (entry) => !(isPlainRecord(entry) && entry.provider === 'opencode')
    );
    if (kept.length !== next.cliSubagents.length) {
      next.cliSubagents = kept;
      changed = true;
    }
  }
  return changed ? JSON.stringify(next) : null;
}

/**
 * Assistant profiles and tasks store their CLI provider in the resource body;
 * a draft that still names OpenCode would otherwise fail as "disabled" when it
 * starts. Only the live body is rewritten, revisions stay as recorded.
 */
export function retireOpenCodeResourceBody(raw: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainRecord(body)) return null;
  let changed = false;
  if (body.provider === 'opencode') {
    body.provider = 'pi';
    changed = true;
  }
  if (body.agentId === 'cli:opencode') {
    body.agentId = 'cli:pi';
    changed = true;
  }
  return changed ? JSON.stringify(body) : null;
}

async function retireOpenCodeSettings(tx: TransactionScope): Promise<void> {
  const rows = (await tx.all(
    `SELECT user_id, settings_json FROM user_settings WHERE settings_json LIKE '%opencode%'`
  )) as unknown as Array<{ user_id: string; settings_json: string | null }>;
  for (const row of rows) {
    const next = retireOpenCodeSettingsJson(row.settings_json);
    if (next !== null) {
      await tx.run(
        'UPDATE user_settings SET settings_json = ? WHERE user_id = ?',
        next,
        row.user_id
      );
    }
  }

  const resources = (await tx.all(
    `SELECT id, body_json FROM assistant_resources
      WHERE kind IN ('profile', 'task') AND body_json LIKE '%opencode%'`
  )) as unknown as Array<{ id: string; body_json: string }>;
  for (const resource of resources) {
    const next = retireOpenCodeResourceBody(resource.body_json);
    if (next !== null) {
      await tx.run('UPDATE assistant_resources SET body_json = ? WHERE id = ?', next, resource.id);
    }
  }
}

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
