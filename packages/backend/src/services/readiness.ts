import fs from 'fs';
import path from 'path';

import { getDatabase } from '../db/index.js';
import { resolveConfigHome } from '../utils/configPaths.js';

export interface ReadinessCheck {
  ok: boolean;
  detail?: string;
}

export interface ProviderStatus {
  /** The harness binary is installed in this image. */
  installed: boolean;
  /** Credentials are present, i.e. somebody completed its login. */
  authenticated: boolean;
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: Record<string, ReadinessCheck>;
  /**
   * Informational only — never folded into `status`. Readiness gates the
   * container, and a logged-out harness is not a reason to restart the WebUI.
   * It was, however, invisible: `/health/ready` reported green while Codex was
   * signed out, so nothing could tell an operator which harness to fix.
   */
  providers?: Record<string, ProviderStatus>;
}

function checkDirectory(directory: string): ReadinessCheck {
  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false, detail: 'directory is not readable and writable' };
  }
}

function checkFrontendBundle(frontendPath: string): ReadinessCheck {
  const indexPath = path.join(frontendPath, 'index.html');
  try {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const assetPaths = Array.from(
      indexHtml.matchAll(/\b(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g),
      (match) => match[1] as string
    );

    if (!assetPaths.some((assetPath) => assetPath.endsWith('.js'))) {
      return { ok: false, detail: 'frontend entry script is missing' };
    }
    if (!assetPaths.some((assetPath) => assetPath.endsWith('.css'))) {
      return { ok: false, detail: 'frontend stylesheet is missing' };
    }

    const frontendRoot = path.resolve(frontendPath);
    for (const assetPath of new Set(assetPaths)) {
      const resolvedAsset = path.resolve(frontendRoot, `.${assetPath}`);
      if (!resolvedAsset.startsWith(`${frontendRoot}${path.sep}`)) {
        return { ok: false, detail: 'frontend asset path is invalid' };
      }
      const assetStats = fs.statSync(resolvedAsset);
      if (!assetStats.isFile() || assetStats.size === 0) {
        return { ok: false, detail: `frontend asset is empty: ${assetPath}` };
      }
    }

    return { ok: true };
  } catch (error) {
    const detail =
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'frontend bundle or referenced asset is missing'
        : 'frontend bundle cannot be read';
    return { ok: false, detail };
  }
}

/**
 * `SELECT 1` was worthless here: it is answered without touching a single table,
 * so readiness reported a healthy database for hours while `SELECT count(*) FROM
 * messages` failed with SQLITE_CORRUPT. The check now reads real pages from the
 * two tables that matter, and periodically runs SQLite's own structural check.
 *
 * quick_check walks the whole b-tree, which is far too slow for a probe Docker
 * fires every few seconds, so it runs at most once every [QUICK_CHECK_INTERVAL_MS]
 * and its last verdict is cached in between.
 */
const QUICK_CHECK_INTERVAL_MS = 15 * 60_000;
let lastQuickCheck: { at: number; ok: boolean; detail?: string } | null = null;

function runQuickCheck(db: ReturnType<typeof getDatabase>): { ok: boolean; detail?: string } {
  const now = Date.now();
  if (lastQuickCheck && now - lastQuickCheck.at < QUICK_CHECK_INTERVAL_MS) {
    return { ok: lastQuickCheck.ok, detail: lastQuickCheck.detail };
  }
  try {
    const row = db.prepare('PRAGMA quick_check(1)').get() as { quick_check?: string } | undefined;
    const verdict = row?.quick_check ?? 'no result';
    const ok = verdict === 'ok';
    lastQuickCheck = { at: now, ok, detail: ok ? undefined : verdict.slice(0, 200) };
  } catch (error) {
    lastQuickCheck = {
      at: now,
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 200) : 'quick_check failed',
    };
  }
  return { ok: lastQuickCheck.ok, detail: lastQuickCheck.detail };
}

function checkDatabase(): ReadinessCheck {
  let db: ReturnType<typeof getDatabase>;
  try {
    db = getDatabase();
  } catch {
    return { ok: false, detail: 'database is not open' };
  }

  // Real reads, not a constant: these are the tables whose pages actually get
  // written, and the ones that were unreadable while readiness said "ok".
  for (const table of ['sessions', 'messages']) {
    try {
      db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'read failed';
      return { ok: false, detail: `${table}: ${code}` };
    }
  }

  const structural = runQuickCheck(db);
  if (!structural.ok) {
    return { ok: false, detail: `quick_check: ${structural.detail ?? 'failed'}` };
  }

  return { ok: true };
}

/**
 * Readiness is intentionally local and bounded. External providers, MCPs and
 * optional integrations are not dependencies of the WebUI control plane and
 * must not flap the container when one of them is offline.
 */
export function buildReadinessReport(
  frontendPath?: string,
  providers?: Record<string, ProviderStatus>
): ReadinessReport {
  const checks: Record<string, ReadinessCheck> = {};

  checks.database = checkDatabase();

  const dataDirectory = process.env.WEBUI_DATA_DIR
    ? path.resolve(process.env.WEBUI_DATA_DIR)
    : path.resolve(process.cwd(), 'packages/backend/data');
  checks.dataDirectory = checkDirectory(dataDirectory);
  checks.configHome = checkDirectory(resolveConfigHome());

  if (frontendPath) {
    checks.frontend = checkFrontendBundle(frontendPath);
  }

  return {
    // `providers` is deliberately not part of this calculation.
    status: Object.values(checks).every((check) => check.ok) ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks,
    ...(providers ? { providers } : {}),
  };
}
