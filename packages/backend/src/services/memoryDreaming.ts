/**
 * Dreaming: an offline pass that keeps a project's memory trustworthy.
 *
 * Sessions write memory notes in the moment, judging salience without knowing
 * the future, and later sessions trust them without rechecking. Anthropic's
 * "components of agent memory" found the expensive failure there: a wrong note
 * ("Mt Moon DONE") sent the agent in circles until a pass that checked the note
 * against the transcript fixed it. memoryOptimizer only archives and shortens;
 * nothing ever checked a note against what actually happened.
 *
 * Once a night, for every project that had sessions that day, an agent gets
 * the memory directory, the project, and the recent transcripts of every
 * provider exported from Plum's database. The agent is Pi on the local Strata
 * model (`MEMORY_DREAMING_MODEL`, default strata-local/qwen3.8-flash-next,
 * 262k context), so the nightly pass costs nothing; when Strata is down the
 * night is skipped. A paid fallback (the admin LLM, Claude Sonnet) runs only
 * with MEMORY_DREAMING_FALLBACK=admin. It corrects
 * notes the transcripts or the code contradict, adds what a future session
 * would need and the notes miss, merges duplicates, keeps MEMORY.md a short
 * index and records what it changed in `dream-log.md`. It is told what memory
 * is for, not how to keep it; the article found purpose beats fixed rules.
 *
 * The memory directory is backed up before every pass and restored when the
 * index comes back missing or gutted. Disable with MEMORY_DREAMING_ENABLED=false.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { all } from '../db/pg.js';
import { getDataDirectory } from '../db/index.js';
import { runAdminLLM } from '../utils/adminLLM.js';
import { buildModelProviderCredentialEnv } from '../utils/modelProviderKeys.js';
import { getPiModelsForUser, syncPiConfig } from '../utils/piConfig.js';
import { claudeProjectSlug, projectMemoryDir } from '../utils/projectMemory.js';
import { releaseMemoryWorkdir, tryLockMemoryWorkdir } from './memoryOptimizer.js';
import { writeFileAtomicSync } from '../utils/atomicWrite.js';

const TRANSCRIPT_DAYS = 3;
const TRANSCRIPT_CAP_BYTES = 600_000;
const MESSAGE_CAP_CHARS = 6_000;
// A local model reads more slowly than a hosted one.
const DREAM_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_DREAM_MODEL = 'strata-local/qwen3.8-flash-next';
const MIN_HOURS_BETWEEN_DREAMS = 20;
// Strata is free but slow (~10 min per 50 KB of transcripts), so the night is long.
const MAX_DREAMS_PER_NIGHT = 6;
/** Local night window (Europe/Zurich) in which scheduled passes run. */
const NIGHT_START_HOUR = 2;
const NIGHT_END_HOUR = 7;
const TICK_MS = 20 * 60 * 1000;

interface DreamState {
  lastDreamByWorkdir: Record<string, string>;
}

export interface DreamResult {
  workdir: string;
  status: 'done' | 'skipped' | 'restored' | 'failed';
  detail: string;
}

let dreaming = false;

/** Plum stores timestamps as text `YYYY-MM-DD HH:MM:SS` (UTC); compare in that form. */
function dbTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function dreamDir(): string {
  return path.join(getDataDirectory(), 'memory-dreaming');
}

async function loadState(): Promise<DreamState> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dreamDir(), 'state.json'), 'utf8'));
    return { lastDreamByWorkdir: parsed?.lastDreamByWorkdir ?? {} };
  } catch {
    return { lastDreamByWorkdir: {} };
  }
}

