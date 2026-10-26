import type { NextFunction, Request, Response } from 'express';
import { requireAuth } from './auth.js';

export const MOBILE_GATEWAY_HEADER = 'x-plum-mobile-gateway';

const PUBLIC_MOBILE_ROUTES = new Set([
  'GET /health',
  'GET /auth/providers',
  'GET /auth/proxy/mobile',
  'POST /auth/mobile/exchange',
  'GET /api/basic-auth/status',
  'POST /api/basic-auth/login',
  // DownloadManager has no session header; the app route verifies its expiring HMAC.
  'GET /api/app/download',
  // Plum Desk authenticates itself with its device token (routes/browserBridge.ts).
  'POST /api/browser-bridge/desk/transcribe',
  'POST /api/browser-bridge/desk/wake',
  'POST /api/browser-bridge/desk/turn',
  'POST /api/browser-bridge/desk/speech',
  // Plum Desktop installer; the single-use code in the query is the credential.
  'GET /api/browser-bridge/desktop/install',
]);

function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function isMobileGatewayPublicRequest(method: string, path: string): boolean {
  return PUBLIC_MOBILE_ROUTES.has(`${method.toUpperCase()} ${normalizePath(path)}`);
}

/**
 * Traefik marks requests entering through the /mobile gateway after stripping
 * that prefix. The gateway is intentionally stricter than the browser surface:
 * every route requires a Plum JWT unless it is an exact bootstrap endpoint.
 */
export async function mobileGatewayAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.get(MOBILE_GATEWAY_HEADER) !== '1') return next();
  if (isMobileGatewayPublicRequest(req.method, req.path)) return next();
  await requireAuth(req, res, next);
}
