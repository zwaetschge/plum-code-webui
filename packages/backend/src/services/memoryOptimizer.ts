/**
 * Self-maintaining workspace memory.
 *
 * Every session compaction triggers a debounced cleanup pass over the
 * workspace's persistent knowledge so it stays lean instead of accreting
 * forever:
 *
 * 1. Claude project memory (`~/.claude/projects/<slug>/memory/`):
 *    - session-*.md files older than {@link ARCHIVE_AFTER_DAYS} move to
 *      `memory/archive/` (mechanical, nothing is deleted),
 *    - their durable lessons are distilled into `learnings.md` via the admin
 *      LLM,
 *    - `MEMORY.md` (the index loaded into every session) is rewritten to stay
 *      compact and to point at the archive instead of listing stale files.
 * 2. Workspace instruction files (`CLAUDE.md`, `AGENTS.md`): deduplicated and
 *    tightened by the admin LLM once they grow past a threshold. The
 *    webui-managed block is cut out first and re-inserted verbatim.
 *
 * Every rewritten or moved file is backed up under
 * `<dataDir>/memory-optimizer/backups/<timestamp>/` first, and every LLM
 * result is sanity-checked (length ratio, structure markers) before it
 * replaces the original — a bad completion loses nothing.
 *
 * Disable with `MEMORY_OPTIMIZER_ENABLED=false`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getDataDirectory } from '../db/index.js';
import { runAdminLLM } from '../utils/adminLLM.js';
import { resolveConfigHome } from '../utils/configPaths.js';

const ARCHIVE_AFTER_DAYS = 14;
const DEBOUNCE_MS = 6 * 60 * 60 * 1000; // one pass per workspace per 6h
const INSTRUCTION_FILE_MIN_CHARS = 12_000; // below this there is nothing to slim
const LLM_INPUT_CAP = 24_000;
// Instruction files legitimately grow past the memory cap (AGENTS.md ~40 kB);
// they get a bigger window and more time for the full rewrite.
const INSTRUCTION_INPUT_CAP = 64_000;
const LLM_TIMEOUT_MS = 180_000;
const INSTRUCTION_TIMEOUT_MS = 360_000;
const BACKUP_RETENTION = 20;

/** Any server-regenerated block: shared-config, project-context, … */
const MANAGED_BLOCK_PATTERN =
  /<!-- webui-managed: ([\w-]+):start -->[\s\S]*?<!-- webui-managed: \1:end -->/g;

function managedPlaceholder(index: number): string {
  return `<!-- __PLUM_MANAGED_BLOCK_${index}__ -->`;
}

const runningWorkdirs = new Set<string>();

interface OptimizerState {
  lastRunByWorkdir: Record<string, string>;
}

function optimizerDir(): string {
  return path.join(getDataDirectory(), 'memory-optimizer');
}

function stateFilePath(): string {
  return path.join(optimizerDir(), 'state.json');
}

