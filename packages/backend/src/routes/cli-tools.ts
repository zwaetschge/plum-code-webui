import { get as pgGet, all as pgAll, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import * as pty from 'node-pty';
import path from 'node:path';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type { CliTool, CliToolExecution } from '@plum-code-webui/shared';
import { buildRestrictedChildEnv } from '../utils/childProcessEnv.js';
import { isAllowedBasePath } from '../utils/allowedPaths.js';

const router = Router();

const createCliToolSchema = z.object({
  name: z.string().min(1).max(100),
  command: z.string().min(1),
  description: z.string().optional(),
  useSessionCwd: z.boolean().optional(),
  timeoutSeconds: z.number().min(10).max(3600).optional(),
  enabled: z.boolean().optional(),
});

const updateCliToolSchema = createCliToolSchema.partial();

const executeCliToolSchema = z.object({
  prompt: z.string().min(1),
  workingDirectory: z.string().optional(),
  sessionId: z.string().optional(), // If provided, messages will be saved to this session
});

// Helper to parse CLI tool from DB
function parseCliTool(row: Record<string, unknown>): CliTool {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    command: row.command as string,
    description: row.description as string | null,
    useSessionCwd: Boolean(row.use_session_cwd),
    timeoutSeconds: row.timeout_seconds as number,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at as string,
  };
}

// List CLI tools
router.get('/', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const rows = (await pgAll(
    `SELECT id, user_id, name, command, description, use_session_cwd, timeout_seconds, enabled, created_at
       FROM cli_tools WHERE user_id = ? ORDER BY name`,
    userId
  )) as unknown as Record<string, unknown>[];

  const tools = rows.map(parseCliTool);

  res.json({ success: true, data: tools });
});

// Get CLI tool by ID
router.get('/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const row = (await pgGet(
    `SELECT id, user_id, name, command, description, use_session_cwd, timeout_seconds, enabled, created_at
       FROM cli_tools WHERE id = ? AND user_id = ?`,
    req.params.id,
    userId
  )) as unknown as Record<string, unknown> | undefined;

  if (!row) {
    throw new AppError('CLI tool not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true, data: parseCliTool(row) });
});

