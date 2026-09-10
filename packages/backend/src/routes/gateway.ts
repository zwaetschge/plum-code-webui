import { get as pgGet, all as pgAll } from '../db/pg.js';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { getProcessManager } from '../websocket/index.js';
import { listPendingPermissionsForUser } from './permissions.js';
import { listPendingQuestionsForUser } from '../services/pendingQuestions.js';
import {
  createGatewayToken,
  listGatewayTokens,
  revokeGatewayToken,
} from '../services/gateway/tokens.js';
import type { ApiResponse } from '@plum-code-webui/shared';

/**
 * Control gateway for an external supervisor.
 *
 * The watchdog this replaces polled one container and asked an LLM about it.
 * What was actually wanted is the other direction: let another instance —
 * Hermes, an OpenCode or Codex CLI — hold the overview and drive the work. So
 * the gateway is deliberately thin. Authentication is the whole integration:
 * a gateway token resolves to its owner in `resolveAuthenticatedUserId`, which
 * means every existing endpoint already works for the supervisor. Only the two
 * things it cannot get from the normal API live here — one snapshot across all
 * sessions, and a stream to react to instead of polling.
 */

const router = Router();

const createTokenSchema = z.object({
  name: z.string().min(1).max(80),
  // Defaults to the historical behaviour so existing callers keep working;
  // read-only has to be asked for.
  scope: z.enum(['read', 'write']).optional().default('write'),
});

/** A gateway must not mint credentials — that turns read access into persistence. */
function rejectGatewayCaller(req: Request): void {
  if ((req as AuthenticatedRequest).viaGateway) {
    throw new AppError('Gateway tokens cannot manage gateway tokens', 403, 'GATEWAY_FORBIDDEN');
  }
}

router.get('/tokens', requireAuth, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = (req as AuthenticatedRequest).userId;
  res.json({ success: true, data: await listGatewayTokens(userId) });
});

router.post('/tokens', requireAuth, rateLimiters.strict, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const parsed = createTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('A token name is required', 400, 'VALIDATION_ERROR');
  }
  const userId = (req as AuthenticatedRequest).userId;
  const { token, row } = await createGatewayToken(userId, parsed.data.name, parsed.data.scope);
  // The only time the secret is ever returned.
  res.json({ success: true, data: { ...row, token } });
});

router.delete('/tokens/:id', requireAuth, (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = (req as AuthenticatedRequest).userId;
  const removed = revokeGatewayToken(userId, req.params.id!);
  if (!removed) throw new AppError('Token not found', 404, 'NOT_FOUND');
  res.json({ success: true, data: { id: req.params.id } });
});

interface SessionOverview {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  workingDirectory: string;
  status: string;
  archived: boolean;
  updatedAt: string;
  running: boolean;
  busy: boolean;
  queueDepth: number;
  activitySummary: string | null;
  lastActivityAt: string | null;
  pendingApprovals: number;
  /** Questions the agent is blocked on. A separate block from an approval. */
  pendingQuestions: number;
}

/**
 * GET /api/gateway/overview
 *
 * One call, everything a supervisor needs to decide what to look at: which
 * sessions exist, which are actually working, which are blocked on a human,
 * and how deep their queues are.
 */
