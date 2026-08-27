#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('../packages/backend/node_modules/better-sqlite3');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const DAY_MS = 24 * 60 * 60 * 1000;

function defaultDataDir() {
  const rootData = path.join(projectDir, 'data');
  const backendData = path.join(projectDir, 'packages', 'backend', 'data');
  if (existsSync(path.join(rootData, 'claude-webui.db'))) return rootData;
  if (existsSync(path.join(backendData, 'claude-webui.db'))) return backendData;
  return rootData;
}

function defaultConfigDir() {
  const projectConfig = path.join(projectDir, 'config');
  return existsSync(projectConfig) ? projectConfig : process.env.HOME || projectConfig;
}

function usage() {
  process.stdout.write(`Plum Code maintenance\n\n`);
  process.stdout.write(`Usage: node scripts/plum-maintenance.mjs [options]\n\n`);
  process.stdout.write(
    `  --data-dir PATH                 Data directory (default: DATA_DIR or ./data)\n`
  );
  process.stdout.write(
    `  --config-dir PATH               Config directory (default: CONFIG_DIR or ./config)\n`
  );
  process.stdout.write(
    `  --backup-retention-days N       Managed DB backup retention (default: 14)\n`
  );
  process.stdout.write(`  --log-retention-days N          Data log retention (default: 14)\n`);
  process.stdout.write(
    `  --session-retention-days N      Provider JSONL retention (default: 30)\n`
  );
  process.stdout.write(
    `  --dry-run                       Validate and report without writing/deleting\n`
  );
  process.stdout.write(
    `  --skip-backup                   Run retention without creating a DB backup\n`
  );
  process.stdout.write(`  --help                          Show this help\n`);
}

function parsePositiveDays(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    dataDir: path.resolve(process.env.DATA_DIR || defaultDataDir()),
    configDir: path.resolve(process.env.CONFIG_DIR || defaultConfigDir()),
    backupRetentionDays: parsePositiveDays(
      process.env.PLUM_BACKUP_RETENTION_DAYS || '14',
      'PLUM_BACKUP_RETENTION_DAYS'
    ),
    logRetentionDays: parsePositiveDays(
      process.env.PLUM_LOG_RETENTION_DAYS || '14',
      'PLUM_LOG_RETENTION_DAYS'
    ),
    sessionRetentionDays: parsePositiveDays(
      process.env.PLUM_SESSION_RETENTION_DAYS || '30',
      'PLUM_SESSION_RETENTION_DAYS'
    ),
    dryRun: false,
    skipBackup: false,
    now: new Date(),
  };

  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--data-dir':
        options.dataDir = path.resolve(takeValue(index, arg));
        index += 1;
        break;
      case '--config-dir':
        options.configDir = path.resolve(takeValue(index, arg));
        index += 1;
        break;
      case '--backup-retention-days':
        options.backupRetentionDays = parsePositiveDays(takeValue(index, arg), arg);
        index += 1;
        break;
      case '--log-retention-days':
        options.logRetentionDays = parsePositiveDays(takeValue(index, arg), arg);
        index += 1;
        break;
      case '--session-retention-days':
        options.sessionRetentionDays = parsePositiveDays(takeValue(index, arg), arg);
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-backup':
        options.skipBackup = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--now=')) {
          // Deterministic regression/incident-replay hook. It is intentionally
          // omitted from normal usage because operators should use wall time.
          options.now = new Date(arg.slice('--now='.length));
          if (Number.isNaN(options.now.getTime())) {
            throw new Error('--now must be an ISO-8601 timestamp');
          }
        } else {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

async function regularFilesRecursively(root, predicate) {
  const files = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await regularFilesRecursively(entryPath, predicate)));
    } else if (entry.isFile() && predicate(entryPath, entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

async function sessionJsonlFiles(configDir) {
  const files = [];
  const providerRoots = ['codex', 'claude', 'pi'].flatMap((name) => [
    path.join(configDir, name),
    path.join(configDir, `.${name}`),
  ]);

  async function discoverSessionDirs(root) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(root, entry.name);
      if (entry.name === 'sessions' || entry.name === 'projects') {
        files.push(
          ...(await regularFilesRecursively(entryPath, (_file, name) => name.endsWith('.jsonl')))
        );
      } else {
        await discoverSessionDirs(entryPath);
      }
    }
  }

  for (const root of providerRoots) await discoverSessionDirs(root);
  return [...new Set(files)];
}

