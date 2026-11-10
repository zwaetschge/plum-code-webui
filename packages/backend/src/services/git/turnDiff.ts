import { run as pgRun } from '../../db/pg.js';
import { nanoid } from 'nanoid';
import { simpleGit } from 'simple-git';

/**
 * "What did the agent actually change in this turn?"
 *
 * A turn's start is marked with the current HEAD and a snapshot of the dirty
 * working tree (`git stash create`, which makes a dangling commit without
 * touching the tree or the stash list). When the turn ends, the diff is taken
 * against that snapshot, so pre-existing uncommitted work is excluded and the
 * record is the turn's own change. Sessions outside a git repo record nothing.
 *
 * Without the start mark the baseline was HEAD, so every record was the entire
 * uncommitted working-tree diff of the repo — which is how `turn_diffs` grew to
 * hundreds of megabytes. A turn with no mark is therefore not recorded.
 */

interface TurnMark {
  /** What the turn's diff is taken against: the start snapshot, or HEAD when the tree was clean. */
  base: string;
  /** Untracked files that already existed; only files created in the turn count as new. */
  untracked: Set<string>;
}

/**
 * `stash create` needs an author, so one is supplied for repos without a
 * configured identity. It can still fail (an unreadable path in the tree:
 * "lstat … Permission denied"); a dirty tree without a snapshot then gets no
 * mark at all. Falling back to HEAD there recorded the whole uncommitted tree
 * on every turn.
 */
const SNAPSHOT_IDENTITY = ['-c', 'user.name=Plum', '-c', 'user.email=plum@localhost'];

const marks = new Map<string, TurnMark>();

/** Rows kept per session; older ones are pruned after each capture. */
const MAX_ROWS_PER_SESSION = 100;
/** Stored diff cap; a huge refactor must not bloat the database. */
const MAX_STORED_DIFF_BYTES = 40_000;

export function markTurnStart(sessionId: string, workingDirectory: string): void {
  // A mark from an earlier turn must never serve this one.
  marks.delete(sessionId);
  void (async () => {
    try {
      const git = simpleGit(workingDirectory);
      if (!(await git.checkIsRepo())) return;
      const head = await git.revparse(['HEAD']).catch(() => null);
      if (!head) return;
      const status = await git.status();
      const untracked = new Set(status.not_added);
      const dirty = status.files.length > untracked.size;
      let base = head;
      if (dirty) {
        // A dangling commit of the dirty tree; touches neither tree nor stash list.
        const snapshot = (
          await git.raw([...SNAPSHOT_IDENTITY, 'stash', 'create']).catch(() => '')
        ).trim();
        // No snapshot of a dirty tree means no honest baseline: record nothing
        // for this turn rather than the whole working tree.
        if (!snapshot) return;
        base = snapshot;
      }
      marks.set(sessionId, { base, untracked });
    } catch {
      // Not a repo, or git unavailable — turn diffs are a bonus, not a contract.
    }
  })();
}

/** Drop a mark without recording (turn aborted, session stopped). */
export function clearTurnMark(sessionId: string): void {
  marks.delete(sessionId);
}

/**
 * Capture the diff produced by the finished turn, against the start snapshot.
 * A turn with no start mark records nothing rather than the whole repo.
 */
export async function captureTurnDiff(
  sessionId: string,
  userId: string,
  workingDirectory: string,
  turnId?: string | null
): Promise<void> {
  const mark = marks.get(sessionId);
  marks.delete(sessionId);
  if (!mark) return;

  try {
    const git = simpleGit(workingDirectory);
    if (!(await git.checkIsRepo())) return;

    const base = mark.base;
    const status = await git.status();
    const untracked = status.not_added.filter((file) => !mark.untracked.has(file));

    const changedNames = await git.diff([base, '--name-only']).catch(() => '');
    const filesChanged = changedNames.split('\n').filter(Boolean).length;
    const statDiff = await git.diff([base, '--stat']).catch(() => '');
    const fullDiff = await git.diff([base]).catch(() => '');

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
      summaryParts.join(' · '),
      (statDiff + '\n' + fullDiff).slice(0, MAX_STORED_DIFF_BYTES)
    );

    // Keep only the most recent rows for this session.
    await pgRun(
      `DELETE FROM turn_diffs WHERE session_id = ? AND id NOT IN (
         SELECT id FROM turn_diffs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
      sessionId,
      sessionId,
      MAX_ROWS_PER_SESSION
    ).catch(() => undefined);
  } catch (error) {
    console.error('[TurnDiff] capture failed:', error);
  }
}

/** Startup/periodic cleanup: drop records older than `maxAgeDays`. */
export async function pruneTurnDiffs(maxAgeDays = 30): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  await pgRun('DELETE FROM turn_diffs WHERE created_at < ?', cutoff).catch((error) =>
    console.warn('[TurnDiff] prune failed:', error)
  );
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}
