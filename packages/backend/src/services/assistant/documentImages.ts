import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { parseAssistantDocument } from '@plum-code-webui/shared';
import { transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, reviseResource } from './resources.js';
import { imageMime } from './apiFiles.js';

export const DOCUMENT_IMAGE_INPUT = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.coerce.number().int().positive(),
    alt: z.string().max(500).default(''),
    caption: z.string().max(500).default(''),
  })
  .strict();

export async function addDocumentImage(
  userId: string,
  id: string,
  raw: z.input<typeof DOCUMENT_IMAGE_INPUT>,
  file: { buffer: Buffer; originalname: string }
) {
  const input = DOCUMENT_IMAGE_INPUT.parse(raw);
  if (!file.buffer.length || file.buffer.length > 5 * 1024 * 1024)
    throw new AppError('Ein Bild darf höchstens 5 MB gross sein', 413, 'IMAGE_SIZE_LIMIT');
  const mime = imageMime(file.buffer),
    sha = createHash('sha256').update(file.buffer).digest('hex');
  const filename =
    path
      .basename(file.originalname)
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, 200) || 'Bild';
  const hash = createHash('sha256')
    .update(JSON.stringify([id, input.expectedRevision, input.alt, input.caption, filename, sha]))
    .digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'document-image' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return JSON.parse(String(prior.result_json));
    }
    const artifact = await findResource(userId, id, tx);
    if (
      artifact.kind !== 'artifact' ||
      artifact.body.type !== 'document' ||
      artifact.body.format !== 'json'
    )
      throw new AppError(
        'Zuerst ein formatiertes Dokument speichern',
        409,
        'DOCUMENT_SAVE_REQUIRED'
      );
    if (artifact.revision !== input.expectedRevision)
      throw new AppError('Dokument wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    const doc = parseAssistantDocument(String(artifact.body.content));
    await tx.run(
      'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO NOTHING',
      randomUUID(),
      userId,
      filename,
      mime,
      sha,
      file.buffer,
      new Date().toISOString()
    );
    const asset = await tx.get(
      'SELECT id FROM assistant_assets WHERE user_id=? AND sha256=?',
      userId,
      sha
    );
    doc.blocks.push({
      type: 'image',
      assetId: String(asset.id),
      alt: input.alt || filename,
      caption: input.caption,
    });
    const resource = await reviseResource(
      userId,
      id,
      artifact.revision,
      artifact.title,
      { ...artifact.body, content: JSON.stringify(parseAssistantDocument(JSON.stringify(doc))) },
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      id,
      hash,
      'document-image',
      JSON.stringify(resource),
      now,
      now
    );
    return resource;
  });
}
