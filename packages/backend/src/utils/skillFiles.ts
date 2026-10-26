import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { findSkillDirectory } from './leanSkillCatalog.js';
import { AppError } from '../middleware/errorHandler.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const missing = () => new AppError('Skilldatei nicht verfügbar', 404, 'NOT_FOUND');
const filePath = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      !value.includes('\\') &&
      value
        .split('/')
        .every(
          (part) =>
            !!part &&
            !part.startsWith('.') &&
            /^[\p{L}\p{N}_ -]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(part)
        ),
    'Ungültiger Dateipfad'
  );
export const SKILL_FILE_WRITE = z
  .object({
    path: filePath,
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    content: z.string().max(500000),
  })
  .strict();
async function root(home: string, name: string) {
  const location = await findSkillDirectory(home, name);
  if (!location) throw missing();
  return fs.realpath(location.dirPath);
}
async function target(base: string, name: string, create = false) {
  filePath.parse(name);
  const candidate = path.join(base, name);
  if (create) {
    // Walk each parent: never create or follow a symlink inside a skill.
    let current = base;
    for (const part of name.split('/').slice(0, -1)) {
      current = path.join(current, part);
      await fs.mkdir(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw missing();
    }
  }
  const parent = await fs.realpath(path.dirname(candidate));
  if (parent !== base && !parent.startsWith(base + path.sep)) throw missing();
  const stat = await fs.lstat(candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.size > 500000)) throw missing();
  return { candidate, stat };
}
async function textFile(candidate: string) {
  const handle = await fs.open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await handle.stat()).size > 500000) throw missing();
    const bytes = await handle.readFile();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw missing();
    return text;
  } finally {
    await handle.close();
  }
}
function historyRoot(home: string, name: string, file: string) {
  return path.join(home, 'integrations', 'skill-file-history', digest(name), digest(file));
}
async function snapshot(home: string, name: string, file: string, content: string) {
  const directory = historyRoot(home, name, file);
  await fs.mkdir(directory, { recursive: true });
  const value = { hash: digest(content), path: file, content, createdAt: new Date().toISOString() };
  await fs
    .writeFile(path.join(directory, value.hash + '.json'), JSON.stringify(value), {
      flag: 'wx',
      mode: 0o600,
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
}
export async function listSkillFiles(home: string, name: string) {
  const base = await root(home, name),
    files: string[] = [];
  async function visit(directory: string, prefix = '', depth = 0) {
    if (depth > 8) return;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || files.length >= 500 || entry.isSymbolicLink()) continue;
      const relative = prefix + entry.name;
      if (!filePath.safeParse(relative).success) continue;
      if (entry.isDirectory())
        await visit(path.join(directory, entry.name), relative + '/', depth + 1);
      else if (entry.isFile()) {
        try {
          await textFile(path.join(directory, entry.name));
          files.push(relative);
        } catch {
          /* Omit binary/large/inaccessible files. */
        }
      }
    }
  }
  await visit(base);
  const managed = await fs.access(path.join(base, '.plum-managed-skill.json')).then(
    () => true,
    () => false
  );
  return { files: files.sort(), readOnly: managed };
}
export async function readSkillFile(home: string, name: string, file: string, revision?: string) {
  const base = await root(home, name);
  filePath.parse(file);
  if (revision) {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(revision);
    const item = JSON.parse(
      await fs.readFile(path.join(historyRoot(home, name, file), revision + '.json'), 'utf8')
    );
    return { path: file, content: String(item.content), hash: revision };
  }
  const { candidate, stat } = await target(base, file);
  if (!stat) throw missing();
  const content = await textFile(candidate);
  return { path: file, content, hash: digest(content) };
}
export async function skillFileHistory(home: string, name: string, file: string) {
  await root(home, name);
  filePath.parse(file);
  const directory = historyRoot(home, name, file);
  const entries = await fs.readdir(directory).catch(() => []);
  return (
    await Promise.all(
      entries
        .filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry))
        .map(async (entry) => {
          const value = JSON.parse(await fs.readFile(path.join(directory, entry), 'utf8'));
          return { hash: String(value.hash), createdAt: String(value.createdAt) };
        })
    )
  )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);
}
export async function writeSkillFile(
  home: string,
  name: string,
  raw: z.input<typeof SKILL_FILE_WRITE>
) {
  const input = SKILL_FILE_WRITE.parse(raw),
    base = await root(home, name);
  if (
    await fs.access(path.join(base, '.plum-managed-skill.json')).then(
      () => true,
      () => false
    )
  )
    throw new AppError('Dieser Skill wird von Plum verwaltet', 403, 'MANAGED_SKILL');
  const locks = path.join(home, 'integrations', 'skill-file-locks');
  await fs.mkdir(locks, { recursive: true });
  const lockPath = path.join(locks, digest(base));
  const lock = await fs.open(lockPath, 'wx').catch(() => {
    throw new AppError('Skill wird gerade bearbeitet', 409, 'REVISION_CONFLICT');
  });
  let temporary: string | undefined;
  try {
    const { candidate, stat } = await target(base, input.path, true);
    const before = stat ? await textFile(candidate) : null;
    if ((before === null ? null : digest(before)) !== input.expectedHash)
      throw new AppError(
        'Datei wurde inzwischen geändert. Bitte neu laden.',
        409,
        'REVISION_CONFLICT'
      );
    if (before !== null) await snapshot(home, name, input.path, before);
    temporary = path.join(path.dirname(candidate), '.plum-edit-' + randomUUID());
    await fs.writeFile(temporary, input.content, { flag: 'wx', mode: stat?.mode ?? 0o600 });
    await fs.rename(temporary, candidate);
    temporary = undefined;
    await snapshot(home, name, input.path, input.content);
    return { path: input.path, content: input.content, hash: digest(input.content) };
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => {});
    await lock.close();
    await fs.unlink(lockPath);
  }
}
