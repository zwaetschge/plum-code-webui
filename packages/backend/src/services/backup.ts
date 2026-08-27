import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { getDataDirectory } from '../db/index.js';
import { readPgConfig } from '../db/pg.js';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);
const log = createLogger('backup');

/**
 * Backups via `pg_dump`, taken from inside the server process.
 *
 * Under SQLite this was `VACUUM INTO` on the connection the server already
 * held, and the reason was specific: a second process attaching to a live WAL
 * database has to coordinate through file locks and a shared-memory index, and
 * on Unraid the same file is reachable both directly under /mnt/cache and
 * through the /mnt/user FUSE layer, where two openers cannot see each other's
 * locks. A half-finished checkpoint truncated the main file on 2026-08-26: the
 * header claimed 57153 pages, the file held 55875, and every page of `messages`
 * past that point was gone.
 *
 * That hazard does not survive the move. Postgres is a server; concurrent
 * readers are what it is for, and `pg_dump` takes a consistent snapshot without
 * blocking writers or touching the data files. What is kept is the part that
 * mattered independently of the storage engine: the backup is verified before
 * it counts as one, and a failed verification leaves the file on disk as
 * evidence.
 */

export interface BackupResult {
  path: string;
  bytes: number;
  durationMs: number;
  verified: boolean;
  detail?: string;
}

const BACKUP_PREFIX = 'backup-';
const BACKUP_SUFFIX = '.dump';

/**
 * The schema the application actually uses.
 *
 * Dumping the whole database instead was both wasteful and wrong: a test run
 * creates and drops its own schemas constantly, so an unscoped dump grew to 84
 * tables, took twice as long, and failed outright when pg_dump's snapshot
 * caught a schema mid-drop. Scoping it means the archive holds exactly what a
 * restore needs and nothing that happens to share the database.
 */
function applicationSchema(): string {
  return process.env.PGSCHEMA || 'public';
}

function backupDirectory(): string {
  const dir = path.join(getDataDirectory(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/**
 * Reads the archive back with `pg_restore --list`.
 *
 * An unverified backup is not a backup. This is the equivalent of the old
 * integrity check plus the row counts that went with it: the listing is the
 * dump's own table of contents, so it proves the archive is readable *and* that
 * it contains the tables — a truncated or empty dump fails both. The two tables
 * named are the ones that were unreadable while the old health check still
 * reported "ok".
 */
async function verify(filePath: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const { stdout } = await execFileAsync('pg_restore', ['--list', filePath], {
      maxBuffer: 32 * 1024 * 1024,
    });
    const tables = stdout.match(/^\d+;.*TABLE DATA /gm)?.length ?? 0;
    const missing = ['sessions', 'messages'].filter(
      (table) => !new RegExp(`TABLE DATA ${applicationSchema()} ${table} `).test(stdout)
    );
    if (missing.length) {
      return { ok: false, detail: `dump is missing ${missing.join(', ')}` };
    }
    return { ok: true, detail: `${tables} tables` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 200) : 'unreadable',
    };
  }
}

export async function createBackup(now: Date = new Date()): Promise<BackupResult> {
  const startedAt = Date.now();
  const target = path.join(backupDirectory(), `${BACKUP_PREFIX}${timestamp(now)}${BACKUP_SUFFIX}`);

  if (fs.existsSync(target)) fs.rmSync(target);

  const pg = readPgConfig();
  // The custom format is compressed and lets pg_restore select individual
  // tables, which is what a partial recovery actually needs. The password goes
  // through the environment rather than the connection string so it stays out
  // of the process list.
  await execFileAsync(
    'pg_dump',
    [
      '--host',
      pg.host,
      '--port',
      String(pg.port),
      '--username',
      pg.user,
      '--dbname',
      pg.database,
      '--schema',
      applicationSchema(),
      '--format',
      'custom',
      '--compress',
      '6',
      '--file',
      target,
    ],
    { env: { ...process.env, PGPASSWORD: pg.password }, maxBuffer: 32 * 1024 * 1024 }
  );

  const bytes = fs.statSync(target).size;
  const verification = await verify(target);
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

  const run = async () => {
    try {
      await createBackup();
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
