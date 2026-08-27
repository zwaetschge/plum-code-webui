import { run as pgRun } from './pg.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { runMigration } from './migrations.js';
import {
  estimateModelCost,
  LLM_PRICING_RATE_CARD_VERSION,
  type CLIProvider,
} from '@plum-code-webui/shared';
import {
  readAllKimiUsageRecords,
  readKimiRootPrompts,
  summarizeKimiUsageBetween,
} from '../utils/kimiTurnUsage.js';
import { resolveOpenCodeTenantPaths } from '../services/opencode/tenantPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIRECTORY = process.env.WEBUI_DATA_DIR
  ? path.resolve(process.env.WEBUI_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIRECTORY, 'claude-webui.db');

export function getDatabasePath(): string {
  return DB_PATH;
}

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): Database.Database {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  // WAL guarantees consistency on crash either way; FULL additionally fsyncs
  // every tiny bookkeeping commit (updated_at per message, token last-used).
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);
  backfillKimiUsageHistory(db);

  // The in-memory process registry starts empty after every backend restart.
  // Any persisted `running` rows therefore describe processes owned by the old
  // backend instance and must not be presented as live sessions.
  const reconciled = reconcileStaleRunningSessions(db);
  if (reconciled > 0) {
    console.log(`[DB] Reconciled ${reconciled} stale running session(s) to stopped.`);
  }

  return db;
}

