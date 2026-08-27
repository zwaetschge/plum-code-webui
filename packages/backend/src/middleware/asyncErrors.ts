import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

/**
 * Forwards a rejected promise from an async handler to Express's error
 * handling.
 *
 * Express 4 calls a handler and ignores what it returns. A synchronous `throw`
 * is caught and passed to the error middleware; a rejected promise is not — it
 * becomes an unhandled rejection, the handler never calls `next` or writes a
 * response, and the request hangs until the client gives up.
 *
 * That did not matter while the handlers were synchronous. The move to Postgres
 * made 305 of them async, so `throw new AppError('Not found', 404)` stopped
 * producing a 404 and started producing a request that never finishes. Every
 * authenticated route was affected, because `requireAuth` throws for anything
 * it cannot resolve.
 *
 * Patching the router once is deliberate. The alternative — wrapping each
 * handler at its registration — is 305 edits that must be repeated correctly
 * for every route added afterwards, and the failure mode of forgetting one is a
 * hang rather than an error. This cannot be forgotten.
 *
 * Express 5 does this itself, at which point this file goes away.
 */

type Handler = (...args: unknown[]) => unknown;

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as Promise<unknown>)?.catch === 'function';
}

function wrap(handler: Handler): Handler {
  // Express distinguishes error middleware by arity, so the wrapper has to
  // declare the same number of parameters as what it wraps.
  if (handler.length === 4) {
    return function wrapped(this: unknown, error, req, res, next) {
      const result = handler.call(this, error, req, res, next);
      if (isPromise(result)) result.catch(next as NextFunction);
      return result;
    } as Handler;
  }

  return function wrapped(this: unknown, req, res, next) {
    const result = handler.call(this, req, res, next);
    if (isPromise(result)) result.catch(next as NextFunction);
    return result;
  } as Handler;
}

const WRAPPED = Symbol('asyncErrorsWrapped');

function wrapArguments(args: unknown[]): unknown[] {
  return args.map((argument) => {
    if (typeof argument !== 'function') return argument;
    const handler = argument as Handler & { [WRAPPED]?: boolean };
    // A router mounted with `app.use(router)` is also a function; wrapping it
    // would swallow its own routing, and it never rejects.
    if (handler[WRAPPED] || 'stack' in handler) return argument;
    const wrapped = wrap(handler) as Handler & { [WRAPPED]?: boolean };
    wrapped[WRAPPED] = true;
    return wrapped;
  });
}

let installed = false;

/**
 * Must run before any router or route is created, since it patches the
 * prototypes that registration goes through. Route modules build their routers
 * at import time, and ES module imports are evaluated before the importing
 * module's body — so this is called at module scope below rather than from
 * `startServer`, and the import of this file has to come first.
 */
export function installAsyncErrorHandling(): void {
  if (installed) return;
  installed = true;

  // Express builds its router from a prototype it does not export, so both
  // prototypes are read off real instances rather than named. `route()` returns
  // a Route, whose verb methods hold the handlers for one path — `router.get()`
  // delegates to it, so patching only the router would miss every route.
  const sample = Router();
  const routerProto = Object.getPrototypeOf(sample) as Record<string, Handler>;
  const routeProto = Object.getPrototypeOf(sample.route('/')) as Record<string, Handler>;

  const methods = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  for (const proto of [routerProto, routeProto]) {
    for (const method of methods) {
      const original = proto[method];
      if (typeof original !== 'function') continue;
      proto[method] = function patched(this: unknown, ...args: unknown[]) {
        return (original as Handler).apply(this, wrapArguments(args) as never[]);
      } as Handler;
    }
  }
}

/**
 * Explicit wrapper for a handler registered outside a router — `app.get` on the
 * application object goes through the same patched Router, so this is only
 * needed for a handler passed somewhere else entirely.
 */
export function asyncHandler<
  T extends (req: Request, res: Response, next: NextFunction) => unknown,
>(handler: T): T {
  return wrap(handler as unknown as Handler) as unknown as T;
}

// Side effect on import, on purpose. See the note on
// [installAsyncErrorHandling]: by the time any statement in index.ts runs, the
// route modules have already registered their handlers.
installAsyncErrorHandling();
