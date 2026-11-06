import fs from 'fs';
import path from 'path';
import { getDataDirectory } from '../../db/index.js';
import { writeFileAtomicSync } from '../../utils/atomicWrite.js';

/**
 * Pi runs that were still going when they were last written down.
 *
 * A Pi run lives in one child process. When that process dies, or the whole
 * backend restarts (a rebuild, a crash), the run is gone and an overnight task
 * simply stopped. The journal is what survives: Plum writes a record when a
 * run starts, keeps the running tool and the queued messages current, and
 * deletes it when the run settles or the user stops it. A record still present
 * after a process exit or at boot is a run to resume.
 *
 * A JSON file in the data directory rather than a table: it is tiny, written
 * from hot paths and must be readable before anything else has started.
 */
export interface PiRunRecord {
  sessionId: string;
  userId: string;
  chatId: string | null;
  startedAt: string;
  lastActivityAt: string;
  /** Tool running when the record was last written. */
  tool: { name: string; input: string } | null;
  /** Messages waiting in Plum's queue; sent again after the resume. */
  queued: Array<{ message: string; chatId: string | null; attachments?: unknown[] }>;
  /** Automatic resumes of this run (ISO times), bounded per window. */
  resumes: string[];
}

let journalPathOverride: string | null = null;

/** Tests point the journal at a temporary file. */
export function setPiRunJournalPath(filePath: string | null): void {
  journalPathOverride = filePath;
}

function journalPath(): string {
  return journalPathOverride ?? path.join(getDataDirectory(), 'pi-active-runs.json');
}

export function readPiRuns(): Record<string, PiRunRecord> {
  try {
    const parsed = JSON.parse(fs.readFileSync(journalPath(), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, PiRunRecord>)
      : {};
  } catch {
    return {};
  }
}

function writePiRuns(runs: Record<string, PiRunRecord>): void {
  try {
    writeFileAtomicSync(journalPath(), `${JSON.stringify(runs, null, 2)}\n`);
  } catch (error) {
    console.warn('[PI] Run journal could not be written:', error);
  }
}

export function getPiRun(sessionId: string): PiRunRecord | null {
  return readPiRuns()[sessionId] ?? null;
}

export function putPiRun(record: PiRunRecord): void {
  const runs = readPiRuns();
  runs[record.sessionId] = record;
  writePiRuns(runs);
}

/** Changes an existing record; a run that is not journalled stays that way. */
export function patchPiRun(
  sessionId: string,
  patch: Partial<Omit<PiRunRecord, 'sessionId'>>
): void {
  const runs = readPiRuns();
  const current = runs[sessionId];
  if (!current) return;
  runs[sessionId] = { ...current, ...patch, lastActivityAt: new Date().toISOString() };
  writePiRuns(runs);
}

export function clearPiRun(sessionId: string): void {
  const runs = readPiRuns();
  if (!runs[sessionId]) return;
  delete runs[sessionId];
  writePiRuns(runs);
}

/** Resumes allowed per run within {@link PI_RESUME_WINDOW_MS}. */
export const PI_MAX_AUTO_RESUMES = 2;
export const PI_RESUME_WINDOW_MS = 60 * 60 * 1000;
/** Runs older than this at boot are not resumed any more. */
export const PI_RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Resumes still counting against the bound, oldest first. */
export function recentPiResumes(record: PiRunRecord, now = Date.now()): string[] {
  return record.resumes.filter((at) => now - Date.parse(at) < PI_RESUME_WINDOW_MS);
}

/** The prompt that picks an interrupted run back up. */
export function piResumePrompt(record: PiRunRecord, reason: 'crash' | 'restart'): string {
  const cause =
    reason === 'restart'
      ? 'Plum restarted while you were working, which stopped your process.'
      : 'Your process stopped unexpectedly while you were working.';
  const tool = record.tool
    ? ` It was running the tool \`${record.tool.name}\`${
        record.tool.input ? ` (${record.tool.input})` : ''
      }; that call may not have finished and its result is lost.`
    : '';
  return (
    `${cause}${tool} Check the current state first (files, running processes, ` +
    'the effect of the last tool), then continue the task from where it stopped. ' +
    'Do not repeat work that is already done. If the task is already complete, say so briefly.'
  );
}
