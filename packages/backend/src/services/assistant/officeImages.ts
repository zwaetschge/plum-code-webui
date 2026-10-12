import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAssistantDocument, type AssistantResource } from '@plum-code-webui/shared';
import type { TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { imageMime } from './apiFiles.js';
let active = 0;

export async function importWordImages(
  userId: string,
  source: AssistantResource,
  tx: TransactionScope
) {
  if (active >= 2)
    throw new AppError('Zwei Word-Importe laufen bereits', 429, 'OFFICE_IMPORT_BUSY');
  active++;
  let directory: string | undefined;
  try {
    const original = await tx.get(
      'SELECT bytes,sha256 FROM assistant_assets WHERE id=? AND user_id=?',
      source.body.assetId,
      userId
    );
    if (
      !original ||
      original.sha256 !== source.body.sha256 ||
      createHash('sha256').update(Buffer.from(original.bytes)).digest('hex') !== original.sha256
    )
      throw new AppError(
        'Office-Original fehlt oder wurde verändert',
        409,
        'SOURCE_ORIGINAL_CHANGED'
      );
    directory = await mkdtemp(path.join(tmpdir(), 'plum-word-images-'));
    const filename = path.join(directory, 'original.docx');
    await writeFile(filename, Buffer.from(original.bytes), { mode: 0o600 });
    const extracted = await promisify(execFile)(
      process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python',
      [
        fileURLToPath(new URL('../../../../../scripts/plum-office-extract.py', import.meta.url)),
        filename,
        '--images',
      ],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
    );
    const parsed = JSON.parse(extracted.stdout);
    if (
      parsed.kind !== 'docx' ||
      !Array.isArray(parsed.media) ||
      parsed.media.length > 4 ||
      !Array.isArray(parsed.document?.blocks)
    )
      throw new Error('Invalid Word import');
    const ids = new Map<string, string>();
    let total = 0;
    for (const item of parsed.media) {
      const bytes = Buffer.from(String(item.base64), 'base64'),
        mime = imageMime(bytes);
      total += bytes.length;
      if (
        total > 2 * 1024 * 1024 ||
        !['image/png', 'image/jpeg'].includes(mime) ||
        ids.has(String(item.id))
      )
        throw new Error('Invalid Word media');
      const sha = createHash('sha256').update(bytes).digest('hex');
      const asset = await tx.get(
        'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
        randomUUID(),
        userId,
        String(item.filename).slice(0, 200),
        mime,
        sha,
        bytes,
        new Date().toISOString()
      );
      ids.set(String(item.id), String(asset.id));
    }
    const doc = parseAssistantDocument(
      JSON.stringify({
        ...parsed.document,
        blocks: parsed.document.blocks.map((block: Record<string, unknown>) => {
          if (block.type !== 'image') return block;
          const assetId = ids.get(String(block.mediaId));
          if (!assetId) throw new Error('Missing Word media');
          return { type: 'image', assetId, alt: block.alt, caption: block.caption };
        }),
      })
    );
    return { document: doc, warnings: parsed.warnings as string[] };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'Word-Kopie konnte nicht sicher übernommen werden. Das Original bleibt erhalten.',
      422,
      'OFFICE_EDIT_LIMIT'
    );
  } finally {
    active--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
