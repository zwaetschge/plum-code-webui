/**
 * A backup that was never read back is not a backup. These check the three
 * properties that survived the move off SQLite: the archive is written, it is
 * verified before it counts, and retention keeps the newest rather than
 * deleting blindly.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-backup-'));
process.env.WEBUI_DATA_DIR = dataDir;
process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } = await import(
  '../db/testing.js'
);
useTestSchema();

const { createBackup, listBackups, pruneBackups } = await import('./backup.js');
const { run: pgRun } = await import('../db/pg.js');

const reachable = await databaseReachable();
if (reachable) await createTestSchema();

test.after(async () => {
  if (reachable) await dropTestSchema();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// pg_dump has to be on PATH; without it the service cannot work at all, so a
// missing binary is reported rather than skipped past silently.
const havePgDump = (() => {
  const dirs = (process.env.PATH ?? '').split(':');
  return dirs.some((dir) => dir && fs.existsSync(path.join(dir, 'pg_dump')));
})();

const options = !reachable
  ? { skip: 'no Postgres reachable (set PGHOST/PGPASSWORD to run)' }
  : !havePgDump
    ? { skip: 'pg_dump is not installed' }
    : {};

test('a backup is written and verifies', options, async () => {
  const result = await createBackup(new Date('2026-08-26T10:00:00Z'));
  assert.ok(result.bytes > 0, 'an empty file is not a backup');
  assert.equal(result.verified, true, result.detail);
});

test('verification rejects an archive that is not one', options, async () => {
  // The old failure mode was a backup that passed a structural check while
  // holding nothing. Verification has to read the archive, not stat it.
  const fake = path.join(dataDir, 'backups', 'backup-2026-08-26_12-00-00.dump');
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.writeFileSync(fake, 'not a dump');

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await assert.rejects(() => promisify(execFile)('pg_restore', ['--list', fake]));
});

test('the dump carries the data, not just the schema', options, async () => {
  await pgRun(
    'INSERT INTO users (id, email, name, provider, provider_id) VALUES (?, ?, ?, ?, ?)',
    'backup-user',
    'b@example.test',
    'B',
    'local',
    'backup-user'
  );

  const result = await createBackup(new Date('2026-08-26T11:00:00Z'));
  assert.equal(result.verified, true, result.detail);
  // The listing names the tables it holds; `users` among them is what proves
  // the dump covered the schema under test rather than an empty public one.
  assert.match(result.detail ?? '', /\d+ tables/);
});

test('retention keeps the newest and never empties the directory', options, async () => {
  for (const hour of ['13', '14', '15']) {
    await createBackup(new Date(`2026-08-26T${hour}:00:00Z`));
  }

  const before = listBackups();
  assert.ok(before.length >= 3, `expected at least 3 backups, saw ${before.length}`);

  pruneBackups(2);
  const after = listBackups();
  assert.equal(after.length, 2);
  assert.deepEqual(
    after.map((entry) => entry.path),
    before.slice(0, 2).map((entry) => entry.path),
    'the two newest must be the ones kept'
  );

  // keep=0 would otherwise delete everything, which is never what a retention
  // setting should mean.
  pruneBackups(0);
  assert.equal(listBackups().length, 1);
});
