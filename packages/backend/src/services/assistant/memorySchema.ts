export const MEMORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_memory_jobs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
    source_type TEXT NOT NULL, source_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    preference_revision BIGINT NOT NULL, source_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    attempts BIGINT NOT NULL DEFAULT 0, lease_until TEXT, error TEXT, usage_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,id)
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_memory_jobs_pending ON assistant_memory_jobs(status,updated_at)`,
  `CREATE TABLE IF NOT EXISTS assistant_memory_history (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
    source_type TEXT NOT NULL, source_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    project_id TEXT, source_hash TEXT NOT NULL, summary TEXT NOT NULL, writing_style TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(user_id,id)
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_memory_history_search ON assistant_memory_history USING GIN(to_tsvector('simple',summary))`,
  `CREATE TABLE IF NOT EXISTS assistant_memory_forgotten (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL,
    PRIMARY KEY(user_id,fingerprint)
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_memory_text_search ON assistant_resources USING GIN(to_tsvector('simple',title || ' ' || COALESCE(body_json::jsonb->>'text','') || ' ' || COALESCE(body_json::jsonb->>'keywords',''))) WHERE kind='memory'`,
];

export const MEMORY_COMPLETION_SCHEMA = [
  `ALTER TABLE assistant_memory_jobs ADD COLUMN IF NOT EXISTS backfill INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS assistant_memory_vectors (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL, kind TEXT NOT NULL,
    version TEXT NOT NULL, model TEXT NOT NULL, part INTEGER NOT NULL DEFAULT 0, vector DOUBLE PRECISION[] NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,id,kind,part)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_memory_backfills (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, preference_revision BIGINT NOT NULL,
    status TEXT NOT NULL, boundary TEXT NOT NULL, cursor_time TEXT, cursor_key TEXT,
    considered BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
];
