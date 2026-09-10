import fs from 'fs';
import path from 'path';

/**
 * Write a file so that a reader never sees a half-written one.
 *
 * The config writers this replaces used a plain `fs.writeFileSync`, which
 * truncates the target and then fills it. A provider CLI that reads
 * `opencode.json` or Pi's `models.json` during that window gets a truncated
 * file and fails to parse it — and because the sync runs on every session
 * spawn, the window is hit by exactly the process that needs the file. Writing
 * to a sibling temp file and renaming makes the swap atomic on the same
 * filesystem, so a reader sees either the old contents or the new ones.
 */
export function writeFileAtomicSync(
  filePath: string,
  content: string,
  options: { mode?: number } = {}
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Same directory, so the rename stays within one filesystem. The pid and a
  // random suffix keep two concurrent writers from sharing a temp file.
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  );
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: options.mode ?? 0o600 });
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // The temp file may never have been created; nothing to clean up.
    }
    throw error;
  }
}
