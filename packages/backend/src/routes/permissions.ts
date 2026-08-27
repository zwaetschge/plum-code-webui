import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { addPatternToSettings } from '../services/claudeSettings.js';
import { getDatabase } from '../db/index.js';
import { config } from '../config.js';
import { opencodeServer } from '../services/opencode/OpencodeServer.js';
import { auditFromRequest, recordAudit } from '../utils/auditLog.js';
import { getProcessManager } from '../websocket/index.js';
import {
  notify,
  resolveApprovalNotification,
} from '../services/notifications/notificationCenter.js';

const router = Router();

// Types
interface PendingPermission {
  sessionId: string;
  userId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  suggestedPattern: string;
  status: 'pending' | 'approved' | 'denied';
  pattern?: string;
  createdAt: number;
}

export function permissionIdentityMatches(
  request: Pick<PendingPermission, 'sessionId' | 'userId'>,
  userId: string,
  sessionId: string
): boolean {
  return request.userId === userId && request.sessionId === sessionId;
}

// In-memory storage for pending permission requests
// Key: requestId, Value: PendingPermission
const pendingRequests = new Map<string, PendingPermission>();

/**
 * Every approval this user is currently blocked on, across all sessions. The
 * gateway needs the whole picture in one call — an external supervisor cannot
 * poll per session without first knowing which sessions are waiting.
 */
export function listPendingPermissionsForUser(
  userId: string
): Array<Omit<PendingPermission, 'userId'>> {
  const pending: Array<Omit<PendingPermission, 'userId'>> = [];
  for (const request of pendingRequests.values()) {
    if (request.userId !== userId || request.status !== 'pending') continue;
    const { userId: _ignored, ...rest } = request;
    pending.push(rest);
  }
  return pending.sort((a, b) => a.createdAt - b.createdAt);
}

// Cleanup old requests (older than 3 minutes)
function cleanupOldRequests(): void {
  const maxAge = 3 * 60 * 1000; // 3 minutes
  const now = Date.now();
  for (const [requestId, request] of pendingRequests.entries()) {
    if (now - request.createdAt > maxAge) {
      pendingRequests.delete(requestId);
    }
  }
}

// Run cleanup every minute
const permissionCleanupTimer = setInterval(cleanupOldRequests, 60 * 1000);
permissionCleanupTimer.unref();

// Hook-only endpoints (request creation + long-polling response) are reachable from any
// caller that can hit the backend — including the public internet once the port is
// exposed. They must only accept calls from our own permission-prompt script, which
// receives the secret via env. We compare with constant-time to not leak length.
function requireHookSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('x-webui-hook-secret') || '';
  const expected = config.hookSecret;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}

// Helper to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Validation schemas
const permissionRequestSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().uuid(),
  toolName: z.string().min(1),
  toolInput: z.unknown(),
  description: z.string().optional(),
  suggestedPattern: z.string().optional(),
});

const permissionRespondSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  action: z.enum(['allow_once', 'allow_project', 'allow_global', 'deny']),
  pattern: z.string().optional(),
});

/**
 * POST /api/permissions/request
 * Called by the permission-prompt script when Claude needs permission.
 * Stores the request and emits to frontend.
 * Requires the shared hook secret, which the spawning backend injects
 * into the script's env so no external caller can forge requests.
 */
