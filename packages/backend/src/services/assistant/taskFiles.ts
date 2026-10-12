import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { get, transaction, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, reviseResource } from './resources.js';
import { imageMime } from './apiFiles.js';
import type { AssistantApiImage } from '@plum-code-webui/shared';
async function task(userId: string, id: string, tx?: TransactionScope, revision?: number) {
  const resource = await findResource(userId, id, tx);
  if (resource.kind !== 'task') throw new AppError('Auftrag nicht gefunden', 404, 'NOT_FOUND');
  if (revision !== undefined && revision !== resource.revision) {
    const version = await (tx ?? { get }).get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      id,
      revision
    );
    if (!version) throw new AppError('Eingaberevision nicht gefunden', 404, 'NOT_FOUND');
    return { ...resource, revision, body: JSON.parse(version.body_json) };
  }
  return resource;
}
async function mutable(tx: TransactionScope, userId: string, id: string) {
  const resource = await task(userId, id, tx);
  if (
    resource.body.status !== 'draft' ||
    (await tx.get(
      "SELECT command_id FROM assistant_commands WHERE user_id=? AND resource_id=? AND action='submit' LIMIT 1",
      userId,
      id
    ))
  )
    throw new AppError(
      'Bilder können nur vor der ersten Übermittlung geändert werden.',
      409,
      'TASK_INPUTS_PINNED'
    );
  return resource;
}
const meta = (row: Record<string, unknown>): AssistantApiImage => ({
  id: String(row.id),
  filename: String(row.filename),
  mimeType: String(row.mime_type),
  byteLength: Number(row.byte_length),
});
export async function taskImage(
  userId: string,
  id: string,
  assetId: string,
  tx?: TransactionScope,
  revision?: number
) {
  const resource = await task(userId, id, tx, revision);
  if (!((resource.body.inputImageIds ?? []) as string[]).includes(assetId))
    throw new AppError('Dieses Bild ist keine Auftragseingabe', 404, 'NOT_FOUND');
  const row = await (tx ?? { get }).get(
    'SELECT id,filename,mime_type,bytes,octet_length(bytes) AS byte_length FROM assistant_assets WHERE id=? AND user_id=?',
    assetId,
    userId
  );
  if (!row) throw new AppError('Bildoriginal nicht gefunden', 404, 'NOT_FOUND');
  return { ...meta(row), bytes: Buffer.from(row.bytes) };
}
export async function taskImages(userId: string, id: string, revision?: number) {
  const resource = await task(userId, id, undefined, revision);
  const result = [];
  for (const assetId of (resource.body.inputImageIds ?? []) as string[]) {
    const file = await taskImage(userId, id, assetId, undefined, revision);
    result.push({
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      byteLength: file.byteLength,
    });
  }
  return result;
}
export async function uploadTaskImage(
  userId: string,
  id: string,
  expectedRevision: number,
  file: { buffer: Buffer; originalname: string }
) {
  if (!file.buffer.length || file.buffer.length > 5 * 1024 * 1024)
    throw new AppError('Ein Bild darf höchstens 5 MB gross sein', 413, 'IMAGE_SIZE_LIMIT');
  const mimeType = imageMime(file.buffer),
    sha = createHash('sha256').update(file.buffer).digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const resource = await task(userId, id, tx),
      ids = (resource.body.inputImageIds ?? []) as string[];
    const prior = await tx.get(
      'SELECT id,filename,mime_type,octet_length(bytes) AS byte_length FROM assistant_assets WHERE user_id=? AND sha256=?',
      userId,
      sha
    );
    if (prior && ids.includes(String(prior.id))) return { task: resource, image: meta(prior) };
    await mutable(tx, userId, id);
    if (resource.revision !== expectedRevision)
      throw new AppError('Auftrag wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    if (ids.length >= 4)
      throw new AppError(
        'Ein Auftrag unterstützt höchstens vier direkte Bildanhänge',
        413,
        'IMAGE_COUNT_LIMIT'
      );
    await tx.run(
      'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO NOTHING',
      randomUUID(),
      userId,
      path
        .basename(file.originalname)
        .replace(/[\u0000-\u001f]/g, '')
        .slice(0, 200) || 'Bild',
      mimeType,
      sha,
      file.buffer,
      new Date().toISOString()
    );
    const row = await tx.get(
      'SELECT id,filename,mime_type,octet_length(bytes) AS byte_length FROM assistant_assets WHERE user_id=? AND sha256=?',
      userId,
      sha
    );
    const updated = await reviseResource(
      userId,
      id,
      resource.revision,
      resource.title,
      { ...resource.body, inputImageIds: [...ids, String(row.id)] },
      tx
    );
    return { task: updated, image: meta(row) };
  });
}
export async function removeTaskImage(
  userId: string,
  id: string,
  assetId: string,
  expectedRevision: number
) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const resource = await task(userId, id, tx),
      ids = (resource.body.inputImageIds ?? []) as string[];
    if (!ids.includes(assetId)) return resource;
    if (
      resource.body.imageTryOn &&
      [resource.body.imageTryOn.personAssetId, resource.body.imageTryOn.productAssetId].includes(
        assetId
      )
    )
      throw new AppError(
        'Person und Produkt bleiben für diesen Anprobeauftrag gebunden.',
        409,
        'TRY_ON_REFERENCES_REQUIRED'
      );
    if (
      resource.body.imageEdit &&
      [resource.body.imageEdit.originalAssetId, resource.body.imageEdit.maskAssetId].includes(
        assetId
      )
    )
      throw new AppError(
        'Original und Maske bleiben für diesen Bearbeitungsauftrag gebunden',
        409,
        'IMAGE_EDIT_INPUTS_REQUIRED'
      );
    await mutable(tx, userId, id);
    if (resource.revision !== expectedRevision)
      throw new AppError('Auftrag wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    return reviseResource(
      userId,
      id,
      resource.revision,
      resource.title,
      { ...resource.body, inputImageIds: ids.filter((image) => image !== assetId) },
      tx
    );
  });
}
