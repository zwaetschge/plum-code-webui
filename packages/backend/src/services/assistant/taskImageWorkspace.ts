import { constants } from 'node:fs';
import { mkdir, realpath, lstat, open, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { get } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';

/** Materialise only an already authorised task image, never a caller-supplied path. */
export async function taskImageWorkspace(
  sessionId: string,
  userId: string,
  image: { bytes: Buffer; mimeType: string }
): Promise<string> {
  const session = await get(
    'SELECT working_directory FROM sessions WHERE id=? AND user_id=?',
    sessionId,
    userId
  );
  if (!session) throw new AppError('Auftragsarbeitsbereich nicht gefunden', 404, 'NOT_FOUND');
  const root = await realpath(session.working_directory);
  const directory = path.join(root, '.claude-webui-images');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink() || (await realpath(directory)) !== directory)
    throw new AppError('Bildverzeichnis ist kein eigener Arbeitsbereich', 403, 'IMAGE_PATH_DENIED');
  const extension = (
    { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<
      string,
      string
    >
  )[image.mimeType];
  if (!extension || image.bytes.length > 5 * 1024 * 1024)
    throw new AppError('Ungültiges Bildoriginal', 422, 'INVALID_IMAGE');
  const sha = createHash('sha256').update(image.bytes).digest('hex');
  const target = path.join(directory, `plum-task-${sha}.${extension}`);
  const temporary = path.join(directory, `.plum-task-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    await file.writeFile(image.bytes);
    await file.close();
    file = undefined;
    await link(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await existing.stat();
      if (
        !info.isFile() ||
        info.size !== image.bytes.length ||
        createHash('sha256')
          .update(await existing.readFile())
          .digest('hex') !== sha
      )
        throw new AppError(
          'Vorhandene Bildkopie stimmt nicht mit dem Original überein',
          409,
          'IMAGE_WORKSPACE_CONFLICT'
        );
    } finally {
      await existing.close();
    }
  } finally {
    await file?.close();
    await unlink(temporary).catch(() => {});
  }
  return target;
}