router.post('/request', requireHookSecret, async (req: Request, res: Response) => {
  const parsed = permissionRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
    });
  }

  const { sessionId, requestId, toolName, toolInput, description, suggestedPattern } = parsed.data;

  const hookSessionId = req.header('x-webui-session-id') || '';
  if (!hookSessionId || hookSessionId !== sessionId) {
    return res.status(403).json({ success: false, error: 'Session identity mismatch' });
  }

  const db = getDatabase();
  const session = db
    .prepare('SELECT user_id, cli_provider FROM sessions WHERE id = ?')
    .get(sessionId) as { user_id: string; cli_provider: string | null } | undefined;
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const pendingRequest: PendingPermission = {
    sessionId,
    userId: session.user_id,
    requestId,
    toolName,
    toolInput,
    description: description || `${toolName} tool`,
    suggestedPattern: suggestedPattern || `${toolName}(:*)`,
    status: 'pending',
    createdAt: Date.now(),
  };

  pendingRequests.set(requestId, pendingRequest);

  recordAudit({
    actorUserId: session.user_id,
    action: 'permission.request',
    resourceType: 'session',
    resourceId: sessionId,
    metadata: {
      provider: session.cli_provider || 'unknown',
      requestId,
      toolName,
      suggestedPattern: pendingRequest.suggestedPattern,
      description: pendingRequest.description,
    },
  });

  getProcessManager().emitPermissionRequest(sessionId, {
    sessionId,
    requestId,
    toolName,
    toolInput,
    description: pendingRequest.description,
    suggestedPattern: pendingRequest.suggestedPattern,
  });

  // File it in the notification centre too: a permission prompt is the one
  // event that actually blocks the agent, so it has to reach whoever is not
  // currently looking at this session.
  const sessionName = (
    db.prepare('SELECT name FROM sessions WHERE id = ?').get(sessionId) as
      | { name: string }
      | undefined
  )?.name;
  notify({
    userId: session.user_id,
    sessionId,
    kind: 'approval',
    title: `Approval needed — ${sessionName || 'session'}`,
    body: pendingRequest.description,
    data: { requestId, toolName, suggestedPattern: pendingRequest.suggestedPattern },
  });

  console.log(`[PERMISSIONS] Request ${requestId} created for session ${sessionId}: ${toolName}`);

  res.json({ success: true, requestId });
});

/**
 * GET /api/permissions/response/:requestId
 * Long-polled by the permission-prompt script to wait for user response.
 * Requires the shared hook secret — same rationale as /request.
 */
router.get('/response/:requestId', requireHookSecret, async (req: Request, res: Response) => {
  const requestId = req.params.requestId;
  if (!requestId) {
    return res.status(400).json({ approved: false, error: 'Missing requestId' });
  }

  const timeout = 120000; // 2 minute timeout

  const startTime = Date.now();
  const hookSessionId = req.header('x-webui-session-id') || '';

  // Poll until response or timeout
  while (Date.now() - startTime < timeout) {
    const request = pendingRequests.get(requestId);

    if (!request) {
      // Request not found - probably already cleaned up or never existed
      return res.json({
        approved: false,
        error: 'Request not found',
      });
    }

    if (!hookSessionId || request.sessionId !== hookSessionId) {
      return res.status(403).json({ approved: false, error: 'Session identity mismatch' });
    }

    if (request.status !== 'pending') {
      // User has responded
      const approved = request.status === 'approved';
      const pattern = request.pattern;

      // Clean up the request
      pendingRequests.delete(requestId);

      console.log(`[PERMISSIONS] Request ${requestId} resolved: ${request.status}`);

      return res.json({
        approved,
        pattern,
      });
    }

    // Wait a bit before checking again
    await sleep(100);
  }

  // Timeout - deny by default
  pendingRequests.delete(requestId);

  console.log(`[PERMISSIONS] Request ${requestId} timed out`);

  res.json({
    approved: false,
    error: 'Timeout',
  });
});

/**
 * POST /api/permissions/respond
 * Called by the frontend when user approves or denies a permission request.
 * Requires authentication.
 */
