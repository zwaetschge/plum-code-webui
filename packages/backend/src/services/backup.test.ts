/**
 * The point of moving backups in-process is that they never open a second
 * connection to the live database. These check the guarantees that follow:
 * the copy is consistent, it is actually verified, and retention keeps the
 * newest rather than deleting blindly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-backup-'));
process.env.WEBUI_DATA_DIR = dataDir;
process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { initDatabase, getDatabase } = await import('../db/index.js');
const { createBackup, listBackups, pruneBackups } = await import('./backup.js');

initDatabase();

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('a backup is written, verified and readable on its own', () => {
  const result = createBackup(new Date('2026-08-26T10:00:00Z'));
  assert.ok(result.bytes > 0, 'an empty file is not a backup');
  assert.equal(result.verified, true, result.detail);

  const copy = new Database(result.path, { readonly: true });
  assert.equal(
    (copy.prepare('PRAGMA integrity_check(1)').get() as { integrity_check: string })
      .integrity_check,
    'ok'
  );
  copy.close();
});

test('the copy carries the data, not just the schema', () => {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO users (id, email, name, provider, provider_id) VALUES (?, ?, ?, ?, ?)'
  ).run('backup-user', 'b@example.test', 'B', 'local', 'backup-user');

  const result = createBackup(new Date('2026-08-26T11:00:00Z'));
  const copy = new Database(result.path, { readonly: true });
  const row = copy.prepare('SELECT name FROM users WHERE id = ?').get('backup-user') as
    | { name: string }
    | undefined;
  copy.close();
  assert.equal(row?.name, 'B');
});

test('retention keeps the newest and drops the rest', () => {
  for (let hour = 12; hour < 17; hour++) {
    createBackup(new Date(`2026-08-26T${hour}:00:00Z`));
  }
  const before = listBackups();
  assert.ok(before.length >= 5);

  const removed = pruneBackups(2);
  const after = listBackups();
  assert.equal(after.length, 2, 'exactly the requested number survives');
  assert.equal(removed.length, before.length - 2);
  // Newest first, so the survivors must be the two most recent.
  assert.deepEqual(
    after.map((entry) => entry.path),
    before.slice(0, 2).map((entry) => entry.path)
  );
});

test('retention never wipes everything, even when asked for zero', () => {
  createBackup(new Date('2026-08-26T18:00:00Z'));
  pruneBackups(0);
  assert.ok(listBackups().length >= 1, 'keeping nothing would leave no recovery point');
});