export interface UsageHistoryTurnInput {
  userId: string;
  sessionId: string;
  provider: CLIProvider;
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
export function insertUsageSubagentTurns(
  database: Database.Database,
  rows: UsageSubagentTurnInput[]
): number {
  if (rows.length === 0) return 0;
  const statement = database.prepare(`
    INSERT INTO usage_subagent_turns (
      user_id, session_id, provider, turn_id, agent_id, parent_agent_id, agent_type, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      total_tokens, cost_usd
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, provider, turn_id, agent_id) DO NOTHING
  `);
  const insertAll = database.transaction((items: UsageSubagentTurnInput[]) => {
    let inserted = 0;
    for (const row of items) {
      inserted += statement.run(
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
      ).changes;
    }
    return inserted;
  });
  return insertAll(rows);
}

/** True when this provider turn has already been booked into usage_history. */
export function usageHistoryTurnExists(
  database: Database.Database,
  sessionId: string,
  provider: CLIProvider,
  turnId: string
): boolean {
  const row = database
    .prepare(
      `SELECT 1 FROM usage_history
        WHERE session_id = ? AND provider = ? AND turn_id = ?
        LIMIT 1`
    )
    .get(sessionId, provider, turnId);
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

export function reconcileStaleRunningSessions(database: Database.Database): number {
  return database
    .prepare(
      `UPDATE sessions
       SET status = 'stopped', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'running'`
    )
    .run().changes;
}

/**
 * Recover Kimi ACP turns created before Plum consumed Kimi's native usage
 * ledger. Kimi persists one usage.record per model call, including cached
 * tokens, under its native session directory. WebUI message ids are reused as
 * turn ids so this scan is safe to repeat and cannot duplicate live writes.
 */
export async function backfillKimiUsageHistory(database: Database.Database): Promise<number> {
  const kimiHome = (
    process.env.CLI_PROVIDER_KIMI_CREDENTIALS_PATH || path.join(os.homedir(), '.kimi-code')
  ).replace(/^~/, os.homedir());
  const sessions = database
    .prepare(
      `SELECT id, user_id as userId, claude_session_id as nativeSessionId, cli_model as model
       FROM sessions
       WHERE cli_provider = 'kimi' AND claude_session_id IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    userId: string;
    nativeSessionId: string;
    model: string | null;
  }>;

  let inserted = 0;
  for (const session of sessions) {
    try {
      const messages = database
        .prepare(
          `SELECT id, content, created_at as createdAt
           FROM messages
           WHERE session_id = ? AND role = 'user'
           ORDER BY created_at ASC, id ASC`
        )
        .all(session.id) as Array<{ id: string; content: string; createdAt: string }>;
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

/**
 * Add durable runtime attribution to existing usage ledgers.
 *
 * Historical model ids are used only for a best-effort backfill. Ambiguous
 * routed models prefer the session's current Pi/OpenCode provider; exact
 * historical attribution cannot be reconstructed after a provider switch.
 */
/**
 * Copy each provider's model list out of OpenCode's per-user config and into
 * the WebUI provider registry.
 *
 * Pi derived its models from that file, so an endpoint the shared catalog does
 * not know — a self-hosted server, or an aggregator added last week — only
 * existed for Pi while OpenCode kept a config listing it. Owning the list here
 * makes every harness readable from one place and lets a provider be set up
 * without OpenCode being installed at all.
 */
export function migrateProviderModelsIntoRegistry(database: Database.Database): number {
  const rows = database.prepare('SELECT user_id, settings_json FROM user_settings').all() as Array<{
    user_id: string;
    settings_json: string | null;
  }>;

  let updated = 0;
  for (const row of rows) {
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(row.settings_json ?? '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    const providers = settings.opencodeProviders;
    if (!Array.isArray(providers) || providers.length === 0) continue;

    let configModels: Record<string, string[]> = {};
    try {
      const configPath = path.join(
        resolveOpenCodeTenantPaths(row.user_id).configDir,
        'opencode.json'
      );
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        provider?: Record<string, { models?: Record<string, unknown> }>;
      };
      for (const [providerId, entry] of Object.entries(parsed.provider ?? {})) {
        const models = Object.keys(entry?.models ?? {}).filter((id) => id.trim().length > 0);
        if (models.length > 0) configModels[providerId] = models;
      }
    } catch {
      // No OpenCode config for this user — nothing to lift, and nothing broken.
      configModels = {};
    }
    if (Object.keys(configModels).length === 0) continue;

    let changed = false;
    for (const provider of providers as Array<Record<string, unknown>>) {
      const id = typeof provider.id === 'string' ? provider.id : '';
      const models = configModels[id];
      // Never overwrite a list the user already curated in the WebUI.
      if (!models || (Array.isArray(provider.models) && provider.models.length > 0)) continue;
      provider.models = models;
      changed = true;
    }

    if (!changed) continue;
    database
      .prepare('UPDATE user_settings SET settings_json = ? WHERE user_id = ?')
      .run(JSON.stringify(settings), row.user_id);
    updated += 1;
  }

  return updated;
}

export function migrateUsageHistoryAttribution(database: Database.Database): number {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(usage_history)').all() as Array<{ name: string }>).map(
      ({ name }) => name
    )
  );
  if (!columns.has('provider')) {
    database.exec(`ALTER TABLE usage_history ADD COLUMN provider TEXT NOT NULL DEFAULT 'unknown'`);
  }
  if (!columns.has('turn_id')) {
    database.exec(`ALTER TABLE usage_history ADD COLUMN turn_id TEXT DEFAULT NULL`);
  }

  const result = database
    .prepare(
      `
      UPDATE usage_history
      SET provider = CASE
        WHEN lower(COALESCE(model, '')) LIKE 'gpt-%'
          OR lower(COALESCE(model, '')) LIKE '%codex%' THEN 'codex'
        WHEN lower(COALESCE(model, '')) LIKE 'claude%'
          OR lower(COALESCE(model, '')) IN ('opus', 'sonnet', 'haiku') THEN 'claude'
        WHEN lower(COALESCE(model, '')) LIKE 'mistral-%'
          OR lower(COALESCE(model, '')) LIKE 'devstral-%' THEN 'vibe'
        WHEN lower(COALESCE(model, '')) LIKE 'glm-%'
          OR lower(COALESCE(model, '')) LIKE 'z-ai/%'
          OR lower(COALESCE(model, '')) LIKE 'zai/%'
          OR instr(COALESCE(model, ''), '/') > 0
          OR lower(COALESCE(model, '')) LIKE '%opencode%'
        THEN COALESCE(
          (
            SELECT CASE
              WHEN sessions.cli_provider = 'pi' THEN 'pi'
              ELSE 'opencode'
            END
            FROM sessions
            WHERE sessions.id = usage_history.session_id
          ),
          'opencode'
        )
        ELSE COALESCE(
          (SELECT sessions.cli_provider FROM sessions WHERE sessions.id = usage_history.session_id),
          'unknown'
        )
      END
      WHERE provider IS NULL OR trim(provider) = '' OR provider = 'unknown'
    `
    )
    .run();

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_usage_history_provider_created
      ON usage_history(provider, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_history_turn
      ON usage_history(session_id, provider, turn_id);
  `);

  return result.changes;
}

/**
 * Split the legacy per-user Claude endpoint override into the dedicated Z.AI
 * provider. Every Claude session owned by a user with that legacy override
 * necessarily ran through the override, so those sessions and GLM usage rows
 * can be attributed to Z.AI without guessing.
 */
export function migrateLegacyClaudeEndpointToZai(database: Database.Database): {
  settings: number;
  sessions: number;
  usage: number;
} {
  const rows = database
    .prepare('SELECT user_id as userId, settings_json as settingsJson FROM user_settings')
    .all() as Array<{ userId: string; settingsJson: string | null }>;
  const updateSettings = database.prepare(
    'UPDATE user_settings SET settings_json = ? WHERE user_id = ?'
  );
  const migrateSessions = database.prepare(
    `UPDATE sessions
     SET cli_provider = 'zai', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND cli_provider IN ('claude', 'glm')`
  );

  let settings = 0;
  let sessions = 0;
  const migrate = database.transaction(() => {
    for (const row of rows) {
      if (!row.settingsJson) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.settingsJson) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed.claudeApi || typeof parsed.claudeApi !== 'object') continue;
      if (!parsed.zaiApi) parsed.zaiApi = parsed.claudeApi;
      delete parsed.claudeApi;
      for (const key of [
        'cliProviderModels',
        'cliProviderModelLists',
        'cliProviderReasoning',
        'localUsageBudgets',
      ]) {
        const providerSettings = parsed[key];
        if (!providerSettings || typeof providerSettings !== 'object') continue;
        const values = providerSettings as Record<string, unknown>;
        if (values.claude !== undefined && values.zai === undefined) values.zai = values.claude;
        delete values.claude;
      }
      if (parsed.defaultCliProvider === 'claude') parsed.defaultCliProvider = 'zai';

      const enabled = Array.isArray(parsed.enabledCliProviders)
        ? parsed.enabledCliProviders.filter((value): value is string => typeof value === 'string')
        : ['codex', 'claude', 'opencode', 'pi'];
      parsed.enabledCliProviders = [...new Set([...enabled, 'claude', 'zai'])];
      updateSettings.run(JSON.stringify(parsed), row.userId);
      settings += 1;
      sessions += migrateSessions.run(row.userId).changes;
    }
  });
  migrate();

  const usage = database
    .prepare(
      `UPDATE usage_history
       SET provider = 'zai'
       WHERE provider IN ('claude', 'unknown')
         AND (
           lower(COALESCE(model, '')) LIKE 'glm-%'
           OR lower(COALESCE(model, '')) LIKE 'z-ai/glm-%'
           OR lower(COALESCE(model, '')) LIKE 'zai/glm-%'
         )`
    )
    .run().changes;

