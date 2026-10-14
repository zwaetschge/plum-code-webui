import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { getRunnerAccessDecision } from '../utils/runnerAccess.js';
import {
  createSshConnectionSchema,
  normalizePrivateKey,
  updateSshConnectionSchema,
  type SshConnectionConfig,
} from '../services/connections/sshConfig.js';
import {
  aliasTaken,
  deleteConnection,
  getConnectionRow,
  insertConnection,
  listConnectionRows,
  listSessionConnectionRows,
  parseSshConfig,
  sessionsUsingConnection,
  setSessionConnections,
  toSshDto,
  updateConnection,
  userOwnsSession,
} from '../services/connections/store.js';
import {
  keyFileExists,
  listSshKeyFiles,
  refreshSessionSshIfPresent,
  testSshConnection,
} from '../services/connections/sshRuntime.js';

/**
 * Verbindungen (connections): SSH hosts a user keeps globally and attaches to
 * sessions, so the session's agent can reach them through generated
 * `ssh_config` aliases.
 *
 * Secrets are write-only. A response says `keyConfigured`; an empty
 * `privateKey` on update keeps the stored key and only `clearKey` removes it.
 * Key files from the read-only `~/.ssh` mount are offered by name only.
 */

const router = Router();
export const sessionConnectionsRouter = Router();

function userIdOf(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}

function rejectGatewayCaller(req: Request): void {
  if ((req as AuthenticatedRequest).viaGateway) {
    throw new AppError('Gateway tokens cannot manage connections', 403, 'GATEWAY_FORBIDDEN');
  }
}

function validationError(error: z.ZodError): AppError {
  const issue = error.issues[0];
  const field = issue?.path.join('.') || 'input';
  return new AppError(`${field}: ${issue?.message ?? 'invalid'}`, 400, 'VALIDATION_ERROR');
}

/**
 * Key files in ~/.ssh belong to the operator, and a probe reaches any host the
 * container can: both are for accounts allowed to run CLI agents only.
 */
async function requireRunnerAccess(userId: string): Promise<void> {
  const decision = await getRunnerAccessDecision(userId).catch(() => ({ allowed: false }));
  if (!decision.allowed) {
    throw new AppError(
      'SSH key files and connection tests need CLI runner access',
      403,
      'RUNNER_ACCESS_REQUIRED'
    );
  }
}

async function assertKeyUsable(
  userId: string,
  config: SshConnectionConfig,
  hasStoredSecret: boolean
): Promise<void> {
  if (config.keySource === 'file') {
    await requireRunnerAccess(userId);
    if (!config.keyFile)
      throw new AppError('Choose a key file from ~/.ssh', 400, 'VALIDATION_ERROR');
    if (!(await keyFileExists(config.keyFile))) {
      throw new AppError('Key file not found in ~/.ssh', 400, 'VALIDATION_ERROR');
    }
  } else if (!hasStoredSecret) {
    throw new AppError('Paste or upload a private key', 400, 'VALIDATION_ERROR');
  }
}

async function refreshSessionsFor(connectionId: string, userId: string, sessionIds?: string[]) {
  const ids = sessionIds ?? (await sessionsUsingConnection(connectionId));
  await Promise.all(ids.map((sessionId) => refreshSessionSshIfPresent(sessionId, userId)));
}

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const rows = await listConnectionRows(userIdOf(req));
  res.json({ success: true, data: rows.map(toSshDto) });
});

router.get('/ssh-keys', requireAuth, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const access = await getRunnerAccessDecision(userIdOf(req)).catch(() => ({ allowed: false }));
  res.json({
    success: true,
    data: access.allowed ? await listSshKeyFiles() : { available: false, files: [] },
  });
});

router.post('/', requireAuth, rateLimiters.strict, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = userIdOf(req);
  const parsed = createSshConnectionSchema.safeParse(req.body);
  if (!parsed.success) throw validationError(parsed.error);
  const input = parsed.data;

  const privateKey =
    input.keySource === 'upload' && input.privateKey ? normalizePrivateKey(input.privateKey) : null;
  if (input.keySource === 'upload' && input.privateKey && !privateKey) {
    throw new AppError('The key is not a valid private key (PEM/OpenSSH)', 400, 'VALIDATION_ERROR');
  }
  const config: SshConnectionConfig = {
    alias: input.alias,
    host: input.host,
    port: input.port,
    user: input.user,
    jumpHost: input.jumpHost ?? null,
    tags: input.tags ?? [],
    keySource: input.keySource,
    keyFile: input.keySource === 'file' ? (input.keyFile ?? null) : null,
  };
  await assertKeyUsable(userId, config, !!privateKey);
  if (await aliasTaken(userId, config.alias)) {
    throw new AppError(`Alias "${config.alias}" is already used`, 409, 'ALIAS_TAKEN');
  }
  const row = await insertConnection(userId, input.name, config, privateKey);
  res.status(201).json({ success: true, data: toSshDto(row) });
});

