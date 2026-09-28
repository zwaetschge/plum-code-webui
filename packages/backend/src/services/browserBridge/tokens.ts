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

export interface BrowserTokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createBrowserToken(
  userId: string,
  name: string
): Promise<{ token: string; row: BrowserTokenRow }> {
  const active = (await pgGet(
    'SELECT COUNT(*) AS count FROM browser_tokens WHERE user_id = ? AND revoked = 0',
    userId
  )) as { count?: number | string } | undefined;
  if (Number(active?.count ?? 0) >= BROWSER_TOKEN_LIMIT) {
    throw new AppError(
      `You already have ${BROWSER_TOKEN_LIMIT} active browser tokens — revoke one first.`,
      429,
      'BROWSER_TOKEN_LIMIT'
    );
  }

  const token = `${BROWSER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const id = nanoid();
  const tokenPrefix = token.slice(0, BROWSER_TOKEN_PREFIX.length + 6);
  const cleanName = name.trim() || 'Firefox';
  await pgRun(
    `INSERT INTO browser_tokens (id, user_id, name, token_hash, token_prefix)
       VALUES (?, ?, ?, ?, ?)`,
    id,
    userId,
    cleanName,
    hashToken(token),
    tokenPrefix
  );
  return {
    token,
    row: {
      id,
      name: cleanName,
      tokenPrefix,
      revoked: false,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

export async function listBrowserTokens(userId: string): Promise<BrowserTokenRow[]> {
  const rows = (await pgAll(
    `SELECT id, name, token_prefix AS tokenPrefix, revoked,
              last_used_at AS lastUsedAt, created_at AS createdAt
         FROM browser_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    userId
  )) as unknown as Array<Omit<BrowserTokenRow, 'revoked'> & { revoked: number }>;
  return rows.map((row) => ({ ...row, revoked: row.revoked === 1 }));
}

export async function revokeBrowserToken(userId: string, id: string): Promise<boolean> {
  const result = await pgRun(
    'UPDATE browser_tokens SET revoked = 1 WHERE id = ? AND user_id = ?',
    id,
    userId
  );
  return result.changes > 0;
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
}

export async function resolveBrowserToken(token: string): Promise<ResolvedBrowserToken | null> {
  if (typeof token !== 'string' || !token.startsWith(BROWSER_TOKEN_PREFIX)) return null;
  const presented = hashToken(token);
  const row = (await pgGet(
    `SELECT id, user_id AS userId, name, token_hash AS tokenHash
         FROM browser_tokens WHERE token_hash = ? AND revoked = 0`,
    presented
  )) as unknown as { id: string; userId: string; name: string; tokenHash: string } | undefined;
  if (!row) return null;
  const a = Buffer.from(row.tokenHash, 'hex');
  const b = Buffer.from(presented, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    await pgRun('UPDATE browser_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', row.id);
  } catch {
    /* best effort */
  }
  return { tokenId: row.id, userId: row.userId, name: row.name };
}
