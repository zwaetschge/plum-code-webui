/**
 * The old check was `SELECT 1`. It answered without touching a table, so it
 * reported a healthy database for hours while `messages` was unreadable and the
 * file was truncated by 1278 pages. These pin the property that failure needed:
 * the check reads the tables that matter, and says which one is broken.
 *
 * The structural half of the old test — deliberately truncating a database file
 * and watching quick_check catch it — has no counterpart here, and that is the
 * point of the move rather than a gap in the tests. Page-level truncation is
 * something that happens to a single file two processes share. Postgres refuses
 * a query it cannot answer, which the reads below surface.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-ready-'));
process.env.WEBUI_DATA_DIR = dataDir;
process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } = await import(
  '../db/testing.js'
);
useTestSchema();

const { buildReadinessReport } = await import('./readiness.js');
const { run: pgRun } = await import('../db/pg.js');

const reachable = await databaseReachable();
if (reachable) await createTestSchema();

test.after(async () => {
  if (reachable) await dropTestSchema();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const options = reachable ? {} : { skip: 'no Postgres reachable (set PGHOST/PGPASSWORD to run)' };

test('a healthy database reports ready', options, async () => {
  const report = await buildReadinessReport();
  assert.equal(report.checks.database?.ok, true, report.checks.database?.detail);
});

test('the check reads real tables, so SELECT 1 alone cannot satisfy it', options, async () => {
  // Renaming the table away is the cheapest stand-in for "it cannot be read":
  // SELECT 1 still succeeds, a real read does not.
  await pgRun('ALTER TABLE messages RENAME TO messages_hidden');
  try {
    const report = await buildReadinessReport();
    assert.equal(
      report.checks.database?.ok,
      false,
      'a missing messages table must not read as ready'
    );
    assert.match(report.checks.database?.detail ?? '', /messages/);
    assert.equal(report.status, 'not_ready');
  } finally {
    await pgRun('ALTER TABLE messages_hidden RENAME TO messages');
  }
});

test('a report names which table failed', options, async () => {
  await pgRun('ALTER TABLE sessions RENAME TO sessions_hidden');
  try {
    const report = await buildReadinessReport();
    assert.match(report.checks.database?.detail ?? '', /^sessions:/);
  } finally {
    await pgRun('ALTER TABLE sessions_hidden RENAME TO sessions');
  }
});
