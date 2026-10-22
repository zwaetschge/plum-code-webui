import fsSync from 'fs';
import { all, run } from '../../db/pg.js';
import { resolveConfigHome } from '../../utils/configPaths.js';
import {
  carryClaudeTranscripts,
  findRelocatedDirectory,
  rebasePath,
} from '../../utils/projectRelocation.js';

/**
 * Moves every session of `userId` whose working directory is `from` (or lies
 * inside it) to the folder's new location, including allowed directories, and
 * keeps Claude Code transcripts reachable. Returns null when the folder could
 * not be found unambiguously.
 */
export async function relocateSessionDirectories(
  userId: string,
  from: string,
  roots?: Parameters<typeof findRelocatedDirectory>[1]
) {
  const found = await findRelocatedDirectory(from, roots);
  if (!found) return null;
  const to = found.path;
  const rows = (await all(
    "SELECT id, working_directory, allowed_directories FROM sessions WHERE user_id = ? AND (working_directory = ? OR working_directory LIKE ? ESCAPE '\\')",
    userId,
    from,
    from.replace(/[\\%_]/g, (c) => '\\' + c) + '/%'
  )) as { id: string; working_directory: string; allowed_directories: string | null }[];
  for (const row of rows) {
    let allowed: string[] = [];
    try {
      allowed = JSON.parse(row.allowed_directories || '[]');
    } catch {
      /* Malformed legacy lists are replaced by an empty one. */
    }
    await run(
      'UPDATE sessions SET working_directory = ?, allowed_directories = ? WHERE id = ? AND user_id = ?',
      rebasePath(row.working_directory, from, to),
      JSON.stringify(allowed.map((dir) => rebasePath(dir, from, to))),
      row.id,
      userId
    );
  }
  await carryClaudeTranscripts(resolveConfigHome(), from, to);
  console.log(
    `[SESSION] Project folder moved (${found.reason}): ${from} -> ${to}; ${rows.length} session(s) updated`
  );
  return { from, to, sessions: rows.length };
}

/**
 * Background check: sessions pointing at a missing folder are moved to its
 * new location before anyone opens them. One lookup per distinct folder.
 */
export async function relocateMissingSessionDirectories() {
  const rows = (await all(
    'SELECT DISTINCT user_id, working_directory FROM sessions WHERE COALESCE(archived, 0) = 0'
  )) as { user_id: string; working_directory: string }[];
  let moved = 0;
  for (const row of rows) {
    if (!row.working_directory || fsSync.existsSync(row.working_directory)) continue;
    const result = await relocateSessionDirectories(row.user_id, row.working_directory).catch(
      () => null
    );
    if (result) moved += result.sessions;
  }
  return moved;
}