// Create CLI tool
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createCliToolSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { name, command, description, useSessionCwd, timeoutSeconds, enabled } = parsed.data;

  const toolId = nanoid();

  await pgRun(
    `INSERT INTO cli_tools (id, user_id, name, command, description, use_session_cwd, timeout_seconds, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    toolId,
    userId,
    name,
    command,
    description || null,
    useSessionCwd !== false ? 1 : 0,
    timeoutSeconds || 300,
    enabled !== false ? 1 : 0
  );

  const row = (await pgGet(
    `SELECT id, user_id, name, command, description, use_session_cwd, timeout_seconds, enabled, created_at
       FROM cli_tools WHERE id = ?`,
    toolId
  )) as unknown as Record<string, unknown>;

  res.status(201).json({ success: true, data: parseCliTool(row) });
});

// Update CLI tool
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateCliToolSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const existing = await pgGet(
    'SELECT id FROM cli_tools WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (!existing) {
    throw new AppError('CLI tool not found', 404, 'NOT_FOUND');
  }

  const { name, command, description, useSessionCwd, timeoutSeconds, enabled } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (command !== undefined) {
    updates.push('command = ?');
    values.push(command);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description);
  }
  if (useSessionCwd !== undefined) {
    updates.push('use_session_cwd = ?');
    values.push(useSessionCwd ? 1 : 0);
  }
  if (timeoutSeconds !== undefined) {
    updates.push('timeout_seconds = ?');
    values.push(timeoutSeconds);
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    await pgRun(`UPDATE cli_tools SET ${updates.join(', ')} WHERE id = ?`, ...values);
  }

  const row = (await pgGet(
    `SELECT id, user_id, name, command, description, use_session_cwd, timeout_seconds, enabled, created_at
       FROM cli_tools WHERE id = ?`,
    req.params.id
  )) as unknown as Record<string, unknown>;

  res.json({ success: true, data: parseCliTool(row) });
});

// Delete CLI tool
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const result = await pgRun(
    'DELETE FROM cli_tools WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (result.changes === 0) {
    throw new AppError('CLI tool not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true });
});

// Execute CLI tool with a prompt
router.post('/:id/execute', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = executeCliToolSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const row = (await pgGet(
    `SELECT id, user_id, name, command, description, use_session_cwd, timeout_seconds, enabled, created_at
       FROM cli_tools WHERE id = ? AND user_id = ?`,
    req.params.id,
    userId
  )) as unknown as Record<string, unknown> | undefined;

  if (!row) {
    throw new AppError('CLI tool not found', 404, 'NOT_FOUND');
  }

  const tool = parseCliTool(row);

  if (!tool.enabled) {
    throw new AppError('CLI tool is disabled', 400, 'TOOL_DISABLED');
  }

  const { prompt, workingDirectory, sessionId } = parsed.data;
  const session = sessionId
    ? ((await pgGet(
        'SELECT working_directory FROM sessions WHERE id = ? AND user_id = ?',
        sessionId,
        userId
      )) as unknown as { working_directory: string } | undefined)
    : undefined;
  if (sessionId && !session) {
    throw new AppError('Session not found', 404, 'SESSION_NOT_FOUND');
  }

  let cwd = process.cwd();
  if (tool.useSessionCwd) {
    const requestedCwd = session?.working_directory || workingDirectory;
    if (requestedCwd) {
      const resolvedCwd = path.resolve(requestedCwd);
      if (!isAllowedBasePath(resolvedCwd)) {
        throw new AppError('Working directory is not allowed', 403, 'FORBIDDEN_PATH');
      }
      cwd = resolvedCwd;
    }
  }

  // Save user message if sessionId provided
  if (sessionId) {
    const userMsgId = nanoid();
    await pgRun(
      'INSERT INTO messages (id, session_id, chat_id, role, content) VALUES (?, ?, (SELECT active_chat_id FROM sessions WHERE id = ?), ?, ?)',
      userMsgId,
      sessionId,
      sessionId,
      'user',
      `[${tool.name}] ${prompt}`
    );
  }

  const execution: CliToolExecution = {
    toolId: tool.id,
    toolName: tool.name,
    command: tool.command,
    prompt,
    output: '',
    exitCode: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
  };

  try {
    // Build full command with prompt as argument
    const fullCommand = `${tool.command} ${JSON.stringify(prompt)}`;

    const result = await new Promise<{ output: string; exitCode: number | null }>(
      (resolve, reject) => {
        // Use PTY for proper terminal emulation (required by tools like Codex)
        const proc = pty.spawn('bash', ['-c', fullCommand], {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd,
          env: buildRestrictedChildEnv({ TERM: 'xterm-256color', FORCE_COLOR: '1' }),
        });

        let output = '';

        proc.onData((data: string) => {
          output += data;
        });

        // Timeout handling
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${tool.timeoutSeconds} seconds`));
        }, tool.timeoutSeconds * 1000);

        proc.onExit(({ exitCode }) => {
          clearTimeout(timeout);
          // Strip ANSI escape codes for cleaner output
          const cleanOutput = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
          resolve({
            output: cleanOutput,
            exitCode,
          });
        });
      }
    );

    execution.output = result.output;
    execution.exitCode = result.exitCode;
    execution.completedAt = new Date().toISOString();
    execution.status = result.exitCode === 0 ? 'completed' : 'error';

    // Save assistant message if sessionId provided
    if (sessionId) {
      const assistantMsgId = nanoid();
      const statusEmoji = execution.status === 'completed' ? '✓' : '✗';
      await pgRun(
        'INSERT INTO messages (id, session_id, chat_id, role, content) VALUES (?, ?, (SELECT active_chat_id FROM sessions WHERE id = ?), ?, ?)',
        assistantMsgId,
        sessionId,
        sessionId,
        'assistant',
        `**${tool.name}** ${statusEmoji}\n\n\`\`\`\n${execution.output || 'No output'}\n\`\`\``
      );
    }

    res.json({ success: true, data: execution });
  } catch (error) {
    execution.output = error instanceof Error ? error.message : 'Unknown error';
    execution.completedAt = new Date().toISOString();
    execution.status =
      error instanceof Error && error.message.includes('timed out') ? 'timeout' : 'error';

    // Save error message if sessionId provided
    if (sessionId) {
      const errorMsgId = nanoid();
      const statusEmoji = execution.status === 'timeout' ? '⏱' : '✗';
      await pgRun(
        'INSERT INTO messages (id, session_id, chat_id, role, content) VALUES (?, ?, (SELECT active_chat_id FROM sessions WHERE id = ?), ?, ?)',
        errorMsgId,
        sessionId,
        sessionId,
        'assistant',
        `**${tool.name}** ${statusEmoji}\n\n\`\`\`\n${execution.output || 'Error'}\n\`\`\``
      );
    }

    res.json({ success: true, data: execution });
  }
});

export default router;
