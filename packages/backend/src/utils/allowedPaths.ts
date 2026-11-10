import path from 'path';
import os from 'os';
import fs from 'fs';
import { config } from '../config.js';

export function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relativePath = path.relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function realpathIfExists(filePath: string): string | null {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return null;
  }
}

function nearestExistingRealpath(filePath: string): string | null {
  let current = path.resolve(filePath);

  while (true) {
    const real = realpathIfExists(current);
    if (real) return real;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function isAllowedBasePath(filePath: string): boolean {
  const target = path.resolve(filePath);

  return config.allowedBasePaths.some((base) => {
    if (!base.trim()) return false;

    const resolvedBase = path.resolve(base);
    if (!isPathInside(resolvedBase, target)) return false;

    const baseReal = realpathIfExists(resolvedBase);
    const targetReal = nearestExistingRealpath(target);
    if (!baseReal || !targetReal) return false;

    return isPathInside(baseReal, targetReal);
  });
}

/**
 * Files and directories that hold secrets or provider credentials. Even inside
 * an allowed base path (the operator browses /mnt/user and /mnt/cache), the file
 * API and the preview static server must never hand these out: the workspace
 * `.env`, the backend data directory (DB dumps, encryption salt), the shared
 * provider homes, SSH keys and any credentials/key file.
 */
const SENSITIVE_SEGMENTS = new Set([
  '.ssh',
  '.git',
  '.claude',
  '.codex',
  '.pi',
  '.vibe',
  '.opencode',
  '.kimi-code',
  '.npm-global',
  '.config',
  '.gnupg',
  '.aws',
  '.docker',
]);

const SENSITIVE_BASENAME =
  /^(\.env($|[.-])|\.credentials\.json$|credentials\.json$|auth\.json$|.*\.pem$|.*\.key$|id_(rsa|ed25519|ecdsa|dsa)(_[a-z0-9]+)?(\.pub)?$|hosts\.yml$|\.npmrc$|\.pgpass$|amo\.env$|docker-compose\.override\.ya?ml.*|.*\.sqlite(3)?$|claude-webui.*\.db.*|.*\.dump$)/i;

function backendDataDir(): string {
  return process.env.WEBUI_DATA_DIR
    ? path.resolve(process.env.WEBUI_DATA_DIR)
    : path.join(process.cwd(), 'packages', 'backend', 'data');
}

export function isSensitivePath(filePath: string): boolean {
  const target = path.resolve(filePath);
  const segments = target.split(path.sep).filter(Boolean);
  if (segments.some((seg) => SENSITIVE_SEGMENTS.has(seg))) return true;
  if (SENSITIVE_BASENAME.test(path.basename(target))) return true;
  // The backend data directory holds the DB, dumps and runtime config.
  const data = backendDataDir();
  if (isPathInside(data, target)) return true;
  // Provider homes and the per-user Plum config live under the home dir.
  const home = os.homedir();
  for (const name of ['.claude', '.codex', '.pi', '.vibe', '.opencode', '.npm-global', '.ssh']) {
    if (isPathInside(path.join(home, name), target)) return true;
  }
  return false;
}
