-- Baseline Postgres schema.
--
-- Generated from the SQLite schema by scripts/sqlite-to-postgres.mjs, which is
-- also what copies the data across. It is a baseline, not a history: the
-- SQLite side accumulated ~1400 lines of CREATE TABLE followed by guarded
-- ALTER TABLE ADD COLUMN, and replaying that sequence on a fresh Postgres
-- database would produce the same tables by a longer route. Everything from
-- here on is a numbered migration in db/migrations.ts.
--
-- Two shapes are deliberately kept rather than modernised, because changing
-- them is a semantic migration and this is a storage one:
--
--   Booleans are BIGINT. SQLite has none; the code writes 0 and 1 and compares
--   with `= 1` in ~200 places.
--   Timestamps are TEXT holding 'YYYY-MM-DD HH:MM:SS' in UTC, which 161 places
--   compare, slice and sort as strings. db/dialect.ts formats now() to match.
--
-- Regenerate with:
--   node scripts/sqlite-to-postgres.mjs --source <backup.db> --dry-run

CREATE TABLE IF NOT EXISTS "app_config" (
  "key" TEXT,
  "value" TEXT NOT NULL,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" BIGSERIAL,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "ip" TEXT,
  "user_agent" TEXT,
  "metadata_json" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "automation_tokens" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "scopes_json" TEXT NOT NULL,
  "expires_at" TEXT,
  "revoked_at" TEXT,
  "last_used_at" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "chat_upload_chunks" (
  "upload_id" TEXT NOT NULL,
  "chunk_index" BIGINT NOT NULL,
  "byte_size" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("upload_id", "chunk_index")
);

CREATE TABLE IF NOT EXISTS "chat_uploads" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "byte_size" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "chunk_size" BIGINT NOT NULL,
  "total_chunks" BIGINT NOT NULL,
  "received_bytes" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "reserved_delivery_id" TEXT,
  "consumed_message_id" TEXT,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cli_tools" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "description" TEXT,
  "use_session_cwd" BIGINT DEFAULT 1,
  "timeout_seconds" BIGINT DEFAULT 300,
  "enabled" BIGINT DEFAULT 1,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "container_health_snapshots" (
  "id" TEXT,
  "watchdog_id" TEXT,
  "container_id" TEXT NOT NULL,
  "state" TEXT,
  "health" TEXT,
  "restart_count" BIGINT,
  "cpu_percent" DOUBLE PRECISION,
  "memory_bytes" BIGINT,
  "memory_limit_bytes" BIGINT,
  "summary" TEXT,
  "evidence_json" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "container_watchdogs" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "container_id" TEXT NOT NULL,
  "container_name" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "enabled" BIGINT NOT NULL DEFAULT 1,
  "autonomy_level" TEXT NOT NULL DEFAULT 'observe',
  "last_snapshot_at" TEXT,
  "last_incident_at" TEXT,
  "metadata_json" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "custom_agents" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "system_prompt" TEXT NOT NULL,
  "model" TEXT DEFAULT 'claude-sonnet-4-20250514',
  "allowed_tools" TEXT,
  "permission_mode" TEXT DEFAULT 'auto-accept',
  "icon" TEXT DEFAULT 'bot',
  "color" TEXT DEFAULT 'violet',
  "enabled" BIGINT DEFAULT 1,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "discord_outbox" (
  "id" TEXT,
  "user_id" TEXT,
  "session_id" TEXT,
  "event_type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL,
  "attempts" BIGINT NOT NULL DEFAULT 0,
  "next_attempt_at" TEXT,
  "sent_at" TEXT,
  "error" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gateway_tokens" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "revoked" BIGINT NOT NULL DEFAULT 0,
  "last_used_at" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "http_sessions" (
  "sid" TEXT,
  "data" TEXT NOT NULL,
  "expires_at" BIGINT NOT NULL,
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("sid")
);

CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "command" TEXT,
  "args" TEXT,
  "url" TEXT,
  "env" TEXT,
  "enabled" BIGINT DEFAULT 1,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "message_deliveries" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "client_message_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "message_id" TEXT,
  "disposition" TEXT,
  "ack_json" TEXT,
  "error" TEXT,
  "retryable" BIGINT NOT NULL DEFAULT 0,
  "attempts" BIGINT NOT NULL DEFAULT 1,
  "accepted_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "message_media" (
  "id" TEXT,
  "message_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "byte_size" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "alt_text" TEXT,
  "source" TEXT NOT NULL,
  "source_id" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "seq" BIGSERIAL NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" TEXT,
  "session_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "chat_id" TEXT DEFAULT NULL,
  "client_message_id" TEXT DEFAULT NULL,
  "event_sequence" BIGINT DEFAULT NULL,
  "seq" BIGSERIAL NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notes" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT,
  "title" TEXT NOT NULL DEFAULT 'Untitled',
  "content" TEXT NOT NULL DEFAULT '',
  "pinned" BIGINT DEFAULT 0,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "read_at" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "data" TEXT,
  "request_id" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "orchestration_sessions" (
  "id" TEXT,
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "config_json" TEXT NOT NULL,
  "master_provider" TEXT DEFAULT 'claude',
  "status" TEXT DEFAULT 'idle',
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "orchestration_tasks" (
  "id" TEXT,
  "orchestration_id" TEXT NOT NULL,
  "worker_id" TEXT,
  "description" TEXT NOT NULL,
  "status" TEXT DEFAULT 'pending',
  "result" TEXT,
  "error" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "delegated_at" TEXT,
  "completed_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "orchestration_workers" (
  "id" TEXT,
  "orchestration_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT DEFAULT 'idle',
  "current_task_id" TEXT,
  "last_activity_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_categories" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT DEFAULT 'blue',
  "icon" TEXT DEFAULT 'folder',
  "sort_order" BIGINT DEFAULT 0,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_chats" (
  "id" TEXT,
  "session_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "provider_session_id" TEXT DEFAULT NULL,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "seq" BIGSERIAL NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_checkpoints" (
  "id" TEXT,
  "session_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "message_count" BIGINT NOT NULL DEFAULT 0,
  "snapshot_data" TEXT NOT NULL,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_delegations" (
  "id" TEXT,
  "thread_id" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "from_session_id" TEXT,
  "to_session_id" TEXT NOT NULL,
  "from_actor" TEXT NOT NULL DEFAULT 'session',
  "kind" TEXT NOT NULL DEFAULT 'consult',
  "status" TEXT NOT NULL DEFAULT 'queued',
  "content" TEXT NOT NULL,
  "result" TEXT,
  "error" TEXT,
  "hop_count" BIGINT NOT NULL DEFAULT 0,
  "expires_at" TEXT,
  "metadata_json" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_drafts" (
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("session_id", "user_id", "chat_id")
);

CREATE TABLE IF NOT EXISTS "session_events" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "input_tokens" BIGINT NOT NULL DEFAULT 0,
  "output_tokens" BIGINT NOT NULL DEFAULT 0,
  "cache_read_tokens" BIGINT NOT NULL DEFAULT 0,
  "cache_creation_tokens" BIGINT NOT NULL DEFAULT 0,
  "total_tokens" BIGINT NOT NULL DEFAULT 0,
  "context_window" BIGINT NOT NULL DEFAULT 0,
  "context_used_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "context_exceeded" BIGINT NOT NULL DEFAULT 0,
  "reason" TEXT,
  "message" TEXT,
  "summary" TEXT,
  "metadata_json" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "seq" BIGSERIAL NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_goals" (
  "id" TEXT,
  "session_id" TEXT NOT NULL,
  "created_by_user_id" TEXT,
  "created_by_token_id" TEXT,
  "title" TEXT NOT NULL,
  "instructions" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "priority" BIGINT NOT NULL DEFAULT 0,
  "metadata_json" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_peer_links" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "source_session_id" TEXT NOT NULL,
  "target_session_id" TEXT NOT NULL,
  "role" TEXT,
  "enabled" BIGINT NOT NULL DEFAULT 1,
  "metadata_json" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session_reads" (
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "chat_key" TEXT NOT NULL DEFAULT '',
  "last_read_message_id" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("user_id", "session_id", "chat_key")
);

CREATE TABLE IF NOT EXISTS "session_templates" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cli_provider" TEXT,
  "cli_model" TEXT,
  "cli_reasoning" TEXT,
  "mode" TEXT,
  "working_directory" TEXT,
  "design_style_skill" TEXT,
  "writing_style_skill" TEXT,
  "surface" TEXT DEFAULT 'code',
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "working_directory" TEXT NOT NULL,
  "provider" TEXT DEFAULT 'claude',
  "claude_session_id" TEXT,
  "status" TEXT DEFAULT 'stopped',
  "last_message" TEXT,
  "starred" BIGINT DEFAULT 0,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "allowed_directories" TEXT DEFAULT '[]',
  "category" TEXT DEFAULT NULL,
  "cli_provider" TEXT DEFAULT 'claude',
  "mode" TEXT DEFAULT 'auto-accept',
  "design_style_skill" TEXT DEFAULT NULL,
  "writing_style_skill" TEXT DEFAULT NULL,
  "cli_model" TEXT DEFAULT NULL,
  "cli_reasoning" TEXT DEFAULT NULL,
  "cli_service_tier" TEXT DEFAULT NULL,
  "android_device_serial" TEXT DEFAULT NULL,
  "icon_path" TEXT DEFAULT NULL,
  "icon_source" TEXT DEFAULT NULL,
  "surface" TEXT DEFAULT 'code',
  "home_assistant_entity_id" TEXT DEFAULT NULL,
  "active_chat_id" TEXT DEFAULT NULL,
  "event_sequence" BIGINT NOT NULL DEFAULT 0,
  "snapshot_revision" BIGINT NOT NULL DEFAULT 0,
  "archived" BIGINT DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "trusted_devices" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "device_name" TEXT NOT NULL,
  "fingerprint_hash" TEXT NOT NULL,
  "platform" TEXT,
  "last_seen_at" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "turn_diffs" (
  "id" TEXT,
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "turn_id" TEXT,
  "files_changed" BIGINT DEFAULT 0,
  "insertions" BIGINT DEFAULT 0,
  "deletions" BIGINT DEFAULT 0,
  "summary" TEXT,
  "diff" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "usage_history" (
  "id" BIGSERIAL,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "input_tokens" BIGINT NOT NULL DEFAULT 0,
  "output_tokens" BIGINT NOT NULL DEFAULT 0,
  "cache_read_tokens" BIGINT NOT NULL DEFAULT 0,
  "cache_creation_tokens" BIGINT NOT NULL DEFAULT 0,
  "total_tokens" BIGINT NOT NULL DEFAULT 0,
  "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "model" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "provider" TEXT NOT NULL DEFAULT 'unknown',
  "turn_id" TEXT DEFAULT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "usage_limit_snapshots" (
  "id" BIGSERIAL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "metric_key" TEXT NOT NULL,
  "metric_label" TEXT NOT NULL,
  "utilization" DOUBLE PRECISION,
  "used_value" DOUBLE PRECISION,
  "limit_value" DOUBLE PRECISION,
  "remaining_value" DOUBLE PRECISION,
  "unit" TEXT,
  "resets_at" TEXT,
  "window_seconds" BIGINT,
  "source" TEXT,
  "reset_detected" BIGINT NOT NULL DEFAULT 0,
  "reset_event_at" TEXT,
  "recorded_at" TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "usage_subagent_turns" (
  "id" BIGSERIAL,
  "user_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "turn_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "parent_agent_id" TEXT,
  "agent_type" TEXT,
  "model" TEXT,
  "input_tokens" BIGINT NOT NULL DEFAULT 0,
  "output_tokens" BIGINT NOT NULL DEFAULT 0,
  "cache_read_tokens" BIGINT NOT NULL DEFAULT 0,
  "cache_creation_tokens" BIGINT NOT NULL DEFAULT 0,
  "total_tokens" BIGINT NOT NULL DEFAULT 0,
  "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" TEXT,
  "theme" TEXT DEFAULT 'dark',
  "default_working_dir" TEXT,
  "allowed_tools" TEXT,
  "custom_system_prompt" TEXT,
  "settings_json" TEXT,
  PRIMARY KEY ("user_id")
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "avatar_url" TEXT,
  "provider" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "api_key_encrypted" TEXT,
  "created_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "updated_at" TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
  "password_hash" TEXT,
  "role" TEXT NOT NULL DEFAULT 'user',
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_login_at" TEXT,
  PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "audit_log" ADD CONSTRAINT "fk_audit_log_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "automation_tokens" ADD CONSTRAINT "fk_automation_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "chat_upload_chunks" ADD CONSTRAINT "fk_chat_upload_chunks_upload_id" FOREIGN KEY ("upload_id") REFERENCES "chat_uploads" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "chat_uploads" ADD CONSTRAINT "fk_chat_uploads_consumed_message_id" FOREIGN KEY ("consumed_message_id") REFERENCES "messages" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "chat_uploads" ADD CONSTRAINT "fk_chat_uploads_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "chat_uploads" ADD CONSTRAINT "fk_chat_uploads_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "cli_tools" ADD CONSTRAINT "fk_cli_tools_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "container_health_snapshots" ADD CONSTRAINT "fk_container_health_snapshots_watchdog_id" FOREIGN KEY ("watchdog_id") REFERENCES "container_watchdogs" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "container_watchdogs" ADD CONSTRAINT "fk_container_watchdogs_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "container_watchdogs" ADD CONSTRAINT "fk_container_watchdogs_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "custom_agents" ADD CONSTRAINT "fk_custom_agents_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "discord_outbox" ADD CONSTRAINT "fk_discord_outbox_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "discord_outbox" ADD CONSTRAINT "fk_discord_outbox_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "gateway_tokens" ADD CONSTRAINT "fk_gateway_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "mcp_servers" ADD CONSTRAINT "fk_mcp_servers_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "message_deliveries" ADD CONSTRAINT "fk_message_deliveries_message_id" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "message_deliveries" ADD CONSTRAINT "fk_message_deliveries_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "message_deliveries" ADD CONSTRAINT "fk_message_deliveries_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "message_media" ADD CONSTRAINT "fk_message_media_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "message_media" ADD CONSTRAINT "fk_message_media_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "message_media" ADD CONSTRAINT "fk_message_media_message_id" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "fk_messages_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "notes" ADD CONSTRAINT "fk_notes_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "notes" ADD CONSTRAINT "fk_notes_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "orchestration_sessions" ADD CONSTRAINT "fk_orchestration_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "orchestration_sessions" ADD CONSTRAINT "fk_orchestration_sessions_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "orchestration_tasks" ADD CONSTRAINT "fk_orchestration_tasks_orchestration_id" FOREIGN KEY ("orchestration_id") REFERENCES "orchestration_sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "orchestration_workers" ADD CONSTRAINT "fk_orchestration_workers_orchestration_id" FOREIGN KEY ("orchestration_id") REFERENCES "orchestration_sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "fk_push_subscriptions_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_categories" ADD CONSTRAINT "fk_session_categories_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_chats" ADD CONSTRAINT "fk_session_chats_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_checkpoints" ADD CONSTRAINT "fk_session_checkpoints_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_delegations" ADD CONSTRAINT "fk_session_delegations_to_session_id" FOREIGN KEY ("to_session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_delegations" ADD CONSTRAINT "fk_session_delegations_from_session_id" FOREIGN KEY ("from_session_id") REFERENCES "sessions" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_delegations" ADD CONSTRAINT "fk_session_delegations_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_drafts" ADD CONSTRAINT "fk_session_drafts_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_events" ADD CONSTRAINT "fk_session_events_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_events" ADD CONSTRAINT "fk_session_events_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_goals" ADD CONSTRAINT "fk_session_goals_created_by_token_id" FOREIGN KEY ("created_by_token_id") REFERENCES "automation_tokens" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_goals" ADD CONSTRAINT "fk_session_goals_created_by_user_id" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_goals" ADD CONSTRAINT "fk_session_goals_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_peer_links" ADD CONSTRAINT "fk_session_peer_links_target_session_id" FOREIGN KEY ("target_session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_peer_links" ADD CONSTRAINT "fk_session_peer_links_source_session_id" FOREIGN KEY ("source_session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_peer_links" ADD CONSTRAINT "fk_session_peer_links_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_reads" ADD CONSTRAINT "fk_session_reads_last_read_message_id" FOREIGN KEY ("last_read_message_id") REFERENCES "messages" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_reads" ADD CONSTRAINT "fk_session_reads_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_reads" ADD CONSTRAINT "fk_session_reads_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "session_templates" ADD CONSTRAINT "fk_session_templates_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "trusted_devices" ADD CONSTRAINT "fk_trusted_devices_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "usage_history" ADD CONSTRAINT "fk_usage_history_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "usage_history" ADD CONSTRAINT "fk_usage_history_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "usage_limit_snapshots" ADD CONSTRAINT "fk_usage_limit_snapshots_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "usage_subagent_turns" ADD CONSTRAINT "fk_usage_subagent_turns_session_id" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "usage_subagent_turns" ADD CONSTRAINT "fk_usage_subagent_turns_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "user_settings" ADD CONSTRAINT "fk_user_settings_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_audit_log_action" ON "audit_log" ("action");
CREATE INDEX IF NOT EXISTS "idx_audit_log_created" ON "audit_log" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_audit_log_actor" ON "audit_log" ("actor_user_id");
CREATE INDEX IF NOT EXISTS "idx_automation_tokens_revoked" ON "automation_tokens" ("revoked_at");
CREATE INDEX IF NOT EXISTS "idx_automation_tokens_hash" ON "automation_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_automation_tokens_user_id" ON "automation_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_chat_uploads_expiry" ON "chat_uploads" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_chat_uploads_owner_session" ON "chat_uploads" ("user_id", "session_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_cli_tools_user_id" ON "cli_tools" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_container_health_container_created" ON "container_health_snapshots" ("container_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_container_health_watchdog_created" ON "container_health_snapshots" ("watchdog_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_container_watchdogs_enabled" ON "container_watchdogs" ("enabled");
CREATE INDEX IF NOT EXISTS "idx_container_watchdogs_session" ON "container_watchdogs" ("session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_container_watchdogs_user_container" ON "container_watchdogs" ("user_id", "container_id");
CREATE INDEX IF NOT EXISTS "idx_custom_agents_updated_at" ON "custom_agents" ("updated_at");
CREATE INDEX IF NOT EXISTS "idx_custom_agents_user_id" ON "custom_agents" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_discord_outbox_session_created" ON "discord_outbox" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_discord_outbox_user_created" ON "discord_outbox" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_discord_outbox_created" ON "discord_outbox" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_discord_outbox_status_next" ON "discord_outbox" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "idx_gateway_tokens_hash" ON "gateway_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_gateway_tokens_user" ON "gateway_tokens" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_http_sessions_expires_at" ON "http_sessions" ("expires_at");
CREATE INDEX IF NOT EXISTS "idx_mcp_servers_user_id" ON "mcp_servers" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_message_deliveries_session_updated" ON "message_deliveries" ("session_id", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_message_media_source_id" ON "message_media" ("session_id", "source", "source_id");
CREATE INDEX IF NOT EXISTS "idx_message_media_storage_key" ON "message_media" ("storage_key");
CREATE INDEX IF NOT EXISTS "idx_message_media_owner_hash" ON "message_media" ("user_id", "sha256");
CREATE INDEX IF NOT EXISTS "idx_message_media_session" ON "message_media" ("session_id", "id");
CREATE INDEX IF NOT EXISTS "idx_message_media_message_created" ON "message_media" ("message_id", "created_at", "id");
CREATE INDEX IF NOT EXISTS "idx_messages_session_sequence" ON "messages" ("session_id", "event_sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_messages_client_delivery" ON "messages" ("session_id", "client_message_id");
CREATE INDEX IF NOT EXISTS "idx_messages_session_chat" ON "messages" ("session_id", "chat_id");
CREATE INDEX IF NOT EXISTS "idx_messages_session_created" ON "messages" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_messages_session_id" ON "messages" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_notes_session_id" ON "notes" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_notes_user_id" ON "notes" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_request_id" ON "notifications" ("request_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_user_created" ON "notifications" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_orchestration_sessions_session_id" ON "orchestration_sessions" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_orchestration_tasks_worker_id" ON "orchestration_tasks" ("worker_id");
CREATE INDEX IF NOT EXISTS "idx_orchestration_tasks_orchestration_id" ON "orchestration_tasks" ("orchestration_id");
CREATE INDEX IF NOT EXISTS "idx_orchestration_workers_orchestration_id" ON "orchestration_workers" ("orchestration_id");
CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user" ON "push_subscriptions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_session_categories_user_id" ON "session_categories" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_session_chats_session" ON "session_chats" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_session_checkpoints_session_id" ON "session_checkpoints" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_session_delegations_correlation" ON "session_delegations" ("correlation_id");
CREATE INDEX IF NOT EXISTS "idx_session_delegations_to" ON "session_delegations" ("to_session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_session_delegations_from" ON "session_delegations" ("from_session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_session_delegations_user_created" ON "session_delegations" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_session_events_session_type" ON "session_events" ("session_id", "event_type", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_session_events_type_created" ON "session_events" ("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "idx_session_events_session_created" ON "session_events" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_session_events_user_created" ON "session_events" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_session_goals_created" ON "session_goals" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_session_goals_status" ON "session_goals" ("status");
CREATE INDEX IF NOT EXISTS "idx_session_goals_session_id" ON "session_goals" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_session_peer_links_user" ON "session_peer_links" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_session_peer_links_target" ON "session_peer_links" ("target_session_id");
CREATE INDEX IF NOT EXISTS "idx_session_peer_links_source" ON "session_peer_links" ("source_session_id");
CREATE INDEX IF NOT EXISTS "idx_session_reads_session" ON "session_reads" ("session_id", "chat_key", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_session_templates_user" ON "session_templates" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_user_updated" ON "sessions" ("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_sessions_updated_at" ON "sessions" ("updated_at");
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_trusted_devices_fingerprint" ON "trusted_devices" ("fingerprint_hash");
CREATE INDEX IF NOT EXISTS "idx_trusted_devices_user_id" ON "trusted_devices" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_turn_diffs_session" ON "turn_diffs" ("session_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_usage_history_turn" ON "usage_history" ("session_id", "provider", "turn_id");
CREATE INDEX IF NOT EXISTS "idx_usage_history_provider_created" ON "usage_history" ("provider", "created_at");
CREATE INDEX IF NOT EXISTS "idx_usage_history_session_created" ON "usage_history" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_usage_history_user_created" ON "usage_history" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_usage_history_created_at" ON "usage_history" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_usage_history_session_id" ON "usage_history" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_usage_history_user_id" ON "usage_history" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_usage_limit_snapshots_series_recorded" ON "usage_limit_snapshots" ("user_id", "provider", "metric_key", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_usage_limit_snapshots_user_recorded" ON "usage_limit_snapshots" ("user_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_usage_subagent_user_created" ON "usage_subagent_turns" ("user_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_usage_subagent_turn_agent" ON "usage_subagent_turns" ("session_id", "provider", "turn_id", "agent_id");
CREATE INDEX IF NOT EXISTS "idx_users_role" ON "users" ("role");
CREATE INDEX IF NOT EXISTS "idx_users_provider" ON "users" ("provider", "provider_id");
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "idx_message_media_seq" ON "message_media" ("seq");
CREATE INDEX IF NOT EXISTS "idx_messages_seq" ON "messages" ("seq");
CREATE INDEX IF NOT EXISTS "idx_session_chats_seq" ON "session_chats" ("seq");

-- 40 tables, 57 foreign keys, 86 indexes

CREATE INDEX IF NOT EXISTS "idx_messages_seq" ON "messages" ("seq");
CREATE INDEX IF NOT EXISTS "idx_message_media_seq" ON "message_media" ("seq");
CREATE INDEX IF NOT EXISTS "idx_session_chats_seq" ON "session_chats" ("seq");
CREATE INDEX IF NOT EXISTS "idx_session_events_seq" ON "session_events" ("seq");

-- Replaces the FTS5 virtual table `messages_fts`. Generated rather than
-- trigger-maintained: the SQLite side needed triggers to keep the shadow table
-- in step and a repair path for when they fell behind.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;
CREATE INDEX IF NOT EXISTS "idx_messages_search_vector"
  ON "messages" USING GIN ("search_vector");
