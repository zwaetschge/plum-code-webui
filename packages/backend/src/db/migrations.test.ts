/**
 * The framework's whole point is "exactly once". These lock in that a step does
 * not repeat, that a failure leaves nothing behind, and that the record is
 * readable — the three things the old bare try/catch blocks could not offer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  hasMigrationRun,
  listAppliedMigrations,
  markMigrationApplied,
  runMigration,
} from './migrations.js';

function memoryDb() {
  return new Database(':memory:');
}

test('a migration runs once and is recorded', () => {
  const db = memoryDb();
  let runs = 0;
  assert.equal(
    runMigration(db, 'm1', () => {
      runs += 1;
    }),
    true
  );
  assert.equal(runs, 1);
  assert.equal(hasMigrationRun(db, 'm1'), true);
  db.close();
});

test('a second call is a no-op', () => {
  const db = memoryDb();
  let runs = 0;
  runMigration(db, 'm1', () => {
    runs += 1;
  });
  assert.equal(
    runMigration(db, 'm1', () => {
      runs += 1;
    }),
    false
  );
  assert.equal(runs, 1, 'the body must not run twice');
  db.close();
});

test('a failing migration rolls back and stays unrecorded', () => {
  const db = memoryDb();
  db.exec('CREATE TABLE t (v TEXT)');

  assert.throws(() =>
    runMigration(db, 'bad', (database) => {
      database.prepare('INSERT INTO t (v) VALUES (?)').run('written');
      throw new Error('boom');
    })
  );

  const rows = db.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number };
  assert.equal(rows.c, 0, 'partial work must not survive');
  assert.equal(hasMigrationRun(db, 'bad'), false, 'so the next boot retries it');
  db.close();
});

test('a retried migration can succeed later', () => {
  const db = memoryDb();
  let attempt = 0;
  assert.throws(() =>
    runMigration(db, 'flaky', () => {
      attempt += 1;
      throw new Error('first attempt fails');
    })
  );
  assert.equal(
    runMigration(db, 'flaky', () => {
      attempt += 1;
    }),
    true
  );
  assert.equal(attempt, 2);
  db.close();
});

test('already-applied steps can be back-filled without running', () => {
  const db = memoryDb();
  markMigrationApplied(db, 'legacy');
  let runs = 0;
  assert.equal(
    runMigration(db, 'legacy', () => {
      runs += 1;
    }),
    false
  );
  assert.equal(runs, 0, 'existing deployments must not re-run old steps');
  db.close();
});

test('applied migrations are listable', () => {
  const db = memoryDb();
  runMigration(db, 'a', () => {});
  runMigration(db, 'b', () => {});
  const ids = listAppliedMigrations(db).map((m) => m.id);
  assert.deepEqual(ids.sort(), ['a', 'b']);
  db.close();
});
