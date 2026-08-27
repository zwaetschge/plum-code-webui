import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { getDatabase, getDatabasePath } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('backup');

/**
 * Backups taken through the connection the server already holds.
 *
 * The previous approach — `scripts/plum-maintenance.mjs` opening its own
 * connection and calling `.backup()` — is what makes this dangerous. A second
 * process attaching to a live WAL database has to coordinate through file locks
 * and the shared-memory index, and on Unraid the same file is reachable both
 * directly under /mnt/cache and through the /mnt/user FUSE layer. Two processes
 * opening it through different views cannot see each other's locks. A
 * half-finished checkpoint then truncates the main file, which is exactly the
 * damage found on 2026-08-26: the header claimed 57153 pages, the file held
 * 55875, and every page of `messages` past that point was gone.
 *
 * `VACUUM INTO` runs inside this process, on the one connection that owns the
 * database, and writes a fresh, defragmented file. No second connection, no
 * lock negotiation, and the result is consistent by construction.
 */

export interface BackupResult {
  path: string;
  bytes: number;
  durationMs: number;
  verified: boolean;
  detail?: string;
}

const BACKUP_PREFIX = 'backup-';
const BACKUP_SUFFIX = '.db';

function backupDirectory(): string {
  const dir = path.join(path.dirname(getDatabasePath()), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/**
 * Verification opens the *copy*, never the live file — a fresh connection to a
 * file nobody else holds is safe, and an unverified backup is not a backup.
 */
function verify(filePath: string): { ok: boolean; detail?: string } {
  let copy: Database.Database | null = null;
  try {
    copy = new Database(filePath, { readonly: true, fileMustExist: true });
    const row = copy.prepare('PRAGMA integrity_check(1)').get() as
      | { integrity_check?: string }
      | undefined;
    const verdict = row?.integrity_check ?? 'no result';
    if (verdict !== 'ok') return { ok: false, detail: verdict.slice(0, 200) };

    // Structure alone is not enough: an empty file passes integrity_check.
    const sessions = copy.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    const messages = copy.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number };
    return { ok: true, detail: `${sessions.c} sessions, ${messages.c} messages` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 200) : 'unreadable',
    };
  } finally {
    copy?.close();
  }
}

export function createBackup(now: Date = new Date()): BackupResult {
  const startedAt = Date.now();
  const target = path.join(backupDirectory(), `${BACKUP_PREFIX}${timestamp(now)}${BACKUP_SUFFIX}`);

  // VACUUM INTO refuses to overwrite, which is the behaviour we want.
  if (fs.existsSync(target)) fs.rmSync(target);

  getDatabase().prepare('VACUUM INTO ?').run(target);

  const bytes = fs.statSync(target).size;
  const verification = verify(target);
  const result: BackupResult = {
    path: target,
    bytes,
    durationMs: Date.now() - startedAt,
    verified: verification.ok,
    detail: verification.detail,
  };

  if (verification.ok) {
    log.info('Backup written', { path: target, bytes, detail: verification.detail });
  } else {
    // Kept on disk deliberately: a broken backup is evidence about the source.
    log.error('Backup failed verification', { path: target, detail: verification.detail });
  }
  return result;
}

export function listBackups(): Array<{ path: string; bytes: number; createdAt: string }> {
  const dir = backupDirectory();
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .map((name) => {
      const full = path.join(dir, name);
      const stats = fs.statSync(full);
      return { path: full, bytes: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function pruneBackups(keep: number): string[] {
  const removed: string[] = [];
  for (const entry of listBackups().slice(Math.max(keep, 1))) {
    try {
      fs.rmSync(entry.path);
      removed.push(entry.path);
    } catch (error) {
      log.warn('Could not remove old backup', { path: entry.path, error: String(error) });
    }
  }
  return removed;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Runs one backup shortly after boot and then on an interval. The first one is
 * delayed so it does not compete with startup migrations for the write lock.
 */
export function startBackupSchedule(): void {
  if (timer) return;

  const intervalHours = Number(process.env.PLUM_BACKUP_INTERVAL_HOURS || 6);
  const keep = Number(process.env.PLUM_BACKUP_KEEP || 14);
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    log.info('Scheduled backups disabled', { intervalHours });
    return;
  }

  const run = () => {
    try {
      createBackup();
      pruneBackups(keep);
    } catch (error) {
      log.error('Scheduled backup failed', { error: String(error) });
    }
  };

  setTimeout(run, 60_000).unref();
  timer = setInterval(run, intervalHours * 3_600_000);
  timer.unref();
  log.info('Backup schedule started', { intervalHours, keep });
}

export function stopBackupSchedule(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
