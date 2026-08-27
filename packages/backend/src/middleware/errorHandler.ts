import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ApiError } from '@plum-code-webui/shared';
import { randomUUID } from 'crypto';
import { createLogger, withRequestContext } from '../utils/logger.js';

const log = createLogger('http');

declare module 'express-serve-static-core' {
  interface Request {
    id?: string;
  }
}

// Wrap async route handlers to properly catch errors
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => {
  return async (req, res, next) => {
    await Promise.resolve(await fn(req, res, next)).catch(next);
  };
};

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Assigns a requestId to every incoming request (respecting X-Request-Id if provided)
 * and echoes it back via the response header. Pair with errorHandler for correlated logs.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  // Everything downstream runs inside this context, so any logger call made
  // while handling the request is correlated without being handed the id.
  withRequestContext({ requestId: id }, () => next());
};

interface ErrorLogContext extends Record<string, unknown> {
  requestId: string;
  method: string;
  path: string;
  userId: string;
  statusCode: number;
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const requestId = req.id || randomUUID();
  const userId = (req.user as { id?: string } | undefined)?.id || 'anonymous';

  const context: ErrorLogContext = {
    requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    userId,
    statusCode,
  };

  if (statusCode >= 500) {
    log.error(err.message, { ...context, stack: err.stack });
  } else {
    log.warn(err.message, context);
  }

  const errorResponse: ApiError & { requestId: string } = {
    code: isAppError ? err.code : 'INTERNAL_ERROR',
    message: isAppError ? err.message : 'An unexpected error occurred',
    requestId,
  };
  res.status(statusCode).json({ success: false, error: errorResponse });
}
