import { get as pgGet, run as pgRun } from '../db/pg.js';
import session, { type SessionData } from 'express-session';

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function expirationFor(data: SessionData): number {
  const expires = data.cookie?.expires;
  if (expires) {
    const timestamp = new Date(expires).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }

  const maxAge = data.cookie?.maxAge;
  return Date.now() + (typeof maxAge === 'number' ? maxAge : DEFAULT_MAX_AGE_MS);
}

/** Postgres-backed express-session store with bounded, opportunistic cleanup. */
export class SqliteSessionStore extends session.Store {
  private lastPrune = 0;

  async get(
    sid: string,
    callback: (err: unknown, session?: SessionData | null) => void
  ): Promise<void> {
    try {
      const row = (await pgGet(
        'SELECT data, expires_at FROM http_sessions WHERE sid = ?',
        sid
      )) as unknown as { data: string; expires_at: number } | undefined;

      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        await pgRun('DELETE FROM http_sessions WHERE sid = ?', sid);
        return callback(null, null);
      }

      try {
        callback(null, JSON.parse(row.data) as SessionData);
      } catch {
        await pgRun('DELETE FROM http_sessions WHERE sid = ?', sid);
        callback(null, null);
      }
    } catch (error) {
      callback(error);
    }
  }

  async set(sid: string, data: SessionData, callback?: (err?: unknown) => void): Promise<void> {
    try {
      await this.pruneExpired();
      await pgRun(
        `INSERT INTO http_sessions (sid, data, expires_at, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(sid) DO UPDATE SET
             data = excluded.data,
             expires_at = excluded.expires_at,
             updated_at = CURRENT_TIMESTAMP`,
        sid,
        JSON.stringify(data),
        expirationFor(data)
      );
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async destroy(sid: string, callback?: (err?: unknown) => void): Promise<void> {
    try {
      await pgRun('DELETE FROM http_sessions WHERE sid = ?', sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  async touch(sid: string, data: SessionData, callback?: (err?: unknown) => void): Promise<void> {
    try {
      await this.pruneExpired();
      await pgRun(
        `UPDATE http_sessions
           SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE sid = ?`,
        expirationFor(data),
        sid
      );
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  private async pruneExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrune < PRUNE_INTERVAL_MS) return;
    await pgRun('DELETE FROM http_sessions WHERE expires_at <= ?', now);
    this.lastPrune = now;
  }
}

/** Revoke every Passport browser session owned by a user. */
export async function revokeUserHttpSessions(userId: string): Promise<number> {
  return (
    await pgRun(
      `DELETE FROM http_sessions
       WHERE json_valid(data)
         AND json_extract(data, '$.passport.user') = ?`,
      userId
    )
  ).changes;
}
