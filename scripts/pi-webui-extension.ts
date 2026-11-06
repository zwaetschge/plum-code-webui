import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

function suggestedPattern(toolName: string): string {
  return `${toolName}(:*)`;
}

function readAllowedPatterns(filePath: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      permissions?: { allow?: unknown };
    };
    return Array.isArray(parsed.permissions?.allow)
      ? parsed.permissions.allow.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function isPersistentlyAllowed(toolName: string): boolean {
  const configHome = process.env.WEBUI_CONFIG_HOME || path.join(os.homedir(), '.claude');
  const project = process.env.WEBUI_PROJECT_PATH;
  const patterns = readAllowedPatterns(path.join(configHome, 'settings.json'));
  if (project) {
    patterns.push(...readAllowedPatterns(path.join(project, '.claude', 'settings.local.json')));
  }
  const normalized = toolName.toLowerCase();
  return patterns.some((pattern) => {
    const value = pattern.trim().toLowerCase();
    return value === normalized || value === `${normalized}(:*)`;
  });
}

async function requestApproval(toolName: string, input: unknown): Promise<boolean> {
  const backend = (process.env.WEBUI_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
  const secret = process.env.WEBUI_HOOK_SECRET || '';
  const sessionId = process.env.WEBUI_SESSION_ID || '';
  if (!secret || !sessionId) return false;

  const requestId = randomUUID();
  // The permissions routes check that the caller is the session it asks for;
  // without this header every request got 403 and ask mode denied every tool.
  const headers = {
    'content-type': 'application/json',
    'x-webui-hook-secret': secret,
    'x-webui-session-id': sessionId,
  };
  const created = await fetch(`${backend}/api/permissions/request`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId,
      requestId,
      toolName,
      toolInput: input,
      description: `Pi requests ${toolName}`,
      suggestedPattern: suggestedPattern(toolName),
    }),
  });
  if (!created.ok) return false;

  const response = await fetch(`${backend}/api/permissions/response/${requestId}`, { headers });
  if (!response.ok) return false;
  const result = (await response.json()) as { approved?: boolean };
  return result.approved === true;
}

export default function webuiPermissions(pi: ExtensionAPI) {
  pi.on('tool_call', async (event) => {
    const toolName = event.toolName || 'unknown';
    const mode = (process.env.WEBUI_SESSION_MODE || 'auto-accept').toLowerCase();

    if (mode === 'danger' || mode === 'auto-accept') return;
    if (mode === 'planning') {
      if (READ_ONLY_TOOLS.has(toolName.toLowerCase())) return;
      return { block: true, reason: `Plan mode blocks the ${toolName} tool.` };
    }
    if (isPersistentlyAllowed(toolName)) return;

    try {
      const approved = await requestApproval(toolName, event.input);
      if (!approved) return { block: true, reason: `Permission denied for ${toolName}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { block: true, reason: `Permission request failed: ${message}` };
    }
  });
}