router.patch('/:id', requireAuth, rateLimiters.strict, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = userIdOf(req);
  const existing = await getConnectionRow(userId, req.params.id!);
  if (!existing) throw new AppError('Connection not found', 404, 'NOT_FOUND');
  const parsed = updateSshConnectionSchema.safeParse(req.body);
  if (!parsed.success) throw validationError(parsed.error);
  const input = parsed.data;
  const current = parseSshConfig(existing);

  const keySource = input.keySource ?? current.keySource;
  const config: SshConnectionConfig = {
    alias: input.alias ?? current.alias,
    host: input.host ?? current.host,
    port: input.port ?? current.port,
    user: input.user ?? current.user,
    jumpHost: input.jumpHost !== undefined ? input.jumpHost : current.jumpHost,
    tags: input.tags ?? current.tags,
    keySource,
    keyFile:
      keySource === 'file' ? (input.keyFile !== undefined ? input.keyFile : current.keyFile) : null,
  };

  let secret: { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; value: string } = {
    kind: 'keep',
  };
  if (input.privateKey && input.privateKey.trim()) {
    const normalized = normalizePrivateKey(input.privateKey);
    if (!normalized) {
      throw new AppError(
        'The key is not a valid private key (PEM/OpenSSH)',
        400,
        'VALIDATION_ERROR'
      );
    }
    secret = keySource === 'upload' ? { kind: 'set', value: normalized } : { kind: 'keep' };
  }
  // Switching to a key file drops an uploaded key: it would otherwise linger
  // encrypted with nothing pointing at it.
  if (input.clearKey || keySource === 'file') {
    if (secret.kind !== 'set') secret = existing.secret_enc ? { kind: 'clear' } : { kind: 'keep' };
  }
  if (input.clearKey && keySource === 'file') config.keyFile = null;

  if (!input.clearKey) {
    const hasSecret = secret.kind === 'set' || (secret.kind === 'keep' && !!existing.secret_enc);
    await assertKeyUsable(userId, config, hasSecret);
  }
  if (config.alias !== current.alias && (await aliasTaken(userId, config.alias, existing.id))) {
    throw new AppError(`Alias "${config.alias}" is already used`, 409, 'ALIAS_TAKEN');
  }

  const row = await updateConnection(
    userId,
    existing.id,
    input.name ?? existing.name,
    config,
    secret
  );
  if (!row) throw new AppError('Connection not found', 404, 'NOT_FOUND');
  await refreshSessionsFor(existing.id, userId);
  res.json({ success: true, data: toSshDto(row) });
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = userIdOf(req);
  const existing = await getConnectionRow(userId, req.params.id!);
  if (!existing) throw new AppError('Connection not found', 404, 'NOT_FOUND');
  const sessions = await sessionsUsingConnection(existing.id);
  await deleteConnection(userId, existing.id);
  await refreshSessionsFor(existing.id, userId, sessions);
  res.json({ success: true, data: { id: existing.id } });
});

router.post('/:id/test', requireAuth, rateLimiters.strict, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = userIdOf(req);
  const row = await getConnectionRow(userId, req.params.id!);
  if (!row) throw new AppError('Connection not found', 404, 'NOT_FOUND');
  await requireRunnerAccess(userId);
  res.json({ success: true, data: await testSshConnection(userId, row) });
});

async function sessionPayload(sessionId: string, userId: string) {
  const [rows, access] = await Promise.all([
    listSessionConnectionRows(sessionId, userId),
    getRunnerAccessDecision(userId).catch(() => ({ allowed: false })),
  ]);
  return { connections: rows.map(toSshDto), agentAccess: access.allowed };
}

sessionConnectionsRouter.get(
  '/:id/connections',
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    if (!(await userOwnsSession(req.params.id!, userId))) {
      throw new AppError('Session not found', 404, 'NOT_FOUND');
    }
    res.json({ success: true, data: await sessionPayload(req.params.id!, userId) });
  }
);

sessionConnectionsRouter.put(
  '/:id/connections',
  requireAuth,
  async (req: Request, res: Response) => {
    rejectGatewayCaller(req);
    const userId = userIdOf(req);
    const sessionId = req.params.id!;
    if (!(await userOwnsSession(sessionId, userId))) {
      throw new AppError('Session not found', 404, 'NOT_FOUND');
    }
    const parsed = z
      .object({ connectionIds: z.array(z.string().min(1).max(64)).max(50) })
      .safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    await setSessionConnections(sessionId, userId, parsed.data.connectionIds);
    await refreshSessionSshIfPresent(sessionId, userId);
    res.json({ success: true, data: await sessionPayload(sessionId, userId) });
  }
);

export default router;
