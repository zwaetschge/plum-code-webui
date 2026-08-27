import { get as pgGet, all as pgAll, run as pgRun } from '../db/pg.js';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { redactSensitiveText } from '../utils/sanitize.js';
import type { McpServer, McpServerType } from '@plum-code-webui/shared';
import { buildRestrictedChildEnv } from '../utils/childProcessEnv.js';

const router = Router();
const CLAUDE_SETTINGS_MCP_ID_PREFIX = 'claude-settings:';

interface ClaudeMcpServer {
  type?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: unknown;
  url?: string;
  env?: unknown;
  headers?: unknown;
  disabled?: boolean;
}

interface ClaudeSettings {
  mcpServers?: Record<string, ClaudeMcpServer>;
}

const createMcpServerSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['subprocess', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const updateMcpServerSchema = createMcpServerSchema.partial();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function getClaudeSettingsMcpId(name: string): string {
  return `${CLAUDE_SETTINGS_MCP_ID_PREFIX}${Buffer.from(name, 'utf8').toString('base64url')}`;
}

function decodeClaudeSettingsMcpId(id: string): string | null {
  if (!id.startsWith(CLAUDE_SETTINGS_MCP_ID_PREFIX)) return null;
  const encoded = id.slice(CLAUDE_SETTINGS_MCP_ID_PREFIX.length);
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function readClaudeSettingsMcpServers(): {
  servers: Record<string, ClaudeMcpServer>;
  mtimeIso: string;
} {
  const settingsPath = getClaudeSettingsPath();
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as ClaudeSettings;
    const stat = fs.statSync(settingsPath);
    return {
      servers:
        parsed && isRecord(parsed.mcpServers)
          ? (parsed.mcpServers as Record<string, ClaudeMcpServer>)
          : {},
      mtimeIso: stat.mtime.toISOString(),
    };
  } catch {
    return { servers: {}, mtimeIso: new Date(0).toISOString() };
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

function parseClaudeSettingsMcpServer(
  name: string,
  server: ClaudeMcpServer,
  userId: string,
  createdAt: string,
  includeEnv = false
): McpServer | null {
  const env = stringRecord(server.env);
  const common = {
    id: getClaudeSettingsMcpId(name),
    userId,
    name,
    enabled: server.disabled !== true,
    createdAt,
    source: 'claude-settings' as const,
    readOnly: true,
    env: includeEnv ? env : {},
    envKeys: Object.keys(env).sort(),
  };

  if (typeof server.command === 'string' && server.command.trim().length > 0) {
    return {
      ...common,
      type: 'subprocess',
      command: server.command,
      args: stringArray(server.args),
      url: null,
    };
  }

  if (typeof server.url === 'string' && server.url.trim().length > 0) {
    return {
      ...common,
      type: 'sse',
      command: null,
      args: [],
      url: server.url,
    };
  }

  return null;
}

// Helper to parse MCP server from DB
function parseMcpServer(row: Record<string, unknown>): McpServer {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    type: row.type as McpServerType,
    command: row.command as string | null,
    args: row.args ? JSON.parse(row.args as string) : [],
    url: row.url as string | null,
    env: row.env ? JSON.parse(row.env as string) : {},
    enabled: Boolean(row.enabled),
    createdAt: row.created_at as string,
    source: 'database',
  };
}

async function getDatabaseMcpServers(userId: string): Promise<McpServer[]> {
  const rows = (await pgAll(
    `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE user_id = ? ORDER BY name`,
    userId
  )) as unknown as Record<string, unknown>[];

  return rows.map(parseMcpServer);
}

async function getMcpServerForRequest(serverId: string, userId: string): Promise<McpServer | null> {
  const claudeSettingsName = decodeClaudeSettingsMcpId(serverId);
  if (claudeSettingsName) {
    const { servers, mtimeIso } = readClaudeSettingsMcpServers();
    const server = servers[claudeSettingsName];
    if (!server) return null;
    return parseClaudeSettingsMcpServer(claudeSettingsName, server, userId, mtimeIso, true);
  }

  const row = (await pgGet(
    `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ? AND user_id = ?`,
    serverId,
    userId
  )) as unknown as Record<string, unknown> | undefined;

  return row ? parseMcpServer(row) : null;
}

// List MCP servers
router.get('/', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const dbServers = await getDatabaseMcpServers(userId);
  const { servers: claudeSettingsServers, mtimeIso } = readClaudeSettingsMcpServers();
  const globalServers = Object.entries(claudeSettingsServers)
    .map(([name, server]) => parseClaudeSettingsMcpServer(name, server, userId, mtimeIso))
    .filter((server): server is McpServer => !!server);

  const globalNames = new Set(globalServers.map((server) => server.name));
  const servers = [
    ...globalServers,
    ...dbServers.filter((server) => !globalNames.has(server.name)),
  ].sort((a, b) => a.name.localeCompare(b.name));

  res.json({ success: true, data: servers });
});

// Get MCP server by ID
router.get('/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const serverId = req.params.id;
  if (!serverId) {
    throw new AppError('Missing MCP server ID', 400, 'MISSING_ID');
  }
  const server = await getMcpServerForRequest(serverId, userId);

  if (!server) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  const responseServer = server.readOnly ? { ...server, env: {} } : server;
  res.json({ success: true, data: responseServer });
});

