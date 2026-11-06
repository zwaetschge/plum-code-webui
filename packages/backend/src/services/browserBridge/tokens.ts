import { get as pgGet, all as pgAll, run as pgRun } from '../../db/pg.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { AppError } from '../../middleware/errorHandler.js';

/**
 * Pairing credentials for the Firefox extension.
 *
 * Deliberately separate from gateway tokens: a browser token only opens the
 * browser-bridge WebSocket. `resolveAuthenticatedUserId` never sees this
 * prefix, so a token copied out of the extension's storage cannot read
 * sessions, send messages or touch settings.
 */

export const BROWSER_TOKEN_PREFIX = 'plum_ff_';
export const BROWSER_TOKEN_LIMIT = 10;
/**
 * Watches have their own budget. Counted against the browser limit, a full set
 * of extension and desktop pairings made the phone fail to pair the watch.
 */
export const WATCH_TOKEN_LIMIT = 5;

/** Active tokens a user may hold per scope. */
export function tokenLimitFor(scope: BrowserTokenScope): number {
  return scope === 'watch' ? WATCH_TOKEN_LIMIT : BROWSER_TOKEN_LIMIT;
}

/**
 * `browser` tokens pair the extension, Plum Desktop and Plum Desk. A `watch`
 * token is handed to the Wear OS app by the phone: its socket always counts as
 * a watch (never a browser or desktop target) and may only make the few RPC
 * calls the watch needs (rpc.ts).
 */
export type BrowserTokenScope = 'browser' | 'watch';

export function normalizeTokenScope(value: unknown): BrowserTokenScope {
  return value === 'watch' ? 'watch' : 'browser';
}

export interface BrowserTokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: BrowserTokenScope;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createBrowserToken(
  userId: string,
  name: string,
  scope: BrowserTokenScope = 'browser'
): Promise<{ token: string; row: BrowserTokenRow }> {
  // Rows from before migration 026 have no scope; they are browser tokens.
  const active = (await pgGet(
    `SELECT COUNT(*) AS count FROM browser_tokens
      WHERE user_id = ? AND revoked = 0 AND COALESCE(scope, 'browser') = ?`,
    userId,
    scope
  )) as { count?: number | string } | undefined;
  const limit = tokenLimitFor(scope);
  if (Number(active?.count ?? 0) >= limit) {
    throw new AppError(
      scope === 'watch'
        ? `Es sind schon ${limit} Uhren gekoppelt. Entferne zuerst eine unter Einstellungen → Uhr.`
        : `You already have ${limit} active browser tokens — revoke one first.`,
      429,
      scope === 'watch' ? 'WATCH_TOKEN_LIMIT' : 'BROWSER_TOKEN_LIMIT'
    );
  }

  const token = `${BROWSER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const id = nanoid();
  const tokenPrefix = token.slice(0, BROWSER_TOKEN_PREFIX.length + 6);
  const cleanName = name.trim() || (scope === 'watch' ? 'Uhr' : 'Firefox');
  await pgRun(
    `INSERT INTO browser_tokens (id, user_id, name, token_hash, token_prefix, scope)
       VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    cleanName,
    hashToken(token),
    tokenPrefix,
    scope
  );
  return {
    token,
    row: {
      id,
      name: cleanName,
      tokenPrefix,
      scope,
      revoked: false,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function listBrowserTokens(userId: string): Promise<BrowserTokenRow[]> {
  const rows = (await pgAll(
    `SELECT id, name, token_prefix AS tokenPrefix, scope, revoked,
              last_used_at AS lastUsedAt, created_at AS createdAt
         FROM browser_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    userId
  )) as unknown as Array<
    Omit<BrowserTokenRow, 'revoked' | 'scope'> & { revoked: number; scope: string | null }
  >;
  return rows.map((row) => ({
    ...row,
    scope: normalizeTokenScope(row.scope),
    revoked: row.revoked === 1,
  }));
}

/** Revoke one of the user's tokens; with `scope`, only a token of that scope. */
export async function revokeBrowserToken(
  userId: string,
  id: string,
  scope?: BrowserTokenScope
): Promise<boolean> {
  const result = scope
    ? await pgRun(
        'UPDATE browser_tokens SET revoked = 1 WHERE id = ? AND user_id = ? AND scope = ?',
        id,
        userId,
        scope
      )
    : await pgRun('UPDATE browser_tokens SET revoked = 1 WHERE id = ? AND user_id = ?', id, userId);
  return result.changes > 0;
}

/**
 * Revoke the user's active tokens of one scope and name, e.g. the previous
 * pairing of the same watch, and return their ids so live sockets can be
 * dropped.
 */
export async function revokeScopedTokensByName(
  userId: string,
  name: string,
  scope: BrowserTokenScope
): Promise<string[]> {
  const rows = (await pgAll(
    `UPDATE browser_tokens SET revoked = 1
      WHERE user_id = ? AND scope = ? AND name = ? AND revoked = 0
      RETURNING id`,
    userId,
    scope,
    name.trim()
  )) as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export async function isBrowserTokenActive(tokenId: string): Promise<boolean> {
  const row = (await pgGet(
    'SELECT revoked FROM browser_tokens WHERE id = ?',
    tokenId
  )) as unknown as { revoked: number } | undefined;
  return !!row && row.revoked === 0;
}

export interface ResolvedBrowserToken {
  tokenId: string;
  userId: string;
  name: string;
  scope: BrowserTokenScope;
}

export async function resolveBrowserToken(token: string): Promise<ResolvedBrowserToken | null> {
  if (typeof token !== 'string' || !token.startsWith(BROWSER_TOKEN_PREFIX)) return null;
  const presented = hashToken(token);
  const row = (await pgGet(
    `SELECT id, user_id AS userId, name, scope, token_hash AS tokenHash
         FROM browser_tokens WHERE token_hash = ? AND revoked = 0`,
    presented
  )) as unknown as
    | { id: string; userId: string; name: string; scope: string | null; tokenHash: string }
    | undefined;
  if (!row) return null;
  const a = Buffer.from(row.tokenHash, 'hex');
  const b = Buffer.from(presented, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    await pgRun('UPDATE browser_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', row.id);
  } catch {
    /* best effort */
  }
  return {
    tokenId: row.id,
    userId: row.userId,
    name: row.name,
    scope: normalizeTokenScope(row.scope),
  };
}
