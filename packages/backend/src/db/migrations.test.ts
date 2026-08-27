/**
 * The framework's whole point is "exactly once". These lock in that a step does
 * not repeat, that a failure leaves nothing behind, and that the record is
 * readable — the three things the old bare try/catch blocks could not offer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } = await import(
  './testing.js'
);
useTestSchema();

const { hasMigrationRun, listAppliedMigrations, markMigrationApplied, runMigration } = await import(
  './migrations.js'
);
const { transaction: pgTransaction, get: pgGet } = await import('./pg.js');

const reachable = await databaseReachable();
if (reachable) await createTestSchema();
test.after(async () => {
  if (reachable) await dropTestSchema();
});

const options = reachable
  ? {}
  : { skip: 'no Postgres reachable (set PGHOST/PGPASSWORD to run)' };

test('a migration runs once and is recorded', options, async () => {
  const migration = {
    id: 'm1',
    statements: ['CREATE TABLE IF NOT EXISTS t1 (v TEXT)'],
  };

  assert.equal(await runMigration(migration), true);
  assert.equal(await hasMigrationRun('m1'), true);

  // Second call is a no-op: if it ran again the CREATE would still succeed
  // because of IF NOT EXISTS, so the return value is what proves it.
  assert.equal(await runMigration(migration), false);
});

test('a failing migration is rolled back and left unrecorded', options, async () => {
  const migration = {
    id: 'm2',
    statements: ['CREATE TABLE t2 (v TEXT)', 'THIS IS NOT SQL'],
  };

  await assert.rejects(() => runMigration(migration));

  // Unrecorded, so the next boot retries it rather than treating the failure
  // as done.
  assert.equal(await hasMigrationRun('m2'), false);
  // And undone: the table created before the failing statement is gone too.
  const table = await pgGet(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 't2'`
  );
  assert.equal(table, undefined);
});

test('a migration can be marked applied without running', options, async () => {
  await markMigrationApplied('m3');
  assert.equal(await hasMigrationRun('m3'), true);

  // Marking twice must not raise.
  await markMigrationApplied('m3');
  assert.equal(await hasMigrationRun('m3'), true);
});

test('applied migrations are listed', options, async () => {
  await markMigrationApplied('m4');
  const ids = (await listAppliedMigrations()).map((m) => m.id);
  assert.ok(ids.includes('m4'), ids.join(', '));
});

test('the bookkeeping shares the migration transaction', options, async () => {
  // Written inside the same transaction, so a row and its record cannot
  // disagree.
  await runMigration({
    id: 'm5',
    statements: [`INSERT INTO app_config (key, value) VALUES ('m5-probe', 'yes')`],
  });

  const value = await pgTransaction(async (tx) => {
    const row = await tx.get(`SELECT value FROM app_config WHERE key = 'm5-probe'`);
    const record = await tx.get(`SELECT 1 FROM schema_migrations WHERE id = 'm5'`);
    return row && record ? row.value : null;
  });
  assert.equal(value, 'yes');
});
