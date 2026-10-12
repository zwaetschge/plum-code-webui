/** Additive schema; applied only by the normal startup migration runner. */
export const ASSISTANT_PUBLICATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_publications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL, token_hash TEXT UNIQUE NOT NULL, token_encrypted TEXT NOT NULL,
    title TEXT NOT NULL, html TEXT NOT NULL, content_sha256 TEXT NOT NULL,
    expires_at TEXT NOT NULL, revoked BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`,
];
export const ASSISTANT_DOCUMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_document_members (
    resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('viewer','editor')), granted_revision BIGINT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(resource_id,user_id)
  )`,
];
export const ASSISTANT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_branches (
    chat_id TEXT PRIMARY KEY REFERENCES session_chats(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_chat_id TEXT, source_message_id TEXT NOT NULL, seed_message_ids TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_matrix_sync (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    native_user_id TEXT NOT NULL, cursor TEXT, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_assets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, mime_type TEXT NOT NULL, sha256 TEXT NOT NULL,
    bytes BYTEA NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(user_id, sha256)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_matrix_events (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, room_id TEXT NOT NULL,
    event_id TEXT NOT NULL, event_json TEXT NOT NULL, native_user_id TEXT NOT NULL DEFAULT '', origin_ts BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, room_id, event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_matrix_events_timeline ON assistant_matrix_events(user_id, room_id, origin_ts)`,
  `CREATE TABLE IF NOT EXISTS assistant_matrix_rooms (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, room_id TEXT NOT NULL,
    native_user_id TEXT NOT NULL DEFAULT '', state_json TEXT NOT NULL DEFAULT '[]', history_cursor TEXT, history_complete BIGINT NOT NULL DEFAULT 0,
    imported_count BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, room_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_executor_leases (
    name TEXT PRIMARY KEY, owner_id TEXT NOT NULL, epoch BIGINT NOT NULL DEFAULT 1,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_credentials (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service TEXT NOT NULL, public_json TEXT NOT NULL, secret_encrypted TEXT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(user_id, service)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_matrix_commands (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, command_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL, native_user_id TEXT NOT NULL DEFAULT '', identity_epoch TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, result_json TEXT,
    PRIMARY KEY(user_id, command_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_resources (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, title TEXT NOT NULL, body_json TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1, archived BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_resources_owner_kind ON assistant_resources(user_id, kind, archived, updated_at)`,
  `CREATE TABLE IF NOT EXISTS assistant_resource_revisions (
    resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL, title TEXT NOT NULL, body_json TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(resource_id, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_source_chunks (
    resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL, chunk_index BIGINT NOT NULL, start_offset BIGINT NOT NULL,
    end_offset BIGINT NOT NULL, page BIGINT, text TEXT NOT NULL,
    PRIMARY KEY(resource_id,revision,chunk_index),
    FOREIGN KEY(resource_id,revision) REFERENCES assistant_resource_revisions(resource_id,revision) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_source_watches (
    source_id TEXT PRIMARY KEY REFERENCES assistant_resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 1, enabled BIGINT NOT NULL DEFAULT 0,
    interval_minutes BIGINT NOT NULL DEFAULT 60, next_check_at TEXT NOT NULL,
    checked_at TEXT, error TEXT, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_source_watches_due ON assistant_source_watches(enabled,next_check_at)`,
  `CREATE TABLE IF NOT EXISTS assistant_api_turns (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL, payload_hash TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, error TEXT, model TEXT NOT NULL, profile_json TEXT NOT NULL,
    source_versions TEXT NOT NULL DEFAULT '[]', image_asset_ids TEXT NOT NULL DEFAULT '[]', usage_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    UNIQUE(chat_id,seq)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_api_usage (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id TEXT, provider_id TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
    usage_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_api_usage_owner_time ON assistant_api_usage(user_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS assistant_api_files (
    chat_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assistant_assets(id), created_at TEXT NOT NULL,
    PRIMARY KEY(chat_id,asset_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_session_bindings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    profile_id TEXT REFERENCES assistant_resources(id), profile_revision BIGINT,
    project_id TEXT REFERENCES assistant_resources(id), runtime_id TEXT,
    temporary BIGINT NOT NULL DEFAULT 0, temporary_expires_at TEXT, temporary_purged_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_commands (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, command_id TEXT NOT NULL,
    resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL,
    result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, command_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_attempts (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    command_id TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT REFERENCES sessions(id),
    native_id TEXT, started_at TEXT NOT NULL, finished_at TEXT, result_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_source_mappings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, source TEXT NOT NULL,
    native_id TEXT NOT NULL, resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    source_revision TEXT, PRIMARY KEY(user_id, source, native_id)
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_app_state (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL, revision BIGINT NOT NULL, version BIGINT NOT NULL,
    state_json TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,resource_id,revision),
    FOREIGN KEY(resource_id,revision) REFERENCES assistant_resource_revisions(resource_id,revision) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS assistant_shares (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL, token_hash TEXT UNIQUE NOT NULL, expires_at TEXT NOT NULL,
    revoked BIGINT NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  )`,
];
