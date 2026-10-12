import { assertTaskTurnAllowed } from './taskLimits.js';
import { assertTaskResults } from './taskResults.js';
import { captureTaskSources } from './taskSources.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { run, all, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { getProcessManager } from '../../websocket/index.js';
import { getEnabledCliProvidersForUser } from '../../routes/settings.js';
import { createAssistantWorkspace } from './workspaces.js';
import { bindProfile } from './context.js';
import { findResource, reviseResource } from './resources.js';
import type { CLIProvider } from '@plum-code-webui/shared';
import {
  acquireAssistantExecutor,
  requireAssistantExecutor,
  onAssistantExecutorLoss,
} from './executor.js';
import { executeNativeTaskCommand } from './nativeTasks.js';

export const TASK_COMMAND = z
  .object({
    commandId: z.string().min(1).max(128),
    expectedRevision: z.number().int().positive(),
    action: z.enum(['submit', 'cancel', 'input', 'retry', 'complete']),
    text: z.string().max(40000).optional(),
  })
  .strict();
export type TaskCommand = z.infer<typeof TASK_COMMAND>;
export function taskTransition(status: string, action: TaskCommand['action']): string {
  const transitions: Record<string, Record<string, string>> = {
    draft: { submit: 'queued', cancel: 'cancelled' },
    queued: { cancel: 'cancelled' },
    running: { cancel: 'cancelled' },
    waiting_input: { input: 'queued', complete: 'completed', cancel: 'cancelled' },
    failed: { retry: 'queued' },
    interrupted: { retry: 'queued', cancel: 'cancelled' },
    cancelled: { retry: 'queued' },
    completed: { retry: 'queued' },
  };
  const next = transitions[status]?.[action];
  if (!next)
    throw new AppError(
      'Diese Aktion ist im aktuellen Zustand nicht möglich',
      409,
      'INVALID_TRANSITION'
    );
  return next;
}
export function commandHash(taskId: string, command: TaskCommand): string {
  return createHash('sha256')
    .update(
      JSON.stringify([taskId, command.expectedRevision, command.action, command.text ?? null])
    )
    .digest('hex');
}

let listening = false;
const ownedSessions = new Map<string, string>();
const commandQueues = new Map<string, Promise<unknown>>();
function registerTaskEvents(): void {
  if (listening) return;
  const manager = getProcessManager();
  onAssistantExecutorLoss(() => {
    for (const [sessionId, userId] of ownedSessions)
      void manager.stopSession(sessionId, userId).catch(() => {});
    ownedSessions.clear();
    const retry = setTimeout(() => {
      void reconcileAssistantTasks().catch(() => {});
    }, 30000);
    retry.unref();
  });
  listening = true;
  manager.events.on('turnComplete', (sessionId: string) => {
    void settleTurn(sessionId).catch((error) =>
      console.error(
        '[assistant] Task settlement failed',
        error instanceof Error ? error.message : 'unknown'
      )
    );
  });
}

async function settleTurn(sessionId: string): Promise<void> {
  await requireAssistantExecutor();
  await transaction(async (tx) => {
    const rows = await tx.all(
      `SELECT r.* FROM assistant_resources r JOIN assistant_attempts a ON a.task_id = r.id
      WHERE a.session_id = ? AND a.status = 'running' AND r.archived = 0 FOR UPDATE OF r`,
      sessionId
    );
    const message = (await tx.get(
      `SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1`,
      sessionId
    )) as { content: string } | undefined;
    for (const row of rows) {
      const body = JSON.parse(row.body_json);
      if (body.coordinator === 'matrix' || String(body.agentId ?? '').startsWith('matrix:'))
        continue;
      if (body.status !== 'running') continue;
      // A finished model turn is awaiting the user's result review, not proof of goal completion.
      await reviseResource(
        row.user_id,
        row.id,
        Number(row.revision),
        row.title,
        {
          ...body,
          status: 'waiting_input',
          result: message?.content ?? '',
          waitingReason: 'Ergebnis prüfen oder eine Folgeanweisung senden',
        },
        tx
      );
      await tx.run(
        "UPDATE assistant_attempts SET status = 'waiting_input', result_json = ? WHERE task_id = ? AND session_id = ? AND status = 'running'",
        JSON.stringify({ result: message?.content ?? '' }),
        row.id,
        sessionId
      );
      ownedSessions.delete(sessionId);
    }
  });
}