async function saveState(state: DreamState): Promise<void> {
  await fs.mkdir(dreamDir(), { recursive: true });
  writeFileAtomicSync(path.join(dreamDir(), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * The recent conversation of every session in `workdir`, all providers, as one
 * markdown file: the searchable event log the pass checks notes against.
 * Newest sessions win when the cap is reached.
 */
export async function exportProjectTranscripts(
  workdir: string,
  outFile: string,
  days = TRANSCRIPT_DAYS
): Promise<{ sessions: number; messages: number; bytes: number }> {
  const since = dbTimestamp(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = (await all(
    `SELECT s.id AS session_id, s.name, s.cli_provider, m.role, m.content, m.created_at
       FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE s.working_directory = ? AND m.created_at >= ? AND m.role IN ('user', 'assistant')
      ORDER BY s.updated_at DESC, m.created_at ASC`,
    workdir,
    since
  )) as Array<{
    session_id: string;
    name: string | null;
    cli_provider: string | null;
    role: string;
    content: string | null;
    created_at: string | Date;
  }>;
  const blocks: string[] = [];
  let bytes = 0;
  let current = '';
  let sessions = 0;
  let messages = 0;
  for (const row of rows) {
    const text = (row.content ?? '').trim();
    if (!text) continue;
    if (row.session_id !== current) {
      current = row.session_id;
      const header = `\n\n# Session "${row.name ?? row.session_id}" (${row.cli_provider ?? 'unknown'}, id ${row.session_id})\n`;
      if (bytes + header.length > TRANSCRIPT_CAP_BYTES) break;
      blocks.push(header);
      bytes += header.length;
      sessions += 1;
    }
    const at = String(row.created_at).replace('T', ' ').slice(0, 16);
    const body =
      text.length > MESSAGE_CAP_CHARS ? `${text.slice(0, MESSAGE_CAP_CHARS)} […gekürzt]` : text;
    const entry = `\n## ${row.role} ${at}\n${body}\n`;
    if (bytes + entry.length > TRANSCRIPT_CAP_BYTES) break;
    blocks.push(entry);
    bytes += entry.length;
    messages += 1;
  }
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `# Transcripts of ${workdir}, last ${days} days${blocks.join('')}\n`);
  return { sessions, messages, bytes };
}

export function dreamPrompt(opts: {
  memoryDir: string;
  workdir: string;
  transcriptFile: string;
  today: string;
}): string {
  return [
    `You are doing the offline "dreaming" pass over the persistent memory of the project ${opts.workdir}.`,
    '',
    `Memory: ${opts.memoryDir}. MEMORY.md is the index every Claude, Codex and Pi session in this project loads at start; the files it links hold the details.`,
    `Transcripts of the last ${TRANSCRIPT_DAYS} days, all providers: ${opts.transcriptFile}.`,
    `Project code: ${opts.workdir}.`,
    'The transcript file is long: read it in parts, newest sessions first, and search it for the topics of the notes.',
    '',
    'What the memory is for: a later session should start with what earlier sessions learnt and be able to trust it without rechecking. ' +
      'A wrong note is worse than a missing one, because sessions act on it. ' +
      'The index is loaded every time, so it must stay short; detail belongs in the linked files.',
    '',
    'Make the memory trustworthy and useful:',
    '- Check notes against the transcripts and the current code. Correct what is wrong or outdated (a file, flag, command or status that no longer holds); say in the note what changed.',
    '- Add what the transcripts show a future session would need and the notes do not have: decisions, verified facts, pitfalls, open work.',
    '- Merge duplicates, link related notes, and keep MEMORY.md a compact index (well under 200 lines) that points to the files.',
    "- Notes about the user's preferences and feedback stay unless the transcripts show the user changed their mind.",
    '',
    `Edit only files inside ${opts.memoryDir}; read anything else you need. Keep the language and format the notes already use.`,
    `Finally put an entry at the top of ${path.join(opts.memoryDir, 'dream-log.md')}: "## ${opts.today}", then what you changed and the evidence (transcript session and time, or file path). Write "nothing to change" when that is the result.`,
  ].join('\n');
}

async function snapshotMemory(memoryDir: string, backupDir: string): Promise<void> {
  await fs.mkdir(path.dirname(backupDir), { recursive: true });
  await fs.cp(memoryDir, backupDir, { recursive: true });
}

async function restoreMemory(memoryDir: string, backupDir: string): Promise<void> {
  // Copy the snapshot back over the directory rather than wiping it first, so a
  // note a live session wrote during the pass is not lost. Files the dreaming
  // pass added stay; the point is only to undo a gutted index and lost notes.
  await fs.cp(backupDir, memoryDir, { recursive: true, force: true });
}

async function readIndex(memoryDir: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(memoryDir, 'MEMORY.md'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Pi, headless, on the dreaming model: file tools in the memory directory, the
 * owner's provider keys, no session file. Resolves with Pi's final answer.
 */
async function runPiDream(
  prompt: string,
  cwd: string,
  userId: string,
  model: string
): Promise<string> {
  const { agentDir } = await syncPiConfig(userId);
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_TELEMETRY: '0',
    PI_SKIP_VERSION_CHECK: '1',
    PI_ULTRACODE: '0',
    WEBUI_SESSION_MODE: 'auto-accept',
    ...(await buildModelProviderCredentialEnv(userId, { pi: true })),
  };
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('pi', ['-p', '--no-session', '--model', model, prompt], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`pi timed out after ${DREAM_TIMEOUT_MS} ms`));
    }, DREAM_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk.toString()).slice(-4000)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `pi exited with code ${code}`));
    });
  });
}

/**
 * The agent for one pass: Pi on the dreaming model when the owner has it, the
 * paid admin LLM only when explicitly allowed. Null means "skip tonight".
 */
async function chooseDreamer(
  userId: string | null
): Promise<{ kind: 'pi'; model: string; userId: string } | { kind: 'admin' } | null> {
  const model = process.env.MEMORY_DREAMING_MODEL || DEFAULT_DREAM_MODEL;
  const available = userId ? await getPiModelsForUser(userId).catch((): string[] => []) : [];
  if (userId && available.includes(model)) {
    return { kind: 'pi', model, userId };
  }
  return process.env.MEMORY_DREAMING_FALLBACK === 'admin' ? { kind: 'admin' } : null;
}