async function loadState(): Promise<OptimizerState> {
  try {
    const raw = await fs.readFile(stateFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as OptimizerState;
    return { lastRunByWorkdir: parsed.lastRunByWorkdir ?? {} };
  } catch {
    return { lastRunByWorkdir: {} };
  }
}

async function saveState(state: OptimizerState): Promise<void> {
  await fs.mkdir(optimizerDir(), { recursive: true });
  await fs.writeFile(stateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
}

/** Claude CLI project slug: path separators and dots become dashes. */
function claudeProjectSlug(workingDirectory: string): string {
  return workingDirectory.replace(/[/.]/g, '-');
}

export function resolveMemoryOptimizerMemoryDir(
  workingDirectory: string,
  configHome = resolveConfigHome()
): string {
  return path.join(configHome, 'projects', claudeProjectSlug(workingDirectory), 'memory');
}

export function hasExactManagedPlaceholderSequence(result: string, blockCount: number): boolean {
  const placeholders = result.match(/<!-- __PLUM_MANAGED_BLOCK_\d+__ -->/g) ?? [];
  return (
    placeholders.length === blockCount &&
    placeholders.every((placeholder, index) => placeholder === managedPlaceholder(index))
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Backups ───────────────────────────────────────────────────────────────────

async function createBackupDir(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(optimizerDir(), 'backups', stamp);
  await fs.mkdir(dir, { recursive: true });
  void pruneOldBackups().catch(() => undefined);
  return dir;
}

async function pruneOldBackups(): Promise<void> {
  const root = path.join(optimizerDir(), 'backups');
  const entries = (await fs.readdir(root).catch(() => [] as string[])).sort();
  const excess = entries.length - BACKUP_RETENTION;
  for (const entry of entries.slice(0, Math.max(0, excess))) {
    await fs.rm(path.join(root, entry), { recursive: true, force: true });
  }
}

async function backupFile(backupDir: string, filePath: string): Promise<void> {
  const flat = filePath.replace(/[/.]/g, '-').replace(/^-+/, '');
  await fs.copyFile(filePath, path.join(backupDir, flat));
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.optimizer-tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, filePath);
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

/** Strip a single surrounding markdown fence if the model added one. */
function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  const inner = fenced?.[1];
  return inner ? inner.trim() : trimmed;
}

async function completeFile(
  prompt: string,
  cwd: string,
  timeoutMs: number = LLM_TIMEOUT_MS
): Promise<string | null> {
  try {
    const { text } = await runAdminLLM(prompt, { cwd, timeoutMs });
    const cleaned = stripFence(text);
    return cleaned.length > 0 ? cleaned : null;
  } catch (error) {
    console.warn('[MEMORY-OPT] Admin LLM call failed:', error);
    return null;
  }
}

// ── Memory directory pass ─────────────────────────────────────────────────────

interface ArchiveResult {
  archived: string[];
  archivedContent: string;
}

/** Move session-*.md files older than the cutoff into memory/archive/. */
async function archiveOldSessionFiles(
  memoryDir: string,
  backupDir: string
): Promise<ArchiveResult> {
  const archiveDir = path.join(memoryDir, 'archive');
  const cutoff = Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const archived: string[] = [];
  let archivedContent = '';

  const entries = await fs.readdir(memoryDir);
  for (const name of entries) {
    if (!/^session-\d{4}-\d{2}-\d{2}.*\.md$/.test(name)) continue;
    const filePath = path.join(memoryDir, name);

    // Prefer the date encoded in the filename; fall back to mtime.
    const encodedDate = name.match(/^session-(\d{4}-\d{2}-\d{2})/)?.[1];
    let fileTime = encodedDate ? Date.parse(encodedDate) : NaN;
    if (Number.isNaN(fileTime)) {
      fileTime = (await fs.stat(filePath)).mtimeMs;
    }
    if (fileTime >= cutoff) continue;

    await fs.mkdir(archiveDir, { recursive: true });
    await backupFile(backupDir, filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    archivedContent += `\n\n<!-- ${name} -->\n${content}`;
    await fs.rename(filePath, path.join(archiveDir, name));
    archived.push(name);
  }

  return { archived, archivedContent };
}

/** Fold the archived sessions' durable lessons into learnings.md. */
async function distillLearnings(
  memoryDir: string,
  backupDir: string,
  archivedContent: string,
  cwd: string
): Promise<boolean> {
  const learningsPath = path.join(memoryDir, 'learnings.md');
  const existing = (await pathExists(learningsPath))
    ? await fs.readFile(learningsPath, 'utf-8')
    : '';

  const prompt = [
    'You maintain a distilled engineering knowledge file for a project. Merge the EXISTING file and the NEWLY ARCHIVED session logs below into one updated file.',
    'Keep only durable knowledge: conventions, root causes, pitfalls, deploy/build procedures, unresolved open points. Drop play-by-play narration, superseded states and anything already fixed and shipped without lasting insight.',
    'Keep the markdown frontmatter exactly in this shape (adjust nothing but the description):',
    '---',
    'name: learnings',
    'description: <one line>',
    'metadata:',
    '  type: project',
    '---',
    'Stay under 8000 characters total. Answer ONLY with the complete new file content, no commentary, no code fence.',
    '',
    '=== EXISTING learnings.md ===',
    existing.slice(0, LLM_INPUT_CAP / 2) || '(none yet)',
    '',
    '=== NEWLY ARCHIVED SESSION LOGS ===',
    archivedContent.slice(0, LLM_INPUT_CAP),
  ].join('\n');

  const result = await completeFile(prompt, cwd);
  // Sanity: must carry the frontmatter and stay in a plausible size band.
  if (!result || !result.startsWith('---') || result.length < 100 || result.length > 20_000) {
    console.warn('[MEMORY-OPT] Learnings distillation rejected by validation; keeping old file.');
    return false;
  }

  if (existing) await backupFile(backupDir, learningsPath);
  await writeAtomically(learningsPath, `${result}\n`);
  return true;
}

/** Rewrite MEMORY.md so the always-loaded index stays small and current. */
async function slimMemoryIndex(
  memoryDir: string,
  backupDir: string,
  archived: string[],
  cwd: string
): Promise<boolean> {
  const indexPath = path.join(memoryDir, 'MEMORY.md');
  if (!(await pathExists(indexPath))) return false;
  const existing = await fs.readFile(indexPath, 'utf-8');

  const activeFiles = (await fs.readdir(memoryDir)).filter((f) => f.endsWith('.md'));

  const prompt = [
    'You maintain MEMORY.md, the compact index of a project memory directory. It is loaded into every agent session, so brevity matters. Rewrite it.',
    'Rules:',
    '- Preserve user preferences and workflow rules verbatim in meaning (they may be reworded only for brevity).',
    '- One line per memory file, `- [Title](file.md) — hook` style. Only reference files from the CURRENT FILES list.',
    `- These files were just archived and must no longer have their own lines: ${archived.join(', ') || '(none)'}. If learnings.md exists in the current list, a single line pointing to it (and to archive/ for full logs) replaces them.`,
    '- Do not invent facts. Keep the overall heading structure.',
    '- Target: noticeably shorter than the existing file, never longer.',
    'Answer ONLY with the complete new MEMORY.md content, no commentary, no code fence.',
    '',
    '=== CURRENT FILES IN MEMORY DIR ===',
    activeFiles.join('\n'),
    '',
    '=== EXISTING MEMORY.md ===',
    existing.slice(0, LLM_INPUT_CAP),
  ].join('\n');

  const result = await completeFile(prompt, cwd);
  if (
    !result ||
    !result.trimStart().startsWith('#') ||
    result.length < 200 ||
    result.length > existing.length * 1.1
  ) {
    console.warn('[MEMORY-OPT] MEMORY.md rewrite rejected by validation; keeping old file.');
    return false;
  }

  await backupFile(backupDir, indexPath);
  await writeAtomically(indexPath, `${result}\n`);
  return true;
}

// ── Instruction file pass (CLAUDE.md / AGENTS.md) ─────────────────────────────

async function slimInstructionFile(
  filePath: string,
  backupDir: string,
  cwd: string
): Promise<boolean> {
  if (!(await pathExists(filePath))) return false;
  const original = await fs.readFile(filePath, 'utf-8');
  if (original.length < INSTRUCTION_FILE_MIN_CHARS) return false;

  // Server-regenerated blocks (shared-config, project-context, …) are cut out
  // so the model can neither mangle nor "optimize" them, then spliced back.
  const managedBlocks: string[] = [];
  const working = original.replace(MANAGED_BLOCK_PATTERN, (match) => {
    managedBlocks.push(match);
    return managedPlaceholder(managedBlocks.length - 1);
  });

  // A file that is (almost) entirely managed blocks has nothing to slim.
  if (working.length < INSTRUCTION_FILE_MIN_CHARS) return false;

  // Files beyond the input cap would be truncated and thus corrupted — skip.
  if (working.length > INSTRUCTION_INPUT_CAP) {
    console.warn(
      `[MEMORY-OPT] ${path.basename(filePath)} exceeds LLM input cap (${working.length} chars); skipping.`
    );
    return false;
  }

  const fileName = path.basename(filePath);
  const prompt = [
    `You maintain ${fileName}, a project instruction file for coding agents. Deduplicate and tighten it without losing operative meaning.`,
    'Rules:',
    '- Merge redundant sections, drop superseded/stale statements and repeated explanations; keep every command, path, port, env var and warning that is still referenced.',
    '- Never invent new facts or rules. Keep the heading structure recognisable. Keep code blocks intact unless they are exact duplicates.',
    '- Lines like <!-- __PLUM_MANAGED_BLOCK_0__ --> are protected placeholders: keep each exactly once, unchanged, in the same position relative to its neighbours.',
    '- Target 60–85% of the original length. Never longer than the original.',
    'Answer ONLY with the complete new file content, no commentary, no code fence.',
    '',
    `=== CURRENT ${fileName} ===`,
    working,
  ].join('\n');

  const result = await completeFile(prompt, cwd, INSTRUCTION_TIMEOUT_MS);
  const valid =
    result !== null &&
    result.trimStart().startsWith('#') &&
    result.length >= working.length * 0.4 &&
    result.length <= working.length &&
    hasExactManagedPlaceholderSequence(result, managedBlocks.length);
  if (!valid) {
    console.warn(`[MEMORY-OPT] ${fileName} rewrite rejected by validation; keeping old file.`);
    return false;
  }

  let finalContent = result;
  managedBlocks.forEach((block, i) => {
    finalContent = finalContent.replace(managedPlaceholder(i), block);
  });

  await backupFile(backupDir, filePath);
  await writeAtomically(filePath, `${finalContent.trimEnd()}\n`);
  return true;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Debounced optimization pass, fired on every `session:compact`. Never throws;
 * a failed pass leaves every file untouched (validation + backups).
 */
export async function onSessionCompacted(
  sessionId: string,
  workingDirectory: string
): Promise<void> {
  if (process.env.MEMORY_OPTIMIZER_ENABLED === 'false') return;
  const workdir = path.resolve(workingDirectory);
  if (runningWorkdirs.has(workdir)) return;

  const state = await loadState();
  const lastRun = Date.parse(state.lastRunByWorkdir[workdir] ?? '');
  if (!Number.isNaN(lastRun) && Date.now() - lastRun < DEBOUNCE_MS) return;

  runningWorkdirs.add(workdir);
  try {
    console.log(`[MEMORY-OPT] Compaction in [${sessionId}] — optimizing memory for ${workdir}`);
    state.lastRunByWorkdir[workdir] = new Date().toISOString();
    await saveState(state);

    const backupDir = await createBackupDir();
    const actions: string[] = [];

    const memoryDir = resolveMemoryOptimizerMemoryDir(workdir);
    if (await pathExists(memoryDir)) {
      const { archived, archivedContent } = await archiveOldSessionFiles(memoryDir, backupDir);
      if (archived.length > 0) {
        actions.push(`archived ${archived.length} session file(s)`);
        if (await distillLearnings(memoryDir, backupDir, archivedContent, workdir)) {
          actions.push('updated learnings.md');
        }
      }
      if (await slimMemoryIndex(memoryDir, backupDir, archived, workdir)) {
        actions.push('slimmed MEMORY.md');
      }
    }

    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      if (await slimInstructionFile(path.join(workdir, name), backupDir, workdir)) {
        actions.push(`slimmed ${name}`);
      }
    }

    console.log(
      `[MEMORY-OPT] Done for ${workdir}: ${actions.length > 0 ? actions.join(', ') : 'nothing to do'}`
    );
  } catch (error) {
    console.error(`[MEMORY-OPT] Pass failed for ${workdir}:`, error);
  } finally {
    runningWorkdirs.delete(workdir);
  }
}
