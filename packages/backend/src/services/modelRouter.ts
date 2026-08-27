import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Per-request model routing for Claude Code sessions.
 *
 * A Claude session is pointed at exactly one Anthropic-compatible endpoint via
 * ANTHROPIC_BASE_URL — the variable is process-global, so a session runs either
 * entirely on the Claude subscription or entirely on Z.AI. That makes the two
 * subscriptions an either/or, when the useful split is: main agent on Claude,
 * subagents on GLM.
 *
 * Claude Code itself already supports the split. A subagent definition carries
 * `model:` in its frontmatter and the CLI puts that string into the API request
 * unvalidated (verified against 2.1.228). What is missing is something that
 * looks at each request's model and picks the upstream. This is that thing: the
 * session's base URL points here, and per request
 *
 *     model glm-* / z-ai/*  ->  the user's Z.AI endpoint, their stored token
 *     everything else       ->  api.anthropic.com, byte-for-byte passthrough
 *
 * The Anthropic path is deliberately transparent — headers (including the OAuth
 * bearer and anthropic-beta), body and stream pass through unmodified, and
 * every non-messages endpoint the CLI calls (/api/hello, token counting) goes
 * there too. If this proxy is in the chain and no GLM model is used, nothing
 * observable changes.
 *
 * Kept dependency-free on purpose: no config, no database, no logger. The
 * wiring in modelRouterInstance.ts supplies those, and the tests supply stubs.
 */

export interface RouterUpstreamConfig {
  /** Anthropic-compatible base, e.g. https://api.z.ai/api/anthropic */
  baseUrl: string;
  authToken: string;
}

export interface RouterUsageEvent {
  userId: string;
  sessionId: string;
  model: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface RoutedUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requests: number;
}

export interface ModelRouterOptions {
  /** Overridable for tests; defaults to the real API. */
  anthropicBaseUrl?: string;
  getZaiConfig(userId: string): Promise<RouterUpstreamConfig | null>;
  /** Fired once per completed Z.AI request with the usage it reported. */
  onZaiUsage?(event: RouterUsageEvent): void;
  onError?(message: string, error: unknown): void;
}

export interface ModelRouter {
  /** Mount with `app.use('/model-router', handler)` — before body parsing. */
  handler(req: IncomingMessage, res: ServerResponse): void;
  /** Returns the token that goes into the session's base URL. */
  registerSession(sessionId: string, userId: string): string;
  unregisterSession(sessionId: string): void;
  /**
   * Tokens routed to Z.AI for this session since the last drain. The process
   * manager subtracts these from the Claude turn it is about to book, because
   * Claude Code's own turn aggregate includes its subagents' usage — without
   * the subtraction every GLM token would be billed twice, once as zai and
   * once inside the claude turn at the wrong price.
   */
  drainRoutedUsage(sessionId: string): RoutedUsageTotals;
}

export function isZaiModel(model: unknown): model is string {
  return typeof model === 'string' && /^(z-ai\/|zai\/)?glm-/i.test(model);
}

/** OpenCode spells these z-ai/glm-*; the Z.AI endpoint itself wants glm-*. */
export function normalizeZaiModel(model: string): string {
  return model.replace(/^(z-ai|zai)\//i, '');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Hop-by-hop headers must not be forwarded in either direction. */
const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer'];

function anthropicError(res: ServerResponse, status: number, type: string, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}

function emptyTotals(): RoutedUsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 0 };
}

