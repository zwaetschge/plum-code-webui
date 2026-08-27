import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getDatabase } from '../db/index.js';
import { AppError } from './errorHandler.js';
import { GATEWAY_TOKEN_PREFIX, resolveGatewayToken } from '../services/gateway/tokens.js';
import type { GatewayScope } from '../services/gateway/tokens.js';

/** Methods that cannot change server state, per RFC 9110. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthenticatedRequest extends Request {
  userId: string;
  /** True when the caller authenticated with a gateway token, not a session. */
  viaGateway?: boolean;
  /** Present only for gateway-authenticated requests. */
  gatewayScope?: GatewayScope;
}

function getUserRoleStatus(userId: string): { role: string; status: string } | null {
  try {
    const db = getDatabase();
    const row = db.prepare(`SELECT role, status FROM users WHERE id = ?`).get(userId) as
      | { role: string; status: string }
      | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Block suspended users from any authenticated endpoint. Must run AFTER requireAuth.
 * Splitting this out (instead of merging into requireAuth) keeps the fast path hot
 * while making the guard explicit at the route level.
 */
export function requireActive(req: Request, _res: Response, next: NextFunction): void {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const info = getUserRoleStatus(userId);
  if (!info) throw new AppError('User not found', 401, 'USER_NOT_FOUND');
  if (info.status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
  next();
}

/**
 * Gate admin-only routes. Runs requireActive implicitly (suspended admins can't log in).
 * Use after requireAuth. 403 (not 404) so admins know the route exists.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const info = getUserRoleStatus(userId);
  if (!info) throw new AppError('User not found', 401, 'USER_NOT_FOUND');
  if (info.status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
  if (info.role !== 'admin') {
    throw new AppError('Admin privileges required', 403, 'ADMIN_REQUIRED');
  }
  next();
}

/**
 * Verify the token's user still exists and is not suspended.
 * Prevents long-lived JWTs from outliving user deletion/suspension.
 * A single indexed lookup (~0.1ms) on every authenticated request.
 */
function enforceUserLifecycle(userId: string): void {
  const info = getUserRoleStatus(userId);
  if (!info) {
    throw new AppError('User no longer exists', 401, 'USER_NOT_FOUND');
  }
  if (info.status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
}

/**
 * Resolve a WebUI identity without mutating the request. This is shared by
 * normal API authentication and the CLI-provider link routes: provider
 * credentials prove that a CLI is installed, not who is using the WebUI.
 */
export function resolveAuthenticatedUserId(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // Gateway tokens resolve to their owner and then take the same path as a
    // browser session. That is the whole design: an external supervisor gets
    // the user's capabilities through the user's endpoints, instead of a
    // parallel API that drifts out of sync with what the UI can do.
    if (token.startsWith(GATEWAY_TOKEN_PREFIX)) {
      const resolved = resolveGatewayToken(token);
      if (!resolved) {
        throw new AppError('Invalid gateway token', 401, 'INVALID_TOKEN');
      }
      enforceUserLifecycle(resolved.userId);
      (req as AuthenticatedRequest).viaGateway = true;
      (req as AuthenticatedRequest).gatewayScope = resolved.scope;

      // Enforced here rather than per route: a read-only token has to stay
      // read-only on every endpoint, including ones added later. Safe methods
      // are the boundary — GET, HEAD and OPTIONS cannot change state.
      if (resolved.scope === 'read' && !SAFE_METHODS.has(req.method.toUpperCase())) {
        throw new AppError('This gateway token is read-only', 403, 'GATEWAY_TOKEN_READ_ONLY');
      }
      return resolved.userId;
    }

    let userId: string;
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId?: unknown };
      if (typeof decoded.userId !== 'string' || !decoded.userId) {
        throw new Error('missing user id');
      }
      userId = decoded.userId;
    } catch {
      throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
    }
    enforceUserLifecycle(userId);
    return userId;
  }

  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const userId = (req.user as { id?: unknown }).id;
    if (typeof userId !== 'string' || !userId) {
      throw new AppError('Invalid session identity', 401, 'INVALID_SESSION');
    }
    enforceUserLifecycle(userId);
    return userId;
  }

  return null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const userId = resolveAuthenticatedUserId(req);
  if (userId) {
    (req as AuthenticatedRequest).userId = userId;
    return next();
  }

  throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      (req as AuthenticatedRequest).userId = decoded.userId;
    } catch {
      // Ignore invalid tokens for optional auth
    }
  } else if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    (req as AuthenticatedRequest).userId = (req.user as { id: string }).id;
  }
  next();
}
