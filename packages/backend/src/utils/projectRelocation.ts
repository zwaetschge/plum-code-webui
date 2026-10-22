import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

/**
 * Project folders move between the Geekom SSD and the Unraid array: the
 * plum-mover tiers idle projects to the array, and users move folders by
 * hand. Sessions keep their old working_directory, so the provider spawn fails
 * with ENOENT. These roots hold the same project tree under different paths;
 * a project keeps its relative path when it moves between them.
 */
const EQUIVALENT_ROOTS = [
  '/mnt/cache/AI/plum-code',
  '/workspace/projects',
  '/mnt/user/AI/plum-code',
  '/mnt/user/Backup/Geekom-Plum/projects',
  '/nas/unraid/AI/plum-code',
];

/** Shallow places a hand-moved project folder usually lands. */
const SEARCH_ROOTS = [...EQUIVALENT_ROOTS, '/mnt/user/AI', '/mnt/user/Open Projects', '/mnt/user'];

async function isDirectory(dir: string): Promise<boolean> {
  return fs
    .stat(dir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
}

/**
 * Locates a project folder that no longer exists at `dir`. First the same
 * relative path under an equivalent root, then a folder with the same name
 * directly inside one of the search roots, accepted only when exactly one
 * real folder matches, so an ambiguous name never rebinds a session.
 */
export async function findRelocatedDirectory(
  dir: string,
  roots: { equivalent: string[]; search: string[] } = {
    equivalent: EQUIVALENT_ROOTS,
    search: SEARCH_ROOTS,
  }
): Promise<{ path: string; reason: 'equivalent-root' | 'unique-name' } | null> {
  const clean = path.resolve(dir);
  const root = roots.equivalent.find((r) => clean.startsWith(r + '/'));
  if (root) {
    const rest = clean.slice(root.length);
    for (const other of roots.equivalent) {
      if (other !== root && (await isDirectory(other + rest)))
        return { path: other + rest, reason: 'equivalent-root' };
    }
  }
  const name = path.basename(clean);
  if (!name || name === '.' || name === '..') return null;
  const matches = new Map<string, string>();
  for (const searchRoot of roots.search) {
    const candidate = path.join(searchRoot, name);
    if (candidate === clean || !(await isDirectory(candidate))) continue;
    // The NFS view and the local bind can expose one folder twice.
    const real = await fs.realpath(candidate).catch(() => candidate);
    if (![...matches.values()].includes(real)) matches.set(candidate, real);
  }
  const [only] = matches.size === 1 ? matches.keys() : [];
  return only ? { path: only, reason: 'unique-name' } : null;
}

/** Rewrites a path that lived inside `from` so it lives inside `to`. */
export function rebasePath(value: string, from: string, to: string): string {
  if (value === from) return to;
  return value.startsWith(from + '/') ? to + value.slice(from.length) : value;
}

/**
 * Claude Code keeps transcripts per working directory
 * (~/.claude/projects/-mnt-cache-AI-...). After a move, a resume from the new
 * path must still find the old transcripts, so the new slug links to the old.
 */
export async function carryClaudeTranscripts(configHome: string, from: string, to: string) {
  const slug = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-');
  const projects = path.join(configHome, 'projects');
  const oldDir = path.join(projects, slug(from));
  const newDir = path.join(projects, slug(to));
  if (!fsSync.existsSync(oldDir) || fsSync.existsSync(newDir)) return;
  await fs.symlink(oldDir, newDir, 'dir').catch(() => undefined);
}