async function expiredFiles(files, cutoffMs) {
  const expired = [];
  for (const file of files) {
    const metadata = await stat(file);
    if (metadata.mtimeMs < cutoffMs) expired.push(file);
  }
  return expired;
}

async function removeFiles(files, dryRun, label) {
  for (const file of files) {
    process.stdout.write(`${dryRun ? 'would remove' : 'removed'} ${label}: ${file}\n`);
    if (!dryRun) await rm(file, { force: true });
  }
}

/**
 * Verification only ever touches a finished backup file — never the live
 * database. Opening the running database from this script is what caused the
 * 2026-08-26 corruption: a second connection negotiating locks with the server
 * across two views of the same file (/mnt/cache directly and /mnt/user through
 * FUSE) truncated the main file mid-checkpoint.
 */
function assertHealthyBackup(backupPath) {
  const database = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error(`SQLite quick_check failed for ${backupPath}: ${result}`);
  } finally {
    database.close();
  }
}

/**
 * Backups are taken by the server, through the connection it already holds.
 * This script asks for one over the API and then validates the resulting file.
 */
async function createBackup(dataDir, now, dryRun) {
  const baseUrl = process.env.PLUM_MAINTENANCE_URL || 'http://127.0.0.1:3001';
  // The same shared secret spawned CLI subprocesses use; the script has no
  // browser session, and the server is the only process allowed to open the file.
  const hookSecret = process.env.WEBUI_HOOK_SECRET || '';
  const token = process.env.PLUM_MAINTENANCE_TOKEN || '';

  if (dryRun) {
    process.stdout.write(`would ask ${baseUrl} for an in-process backup\n`);
    return null;
  }

  const response = await fetch(`${baseUrl}/api/admin/backup`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(hookSecret ? { 'X-Webui-Hook-Secret': hookSecret } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `Backup request failed with ${response.status}. The server owns the database; ` +
        'this script must not open it directly.'
    );
  }
  const payload = await response.json();
  const destinationPath = payload?.data?.path;
  if (!destinationPath) throw new Error('Backup response contained no path');

  await chmod(destinationPath, 0o600).catch(() => {});
  assertHealthyBackup(destinationPath);
  process.stdout.write(`created validated SQLite backup: ${destinationPath}\n`);
  return destinationPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const nowMs = options.now.getTime();

  if (!options.skipBackup) await createBackup(options.dataDir, options.now, options.dryRun);

  const backupFiles = await regularFilesRecursively(
    path.join(options.dataDir, 'backups'),
    (_file, name) => /^claude-webui-.*\.db(?:-(?:wal|shm))?$/.test(name)
  );
  const expiredBackups = await expiredFiles(
    backupFiles,
    nowMs - options.backupRetentionDays * DAY_MS
  );

  const rootDataEntries = await readdir(options.dataDir, { withFileTypes: true });
  const dataLogs = rootDataEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => path.join(options.dataDir, entry.name));
  dataLogs.push(
    ...(await regularFilesRecursively(path.join(options.dataDir, 'logs'), (_file, name) =>
      name.endsWith('.log')
    ))
  );
  const expiredLogs = await expiredFiles(dataLogs, nowMs - options.logRetentionDays * DAY_MS);

  const sessions = await sessionJsonlFiles(options.configDir);
  const expiredSessions = await expiredFiles(
    sessions,
    nowMs - options.sessionRetentionDays * DAY_MS
  );

  await removeFiles(expiredBackups, options.dryRun, 'backup');
  await removeFiles(expiredLogs, options.dryRun, 'log');
  await removeFiles(expiredSessions, options.dryRun, 'session');

  process.stdout.write(
    `maintenance complete: backup=${options.skipBackup ? 'skipped' : options.dryRun ? 'planned' : 'created'}, ` +
      `expired backups=${expiredBackups.length}, logs=${expiredLogs.length}, sessions=${expiredSessions.length}` +
      `${options.dryRun ? ' (dry run)' : ''}\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `plum-maintenance: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
