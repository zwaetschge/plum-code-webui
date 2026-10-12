import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { all, get, transaction, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource } from './resources.js';
import type { AssistantApiImage } from '@plum-code-webui/shared';

export function imageMime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  throw new AppError(
    'Bildanhänge unterstützen PNG, JPEG, WebP und GIF',
    415,
    'IMAGE_TYPE_UNSUPPORTED'
  );
}
async function chat(userId: string, id: string, tx?: TransactionScope) {
  const resource = await findResource(userId, id, tx);
  if (resource.kind !== 'api-chat')
    throw new AppError('Modellchat nicht gefunden', 404, 'NOT_FOUND');
  if (
    resource.body.temporary &&
    (!resource.body.expiresAt || Date.parse(String(resource.body.expiresAt)) <= Date.now())
  )
    throw new AppError('Dieses temporäre Gespräch ist abgelaufen', 410, 'TEMPORARY_EXPIRED');
  return resource;
}
function metadata(row: Record<string, unknown>): AssistantApiImage {
  return {
    id: String(row.id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    byteLength: Number(row.byte_length),
  };
}
export async function uploadApiImage(
  userId: string,
  id: string,
  file: { buffer: Buffer; originalname: string }
) {
  if (!file.buffer.length || file.buffer.length > 5 * 1024 * 1024)
    throw new AppError('Ein Bild darf höchstens 5 MB gross sein', 413, 'IMAGE_SIZE_LIMIT');
  const mimeType = imageMime(file.buffer),
    sha = createHash('sha256').update(file.buffer).digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    await tx.get(
      'SELECT id FROM assistant_resources WHERE id=? AND user_id=? FOR UPDATE',
      id,
      userId
    );
    await chat(userId, id, tx);
    const duplicate = await tx.get(
      'SELECT a.id,a.filename,a.mime_type,octet_length(a.bytes) AS byte_length FROM assistant_api_files f JOIN assistant_assets a ON a.id=f.asset_id WHERE f.chat_id=? AND a.user_id=? AND a.sha256=?',
      id,
      userId,
      sha
    );
    if (duplicate) return metadata(duplicate);
    const count = await tx.get(
      'SELECT COUNT(*) AS count FROM assistant_api_files WHERE chat_id=?',
      id
    );
    if (Number(count.count) >= 30)
      throw new AppError(
        'Dieses Modellgespräch enthält bereits 30 Bilder',
        413,
        'IMAGE_COUNT_LIMIT'
      );
    await tx.run(
      'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO NOTHING',
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
    await tx.run(
      'INSERT INTO assistant_api_files(chat_id,asset_id,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING',
      id,
      row.id,
      new Date().toISOString()
    );
    return metadata(row);
  });
}
export async function apiChatImages(userId: string, id: string) {
  await chat(userId, id);
  return (
    await all(
      'SELECT a.id,a.filename,a.mime_type,octet_length(a.bytes) AS byte_length FROM assistant_api_files f JOIN assistant_assets a ON a.id=f.asset_id WHERE f.chat_id=? AND a.user_id=? ORDER BY f.created_at,a.id',
      id,
      userId
    )
  ).map(metadata);
}
export async function apiChatImage(
  userId: string,
  id: string,
  assetId: string,
  tx?: TransactionScope
) {
  await chat(userId, id, tx);
  const row = await (tx ?? { get }).get(
    'SELECT a.id,a.filename,a.mime_type,a.bytes,octet_length(a.bytes) AS byte_length FROM assistant_api_files f JOIN assistant_assets a ON a.id=f.asset_id WHERE f.chat_id=? AND a.id=? AND a.user_id=?',
    id,
    assetId,
    userId
  );
  if (!row) throw new AppError('Bildanhang nicht gefunden', 404, 'NOT_FOUND');
  return { ...metadata(row), bytes: Buffer.from(row.bytes) };
}
export async function apiImagePayloads(
  userId: string,
  id: string,
  ids: string[],
  tx?: TransactionScope
) {
  const images = [];
  for (const assetId of ids) {
    const file = await apiChatImage(userId, id, assetId, tx);
    images.push({
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      data: file.bytes.toString('base64'),
      byteLength: file.bytes.length,
    });
  }
  if (images.reduce((sum, image) => sum + image.byteLength, 0) > 20 * 1024 * 1024)
    throw new AppError('Die Bildanhänge überschreiten 20 MB', 413, 'IMAGE_SIZE_LIMIT');
  return images;
}
