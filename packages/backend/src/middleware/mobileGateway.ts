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
