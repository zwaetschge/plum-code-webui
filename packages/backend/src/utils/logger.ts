import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Levelled, machine-readable logging.
 *
 * The codebase logs through ~390 bare `console.*` calls whose format is
 * whatever the author felt like, so a stuck session means eyeballing container
 * output and there is no way to raise or lower verbosity in production. Two
 * things were missing and both are here:
 *
 * - **Levels.** `LOG_LEVEL` (debug|info|warn|error, default info) decides what
 *   is emitted, so debug lines can live in the code permanently instead of
 *   being added and deleted around each incident.
 * - **Correlation.** `requestIdMiddleware` already stamps every request, but
 *   only the error handler ever used it. `withRequestContext` puts that id in
 *   async local storage, so any log emitted while handling a request carries it
 *   without every function having to take a context parameter.
 *
 * Output is one JSON object per line when NODE_ENV is production — greppable
 * and ingestible — and a compact human line otherwise.
 *
 * Deliberately dependency-free: adding pino or winston to a container that
 * ships five CLI harnesses is not worth it for what amounts to 60 lines.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = String(process.env.LOG_LEVEL || '')
    .trim()
    .toLowerCase();
  return raw in LEVEL_ORDER ? (raw as LogLevel) : 'info';
}

interface RequestContext {
  requestId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with a request context every log call inside it will pick up. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

function emit(level: LogLevel, scope: string, message: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;

  const context = storage.getStore();
  const entry = {
    level,
    scope,
    message,
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.userId ? { userId: context.userId } : {}),
    ...fields,
  };

  // console is still the sink — the container's log driver is what collects it.
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (process.env.NODE_ENV === 'production') {
    sink(JSON.stringify({ time: new Date().toISOString(), ...entry }));
    return;
  }

  const suffix = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
  const id = context?.requestId ? ` (${context.requestId.slice(0, 8)})` : '';
  sink(`[${level}] [${scope}]${id} ${message}${suffix}`);
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(childScope: string): Logger;
}

/**
 * `const log = createLogger('codex')` — the scope replaces the ad-hoc
 * `[CODEX]` prefixes that are currently baked into message strings.
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, fields) => emit('debug', scope, message, fields),
    info: (message, fields) => emit('info', scope, message, fields),
    warn: (message, fields) => emit('warn', scope, message, fields),
    error: (message, fields) => emit('error', scope, message, fields),
    child: (childScope: string) => createLogger(`${scope}:${childScope}`),
  };
}
