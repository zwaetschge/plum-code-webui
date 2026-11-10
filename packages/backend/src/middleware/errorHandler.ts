import type { Request, RequestHandler, Response, NextFunction } from 'express';
import type { ApiError } from '@plum-code-webui/shared';
import { randomUUID } from 'crypto';
import { createLogger, withRequestContext } from '../utils/logger.js';

const log = createLogger('http');

declare module 'express-serve-static-core' {
  interface Request {
    id?: string;
  }
}

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

interface ClientError {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * body-parser turns a request down before any route runs (body over the limit,
 * malformed JSON, unsupported encoding). Those are the client's mistake; they
 * used to surface as a 500 with a stack trace in the error log. Only errors
 * that carry body-parser's `type` and a 4xx status are taken at their word.
 */
export function clientErrorOf(err: unknown): ClientError | null {
  if (!err || typeof err !== 'object') return null;
  const candidate = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof candidate.type !== 'string') return null;
  const status = Number(candidate.status ?? candidate.statusCode);
  if (!Number.isInteger(status) || status < 400 || status > 499) return null;
  if (candidate.type === 'entity.too.large') {
    return { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' };
  }
  if (candidate.type === 'entity.parse.failed') {
    return { statusCode: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  }
  return { statusCode: status, code: 'BAD_REQUEST', message: 'Request could not be read' };
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isAppError = err instanceof AppError;
  const clientError = isAppError ? null : clientErrorOf(err);
  const statusCode = isAppError ? err.statusCode : (clientError?.statusCode ?? 500);
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
    code: isAppError ? err.code : (clientError?.code ?? 'INTERNAL_ERROR'),
    message: isAppError ? err.message : (clientError?.message ?? 'An unexpected error occurred'),
    requestId,
  };
  res.status(statusCode).json({ success: false, error: errorResponse });
}