// Create MCP server
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createMcpServerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { name, type, command, args, url, env, enabled } = parsed.data;

  // Validate type-specific fields
  if (type === 'subprocess' && !command) {
    throw new AppError('Command is required for subprocess type', 400, 'MISSING_COMMAND');
  }
  if (type === 'sse' && !url) {
    throw new AppError('URL is required for SSE type', 400, 'MISSING_URL');
  }

  const serverId = nanoid();

  await pgRun(
    `INSERT INTO mcp_servers (id, user_id, name, type, command, args, url, env, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    serverId,
    userId,
    name,
    type,
    command || null,
    args ? JSON.stringify(args) : null,
    url || null,
    env ? JSON.stringify(env) : null,
    enabled !== false ? 1 : 0
  );

  const row = (await pgGet(
    `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ?`,
    serverId
  )) as unknown as Record<string, unknown>;

  res.status(201).json({ success: true, data: parseMcpServer(row) });
});

// Update MCP server
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateMcpServerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const existing = await pgGet(
    'SELECT id FROM mcp_servers WHERE id = ? AND user_id = ?',
    req.params.id,
    userId
  );

  if (!existing) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  const { name, type, command, args, url, env, enabled } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (type !== undefined) {
    updates.push('type = ?');
    values.push(type);
  }
  if (command !== undefined) {
    updates.push('command = ?');
    values.push(command);
  }
  if (args !== undefined) {
    updates.push('args = ?');
    values.push(JSON.stringify(args));
  }
  if (url !== undefined) {
    updates.push('url = ?');
    values.push(url);
  }
  if (env !== undefined) {
    updates.push('env = ?');
    values.push(JSON.stringify(env));
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    await pgRun(`UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`, ...values);
  }

  const row = (await pgGet(
    `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ?`,
    req.params.id
  )) as unknown as Record<string, unknown>;

  res.json({ success: true, data: parseMcpServer(row) });
});

// Delete MCP server
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const serverId = req.params.id;
  if (!serverId) {
    throw new AppError('Missing MCP server ID', 400, 'MISSING_ID');
  }
  if (decodeClaudeSettingsMcpId(serverId)) {
    throw new AppError(
      'MCP server is managed in ~/.claude/settings.json',
      403,
      'READ_ONLY_MCP_SERVER'
    );
  }

  const result = await pgRun(
    'DELETE FROM mcp_servers WHERE id = ? AND user_id = ?',
    serverId,
    userId
  );

  if (result.changes === 0) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true });
});

// Test MCP server connection
router.post('/:id/test', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const serverId = req.params.id;
  if (!serverId) {
    throw new AppError('Missing MCP server ID', 400, 'MISSING_ID');
  }
  const server = await getMcpServerForRequest(serverId, userId);

  if (!server) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  try {
    if (server.type === 'subprocess') {
      // Test subprocess by trying to spawn and checking if it starts
      const result = await testSubprocessMcp(server.command!, server.args || [], server.env);
      res.json({ success: true, data: result });
    } else if (server.type === 'sse') {
      // Test SSE by trying to connect to the URL
      const result = await testSseMcp(server.url!);
      res.json({ success: true, data: result });
    } else {
      throw new AppError('Unknown server type', 400, 'UNKNOWN_TYPE');
    }
  } catch (error) {
    res.json({
      success: true,
      data: {
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
});

// Helper to test subprocess MCP server
async function testSubprocessMcp(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): Promise<{ connected: boolean; error?: string; output?: string }> {
  return new Promise((resolve) => {
    // Parse command - might be "npx something" or just "something"
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    if (!cmd) {
      resolve({ connected: false, error: 'Invalid command' });
      return;
    }
    const cmdArgs = [...parts.slice(1), ...args];

    const proc = spawn(cmd, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildRestrictedChildEnv(env),
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ connected: false, error: 'Connection timeout (5s)' });
    }, 5000);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      // If we get any output, the server started successfully
      clearTimeout(timeout);
      proc.kill();
      resolve({ connected: true, output: redactSensitiveText(stdout).substring(0, 200) });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timeout);
      resolve({ connected: false, error: redactSensitiveText(`Failed to start: ${err.message}`) });
    });

    proc.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0 && !stdout) {
        resolve({
          connected: false,
          error: redactSensitiveText(stderr || `Process exited with code ${code}`),
        });
      }
    });

    // Send a basic MCP initialize request to check if it responds
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    proc.stdin?.write(initRequest + '\n');
  });
}

// Helper to test SSE MCP server
async function testSseMcp(
  url: string
): Promise<{ connected: boolean; error?: string; status?: number }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return { connected: true, status: response.status };
    } else {
      return {
        connected: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { connected: false, error: 'Connection timeout (5s)' };
    }
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default router;