interface UsageFields {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Pulls the reported usage out of a completed Z.AI response.
 *
 * Streaming: `message_start` carries the input side, the final `message_delta`
 * carries everything (verified against the live endpoint — Z.AI repeats
 * input_tokens there). Fields are merged last-wins so either layout works.
 * Non-streaming: the JSON body's `usage` object.
 */
export function extractZaiUsage(body: string, contentType: string | undefined): UsageFields | null {
  try {
    if (contentType?.includes('application/json')) {
      const parsed = JSON.parse(body) as { usage?: UsageFields };
      return parsed.usage ?? null;
    }

    let merged: UsageFields | null = null;
    for (const line of body.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let event: { usage?: UsageFields; message?: { usage?: UsageFields } };
      try {
        event = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      const usage = event.usage ?? event.message?.usage;
      if (!usage) continue;
      const next: UsageFields = { ...(merged ?? {}) };
      for (const key of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const) {
        if (typeof usage[key] === 'number') next[key] = usage[key];
      }
      merged = next;
    }
    return merged;
  } catch {
    return null;
  }
}

export function createModelRouter(options: ModelRouterOptions): ModelRouter {
  const anthropicBase = new URL(options.anthropicBaseUrl ?? 'https://api.anthropic.com');
  const onError = options.onError ?? (() => {});

  const byToken = new Map<string, { userId: string; sessionId: string }>();
  const bySession = new Map<string, string>();
  const usage = new Map<string, RoutedUsageTotals>();

  function registerSession(sessionId: string, userId: string): string {
    // A respawn replaces the old token, so a leaked URL from a dead process
    // stops working the moment the session restarts.
    const previous = bySession.get(sessionId);
    if (previous) byToken.delete(previous);
    // A fresh process starts with a clean slate: usage a dead predecessor
    // never drained must not be subtracted from the new instance's first turn.
    usage.delete(sessionId);
    const token = randomBytes(24).toString('base64url');
    byToken.set(token, { userId, sessionId });
    bySession.set(sessionId, token);
    return token;
  }

  function unregisterSession(sessionId: string): void {
    const token = bySession.get(sessionId);
    if (token) byToken.delete(token);
    bySession.delete(sessionId);
    usage.delete(sessionId);
  }

  function drainRoutedUsage(sessionId: string): RoutedUsageTotals {
    const totals = usage.get(sessionId) ?? emptyTotals();
    usage.delete(sessionId);
    return totals;
  }

  function forward(
    req: IncomingMessage,
    res: ServerResponse,
    target: URL,
    pathAndQuery: string,
    headers: http.OutgoingHttpHeaders,
    body: Buffer | null,
    tee?: { onBody(text: string, contentType: string | undefined): void }
  ): void {
    const lib = target.protocol === 'http:' ? http : https;
    const collected: Buffer[] = [];
    // A cap so a runaway stream cannot grow the tee buffer without bound; the
    // usage lines sit at the very end of the stream, so keeping the tail
    // would be enough, but responses are small and the cap is generous.
    const TEE_LIMIT = 8 * 1024 * 1024;
    let teeBytes = 0;

    const upstream = lib.request(
      {
        host: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: pathAndQuery,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        const responseHeaders = { ...upstreamRes.headers };
        for (const header of HOP_BY_HOP) delete responseHeaders[header];
        res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
        // SSE must start flowing immediately; a buffered stream deadlocks the
        // CLI, which waits for message_start before it does anything.
        res.flushHeaders?.();

        if (tee) {
          upstreamRes.on('data', (chunk: Buffer) => {
            if (teeBytes < TEE_LIMIT) {
              collected.push(chunk);
              teeBytes += chunk.length;
            }
          });
          upstreamRes.on('end', () => {
            tee.onBody(Buffer.concat(collected).toString('utf8'), String(upstreamRes.headers['content-type'] ?? ''));
          });
        }

        upstreamRes.pipe(res);
      }
    );

    upstream.on('error', (error) => {
      onError(`upstream ${target.hostname} failed`, error);
      anthropicError(res, 502, 'api_error', `Upstream request failed: ${(error as Error).message}`);
    });

    if (body) upstream.end(body);
    else upstream.end();
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    // The router only ever serves CLIs spawned in this container. Traefik and
    // the docker network reach this port too, but never from loopback — so a
    // request from anywhere else is wrong by construction, token or not.
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      anthropicError(res, 403, 'permission_error', 'Model router is local-only');
      return;
    }

    // Mounted under /model-router, so req.url is /<token>/<upstream path>.
    const match = /^\/([A-Za-z0-9_-]{16,})(\/.*)?$/.exec(req.url ?? '');
    if (!match) {
      anthropicError(res, 404, 'not_found_error', 'Malformed model router path');
      return;
    }
    const session = byToken.get(match[1]!);
    if (!session) {
      anthropicError(res, 401, 'authentication_error', 'Unknown model router token');
      return;
    }
    const upstreamPath = match[2] || '/';

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void route(req, res, session, upstreamPath, chunks.length ? Buffer.concat(chunks) : null);
    });
    req.on('error', (error) => {
      onError('client request failed', error);
      anthropicError(res, 400, 'invalid_request_error', 'Client stream failed');
    });
  }

  async function route(
    req: IncomingMessage,
    res: ServerResponse,
    session: { userId: string; sessionId: string },
    upstreamPath: string,
    body: Buffer | null
  ): Promise<void> {
    // Only a messages POST can name a GLM model; everything else the CLI does
    // (auth pings, token counting, model listing) belongs to Anthropic.
    let zaiModel: string | null = null;
    let parsedBody: Record<string, unknown> | null = null;
    if (req.method === 'POST' && /^\/v1\/messages(\?|$)/.test(upstreamPath) && body) {
      try {
        parsedBody = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
        if (isZaiModel(parsedBody.model)) zaiModel = normalizeZaiModel(parsedBody.model);
      } catch {
        // Unparseable body: let Anthropic produce the error the CLI expects.
      }
    }

    if (!zaiModel) {
      const headers: http.OutgoingHttpHeaders = { ...req.headers, host: anthropicBase.host };
      for (const header of HOP_BY_HOP) delete headers[header];
      delete headers['content-length'];
      if (body) headers['content-length'] = String(body.length);
      forward(req, res, anthropicBase, anthropicBase.pathname.replace(/\/$/, '') + upstreamPath, headers, body);
      return;
    }

    const zai = await options.getZaiConfig(session.userId).catch(() => null);
    if (!zai) {
      anthropicError(res, 400, 'invalid_request_error', `Model ${zaiModel} routes to Z.AI, but no Z.AI API is configured for this account`);
      return;
    }

    // Minimal allowlist to Z.AI. The client's own authorization (the Claude
    // OAuth bearer) must never reach a third party; accept-encoding is dropped
    // so the usage tee can read the stream.
    const zaiBase = new URL(zai.baseUrl);
    const headers: http.OutgoingHttpHeaders = {
      host: zaiBase.host,
      'content-type': req.headers['content-type'] ?? 'application/json',
      accept: req.headers.accept ?? 'application/json',
      'anthropic-version': req.headers['anthropic-version'] ?? '2023-06-01',
      authorization: `Bearer ${zai.authToken}`,
    };
    if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta'];

    let outBody = body;
    if (parsedBody && parsedBody.model !== zaiModel) {
      outBody = Buffer.from(JSON.stringify({ ...parsedBody, model: zaiModel }));
    }
    if (outBody) headers['content-length'] = String(outBody.length);

    const requestId = randomBytes(8).toString('hex');
    forward(req, res, zaiBase, zaiBase.pathname.replace(/\/$/, '') + upstreamPath, headers, outBody, {
      onBody: (text, contentType) => {
        const reported = extractZaiUsage(text, contentType);
        if (!reported) return;
        const inputTokens = reported.input_tokens ?? 0;
        const outputTokens = reported.output_tokens ?? 0;
        const cacheReadTokens = reported.cache_read_input_tokens ?? 0;
        const cacheCreationTokens = reported.cache_creation_input_tokens ?? 0;

        const totals = usage.get(session.sessionId) ?? emptyTotals();
        totals.inputTokens += inputTokens;
        totals.outputTokens += outputTokens;
        totals.cacheReadTokens += cacheReadTokens;
        totals.cacheCreationTokens += cacheCreationTokens;
        totals.requests += 1;
        usage.set(session.sessionId, totals);

        options.onZaiUsage?.({
          userId: session.userId,
          sessionId: session.sessionId,
          model: zaiModel,
          requestId,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
        });
      },
    });
  }

  return { handler, registerSession, unregisterSession, drainRoutedUsage };
}
