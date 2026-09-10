/**
 * `schema.sql` claims to describe the schema as it stands. It drifted anyway:
 * `gateway_tokens.scope` (migration 001) and `idx_messages_unread` (002) were
 * missing from it for as long as those migrations existed, while 003's column
 * was present — so the file had been half-maintained, and any path that applies
 * the baseline alone (a restore, a fresh node, a test helper) built a database
 * on which creating a gateway token fails outright.
 *
 * This compares the two shapes instead of trusting the claim: apply the
 * baseline, record every column and index, run the migrations, record again.
 * A structural difference means schema.sql is behind and needs the new
 * artefact copied into it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('./testing.js');
useTestSchema();

const { all: pgAll } = await import('./pg.js');

const reachable = await databaseReachable();
if (reachable) await createTestSchema({ runMigrations: false });
test.after(async () => {
  if (reachable) await dropTestSchema();
});

const options = reachable ? {} : { skip: 'no Postgres reachable (set PGHOST/PGPASSWORD to run)' };

async function structure(): Promise<string[]> {
  const columns = (await pgAll(
    `SELECT table_name || '.' || column_name AS item
       FROM information_schema.columns
      WHERE table_schema = current_schema()`
  )) as Array<{ item: string }>;
  const indexes = (await pgAll(
    `SELECT 'index:' || indexname AS item
       FROM pg_indexes
      WHERE schemaname = current_schema()`
  )) as Array<{ item: string }>;
  return [...columns, ...indexes].map((row) => row.item).sort();
}

test('schema.sql already contains everything the migrations add', options, async () => {
  const baseline = await structure();

  const { runPendingMigrations } = await import('./migrations.js');
  await runPendingMigrations();

  const migrated = await structure();
  // schema_migrations is created by the migration runner itself, not by the
  // baseline, so it is expected to appear here and only here.
  const added = migrated.filter(
    (item) => !baseline.includes(item) && !item.includes('schema_migrations')
  );

  assert.deepEqual(
    added,
    [],
    `schema.sql is behind the migrations — copy these into it: ${added.join(', ')}`
  );
});