export async function reconcileAssistantTasks(): Promise<void> {
  if (!(await acquireAssistantExecutor())) {
    if (process.env.PLUM_ASSISTANT_EXECUTOR !== 'false') {
      const retry = setTimeout(() => {
        void reconcileAssistantTasks().catch((error) =>
          console.error(
            '[assistant] Executor recovery failed',
            error instanceof Error ? error.message : 'unknown'
          )
        );
      }, 30000);
      retry.unref();
    }
    return;
  }
  registerTaskEvents();
  await transaction(async (tx) => {
    const rows = await tx.all(
      "SELECT * FROM assistant_resources WHERE kind = 'task' AND archived = 0 FOR UPDATE"
    );
    for (const row of rows) {
      const body = JSON.parse(row.body_json);
      if (
        !['running', 'queued'].includes(body.status) ||
        body.coordinator === 'matrix' ||
        String(body.agentId ?? '').startsWith('matrix:')
      )
        continue;
      await reviseResource(
        row.user_id,
        row.id,
        Number(row.revision),
        row.title,
        {
          ...body,
          status: 'interrupted',
          waitingReason: 'Backend wurde neu gestartet; Wiederaufnahme ausdrücklich wählen',
        },
        tx
      );
    }
    await tx.run(
      "UPDATE assistant_attempts SET status = 'interrupted', finished_at = ? WHERE session_id IS NOT NULL AND status IN ('running', 'queued')",
      new Date().toISOString()
    );
    await tx.run(
      "UPDATE assistant_commands SET status = 'interrupted', updated_at = ? WHERE status = 'dispatching' AND resource_id IN (SELECT id FROM assistant_resources WHERE COALESCE((body_json::jsonb)->>'coordinator', '') <> 'matrix' AND COALESCE((body_json::jsonb)->>'agentId', '') NOT LIKE 'matrix:%')",
      new Date().toISOString()
    );
  });
}

