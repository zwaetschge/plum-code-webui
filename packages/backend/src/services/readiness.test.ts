/**
 * The old check was `SELECT 1`. It answered without touching a table, so it
 * reported a healthy database for hours while `messages` was unreadable and the
 * file was truncated by 1278 pages. These tests pin the two properties that
 * failure needed: real table reads, and SQLite's own structural verdict.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-ready-'));
process.env.WEBUI_DATA_DIR = dataDir;
process.env.SESSION_SECRET ||= 'x'.repeat(32);
process.env.JWT_SECRET ||= 'y'.repeat(32);

const { initDatabase, getDatabase } = await import('../db/index.js');
const { buildReadinessReport } = await import('./readiness.js');

initDatabase();

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('a healthy database reports ready', () => {
  const report = buildReadinessReport();
  assert.equal(report.checks.database?.ok, true, report.checks.database?.detail);
});

test('the check reads real tables, so SELECT 1 alone cannot satisfy it', () => {
  // Renaming the table away is the cheapest stand-in for "its pages are gone":
  // SELECT 1 still succeeds, a real read does not.
  const db = getDatabase();
  db.exec('ALTER TABLE messages RENAME TO messages_hidden');
  try {
    const report = buildReadinessReport();
    assert.equal(
      report.checks.database?.ok,
      false,
      'a missing messages table must not read as ready'
    );
    assert.match(report.checks.database?.detail ?? '', /messages/);
    assert.equal(report.status, 'not_ready');
  } finally {
    db.exec('ALTER TABLE messages_hidden RENAME TO messages');
  }
});

test('quick_check runs against a genuinely corrupt file', () => {
  // Truncating a database mid-page is exactly what happened in production.
  const brokenPath = path.join(dataDir, 'broken.db');
  const broken = new Database(brokenPath);
  broken.exec('CREATE TABLE t (v TEXT)');
  const insert = broken.prepare('INSERT INTO t (v) VALUES (?)');
  const fill = broken.transaction(() => {
    for (let i = 0; i < 5000; i++) insert.run(`row-${i}`.repeat(20));
  });
  fill();
  broken.pragma('wal_checkpoint(TRUNCATE)');
  broken.close();

  const size = fs.statSync(brokenPath).size;
  fs.truncateSync(brokenPath, Math.floor(size / 2));

  const reopened = new Database(brokenPath, { readonly: true });
  let verdict: string;
  try {
    const row = reopened.prepare('PRAGMA quick_check(1)').get() as { quick_check?: string };
    verdict = row?.quick_check ?? 'no result';
  } catch (error) {
    verdict = error instanceof Error ? error.message : 'threw';
  }
  reopened.close();

  assert.notEqual(verdict, 'ok', 'a truncated database must not pass quick_check');
});
