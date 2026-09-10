import { get as pgGet, all as pgAll, run as pgRun } from '../db/pg.js';
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  requireAuth,
  requireAdmin,
  resolveAuthenticatedUserId,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { auditFromRequest } from '../utils/auditLog.js';
import { revokeUserHttpSessions } from '../services/SqliteSessionStore.js';
import { disconnectUserSockets } from '../websocket/index.js';
import { createBackup, listBackups } from '../services/backup.js';
import { config } from '../config.js';
import { timingSafeEqual } from 'crypto';

const router = Router();

// Every admin route is gated by both requireAuth and requireAdmin.
/**
 * The only supported way to back this database up. Outside processes must not
 * open the live file — see services/backup.ts for what that did on 2026-08-26.
 *
 * Reachable two ways: an admin session, or the shared hook secret that spawned
 * CLI subprocesses already use. The maintenance script has no browser session,
 * and without the second path it could no longer take a backup at all.
 */
async function backupCallerAllowed(req: Request): Promise<boolean> {
  // This route is registered before the router-wide requireAuth, so nothing has
  // populated req.userId yet — the old `if (req.userId) return true` was dead
  // code and an admin session could not actually take a backup.
  const userId = await resolveAuthenticatedUserId(req);
  if (userId) {
    const row = (await pgGet(`SELECT role, status FROM users WHERE id = ?`, userId)) as unknown as
      | { role: string; status: string }
      | undefined;
    if (row?.role === 'admin' && row.status !== 'suspended') return true;
  }
  const provided = req.header('x-webui-hook-secret') || '';
  const expected = config.hookSecret;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.post('/backup', async (req: Request, res: Response) => {
  if (!(await backupCallerAllowed(req))) {
    throw new AppError('Admin session or hook secret required', 401, 'AUTH_REQUIRED');
  }
  const result = await createBackup();
  if (!result.verified) {
    throw new AppError(
      `Backup verification failed: ${result.detail ?? 'unknown'}`,
      500,
      'BACKUP_UNVERIFIED'
    );
  }
  res.json({ success: true, data: result });
});

router.use(requireAuth, requireAdmin);

router.get('/backups', (_req: Request, res: Response) => {
  res.json({ success: true, data: listBackups() });
});

// ─── Users ──────────────────────────────────────────────────────────────────

router.get('/users', async (_req, res) => {
  const rows =
    await pgAll(`SELECT u.id, u.email, u.name, u.avatar_url as avatarUrl, u.provider, u.provider_id as providerId,
              u.role, u.status,
              strftime('%Y-%m-%dT%H:%M:%fZ', u.last_login_at) as lastLoginAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', u.created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', u.updated_at) as updatedAt,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) as sessionCount
       FROM users u
       ORDER BY u.created_at DESC`);
  res.json({ success: true, data: rows });
});

router.get('/users/:id', async (req, res) => {
  const user = await pgGet(
    `SELECT id, email, name, avatar_url as avatarUrl, provider, provider_id as providerId,
              role, status,
              strftime('%Y-%m-%dT%H:%M:%fZ', last_login_at) as lastLoginAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
       FROM users WHERE id = ?`,
    req.params.id
  );
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');
  res.json({ success: true, data: user });
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  role: z.enum(['user', 'admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  password: z.string().min(8).max(200).optional(),
});

router.patch('/users/:id', async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');

  const targetId = req.params.id;
  const actorId = (req as unknown as AuthenticatedRequest).userId;

  const current = (await pgGet(
    `SELECT id, email, role, status FROM users WHERE id = ?`,
    targetId
  )) as unknown as { id: string; email: string; role: string; status: string } | undefined;
  if (!current) throw new AppError('User not found', 404, 'NOT_FOUND');

  // Guard: the actor must never demote or suspend themselves, otherwise a single admin
  // can lock the system out of all admin access in one request.
  if (targetId === actorId) {
    if (parsed.data.role && parsed.data.role !== current.role) {
      throw new AppError('Cannot change your own role', 400, 'SELF_DEMOTE');
    }
    if (parsed.data.status && parsed.data.status !== current.status) {
      throw new AppError('Cannot change your own status', 400, 'SELF_SUSPEND');
    }
  }

  // Guard: never demote/suspend the last remaining admin.
  if (
    current.role === 'admin' &&
    (parsed.data.role === 'user' || parsed.data.status === 'suspended')
  ) {
    const otherAdmins = (await pgGet(
      `SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND status = 'active' AND id != ?`,
      targetId
    )) as unknown as { c: number };
    if (otherAdmins.c === 0) {
      throw new AppError('Cannot remove the last active admin', 400, 'LAST_ADMIN');
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (parsed.data.name !== undefined) {
    updates.push('name = ?');
    params.push(parsed.data.name);
  }
  if (parsed.data.email !== undefined) {
    updates.push('email = ?');
    params.push(parsed.data.email);
  }
  if (parsed.data.role !== undefined) {
    updates.push('role = ?');
    params.push(parsed.data.role);
  }
  if (parsed.data.status !== undefined) {
    updates.push('status = ?');
    params.push(parsed.data.status);
  }
  if (parsed.data.password !== undefined) {
    updates.push('password_hash = ?');
    params.push(bcrypt.hashSync(parsed.data.password, 10));
  }

  if (updates.length === 0) {
    return res.json({ success: true, data: { id: targetId, changed: 0 } });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(targetId);

  await pgRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);

  if (parsed.data.status === 'suspended' || parsed.data.password !== undefined) {
    await revokeUserHttpSessions(targetId);
    await disconnectUserSockets(targetId);
  }

  await auditFromRequest(req, 'admin.user.update', {
    resourceType: 'user',
    resourceId: targetId,
    metadata: {
      targetEmail: current.email,
      changes: Object.keys(parsed.data),
      previousRole: current.role,
      previousStatus: current.status,
    },
  });

  res.json({ success: true, data: { id: targetId, changed: updates.length - 1 } });
});

router.delete('/users/:id', async (req, res) => {
  const targetId = req.params.id;
  const actorId = (req as unknown as AuthenticatedRequest).userId;
  if (targetId === actorId) {
    throw new AppError('Cannot delete your own account', 400, 'SELF_DELETE');
  }

  const current = (await pgGet(
    `SELECT email, role FROM users WHERE id = ?`,
    targetId
  )) as unknown as { email: string; role: string } | undefined;
  if (!current) throw new AppError('User not found', 404, 'NOT_FOUND');

  if (current.role === 'admin') {
    const otherAdmins = (await pgGet(
      `SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND status = 'active' AND id != ?`,
      targetId
    )) as unknown as { c: number };
    if (otherAdmins.c === 0) {
      throw new AppError('Cannot delete the last active admin', 400, 'LAST_ADMIN');
    }
  }

  await disconnectUserSockets(targetId);
  await revokeUserHttpSessions(targetId);
  await pgRun(`DELETE FROM users WHERE id = ?`, targetId);

  await auditFromRequest(req, 'admin.user.delete', {
    resourceType: 'user',
    resourceId: targetId,
    metadata: { targetEmail: current.email, targetRole: current.role },
  });

  res.json({ success: true });
});

// ─── Audit log ──────────────────────────────────────────────────────────────

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().max(80).optional(),
  actorUserId: z.string().max(80).optional(),
});

router.get('/audit-log', async (req, res) => {
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('Invalid query', 400, 'VALIDATION_ERROR');
  const { limit, offset, action, actorUserId } = parsed.data;

  const where: string[] = [];
  const params: unknown[] = [];
  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  if (actorUserId) {
    where.push('a.actor_user_id = ?');
    params.push(actorUserId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = (await pgAll(
    `SELECT a.id, a.actor_user_id as actorUserId, u.email as actorEmail, a.action,
              a.resource_type as resourceType, a.resource_id as resourceId,
              a.ip, a.user_agent as userAgent, a.metadata_json as metadataJson,
              strftime('%Y-%m-%dT%H:%M:%fZ', a.created_at) as createdAt
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ${whereSql}
       ORDER BY a.id DESC
       LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  )) as unknown as Array<{
    id: number;
    actorUserId: string | null;
    actorEmail: string | null;
    action: string;
    resourceType: string | null;
    resourceId: string | null;
    ip: string | null;
    userAgent: string | null;
    metadataJson: string | null;
    createdAt: string;
  }>;

  const total = (
    (await pgGet(`SELECT COUNT(*) as c FROM audit_log a ${whereSql}`, ...params)) as unknown as {
      c: number;
    }
  ).c;

  const entries = rows.map((r) => ({
    ...r,
    metadata: r.metadataJson ? safeParseJson(r.metadataJson) : null,
    metadataJson: undefined,
  }));

  res.json({ success: true, data: { entries, total, limit, offset } });
});

// ─── Stats ──────────────────────────────────────────────────────────────────

router.get('/stats', async (_req, res) => {
  const userCount = ((await pgGet(`SELECT COUNT(*) as c FROM users`)) as unknown as { c: number })
    .c;
  const adminCount = (
    (await pgGet(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`)) as unknown as {
      c: number;
    }
  ).c;
  const suspendedCount = (
    (await pgGet(`SELECT COUNT(*) as c FROM users WHERE status = 'suspended'`)) as unknown as {
      c: number;
    }
  ).c;
  const sessionCount = (
    (await pgGet(`SELECT COUNT(*) as c FROM sessions`)) as unknown as { c: number }
  ).c;
  const runningSessionCount = (
    (await pgGet(`SELECT COUNT(*) as c FROM sessions WHERE status = 'running'`)) as unknown as {
      c: number;
    }
  ).c;
  const auditCount = (
    (await pgGet(`SELECT COUNT(*) as c FROM audit_log`)) as unknown as { c: number }
  ).c;

  res.json({
    success: true,
    data: { userCount, adminCount, suspendedCount, sessionCount, runningSessionCount, auditCount },
  });
});

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default router;
