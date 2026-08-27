import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { getDatabase } from '../../db/index.js';

/**
 * Credentials for an external supervisor.
 *
 * The point of the gateway is that another instance — Hermes, an OpenCode or
 * Codex CLI, a cron script — can watch and drive every session through exactly
 * the API the user drives. So a gateway token resolves to a user identity and
 * then flows through the normal auth path; there is no parallel, weaker set of
 * endpoints to keep in sync.
 */

export const GATEWAY_TOKEN_PREFIX = 'plum_gw_';

/**
 * `read` may only issue safe HTTP methods; `write` is the previous behaviour,
 * i.e. everything the owning user can do. Anything finer would have to mirror
 * the whole route table and drift out of sync with it — the same trap the
 * gateway avoids by reusing the user's endpoints in the first place.
 */
export type GatewayScope = 'read' | 'write';

export interface GatewayTokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: GatewayScope;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createGatewayToken(
  userId: string,
  name: string,
  scope: GatewayScope = 'write'
): { token: string; row: GatewayTokenRow } {
  const secret = randomBytes(32).toString('base64url');
  const token = `${GATEWAY_TOKEN_PREFIX}${secret}`;
  const id = nanoid();
  // Enough to recognise a token in a list without being enough to use it.
  const tokenPrefix = token.slice(0, GATEWAY_TOKEN_PREFIX.length + 6);

  getDatabase()
    .prepare(
      `INSERT INTO gateway_tokens (id, user_id, name, token_hash, token_prefix, scope)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, name.trim() || 'gateway', hashToken(token), tokenPrefix, scope);

  return {
    token,
    row: {
      id,
      name: name.trim() || 'gateway',
      tokenPrefix,
      scope,
      revoked: false,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

export function listGatewayTokens(userId: string): GatewayTokenRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, token_prefix AS tokenPrefix, scope, revoked,
              last_used_at AS lastUsedAt, created_at AS createdAt
         FROM gateway_tokens WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId) as Array<Omit<GatewayTokenRow, 'revoked'> & { revoked: number }>;
  return rows.map((row) => ({ ...row, revoked: row.revoked === 1 }));
}

export function revokeGatewayToken(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare('UPDATE gateway_tokens SET revoked = 1 WHERE id = ? AND user_id = ?')
    .run(id, userId);
  return result.changes > 0;
}

/**
 * Resolve a presented token to its owner, or null. Constant-time compare on the
 * stored hash: the lookup is by hash anyway, but a plain string equality here
 * would leak timing on the hash itself.
 */
export interface ResolvedGatewayToken {
  userId: string;
  scope: GatewayScope;
}

export function resolveGatewayToken(token: string): ResolvedGatewayToken | null {
  if (!token.startsWith(GATEWAY_TOKEN_PREFIX)) return null;

  const presented = hashToken(token);
  const row = getDatabase()
    .prepare(
      `SELECT id, user_id AS userId, token_hash AS tokenHash, scope
         FROM gateway_tokens WHERE token_hash = ? AND revoked = 0`
    )
    .get(presented) as { id: string; userId: string; tokenHash: string; scope: string } | undefined;
  if (!row) return null;

  const a = Buffer.from(row.tokenHash, 'hex');
  const b = Buffer.from(presented, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  touchLastUsed(row.id);
  // Anything unrecognised is treated as read-only: a corrupt value must not
  // widen a token's rights.
  return { userId: row.userId, scope: row.scope === 'write' ? 'write' : 'read' };
}

const lastUsedWrites = new Map<string, number>();
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/**
 * Best effort, and throttled: a supervisor polling the overview every few
 * seconds would otherwise turn every request into a WAL write for a timestamp
 * nobody reads at that resolution.
 */
function touchLastUsed(tokenId: string): void {
  const now = Date.now();
  const last = lastUsedWrites.get(tokenId) ?? 0;
  if (now - last < LAST_USED_WRITE_INTERVAL_MS) return;
  lastUsedWrites.set(tokenId, now);
  try {
    getDatabase()
      .prepare('UPDATE gateway_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(tokenId);
  } catch {
    /* ignore */
  }
}
