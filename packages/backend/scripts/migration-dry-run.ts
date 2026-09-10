/**
 * Applies the schema to a throwaway Postgres schema and checks it holds.
 *
 * Under SQLite this copied a database, ran the migrations over it and asked for
 * `quick_check` and `foreign_key_check`. The Postgres equivalents of those two
 * are different questions:
 *
 * - **Does it apply twice?** schema.sql runs on every boot, so a statement that
 *   is not idempotent breaks the *second* start, not the first. That is exactly
 *   what happened with `ALTER TABLE ... ADD CONSTRAINT`, which has no
 *   IF NOT EXISTS and failed on the first foreign key. Applying twice here
 *   catches the next one before a deployment does.
 * - **Are the constraints real?** Postgres will not let a NOT VALID constraint
 *   masquerade as an enforced one, so the check is that none are left in that
 *   state, plus that every trigger the invariants depend on exists. Those
 *   triggers lived only in boot-time code once, and their absence was silent.
 *
 * Usage: tsx scripts/migration-dry-run.ts
 */

import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'migration-dry-run-session-secret-0000000000000000';
process.env.JWT_SECRET ||= 'migration-dry-run-jwt-secret-0000000000000000000';
process.env.ENCRYPTION_KEY ||= 'migration-dry-run-encryption-key-000000000000';

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();

const { all: pgAll } = await import('../src/db/pg.js');

if (!(await databaseReachable())) {
  console.log('Migration dry-run skipped: no Postgres reachable');
  process.exit(0);
}

try {
  await createTestSchema();
  // Twice. The whole point.
  await createTestSchema();

  const invalid = (await pgAll(
    `SELECT conname FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = current_schema() AND NOT c.convalidated`
  )) as Array<{ conname: string }>;
  assert.deepEqual(
    invalid.map((row) => row.conname),
    [],
    'a constraint left NOT VALID is not enforced for the rows already there'
  );

  const expectedTriggers = [
    'trg_message_media_validate_ownership',
    'trg_session_reads_validate',
    'trg_messages_snapshot_insert',
    'trg_messages_snapshot_update',
    'trg_messages_snapshot_delete',
    'trg_messages_cancel_consumed_uploads',
    'trg_session_categories_after_delete',
  ];
  const triggers = (await pgAll(
    `SELECT tgname FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND NOT t.tgisinternal
      ORDER BY tgname`
  )) as Array<{ tgname: string }>;
  const present = new Set(triggers.map((row) => row.tgname));
  const missing = expectedTriggers.filter((name) => !present.has(name));
  assert.deepEqual(missing, [], 'invariants enforced by triggers must survive a fresh schema');

  const tables = (await pgAll(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = current_schema()`
  )) as Array<{ count: number }>;
  console.log(
    `Migration dry-run passed: ${tables[0]?.count} tables, ` +
      `${expectedTriggers.length} triggers, all constraints validated`
  );
} finally {
  await dropTestSchema();
}