export async function executeTaskCommand(userId: string, taskId: string, command: TaskCommand) {
  const key = `${userId}:${taskId}`;
  const previous = commandQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => executeTaskCommandInOrder(userId, taskId, command));
  commandQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (commandQueues.get(key) === current) commandQueues.delete(key);
  }
}
async function executeTaskCommandInOrder(userId: string, taskId: string, command: TaskCommand) {
  const candidate = await findResource(userId, taskId);
  if (candidate.kind !== 'task') throw new AppError('Auftrag nicht gefunden', 404, 'NOT_FOUND');
  if (String(candidate.body.agentId ?? '').startsWith('matrix:'))
    return executeNativeTaskCommand(userId, taskId, command, commandHash(taskId, command));
  await requireAssistantExecutor();
  const hash = commandHash(taskId, command);
  const now = new Date().toISOString();
  const accepted = await transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', userId);
    const existing = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id = ? AND command_id = ?',
      userId,
      command.commandId
    );
    if (existing) {
      if (existing.payload_hash !== hash || existing.resource_id !== taskId)
        throw new AppError(
          'Diese Befehlskennung gehört zu einem anderen Inhalt',
          409,
          'COMMAND_CONFLICT'
        );
      return { duplicate: true, taskId, commandId: command.commandId, status: existing.status };
    }
    const task = await findResource(userId, taskId, tx);
    if (task.kind !== 'task') throw new AppError('Auftrag nicht gefunden', 404, 'NOT_FOUND');
    if (task.revision !== command.expectedRevision)
      throw new AppError('Auftrag wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    const status = taskTransition(String(task.body.status), command.action);
    if (command.action === 'input' && !command.text?.trim())
      throw new AppError('Antwort fehlt', 400, 'INVALID_INPUT');
    if (command.action === 'complete' && !String(task.body.result ?? '').trim())
      throw new AppError('Es liegt noch kein Ergebnis vor', 409, 'NO_RESULT');
    if (command.action === 'complete') {
      await assertTaskResults(tx, userId, taskId, task.body);
      const children = await tx.all(
        "SELECT body_json FROM assistant_resources WHERE user_id = ? AND kind = 'task' AND archived = 0 AND (body_json::jsonb)->>'parentId' = ?",
        userId,
        taskId
      );
      if (children.some((child) => JSON.parse(child.body_json).status !== 'completed'))
        throw new AppError(
          'Zugehörige Teilaufträge sind noch nicht erledigt',
          409,
          'CHILDREN_INCOMPLETE'
        );
    }
    await tx.run(
      'INSERT INTO assistant_commands (user_id, command_id, resource_id, payload_hash, action, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      userId,
      command.commandId,
      taskId,
      hash,
      command.action,
      'dispatching',
      now,
      now
    );
    await reviseResource(userId, taskId, task.revision, task.title, { ...task.body, status }, tx);
    return { duplicate: false, taskId, commandId: command.commandId, status };
  });
  if (accepted.duplicate) return accepted;
  try {
    const task = await findResource(userId, taskId);
    let sessionId = task.body.sessionId as string | undefined;
    if (command.action === 'cancel') {
      if (sessionId) await getProcessManager().stopSession(sessionId, userId);
      await run(
        "UPDATE assistant_attempts SET status = 'cancelled', finished_at = ? WHERE task_id = ? AND status IN ('running','waiting_input')",
        now,
        taskId
      );
    } else if (command.action === 'complete') {
      await run(
        "UPDATE assistant_attempts SET status = 'completed', finished_at = ? WHERE task_id = ? AND status = 'waiting_input'",
        now,
        taskId
      );
    } else {
      const provider = (
        String(task.body.agentId ?? '').startsWith('cli:')
          ? String(task.body.agentId).slice(4)
          : task.body.provider
      ) as CLIProvider;
      if (!(await getEnabledCliProvidersForUser(userId)).includes(provider))
        throw new AppError('Provider ist deaktiviert', 409, 'PROVIDER_DISABLED');
      if (task.body.agentId && !String(task.body.agentId).startsWith('cli:'))
        throw new AppError(
          'Für diesen Auftrag den nativen Schwarm-Transport verwenden',
          409,
          'NATIVE_RUNTIME_REQUIRED'
        );
      if (!sessionId || command.action === 'retry') {
        sessionId = randomUUID();
        const workspace = await createAssistantWorkspace(userId);
        await run(
          "INSERT INTO sessions (id, user_id, name, working_directory, cli_provider, mode, surface) VALUES (?, ?, ?, ?, ?, 'auto-accept', 'task')",
          sessionId,
          userId,
          task.title,
          workspace,
          provider
        );
        if (task.body.profileId) {
          const profile = await findResource(userId, task.body.profileId as string);
          await bindProfile(userId, sessionId, profile.id);
          if (profile.body.provider === provider && profile.body.model)
            await run(
              'UPDATE sessions SET cli_model = ? WHERE id = ? AND user_id = ?',
              profile.body.model,
              sessionId,
              userId
            );
        }
      }
      const attemptId = randomUUID();
      await transaction(async (tx) => {
        const current = await findResource(userId, taskId, tx);
        if (current.body.status !== 'queued')
          throw new AppError('Auftrag wurde vor dem Start geändert', 409, 'INVALID_TRANSITION');
        await reviseResource(
          userId,
          taskId,
          current.revision,
          current.title,
          {
            ...current.body,
            sessionId,
            status: 'running',
            sourceVersions: await captureTaskSources(
              tx,
              userId,
              (current.body.sourceIds ?? []) as string[]
            ),
          },
          tx
        );
        await tx.run(
          'INSERT INTO assistant_attempts (id, task_id, command_id, status, session_id, started_at) VALUES (?, ?, ?, ?, ?, ?)',
          attemptId,
          taskId,
          command.commandId,
          'running',
          sessionId,
          now
        );
      });
      registerTaskEvents();
      await requireAssistantExecutor();
      const manager = getProcessManager();
      ownedSessions.set(sessionId, userId);
      await assertTaskTurnAllowed(sessionId, userId);
      await manager.startSession(sessionId, userId);
      await manager.sendMessage(
        sessionId,
        userId,
        `${command.text ?? task.body.goal}\n\nPlum Task-ID: ${taskId}. Ergebnisse mit plum_create_artifact unter body.taskId an diesen Auftrag binden.\nGewünschte Ergebnisse: ${JSON.stringify(task.body.deliverables ?? [])}`,
        undefined,
        { clientMessageId: command.commandId }
      );
    }
    await run(
      "UPDATE assistant_commands SET status = 'accepted', updated_at = ? WHERE user_id = ? AND command_id = ?",
      new Date().toISOString(),
      userId,
      command.commandId
    );
    return { ...accepted, status: 'accepted', sessionId };
  } catch (error) {
    await run(
      "UPDATE assistant_attempts SET status = 'failed', finished_at = ? WHERE task_id = ? AND command_id = ? AND status = 'running'",
      new Date().toISOString(),
      taskId,
      command.commandId
    );
    const current = await findResource(userId, taskId);
    if (['queued', 'running'].includes(String(current.body.status)))
      await reviseResource(userId, taskId, current.revision, current.title, {
        ...current.body,
        status: 'failed',
        waitingReason:
          error instanceof AppError ? error.message : 'Laufzeit konnte nicht gestartet werden',
      });
    await run(
      "UPDATE assistant_commands SET status = 'failed', updated_at = ? WHERE user_id = ? AND command_id = ?",
      new Date().toISOString(),
      userId,
      command.commandId
    );
    throw error;
  }
}

export async function taskAttempts(userId: string, taskId: string) {
  const task = await findResource(userId, taskId);
  if (task.kind !== 'task') throw new AppError('Auftrag nicht gefunden', 404, 'NOT_FOUND');
  return all(
    'SELECT id, command_id, status, session_id, native_id, started_at, finished_at, result_json FROM assistant_attempts WHERE task_id = ? ORDER BY started_at DESC LIMIT 100',
    taskId
  );
}
