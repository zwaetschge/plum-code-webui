export const CHAT_COMPACTION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_api_compactions (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    through_seq BIGINT NOT NULL, turn_count BIGINT NOT NULL, source_hash TEXT NOT NULL,
    summary TEXT NOT NULL, truncated_ids_json TEXT NOT NULL DEFAULT '[]',
    provider_id TEXT NOT NULL, model TEXT NOT NULL, usage_json TEXT, created_at TEXT NOT NULL,
    UNIQUE(chat_id,source_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_api_compactions_latest ON assistant_api_compactions(chat_id,through_seq DESC)`,
  `CREATE INDEX IF NOT EXISTS assistant_api_compactions_owner ON assistant_api_compactions(user_id)`,
];