router.post('/respond', requireAuth, async (req: Request, res: Response) => {
  const parsed = permissionRespondSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { sessionId, requestId, action, pattern } = parsed.data;
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();
  const session = db
    .prepare(
      `SELECT id, cli_provider, claude_session_id
       FROM sessions WHERE id = ? AND user_id = ?`
    )
    .get(sessionId, userId) as
    | { id: string; cli_provider: string | null; claude_session_id: string | null }
    | undefined;
  if (!session) {
    throw new AppError('Permission request not found or expired', 404, 'NOT_FOUND');
  }
  if (action === 'allow_global') {
    const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as
      | { role: string }
      | undefined;
    if (actor?.role !== 'admin') {
      throw new AppError('Admin privileges required', 403, 'ADMIN_REQUIRED');
    }
  }

  const request = pendingRequests.get(requestId);

  if (!request) {
    if (session.cli_provider !== 'opencode' || !session.claude_session_id) {
      throw new AppError('Permission request not found or expired', 404, 'NOT_FOUND');
    }
    try {
      const reply =
        action === 'deny'
          ? 'reject'
          : action === 'allow_global' || action === 'allow_project'
            ? 'always'
            : 'once';
      const handled = await opencodeServer.replyPermission(
        requestId,
        reply,
        pattern,
        session.claude_session_id,
        userId
      );
      if (handled) {
        resolveApprovalNotification(requestId);
        auditFromRequest(req, 'permission.respond', {
          resourceType: 'permission_request',
          resourceId: requestId,
          metadata: {
            provider: 'opencode',
            action,
            pattern: pattern ?? null,
          },
        });
        return res.json({
          success: true,
          action,
          pattern,
          provider: 'opencode',
        });
      }
    } catch (err) {
      console.error(`[PERMISSIONS] OpenCode permission reply failed for ${requestId}:`, err);
      throw new AppError('Failed to respond to OpenCode permission request', 502, 'OPENCODE_ERROR');
    }

    throw new AppError('Permission request not found or expired', 404, 'NOT_FOUND');
  }

  if (!permissionIdentityMatches(request, userId, sessionId)) {
    throw new AppError('Permission request not found or expired', 404, 'NOT_FOUND');
  }

  // Update request status
  if (action === 'deny') {
    request.status = 'denied';
  } else {
    request.status = 'approved';
    request.pattern = pattern || request.suggestedPattern;

    // Save pattern if user selected allow_project or allow_global
    if (action === 'allow_project' || action === 'allow_global') {
      try {
        const scope = action === 'allow_global' ? 'global' : 'project';
        let projectPath: string | undefined;

        if (scope === 'project') {
          // Get project path from session
          const ownedSession = db
            .prepare('SELECT working_directory FROM sessions WHERE id = ?')
            .get(request.sessionId) as { working_directory: string } | undefined;
          projectPath = ownedSession?.working_directory;
        }

        await addPatternToSettings(request.pattern!, scope, projectPath);
        console.log(`[PERMISSIONS] Saved pattern "${request.pattern}" to ${scope} settings`);
      } catch (err) {
        console.error(`[PERMISSIONS] Failed to save pattern:`, err);
        // Don't fail the request if pattern saving fails
      }
    }
  }

  console.log(`[PERMISSIONS] User responded to ${requestId}: ${action}`);
  resolveApprovalNotification(requestId);
  auditFromRequest(req, 'permission.respond', {
    resourceType: 'session',
    resourceId: request.sessionId,
    metadata: {
      provider: 'hook',
      requestId,
      toolName: request.toolName,
      action,
      pattern: request.pattern ?? pattern ?? null,
    },
  });

  // Note: The long-polling endpoint will pick up this status change
  // and return the response to the permission-prompt script

  res.json({
    success: true,
    action,
    pattern: request.pattern,
  });
});

/**
 * GET /api/permissions/pending/:sessionId
 * Get pending permission requests for a session.
 * Useful for frontend to check if there are outstanding requests.
 * Requires authentication.
 */
router.get('/pending/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const userId = (req as AuthenticatedRequest).userId;
  const ownedSession = getDatabase()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId);
  if (!ownedSession) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const pending: Array<Omit<PendingPermission, 'userId'>> = [];
  for (const request of pendingRequests.values()) {
    if (
      request.sessionId === sessionId &&
      request.userId === userId &&
      request.status === 'pending'
    ) {
      pending.push({
        sessionId: request.sessionId,
        requestId: request.requestId,
        toolName: request.toolName,
        toolInput: request.toolInput,
        description: request.description,
        suggestedPattern: request.suggestedPattern,
        status: request.status,
        pattern: request.pattern,
        createdAt: request.createdAt,
      });
    }
  }

  res.json({
    success: true,
    data: pending,
  });
});

export default router;