router.get('/overview', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const includeArchived = req.query.archived === '1';

  const rows = (await pgAll(
    `SELECT id, name, cli_provider AS provider, cli_model AS model,
              working_directory AS workingDirectory, status, archived,
              strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) AS updatedAt
         FROM sessions
        WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'}
        ORDER BY updated_at DESC`,
    userId
  )) as unknown as Array<
    Omit<
      SessionOverview,
      | 'running'
      | 'busy'
      | 'queueDepth'
      | 'activitySummary'
      | 'lastActivityAt'
      | 'pendingApprovals'
      | 'pendingQuestions'
      | 'archived'
    > & { archived: number }
  >;

  const pending = listPendingPermissionsForUser(userId);
  const pendingBySession = new Map<string, number>();
  for (const request of pending) {
    pendingBySession.set(request.sessionId, (pendingBySession.get(request.sessionId) ?? 0) + 1);
  }

  // Questions block a session exactly as hard as an approval does, and until
  // now they were invisible here — a supervisor, the widget and the watch all
  // saw an idle session that was in fact waiting for someone to pick an option.
  const questions = listPendingQuestionsForUser(userId);
  const questionsBySession = new Map<string, number>();
  for (const question of questions) {
    questionsBySession.set(
      question.sessionId,
      (questionsBySession.get(question.sessionId) ?? 0) + 1
    );
  }

  const manager = getProcessManager();
  const sessions: SessionOverview[] = rows.map((row) => {
    const runtime = manager.getSessionRuntimeSnapshot(row.id);
    return {
      ...row,
      archived: row.archived === 1,
      running: runtime.running,
      busy: runtime.busy,
      queueDepth: runtime.queueDepth,
      activitySummary: runtime.activitySummary,
      lastActivityAt: runtime.lastActivityAt,
      pendingApprovals: pendingBySession.get(row.id) ?? 0,
      pendingQuestions: questionsBySession.get(row.id) ?? 0,
    };
  });

  const response: ApiResponse<{
    generatedAt: string;
    totals: {
      sessions: number;
      busy: number;
      pendingApprovals: number;
      pendingQuestions: number;
    };
    needsAttention: string[];
    sessions: SessionOverview[];
    pendingApprovals: typeof pending;
    pendingQuestions: typeof questions;
  }> = {
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      totals: {
        sessions: sessions.length,
        busy: sessions.filter((s) => s.busy).length,
        pendingApprovals: pending.length,
        pendingQuestions: questions.length,
      },
      // Blocked on a human, or errored — the list a supervisor acts on first.
      needsAttention: sessions
        .filter((s) => s.pendingApprovals > 0 || s.pendingQuestions > 0 || s.status === 'error')
        .map((s) => s.id),
      sessions,
      pendingApprovals: pending,
      pendingQuestions: questions,
    },
  };
  res.json(response);
});

/**
 * GET /api/gateway/events
 *
 * Server-sent events for the same session traffic the UI sees. An external CLI
 * gets a plain HTTP stream instead of having to speak Socket.IO.
 */
/**
 * Every open stream registers three listeners on the process manager's event
 * emitter (which is deliberately unbounded) plus a heartbeat interval, and each
 * one gets a copy of every message from every session the user owns. A
 * reconnect loop in a supervisor script therefore multiplies the fan-out
 * silently. Cap it; four supervisors is already generous.
 */
const GATEWAY_SSE_MAX_PER_USER = Number(process.env.GATEWAY_SSE_MAX_PER_USER) || 4;
const openEventStreams = new Map<string, number>();

router.get('/events', requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const manager = getProcessManager();

  const open = openEventStreams.get(userId) ?? 0;
  if (open >= GATEWAY_SSE_MAX_PER_USER) {
    throw new AppError(
      `Too many open gateway event streams (max ${GATEWAY_SSE_MAX_PER_USER})`,
      429,
      'GATEWAY_STREAM_LIMIT'
    );
  }
  openEventStreams.set(userId, open + 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ userId })}\n\n`);

  // One ownership probe per session per 30s, not per streamed message: a busy
  // session emits many events per second, and each one used to cost a query
  // for every connected supervisor.
  const ownershipCache = new Map<string, { owned: boolean; at: number }>();
  const OWNERSHIP_TTL_MS = 30_000;
  const ownsSession = async (sessionId: string): Promise<boolean> => {
    const cached = ownershipCache.get(sessionId);
    if (cached && Date.now() - cached.at < OWNERSHIP_TTL_MS) return cached.owned;
    const row = await pgGet(
      'SELECT 1 FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    );
    const owned = Boolean(row);
    ownershipCache.set(sessionId, { owned, at: Date.now() });
    return owned;
  };

  const send = async (event: string, sessionId: string, payload: unknown): Promise<void> => {
    if (!(await ownsSession(sessionId))) return;
    res.write(
      `event: ${event}\ndata: ${JSON.stringify({ sessionId, ...(payload as object) })}\n\n`
    );
  };

  const onAssistant = async (sessionId: string, content: string) =>
    await send('assistant_message', sessionId, { content });
  const onUser = async (sessionId: string, content: string) =>
    await send('user_message', sessionId, { content });
  const onTurn = async (sessionId: string, usage: unknown) =>
    await send('turn_complete', sessionId, { usage });

  manager.events.on('assistantMessage', onAssistant);
  manager.events.on('userMessage', onUser);
  manager.events.on('turnComplete', onTurn);

  // Proxies drop an idle stream; a comment line keeps it open without noise.
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25_000);
  // An open stream must not by itself keep the process from shutting down.
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    manager.events.off('assistantMessage', onAssistant);
    manager.events.off('userMessage', onUser);
    manager.events.off('turnComplete', onTurn);
    const remaining = (openEventStreams.get(userId) ?? 1) - 1;
    if (remaining > 0) openEventStreams.set(userId, remaining);
    else openEventStreams.delete(userId);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
});

export default router;
