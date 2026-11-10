import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveConfigHome } from './configPaths.js';

/**
 * The persistent memory of a project, shared by every provider.
 *
 * Claude Code keeps it in `~/.claude/projects/<slug>/memory/`: `MEMORY.md` is
 * the small index it loads into every session, the files it links hold the
 * details. Codex, Pi and Vibe never saw it, so a session that switched provider
 * started without what the earlier ones had learnt. Plum injects the same
 * index into their first turn and tells them where the files are.
 *
 * Following Anthropic's "components of agent memory": the injected layer stays
 * small (Claude Code's own limit: 200 lines / 25 KB), and the agent is told what
 * memory is for, not how to keep it.
 */
export const PROJECT_MEMORY_INDEX_MAX_LINES = 200;
export const PROJECT_MEMORY_INDEX_MAX_BYTES = 25_000;

/** Claude Code's project slug: every character outside [A-Za-z0-9] becomes '-'. */
export function claudeProjectSlug(workingDirectory: string): string {
  return path.resolve(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-');
}

export function projectMemoryDir(
  workingDirectory: string,
  configHome = resolveConfigHome()
): string {
  return path.join(configHome, 'projects', claudeProjectSlug(workingDirectory), 'memory');
}

/** The index as Claude Code loads it: the first 200 lines, at most 25 KB. */
export function truncateMemoryIndex(text: string): string {
  let index = text.split('\n').slice(0, PROJECT_MEMORY_INDEX_MAX_LINES).join('\n');
  if (Buffer.byteLength(index, 'utf8') > PROJECT_MEMORY_INDEX_MAX_BYTES) {
    index = Buffer.from(index, 'utf8').subarray(0, PROJECT_MEMORY_INDEX_MAX_BYTES).toString('utf8');
    index = index.slice(0, index.lastIndexOf('\n') > 0 ? index.lastIndexOf('\n') : index.length);
  }
  return index.trim();
}

/**
 * The context block for a non-Claude session, or null without a memory index.
 * The directory is named even when it is empty of notes, so the first session
 * of a project can start one.
 */
export async function buildProjectMemoryContext(
  workingDirectory: string,
  configHome = resolveConfigHome()
): Promise<string | null> {
  const dir = projectMemoryDir(workingDirectory, configHome);
  let index: string;
  try {
    index = truncateMemoryIndex(await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf8'));
  } catch {
    return null;
  }
  if (!index) return null;
  return [
    `<project-memory dir="${dir}">`,
    'Persistent memory of this project, shared with every Claude, Codex and Pi session that works here. ' +
      'MEMORY.md (below) is the index; the files it links hold the details, read one when it matters for the task. ' +
      'It exists so a later session does not have to rediscover what an earlier one learnt: when you learn something ' +
      'a future session would need, save it there as a note and add a one-line pointer to MEMORY.md. ' +
      'Notes can be outdated; check a claim against the code before you rely on it, and correct the note when it is wrong.',
    '',
    index,
    '</project-memory>',
  ].join('\n');
}