/** One dreaming pass over one project; never throws. */
export async function dreamProject(
  workdir: string,
  userId: string | null = null
): Promise<DreamResult> {
  const memoryDir = projectMemoryDir(workdir);
  const before = await readIndex(memoryDir);
  if (!before?.trim()) return { workdir, status: 'skipped', detail: 'no MEMORY.md' };
  if (!tryLockMemoryWorkdir(workdir)) {
    return { workdir, status: 'skipped', detail: 'memory busy (optimizer or dreaming)' };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scratch = path.join(dreamDir(), claudeProjectSlug(workdir));
  const transcriptFile = path.join(scratch, 'transcripts.md');
  const backupDir = path.join(scratch, 'backups', stamp);
  try {
    const dreamer = await chooseDreamer(userId ?? (await projectOwner(workdir)));
    if (!dreamer) {
      return { workdir, status: 'skipped', detail: 'dreaming model not available' };
    }
    const exported = await exportProjectTranscripts(workdir, transcriptFile);
    if (exported.messages === 0) {
      return { workdir, status: 'skipped', detail: 'no recent transcripts' };
    }
    await snapshotMemory(memoryDir, backupDir);
    const today = new Date().toISOString().slice(0, 10);
    console.log(
      `[DREAM] ${workdir}: ${exported.sessions} session(s), ${exported.messages} message(s), ` +
        `${Math.round(exported.bytes / 1024)} KB of transcripts`
    );
    const prompt = dreamPrompt({ memoryDir, workdir, transcriptFile, today });
    const text =
      dreamer.kind === 'pi'
        ? await runPiDream(prompt, memoryDir, dreamer.userId, dreamer.model)
        : (
            await runAdminLLM(prompt, {
              cwd: memoryDir,
              timeoutMs: DREAM_TIMEOUT_MS,
              agentic: true,
            })
          ).text;
    const via = dreamer.kind === 'pi' ? dreamer.model : 'admin LLM';

    // A pass that lost or gutted the index is undone completely.
    const after = await readIndex(memoryDir);
    if (!after?.trim() || (before.length > 2_000 && after.length < before.length * 0.3)) {
      await restoreMemory(memoryDir, backupDir);
      console.warn(`[DREAM] ${workdir}: index lost or gutted, memory restored from ${backupDir}`);
      return { workdir, status: 'restored', detail: 'index lost or gutted; backup restored' };
    }
    const summary = text.split('\n').slice(-6).join(' ').slice(0, 400);
    console.log(`[DREAM] ${workdir}: done via ${via}. ${summary}`);
    return { workdir, status: 'done', detail: summary };
  } catch (error) {
    console.error(`[DREAM] ${workdir}: failed:`, error);
    return {
      workdir,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    releaseMemoryWorkdir(workdir);
  }
}

/** The user of the most recent session in `workdir`; their Pi keys run the pass. */
async function projectOwner(workdir: string): Promise<string | null> {
  const rows = (await all(
    'SELECT user_id FROM sessions WHERE working_directory = ? ORDER BY updated_at DESC LIMIT 1',
    workdir
  )) as Array<{ user_id: string }>;
  return rows[0]?.user_id ?? null;
}

/** Projects with sessions since `sinceHours` whose memory has an index. */
export async function dreamCandidates(sinceHours = 26): Promise<string[]> {
  const since = dbTimestamp(Date.now() - sinceHours * 60 * 60 * 1000);
  const rows = (await all(
    `SELECT working_directory, MAX(updated_at) AS last
       FROM sessions
      WHERE updated_at >= ? AND working_directory IS NOT NULL AND working_directory <> ''
      GROUP BY working_directory
      ORDER BY last DESC`,
    since
  )) as Array<{ working_directory: string }>;
  const candidates: string[] = [];
  for (const row of rows) {
    if ((await readIndex(projectMemoryDir(row.working_directory)))?.trim()) {
      candidates.push(row.working_directory);
    }
  }
  return candidates;
}

function zurichHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Zurich',
      hour: '2-digit',
      hour12: false,
    }).format(now)
  );
}

/** One scheduler tick: in the night window, dream the projects that are due. */
export async function dreamingTick(now = new Date()): Promise<DreamResult[]> {
  if (dreaming) return [];
  const hour = zurichHour(now);
  if (hour < NIGHT_START_HOUR || hour >= NIGHT_END_HOUR) return [];
  dreaming = true;
  const results: DreamResult[] = [];
  try {
    const state = await loadState();
    const due = (await dreamCandidates()).filter((workdir) => {
      const last = Date.parse(state.lastDreamByWorkdir[workdir] ?? '');
      return Number.isNaN(last) || now.getTime() - last > MIN_HOURS_BETWEEN_DREAMS * 3_600_000;
    });
    for (const workdir of due.slice(0, MAX_DREAMS_PER_NIGHT)) {
      if (zurichHour() >= NIGHT_END_HOUR) break;
      state.lastDreamByWorkdir[workdir] = new Date().toISOString();
      await saveState(state);
      results.push(await dreamProject(workdir));
    }
  } finally {
    dreaming = false;
  }
  return results;
}

export function startMemoryDreaming(): void {
  if (process.env.MEMORY_DREAMING_ENABLED === 'false') return;
  const timer = setInterval(() => {
    void dreamingTick().catch((error) => console.error('[DREAM] Tick failed:', error));
  }, TICK_MS);
  timer.unref();
}
