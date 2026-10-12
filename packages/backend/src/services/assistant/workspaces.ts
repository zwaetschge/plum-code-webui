import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { config } from '../../config.js';
import { isAllowedBasePath } from '../../utils/allowedPaths.js';
import { AppError } from '../../middleware/errorHandler.js';

export async function createAssistantWorkspace(userId: string): Promise<string> {
  const base =
    process.env.PLUM_ASSISTANT_WORKSPACE_ROOT ||
    path.join(config.allowedBasePaths[0] || '', '.plum-assistant');
  const owner = createHash('sha256').update(userId).digest('hex').slice(0, 24);
  const directory = path.resolve(base, owner, randomUUID());
  if (!isAllowedBasePath(directory))
    throw new AppError(
      'Der Assistenz-Arbeitsbereich liegt ausserhalb der erlaubten Pfade',
      400,
      'INVALID_WORKSPACE'
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}
