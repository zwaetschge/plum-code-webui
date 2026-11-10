import { createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import { config } from '../config.js';

/**
 * Credentials for the /internal/* routes that spawned CLI processes call (MCP
 * bridges, the permission hook). These routes are mounted before requireAuth
 * on purpose — a CLI child has no browser session.
 *
 * Every session used to receive the same secret and name its own session id in
 * a header, so any agent could act as any other session: read its provider
 * keys, drive its browser, its desktop, its phone. A session now gets a token
 * derived from its id. The token proves which session is calling, and the
 * session header is set from it — what a caller claims no longer matters.
 *
 * The undivided secret stays valid for the backend's own helpers; it is not
 * handed to sessions any more.
 */
const SESSION_TOKEN_PREFIX = 'pst1.';

export type HookCaller = { kind: 'internal' } | { kind: 'session'; sessionId: string };

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The hook credential of one session; goes into that session's environment. */
export function sessionHookToken(sessionId: string): string {
  const mac = createHmac('sha256', config.hookSecret)
    .update(`session:${sessionId}`)
    .digest('base64url');
  return `${SESSION_TOKEN_PREFIX}${Buffer.from(sessionId, 'utf8').toString('base64url')}.${mac}`;
}

/** Who a presented credential belongs to, or null when it is not valid. */
export function identifyHookCaller(provided: string): HookCaller | null {
  if (!provided || !config.hookSecret) return null;
  if (provided.startsWith(SESSION_TOKEN_PREFIX)) {
    const encoded = provided.slice(SESSION_TOKEN_PREFIX.length).split('.')[0] ?? '';
    const sessionId = Buffer.from(encoded, 'base64url').toString('utf8');
    if (!sessionId) return null;
    return safeEqual(provided, sessionHookToken(sessionId)) ? { kind: 'session', sessionId } : null;
  }
  return safeEqual(provided, config.hookSecret) ? { kind: 'internal' } : null;
}

/**
 * Identifies the caller and binds the request to its session: handlers keep
 * reading `x-webui-session-id`, which now holds the verified id.
 */
export function bindHookCaller(req: Request): HookCaller | null {
  const caller = identifyHookCaller(req.header('x-webui-hook-secret') || '');
  if (caller?.kind === 'session') req.headers['x-webui-session-id'] = caller.sessionId;
  return caller;
}

export function requireHookSecret(req: Request, res: Response, next: NextFunction): void {
  if (!config.hookSecret) {
    res
      .status(503)
      .json({ success: false, error: { code: 'NO_HOOK', message: 'hook secret unconfigured' } });
    return;
  }
  if (!bindHookCaller(req)) {
    res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'invalid secret' } });
    return;
  }
  next();
}
