import { run as pgRun } from '../../db/pg.js';
import { nanoid } from 'nanoid';
import { simpleGit } from 'simple-git';

/**
 * "What did the agent actually change in this turn?"
 *
 * A turn's start is marked by recording HEAD plus the dirty working tree; when
 * the turn ends the diff against that mark becomes one durable record. Sessions
 * outside a git repo simply record nothing — no error, no noise.
 */

interface TurnMark {
  head: string | null;
  stashedDirty: boolean;
}

const marks = new Map<string, TurnMark>();

export function markTurnStart(sessionId: string, workingDirectory: string): void {
  void (async () => {
    try {
      const git = simpleGit(workingDirectory);
      if (!(await git.checkIsRepo())) return;
      const head = await git.revparse(['HEAD']).catch(() => null);
      marks.set(sessionId, { head, stashedDirty: false });
    } catch {
      // Not a repo, or git unavailable — turn diffs are a bonus, not a contract.
    }
  })();
}

/**
 * Capture the diff produced by the finished turn. Compares against the recorded
 * HEAD when the agent committed, otherwise against the current HEAD, which
 * yields the uncommitted work — the common case for an agent turn.
 */
export async function captureTurnDiff(
  sessionId: string,
  userId: string,
  workingDirectory: string,
  turnId?: string | null
): Promise<void> {
  try {
    const git = simpleGit(workingDirectory);
    if (!(await git.checkIsRepo())) return;

    const mark = marks.get(sessionId);
    marks.delete(sessionId);

    const base = mark?.head ?? 'HEAD';
    // Include untracked files: an agent that creates a new file would otherwise
    // show up as "no changes".
    const status = await git.status();
    const untracked = status.not_added;

    const diff = await git.diff([base, '--stat']).catch(() => '');
    const fullDiff = await git.diff([base]).catch(() => '');

    const filesChanged = status.files.length + 0;
    const insertions = countMatches(fullDiff, /^\+(?!\+\+)/gm);
    const deletions = countMatches(fullDiff, /^-(?!--)/gm);

    if (filesChanged === 0 && untracked.length === 0 && !fullDiff.trim()) return;

    const summaryParts = [
      `${filesChanged} file${filesChanged === 1 ? '' : 's'} changed`,
      insertions ? `+${insertions}` : null,
      deletions ? `-${deletions}` : null,
      untracked.length ? `${untracked.length} new` : null,
    ].filter(Boolean);

    await pgRun(
      `INSERT INTO turn_diffs
           (id, session_id, user_id, turn_id, files_changed, insertions, deletions, summary, diff)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nanoid(),
      sessionId,
      userId,
      turnId ?? null,
      filesChanged,
      insertions,
      deletions,
      summaryParts.join(' · '), // Cap the stored diff: a huge refactor should not bloat the database.
      (diff + '\n' + fullDiff).slice(0, 200_000)
    );
  } catch (error) {
    console.error('[TurnDiff] capture failed:', error);
  }
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}
