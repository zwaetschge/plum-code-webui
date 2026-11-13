/**
 * Plum sessions finding and messaging each other, whether they run or not.
 *
 * Claude Code's own cross-session messaging only sees sessions whose CLI process
 * is alive: a Task session could not reach a Code session that had gone idle a
 * minute earlier (2026-11-13, "task und code sessions können sich gegenseitig
 * nicht sehen"). Plum knows every session of the account and can wake a stopped
 * one by sending it a message, which is what these tools do. Messages travel as
 * session-mesh delegations, so they show up in the WebUI's peer panel as well.
 */

import { all as pgAll } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface DirectoryEntry {
  id: string;
  name: string;
  area: string;
  provider: string | null;
  running: boolean;
  busy: boolean;
  workingDirectory: string | null;
  updatedAt: string | null;
  self: boolean;
}

interface Runtime {
  isSessionRunning(sessionId: string): boolean;
  getSessionRuntimeSnapshot(sessionId: string): { busy: boolean };
}

/** The account's sessions, most recently active first. */
export async function listSessionDirectory(
  userId: string,
  callerSessionId: string,
  runtime: Runtime,
  options: { query?: string; limit?: number } = {}
): Promise<DirectoryEntry[]> {
  const rows = (await pgAll(
    `SELECT id, name, COALESCE(surface, 'code') AS surface, cli_provider, working_directory, updated_at
       FROM sessions
      WHERE user_id = ? AND COALESCE(archived, 0) = 0
      ORDER BY updated_at DESC`,
    userId
  )) as unknown as Array<{
    id: string;
    name: string;
    surface: string;
    cli_provider: string | null;
    working_directory: string | null;
    updated_at: string | null;
  }>;
  const query = options.query?.trim().toLowerCase();
  return rows
    .filter((row) => !query || row.name.toLowerCase().includes(query) || row.id === options.query)
    .slice(0, options.limit ?? 60)
    .map((row) => {
      const running = runtime.isSessionRunning(row.id);
      return {
        id: row.id,
        name: row.name,
        area: row.surface,
        provider: row.cli_provider,
        running,
        busy: running && runtime.getSessionRuntimeSnapshot(row.id).busy,
        workingDirectory: row.working_directory,
        updatedAt: row.updated_at,
        self: row.id === callerSessionId,
      };
    });
}

/**
 * Which session `to` means: its id, its name (case-insensitive), or a part of
 * the name that matches exactly one session. Ambiguity is an error that lists
 * the candidates, never a guess.
 */
export function resolveSessionTarget(
  sessions: Array<{ id: string; name: string }>,
  to: string,
  callerSessionId: string
): { id: string; name: string } {
  const wanted = to.trim();
  const lower = wanted.toLowerCase();
  const others = sessions.filter((session) => session.id !== callerSessionId);
  const exact =
    others.find((session) => session.id === wanted) ??
    (others.filter((session) => session.name.toLowerCase() === lower).length === 1
      ? others.find((session) => session.name.toLowerCase() === lower)
      : undefined);
  if (exact) return exact;
  if (sessions.some((session) => session.id === callerSessionId && session.id === wanted)) {
    throw new AppError('Eine Session kann sich nicht selbst schreiben.', 400, 'SELF_MESSAGE');
  }
  const partial = others.filter((session) => session.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0]!;
  const named = others.filter((session) => session.name.toLowerCase() === lower);
  const candidates = (named.length > 1 ? named : partial).slice(0, 10);
  if (candidates.length > 1) {
    throw new AppError(
      `"${wanted}" passt auf mehrere Sessions: ${candidates
        .map((session) => `${session.name} (${session.id})`)
        .join(', ')}. Gib die id an.`,
      400,
      'AMBIGUOUS_SESSION'
    );
  }
  throw new AppError(
    `Keine Session "${wanted}" gefunden. plum_list_sessions zeigt alle.`,
    404,
    'SESSION_NOT_FOUND'
  );
}
