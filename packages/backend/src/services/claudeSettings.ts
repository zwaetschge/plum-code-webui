/**
 * Writes permission patterns into Claude's settings files:
 * - ~/.claude/settings.json           global user settings
 * - <project>/.claude/settings.local.json   project settings
 *
 * This is what stays of the former routes/claude-settings.ts. Its HTTP surface
 * (/global, /project/:sessionId, /add-pattern, /remove-pattern) had no caller in
 * either client, so the routes went; the approval flow in routes/permissions.ts
 * still needs to persist an "always allow" decision, which is this helper.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
}

async function readSettingsFile(filePath: string): Promise<ClaudeSettings> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    // Missing or malformed: start from empty rather than losing the write.
    return {};
  }
}

async function writeSettingsFile(filePath: string, settings: ClaudeSettings): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function getGlobalSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export function getProjectSettingsPath(projectPath: string): string {
  return path.join(projectPath, '.claude', 'settings.local.json');
}

export async function addPatternToSettings(
  pattern: string,
  scope: 'project' | 'global',
  projectPath?: string
): Promise<void> {
  let settingsPath: string;

  if (scope === 'global') {
    settingsPath = getGlobalSettingsPath();
  } else {
    if (!projectPath) {
      throw new Error('Project path is required for project scope');
    }
    settingsPath = getProjectSettingsPath(projectPath);
  }

  const settings = await readSettingsFile(settingsPath);

  settings.permissions ??= {};
  settings.permissions.allow ??= [];

  if (!settings.permissions.allow.includes(pattern)) {
    settings.permissions.allow.push(pattern);
    await writeSettingsFile(settingsPath, settings);
    console.log(`[CLAUDE-SETTINGS] Added allow pattern "${pattern}" to ${scope} settings`);
  }
}