  return { settings, sessions, usage };
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      api_key_encrypted TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_id)
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      claude_session_id TEXT,
      status TEXT DEFAULT 'stopped',
      last_message TEXT,
      starred INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Persisted files attached to chat messages. The storage key is an
    -- opaque backend-generated name; host paths are never stored in message
    -- payloads or returned to clients. Repeating the same content for another
    -- message reuses the physical storage key, while the per-message unique
    -- constraint prevents duplicate cards within one turn.
    CREATE TABLE IF NOT EXISTS message_media (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      alt_text TEXT,
      source TEXT NOT NULL CHECK (source IN ('provider', 'workspace', 'comfyui', 'user')),
      source_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, sha256)
    );

    -- Enforce the denormalized ownership columns even for future direct SQL
    -- writers. This keeps media rows from being rebound across sessions/users.
    CREATE TRIGGER IF NOT EXISTS trg_message_media_validate_ownership
    BEFORE INSERT ON message_media
    WHEN NOT EXISTS (
      SELECT 1
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE m.id = NEW.message_id
        AND m.session_id = NEW.session_id
        AND s.user_id = NEW.user_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'message media ownership mismatch');
    END;

    -- User settings table
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT DEFAULT 'dark',
      default_working_dir TEXT,
      allowed_tools TEXT,
      custom_system_prompt TEXT,
      settings_json TEXT
    );

    -- Durable browser login sessions. Keeping these in SQLite avoids the
    -- unbounded in-process MemoryStore and preserves logins across restarts.
    CREATE TABLE IF NOT EXISTS http_sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_http_sessions_expires_at
      ON http_sessions(expires_at);

    -- MCP servers table
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      command TEXT,
      args TEXT,
      url TEXT,
      env TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- CLI tools table (for orchestrating other AI CLI tools like Codex)
    CREATE TABLE IF NOT EXISTS cli_tools (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT,
      use_session_cwd INTEGER DEFAULT 1,
      timeout_seconds INTEGER DEFAULT 300,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Usage history table (for analytics)
    CREATE TABLE IF NOT EXISTS usage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      model TEXT,
      provider TEXT NOT NULL DEFAULT 'unknown',
      turn_id TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Per-subagent breakdown of a provider turn. usage_history stays the single
    -- source of truth for billable totals (a turn's row already INCLUDES its
    -- subagents); this table only records who inside the turn spent what, so
    -- analytics can attribute a turn to the agents that drove it.
    CREATE TABLE IF NOT EXISTS usage_subagent_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      parent_agent_id TEXT,
      agent_type TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Session checkpoints table (for versioning)
    CREATE TABLE IF NOT EXISTS session_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      snapshot_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Custom agents table
    CREATE TABLE IF NOT EXISTS custom_agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      model TEXT DEFAULT 'gpt-5.5',
      allowed_tools TEXT,
      permission_mode TEXT DEFAULT 'auto-accept',
      icon TEXT DEFAULT 'bot',
      color TEXT DEFAULT 'violet',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- App config table (for basic auth and other app-wide settings)
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON sessions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_media_message_created
      ON message_media(message_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_message_media_session
      ON message_media(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_message_media_owner_hash
      ON message_media(user_id, sha256);
    CREATE INDEX IF NOT EXISTS idx_message_media_storage_key
      ON message_media(storage_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_message_media_source_id
      ON message_media(session_id, source, source_id)
      WHERE source_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
    CREATE INDEX IF NOT EXISTS idx_cli_tools_user_id ON cli_tools(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_user_id ON usage_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_session_id ON usage_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_usage_history_created_at ON usage_history(created_at);
    -- Composite index so analytics range queries (WHERE user_id = ? AND created_at >= ...)
    -- use a single index seek instead of a full scan of the user's rows.
    CREATE INDEX IF NOT EXISTS idx_usage_history_user_created ON usage_history(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_history_session_created ON usage_history(session_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_subagent_turn_agent
      ON usage_subagent_turns(session_id, provider, turn_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_usage_subagent_user_created
      ON usage_subagent_turns(user_id, created_at DESC);

    -- Periodic upstream account-quota snapshots. These are deliberately
    -- separate from usage_history: they describe provider limits and resets,
    -- not billable LLM turns.
    CREATE TABLE IF NOT EXISTS usage_limit_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      metric_label TEXT NOT NULL,
      utilization REAL,
      used_value REAL,
      limit_value REAL,
      remaining_value REAL,
      unit TEXT,
      resets_at TEXT,
      window_seconds INTEGER,
      source TEXT,
      reset_detected INTEGER NOT NULL DEFAULT 0,
      reset_event_at TEXT,
      recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_usage_limit_snapshots_user_recorded
      ON usage_limit_snapshots(user_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_limit_snapshots_series_recorded
      ON usage_limit_snapshots(user_id, provider, metric_key, recorded_at DESC);

    -- Some Codex plans expose a single weekly window in primary_window. Older
    -- builds labelled primary_window as 5h without checking its duration.
    -- Reclassify those persisted samples so cards and combined charts agree.
    UPDATE usage_limit_snapshots
       SET metric_key = 'seven_day',
           metric_label = 'Weekly · Total'
     WHERE provider = 'codex'
       AND metric_key = 'five_hour'
       AND window_seconds > 86400;

    -- Session events table (non-billing telemetry such as live context window
    -- snapshots and context compaction boundaries). Keep this separate from
    -- usage_history so analytics cost/request math only counts real LLM turns.
    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      context_window INTEGER NOT NULL DEFAULT 0,
      context_used_percent REAL NOT NULL DEFAULT 0,
      context_exceeded INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      message TEXT,
      summary TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_events_user_created ON session_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_events_session_created ON session_events(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_events_type_created ON session_events(event_type, created_at DESC);
    -- Serves the per-session telemetry snapshot (two type counts + latest
    -- context row) as an index-only lookup instead of scanning every event
    -- row of the session on each PATCH/GET.
    CREATE INDEX IF NOT EXISTS idx_session_events_session_type
      ON session_events(session_id, event_type, user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session_id ON session_checkpoints(session_id);
    CREATE INDEX IF NOT EXISTS idx_custom_agents_user_id ON custom_agents(user_id);
    CREATE INDEX IF NOT EXISTS idx_custom_agents_updated_at ON custom_agents(updated_at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
  `);

  migrateMessageMediaUserSource(db);

  // Initialize default basic auth credentials
  initializeBasicAuth(db);

  // Migration: Add starred column to existing sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN starred INTEGER DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add allowed_directories column to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN allowed_directories TEXT DEFAULT '[]'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add category column to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN category TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add cli_provider column to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_provider TEXT DEFAULT 'codex'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add mode column to sessions table (permission mode: auto-accept, plan, etc.)
  // Persists per-session so it survives browser/device switches instead of living in localStorage.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'auto-accept'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add session surface. "code" is the existing technical workbench;
  // "task" is a quieter messenger-style surface over the same provider runtime.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN surface TEXT DEFAULT 'code'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add per-session CLI model selection so multiple WebUI sessions can
  // run different provider/model pairs for the same user.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_model TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add per-session reasoning / effort selection. Like cli_model, this
  // must not be user-global because high/xhigh style settings affect usage limits.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_reasoning TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: multi-chat threads inside one session. chat_id NULL on both
  // sessions.active_chat_id and messages.chat_id means the legacy main chat,
  // so existing sessions need no data rewrite.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN active_chat_id TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN chat_id TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_chats (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      provider_session_id TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_chats_session ON session_chats(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_chat ON messages(session_id, chat_id);
  `);

  // Vibe was removed as a first-class provider. Keep existing chats accessible by
  // moving them to OpenCode, but clear provider-native resume/model state because
  // those identifiers are not compatible across CLIs.
  try {
    db.exec(`
      UPDATE sessions
      SET cli_provider = 'opencode',
          claude_session_id = NULL,
          cli_model = NULL,
          cli_reasoning = NULL
      WHERE cli_provider = 'vibe'
    `);
  } catch {
    // Best effort for older schemas.
  }

  migrateUsageHistoryAttribution(db);
  const liftedProviders = migrateProviderModelsIntoRegistry(db);
  if (liftedProviders > 0) {
    console.log(`[DB] Lifted provider models into the registry for ${liftedProviders} user(s).`);
  }
  const zaiMigration = migrateLegacyClaudeEndpointToZai(db);
  if (zaiMigration.settings || zaiMigration.sessions || zaiMigration.usage) {
    console.log(
      `[DB] Split legacy Z.AI override: ${zaiMigration.settings} setting(s), ` +
        `${zaiMigration.sessions} session(s), ${zaiMigration.usage} usage row(s).`
    );
  }

  // Migration: Add per-session Codex service/profile tier. This is intentionally
  // separate from cli_reasoning so `/fast` can be combined with xhigh effort.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN cli_service_tier TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`
      UPDATE sessions
      SET cli_service_tier = 'fast',
          cli_reasoning = NULL
      WHERE cli_provider = 'codex'
        AND cli_reasoning = 'fast'
        AND (cli_service_tier IS NULL OR cli_service_tier = '')
    `);
  } catch {
    // Best-effort cleanup; older schemas may not have both columns during startup.
  }

  // Migration: Add per-session style library selections.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN design_style_skill TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN writing_style_skill TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Bind one Android ADB test device to a WebUI session. The Android
  // builder keeps the persistent wifi pairing registry; the session only stores
  // the selected serial so MCP tools and prompts know which live device to use.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN android_device_serial TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Optional Home Assistant light used for physical session status notifications.
  // Connection credentials stay app-wide; only the entity assignment is per-session.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN home_assistant_entity_id TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Per-session custom icon. The file itself is copied into backend
  // appdata and served through an authenticated session route.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN icon_path TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN icon_source TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Durable chat delivery/reconnect cursors. These columns are additive so
  // older clients can continue using timestamp-based replay while newer
  // clients use a monotone, restart-safe cursor and snapshot revision.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN event_sequence INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN snapshot_revision INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN client_message_id TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN event_sequence INTEGER DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_delivery
      ON messages(session_id, client_message_id)
      WHERE client_message_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_session_sequence
      ON messages(session_id, event_sequence)
      WHERE event_sequence IS NOT NULL;

    -- A client-generated delivery id remains authoritative across sockets and
    -- backend restarts. ack_json stores the exact terminal acknowledgement so
    -- retries receive the same answer without dispatching another model turn.
    CREATE TABLE IF NOT EXISTS message_deliveries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      client_message_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      status TEXT NOT NULL CHECK (status IN ('processing', 'accepted', 'rejected')),
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      disposition TEXT CHECK (disposition IS NULL OR disposition IN ('dispatched', 'queued')),
      ack_json TEXT,
      error TEXT,
      retryable INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 1,
      accepted_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, session_id, client_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_deliveries_session_updated
      ON message_deliveries(session_id, updated_at DESC);

    -- Resumable uploads are assembled only after every validated chunk exists;
    -- completed uploads are then atomically linked to the persisted message.
    CREATE TABLE IF NOT EXISTS chat_uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      chunk_size INTEGER NOT NULL CHECK (chunk_size > 0),
      total_chunks INTEGER NOT NULL CHECK (total_chunks > 0),
      received_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'complete', 'cancelled', 'failed')),
      error TEXT,
      reserved_delivery_id TEXT,
      consumed_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chat_upload_chunks (
      upload_id TEXT NOT NULL REFERENCES chat_uploads(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(upload_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_uploads_owner_session
      ON chat_uploads(user_id, session_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_uploads_expiry
      ON chat_uploads(status, expires_at);

    CREATE TABLE IF NOT EXISTS session_reads (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      chat_key TEXT NOT NULL DEFAULT '',
      last_read_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, session_id, chat_key)
    );
    CREATE INDEX IF NOT EXISTS idx_session_reads_session
      ON session_reads(session_id, chat_key, updated_at DESC);
    CREATE TRIGGER IF NOT EXISTS trg_session_reads_validate_insert
    BEFORE INSERT ON session_reads
    WHEN NOT EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = NEW.session_id AND s.user_id = NEW.user_id
    ) OR (
      NEW.last_read_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM messages m
         WHERE m.id = NEW.last_read_message_id
           AND m.session_id = NEW.session_id
           AND COALESCE(m.chat_id, '') = NEW.chat_key
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'session read ownership mismatch');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_session_reads_validate_update
    BEFORE UPDATE ON session_reads
    WHEN NOT EXISTS (
      SELECT 1 FROM sessions s
       WHERE s.id = NEW.session_id AND s.user_id = NEW.user_id
    ) OR (
      NEW.last_read_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM messages m
         WHERE m.id = NEW.last_read_message_id
           AND m.session_id = NEW.session_id
           AND COALESCE(m.chat_id, '') = NEW.chat_key
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'session read ownership mismatch');
    END;

    -- Message history revisions deliberately include edits/deletes as well as
    -- inserts. The trigger avoids touching sessions.updated_at so background
    -- metadata changes do not reorder the dashboard.
    CREATE TRIGGER IF NOT EXISTS trg_messages_snapshot_insert
    AFTER INSERT ON messages BEGIN
      UPDATE sessions
         SET snapshot_revision = snapshot_revision + 1
       WHERE id = NEW.session_id;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_messages_snapshot_update
    AFTER UPDATE OF role, content, chat_id, client_message_id ON messages BEGIN
      UPDATE sessions
         SET snapshot_revision = snapshot_revision + 1
       WHERE id = NEW.session_id;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_messages_snapshot_delete
    AFTER DELETE ON messages BEGIN
      UPDATE sessions
         SET snapshot_revision = snapshot_revision + 1
       WHERE id = OLD.session_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_messages_cancel_consumed_uploads
    BEFORE DELETE ON messages BEGIN
      UPDATE chat_uploads
         SET status = 'cancelled', reserved_delivery_id = NULL,
             error = 'Consumed message removed', updated_at = CURRENT_TIMESTAMP
       WHERE consumed_message_id = OLD.id;
    END;
  `);
  db.exec(`
    UPDATE sessions
       SET snapshot_revision = (
         SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
       )
     WHERE snapshot_revision = 0
       AND EXISTS (SELECT 1 FROM messages WHERE messages.session_id = sessions.id)
  `);
  try {
    db.exec(`ALTER TABLE chat_uploads ADD COLUMN reserved_delivery_id TEXT DEFAULT NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Create session_categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT 'blue',
      icon TEXT DEFAULT 'folder',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_categories_user_id ON session_categories(user_id);

    -- The sessions.category column was added via ALTER TABLE, so we can't add a FOREIGN KEY
    -- constraint. This trigger enforces ON DELETE SET NULL semantics at the DB level, so
    -- direct SQL category deletes (bypassing the route handler) don't leave orphan references.
    CREATE TRIGGER IF NOT EXISTS trg_session_categories_after_delete
    AFTER DELETE ON session_categories
    BEGIN
      UPDATE sessions SET category = NULL WHERE category = OLD.id;
    END;
  `);

  // FTS5 virtual table for message full-text search. LIKE '%x%' does a full scan and can't
  // use a btree index; FTS5 provides fast prefix + phrase search across millions of rows.
  // Triggers keep the FTS index in sync with the messages table automatically.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert
      AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete
      AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;

      DROP TRIGGER IF EXISTS trg_messages_fts_update;
      CREATE TRIGGER trg_messages_fts_update
      AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);

    // Backfill: populate FTS table from existing messages if it is empty. Only runs once.
    const ftsCount = db.prepare('SELECT COUNT(*) as c FROM messages_fts').get() as { c: number };
    if (ftsCount.c === 0) {
      const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number };
      if (msgCount.c > 0) {
        db.exec(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages`);
        console.log(`[DB] Backfilled messages_fts with ${msgCount.c} rows.`);
      }
    }
  } catch (err) {
    // FTS5 may be disabled in some SQLite builds — fail soft, keep LIKE fallback.
    console.warn('[DB] FTS5 setup failed (search will fall back to LIKE):', err);
  }

  // Create notes table for prompt notepad
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      pinned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_session_id ON notes(session_id);
  `);

  // Migration: drop dead tables.
  // - ai_providers: the BYO-API-key / Gemini-OAuth feature was removed; no
  //   inference path ever consumed the stored credentials, so drop the table
  //   so orphaned secrets do not linger at rest.
  // - claude_tokens: legacy Claude OAuth token storage, unreferenced.
  // - session_peer_profiles: half-shipped mesh feature, unreferenced.
  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_ai_providers_user_id;
      DROP TABLE IF EXISTS ai_providers;
      DROP TABLE IF EXISTS claude_tokens;
      DROP INDEX IF EXISTS idx_session_peer_profiles_enabled;
      DROP TABLE IF EXISTS session_peer_profiles;
    `);
  } catch (err) {
    console.error('[migrations] Failed to drop legacy tables:', err);
  }

  // Migration: drop the tables of features whose HTTP surface had no caller in
  // either client and has now been removed.
  // - trusted_devices: routes/devices.ts (desktop device pairing), never called.
  // - automation_tokens + session_goals: routes/automation.ts, superseded by the
  //   control gateway. The visible /goal command is a Codex native command and
  //   never touched these tables.
  // - orchestration_*: leftovers of the orchestration manager / task router that
  //   were removed earlier; no code has referenced them since.
  runMigration(db, '2026-08-23-drop-removed-feature-tables', (database) => {
    for (const table of [
      'trusted_devices',
      'automation_tokens',
      'session_goals',
      'orchestration_tasks',
      'orchestration_workers',
      'orchestration_sessions',
    ]) {
      // Loud rather than silent: an operator whose deployment did use one of
      // these should see what went away.
      try {
        const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
          | { count: number }
          | undefined;
        if (row?.count) {
          console.warn(`[migrations] Dropping ${table} with ${row.count} row(s)`);
        }
      } catch {
        // Table absent on a fresh database; nothing to report.
      }
      database.exec(`DROP TABLE IF EXISTS ${table};`);
    }
  });

  // Migration: Add password_hash column to users table for multi-user basic auth
  try {
    db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: Move legacy single-credential basic_auth password into the matching user record
  try {
    const legacyUsername = db
      .prepare("SELECT value FROM app_config WHERE key = 'basic_auth_username'")
      .get() as { value: string } | undefined;
    const legacyHash = db
      .prepare("SELECT value FROM app_config WHERE key = 'basic_auth_password'")
      .get() as { value: string } | undefined;
    if (legacyUsername?.value && legacyHash?.value) {
      db.prepare(
        "UPDATE users SET password_hash = ? WHERE name = ? AND (password_hash IS NULL OR password_hash = '')"
      ).run(legacyHash.value, legacyUsername.value);
    }
  } catch {
    // ignore migration errors
  }

  // Migration: Role/status columns for RBAC (admin console).
  // role:  'user' | 'admin'   — admin unlocks /api/admin/* and can access any session
  // status: 'active' | 'suspended' — suspended blocks login and WS auth
  try {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at DATETIME`);
  } catch {
    /* exists */
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`);

  // Audit log — records privileged admin actions and auth events. Append-only from app code.
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      ip TEXT,
      user_agent TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_peer_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, source_session_id, target_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_peer_links_source ON session_peer_links(source_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_peer_links_target ON session_peer_links(target_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_peer_links_user ON session_peer_links(user_id);

    CREATE TABLE IF NOT EXISTS session_delegations (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      to_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      from_actor TEXT NOT NULL DEFAULT 'session',
      kind TEXT NOT NULL DEFAULT 'consult',
      status TEXT NOT NULL DEFAULT 'queued',
      content TEXT NOT NULL,
      result TEXT,
      error TEXT,
      hop_count INTEGER NOT NULL DEFAULT 0,
      expires_at DATETIME,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_delegations_user_created ON session_delegations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_delegations_from ON session_delegations(from_session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_delegations_to ON session_delegations(to_session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_delegations_correlation ON session_delegations(correlation_id);

    -- Long-lived credentials for an external supervisor (Hermes, an OpenCode
    -- or Codex CLI, a script) that drives this instance through the same API
    -- the user drives. Only the hash is stored; the secret is shown once.
    CREATE TABLE IF NOT EXISTS gateway_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      -- 'read' or 'write'. Existing rows predate scopes and were minted with the
      -- owner's full rights, so they default to write rather than being silently
      -- downgraded to read-only under a supervisor that depends on them.
      scope TEXT NOT NULL DEFAULT 'write',
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gateway_tokens_user ON gateway_tokens(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gateway_tokens_hash ON gateway_tokens(token_hash) WHERE revoked = 0;

    CREATE TABLE IF NOT EXISTS container_watchdogs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      autonomy_level TEXT NOT NULL DEFAULT 'observe',
      last_snapshot_at DATETIME,
      last_incident_at DATETIME,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_container_watchdogs_user_container ON container_watchdogs(user_id, container_id);
    CREATE INDEX IF NOT EXISTS idx_container_watchdogs_session ON container_watchdogs(session_id);
    CREATE INDEX IF NOT EXISTS idx_container_watchdogs_enabled ON container_watchdogs(enabled);

    CREATE TABLE IF NOT EXISTS container_health_snapshots (
      id TEXT PRIMARY KEY,
      watchdog_id TEXT REFERENCES container_watchdogs(id) ON DELETE CASCADE,
      container_id TEXT NOT NULL,
      state TEXT,
      health TEXT,
      restart_count INTEGER,
      cpu_percent REAL,
      memory_bytes INTEGER,
      memory_limit_bytes INTEGER,
      summary TEXT,
      evidence_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_container_health_watchdog_created ON container_health_snapshots(watchdog_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_container_health_container_created ON container_health_snapshots(container_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS discord_outbox (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at DATETIME,
      sent_at DATETIME,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_status_next ON discord_outbox(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_created ON discord_outbox(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_user_created ON discord_outbox(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discord_outbox_session_created ON discord_outbox(session_id, created_at DESC);
  `);

  // Databases created before scopes existed: keep those tokens on full rights
  // rather than silently downgrading a supervisor that depends on them.
  try {
    const gatewayColumns = new Set(
      (db.prepare('PRAGMA table_info(gateway_tokens)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (!gatewayColumns.has('scope')) {
      db.exec(`ALTER TABLE gateway_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'write'`);
    }
  } catch (err) {
    console.error('[migrations] Failed to add gateway_tokens.scope:', err);
  }

  // Bootstrap: promote SEED_ADMIN_EMAIL to admin role, or promote the first existing user
  // if no admin exists yet. Runs on every start so a fresh deploy with an env change takes
  // effect without manual SQL.
  try {
    const adminCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`).get() as {
      c: number;
    };
    const seedAdmin = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();

    if (seedAdmin) {
      const promoted = db
        .prepare(
          `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP
                  WHERE LOWER(email) = ? AND role != 'admin'`
        )
        .run(seedAdmin);
      if (promoted.changes > 0) {
        console.log(`[DB] Promoted ${seedAdmin} to admin (SEED_ADMIN_EMAIL).`);
      }
    } else if (adminCount.c === 0) {
      // No admin yet and no seed email — promote the earliest-created user so the system
      // always has a reachable admin.
      const first = db
        .prepare(`SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1`)
        .get() as { id: string; email: string } | undefined;
      if (first) {
        db.prepare(
          `UPDATE users SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(first.id);
        console.log(`[DB] No admin found — promoted ${first.email} (earliest user) to admin.`);
      }
    }
  } catch (err) {
    console.error('[DB] Admin bootstrap failed:', err);
  }

  // Optional seed user via ENV (for local dev / first-boot bootstrap).
  // Set SEED_USER_EMAIL, SEED_USER_NAME, SEED_USER_PASSWORD to create a user on startup.
  // Never commit credentials to source. Password is read from env only.
  const seedEmail = process.env.SEED_USER_EMAIL?.trim();
  const seedPassword = process.env.SEED_USER_PASSWORD;
  const seedName = process.env.SEED_USER_NAME?.trim() || seedEmail?.split('@')[0];
  if (seedEmail && seedPassword && seedName) {
    try {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(seedEmail) as
        | { id: string }
        | undefined;
      if (!existing) {
        const userId = nanoid();
        const passwordHash = bcrypt.hashSync(seedPassword, 10);
        db.prepare(
          `INSERT INTO users (id, email, name, avatar_url, provider, provider_id, password_hash)
           VALUES (?, ?, ?, ?, 'cli', ?, ?)`
        ).run(userId, seedEmail, seedName, null, `local-cli-${seedName}`, passwordHash);
        db.prepare(
          `INSERT INTO user_settings (user_id, theme, allowed_tools)
           VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
        ).run(userId);
        console.log(`[DB] Seeded user ${seedEmail} from SEED_USER_* env vars.`);
      }
    } catch (err) {
      console.error('[DB] Failed to seed user from env:', err);
    }
  }

  // ── Session templates, notification centre, push, drafts, archive ────────
  // One place for the newer feature tables so their shape is easy to compare.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      cli_provider TEXT,
      cli_model TEXT,
      cli_reasoning TEXT,
      mode TEXT,
      working_directory TEXT,
      design_style_skill TEXT,
      writing_style_skill TEXT,
      surface TEXT DEFAULT 'code',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_templates_user ON session_templates(user_id);

    -- Durable "what happened" feed; the transient socket events are lost on
    -- reload, this is what the notification centre reads.
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

    -- Composer drafts follow the read-state model: server-side, per session and
    -- chat thread, so a draft started on the desktop continues on the phone.
    CREATE TABLE IF NOT EXISTS session_drafts (
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, user_id, chat_id)
    );

    -- Turn diffs: what the working tree looked like before/after one turn.
    CREATE TABLE IF NOT EXISTS turn_diffs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      turn_id TEXT,
      files_changed INTEGER DEFAULT 0,
      insertions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      summary TEXT,
      diff TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_turn_diffs_session
      ON turn_diffs(session_id, created_at DESC);
  `);

  // Archive instead of delete — sessions accumulate and deleting is lossy.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN archived INTEGER DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }

  // Carries the payload a notification needs to be acted on in place — an
  // approval row keeps its requestId so the feed can answer without opening
  // the session.
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN data TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  // Approvals resolve by requestId. A dedicated indexed column replaces the
  // former leading-wildcard LIKE over the JSON blob, which scanned the whole
  // table on every approve/deny click.
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN request_id TEXT`);
    db.exec(
      `UPDATE notifications
          SET request_id = json_extract(data, '$.requestId')
        WHERE request_id IS NULL AND data IS NOT NULL`
    );
  } catch {
    // Column already exists, ignore error
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_request_id
    ON notifications(request_id) WHERE request_id IS NOT NULL`);

  // The feed shows recent history; rows were previously inserted forever. Keep
  // read notifications for 30 days, everything else stays.
  try {
    db.prepare(
      `DELETE FROM notifications
        WHERE read_at IS NOT NULL AND created_at < datetime('now', '-30 days')`
    ).run();
  } catch {
    // Retention is best-effort; never block startup on it.
  }

  repriceUsageHistoryCosts(db);
  backfillGpt55ContextSnapshotWindows(db);
}

/**
 * SQLite cannot alter a CHECK constraint in place. Builds predating user-upload
 * history created `message_media.source` without the `user` value, so every
 * uploaded image failed persistence even though the TypeScript type accepted
 * it. Rebuild the table once, preserving all existing rows and indexes.
 */
export function migrateMessageMediaUserSource(database: Database.Database): boolean {
  const table = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'message_media'")
    .get() as { sql: string | null } | undefined;
  if (!table?.sql || table.sql.includes("'user'")) return false;

  database.transaction(() => {
    database.exec(`
      DROP TRIGGER IF EXISTS trg_message_media_validate_ownership;
      ALTER TABLE message_media RENAME TO message_media_before_user_source;

      CREATE TABLE message_media (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        storage_key TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        alt_text TEXT,
        source TEXT NOT NULL CHECK (source IN ('provider', 'workspace', 'comfyui', 'user')),
        source_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(message_id, sha256)
      );

      INSERT INTO message_media (
        id, message_id, session_id, user_id, storage_key, filename,
        mime_type, byte_size, sha256, alt_text, source, source_id, created_at
      )
      SELECT
        id, message_id, session_id, user_id, storage_key, filename,
        mime_type, byte_size, sha256, alt_text, source, source_id, created_at
      FROM message_media_before_user_source;

      DROP TABLE message_media_before_user_source;

      CREATE TRIGGER trg_message_media_validate_ownership
      BEFORE INSERT ON message_media
      WHEN NOT EXISTS (
        SELECT 1
        FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE m.id = NEW.message_id
          AND m.session_id = NEW.session_id
          AND s.user_id = NEW.user_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'message media ownership mismatch');
      END;

      CREATE INDEX idx_message_media_message_created
        ON message_media(message_id, created_at, id);
      CREATE INDEX idx_message_media_session
        ON message_media(session_id, id);
      CREATE INDEX idx_message_media_owner_hash
        ON message_media(user_id, sha256);
      CREATE INDEX idx_message_media_storage_key
        ON message_media(storage_key);
      CREATE UNIQUE INDEX idx_message_media_source_id
        ON message_media(session_id, source, source_id)
        WHERE source_id IS NOT NULL;
    `);
  })();

  console.log('[DB] Migrated message_media to support durable user attachments.');
  return true;
}

function repriceUsageHistoryCosts(database: Database.Database): void {
  const markerKey = 'usage_history_cost_rate_card_version';
  const marker = database.prepare('SELECT value FROM app_config WHERE key = ?').get(markerKey) as
    | { value: string }
    | undefined;
  if (marker?.value === LLM_PRICING_RATE_CARD_VERSION) return;

  const rows = database
    .prepare(
      `
      SELECT
        id,
        model,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        cost_usd
      FROM usage_history
    `
    )
    .all() as Array<{
    id: number;
    model: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    cost_usd: number;
  }>;

  const updateCost = database.prepare('UPDATE usage_history SET cost_usd = ? WHERE id = ?');
  const upsertMarker = database.prepare(
    `
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `
  );

  let updated = 0;
  let skipped = 0;
  let oldTotal = 0;
  let newTotal = 0;

  const tx = database.transaction(() => {
    for (const row of rows) {
      const estimate = estimateModelCost(
        row.model,
        {
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cacheCreationTokens: row.cache_creation_tokens,
        },
        null
      );

      oldTotal += row.cost_usd || 0;
      if (!estimate.known) {
        skipped += 1;
        newTotal += row.cost_usd || 0;
        continue;
      }

      newTotal += estimate.cost;
      if (Math.abs((row.cost_usd || 0) - estimate.cost) >= 0.0000005) {
        updateCost.run(estimate.cost, row.id);
        updated += 1;
      }
    }

    upsertMarker.run(markerKey, LLM_PRICING_RATE_CARD_VERSION);
  });

  try {
    tx();
    if (rows.length > 0) {
      console.log(
        `[DB] Repriced usage_history costs with ${LLM_PRICING_RATE_CARD_VERSION}: ` +
          `${updated}/${rows.length} rows updated, ${skipped} rows skipped, ` +
          `$${oldTotal.toFixed(4)} -> $${newTotal.toFixed(4)}.`
      );
    }
  } catch (err) {
    console.error('[DB] Failed to reprice usage_history costs:', err);
  }
}

function backfillGpt55ContextSnapshotWindows(database: Database.Database): void {
  const markerKey = 'session_events_context_window_fix_v1';
  const marker = database.prepare('SELECT value FROM app_config WHERE key = ?').get(markerKey) as
    | { value: string }
    | undefined;
  if (marker?.value === 'gpt-5.5:256000') return;

  const updateRows = database.prepare(
    `
    UPDATE session_events
    SET
      context_window = 256000,
      context_used_percent = ROUND((total_tokens * 100.0) / 256000, 0),
      context_exceeded = CASE
        WHEN ROUND((total_tokens * 100.0) / 256000, 0) > 100 THEN 1
        ELSE 0
      END
    WHERE event_type = 'context_snapshot'
      AND model LIKE 'gpt-5.5%'
      AND context_window = 258400
  `
  );
  const upsertMarker = database.prepare(
    `
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `
  );

  let updated = 0;
  const tx = database.transaction(() => {
    updated = updateRows.run().changes;
    upsertMarker.run(markerKey, 'gpt-5.5:256000');
  });

  try {
    tx();
    if (updated > 0) {
      console.log(`[DB] Backfilled ${updated} gpt-5.5 context snapshot rows to 256000.`);
    }
  } catch (err) {
    console.error('[DB] Failed to backfill gpt-5.5 context snapshot windows:', err);
  }
}

function initializeBasicAuth(db: Database.Database): void {
  const existingUsername = db
    .prepare('SELECT value FROM app_config WHERE key = ?')
    .get('basic_auth_username') as { value: string } | undefined;

  if (!existingUsername) {
    // Generate a secure random password on first run
    const defaultUsername = 'admin';
    const randomPassword = crypto.randomBytes(16).toString('base64').slice(0, 20);
    const hashedPassword = bcrypt.hashSync(randomPassword, 10);

    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(
      'basic_auth_username',
      defaultUsername
    );
    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(
      'basic_auth_password',
      hashedPassword
    );
    db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)').run(
      'basic_auth_enabled',
      'true'
    );

    // Show the generated credentials only for an interactive first start. CI
    // migration dry-runs create a disposable database and must not print a
    // password-shaped value into build logs.
    if (process.env.WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG === '1') return;

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  INITIAL BASIC AUTH CREDENTIALS (save these!)              ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Username: ${defaultUsername.padEnd(47)}║`);
    console.log(`║  Password: ${randomPassword.padEnd(47)}║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  Change these in Settings > Security after first login ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
  }
}

export function getAppConfig(key: string): string | null {
  const database = getDatabase();
  const row = database.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setAppConfig(key: string, value: string): void {
  const database = getDatabase();
  database
    .prepare(
      `
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
  `
    )
    .run(key, value, value);
}

export { db };
