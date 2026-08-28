import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import { config } from '../config.js';

/**
 * Auth guard for /internal/* routes called by spawned-CLI subprocesses (MCP
 * bridges). They authenticate with the same X-Webui-Hook-Secret the
 * permission-prompt hook uses; the X-Webui-Session-Id header supplies user
 * attribution. These routes are mounted before requireAuth on purpose — a CLI
 * child has no browser session.
 */
export function requireHookSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('x-webui-hook-secret') || '';
  const expected = config.hookSecret;
  if (!expected) {
    res
      .status(503)
      .json({ success: false, error: { code: 'NO_HOOK', message: 'hook secret unconfigured' } });
    return;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'invalid secret' } });
    return;
  }
  next();
}
