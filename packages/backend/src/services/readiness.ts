import { get as pgGet } from '../db/pg.js';
import fs from 'fs';
import path from 'path';

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
 * messages` failed with SQLITE_CORRUPT. The check reads real rows from the two
 * tables that matter.
 *
 * On Postgres the structural half of the old check is gone, and that is
 * correct rather than a gap: `quick_check` existed because a single-file
 * embedded database can be truncated underneath a running process. Postgres
 * detects that class of damage itself and refuses the query, which the reads
 * below surface anyway. What readiness has to answer is "can this process serve
 * requests", so the probe checks the connection pool and the two hot tables.
 */
async function checkDatabase(): Promise<ReadinessCheck> {
  for (const table of ['sessions', 'messages']) {
    try {
      await pgGet(`SELECT COUNT(*) AS c FROM ${table}`);
    } catch (error) {
      // `pg` puts the SQLSTATE on `code`; 57P01/08006 mean the server or the
      // connection went away, 42P01 means the schema is not there at all.
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'read failed';
      return { ok: false, detail: `${table}: ${code}` };
    }
  }

  return { ok: true };
}

/**
 * Readiness is intentionally local and bounded. External providers, MCPs and
 * optional integrations are not dependencies of the WebUI control plane and
 * must not flap the container when one of them is offline.
 */
export async function buildReadinessReport(
  frontendPath?: string,
  providers?: Record<string, ProviderStatus>
): Promise<ReadinessReport> {
  const checks: Record<string, ReadinessCheck> = {};

  checks.database = await checkDatabase();

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
