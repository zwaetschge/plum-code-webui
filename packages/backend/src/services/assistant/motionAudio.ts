import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { parseAssistantMotion } from '@plum-code-webui/shared';
import { get, transaction, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, reviseResource } from './resources.js';
/** PCM/IEEE-float WAV only; duration comes from actual aligned samples, not client metadata. */
export function waveFacts(bytes: Buffer) {
  const invalid = () =>
    new AppError('Eine gültige PCM-/Float-WAV-Datei mit 1–2 Kanälen wählen.', 400, 'WAV_REQUIRED');
  if (
    bytes.length < 44 ||
    bytes.length > 5 * 1024 * 1024 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  )
    throw invalid();
  let offset = 12,
    format:
      | { codec: number; channels: number; rate: number; align: number; bits: number }
      | undefined,
    dataSize = 0,
    chunks = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length || ++chunks > 64) throw invalid();
    const type = bytes.toString('ascii', offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (start + size > bytes.length) throw invalid();
    if (type === 'fmt ') {
      if (format || size < 16) throw invalid();
      const codec = bytes.readUInt16LE(start),
        channels = bytes.readUInt16LE(start + 2),
        rate = bytes.readUInt32LE(start + 4),
        align = bytes.readUInt16LE(start + 12),
        bits = bytes.readUInt16LE(start + 14);
      if (
        ![1, 3].includes(codec) ||
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 96000 ||
        (codec === 1 ? ![8, 16, 24, 32].includes(bits) : ![32, 64].includes(bits)) ||
        align !== (channels * bits) / 8 ||
        bytes.readUInt32LE(start + 8) !== rate * align
      )
        throw invalid();
      format = { codec, channels, rate, align, bits };
    } else if (type === 'data') {
      if (dataSize || !size) throw invalid();
      dataSize = size;
    }
    offset = start + size + (size % 2);
  }
  if (offset !== bytes.length || !format || !dataSize || dataSize % format.align) throw invalid();
  const duration = dataSize / format.align / format.rate;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 10)
    throw new AppError(
      'Die WAV-Spur darf höchstens zehn Sekunden dauern.',
      413,
      'MOTION_AUDIO_LIMIT'
    );
  return { ...format, duration };
}
export async function bindMotionAudio(
  userId: string,
  body: Record<string, unknown>,
  tx: TransactionScope
) {
  if (!body.audioAssetId) {
    const next = { ...body };
    delete next.audio;
    return next;
  }
  if (body.type !== 'video' || body.format !== 'json')
    throw new AppError(
      'Audio gehört zu einer gespeicherten Plum-Animation.',
      400,
      'MOTION_AUDIO_REQUIRED'
    );
  const model = parseAssistantMotion(String(body.content));
  const asset = await tx.get(
    'SELECT * FROM assistant_assets WHERE id=? AND user_id=?',
    body.audioAssetId,
    userId
  );
  if (!asset || asset.mime_type !== 'audio/wav')
    throw new AppError('Eigenes WAV-Original nicht gefunden', 404, 'NOT_FOUND');
  const bytes = Buffer.from(asset.bytes),
    sha = createHash('sha256').update(bytes).digest('hex'),
    facts = waveFacts(bytes);
  if (sha !== asset.sha256)
    throw new AppError('Audiooriginal wurde verändert', 409, 'ORIGINAL_AUDIO_CHANGED');
  if (facts.duration > model.duration + 0.001)
    throw new AppError(
      'Audiospur ist länger als die Animation. Kürzere Spur oder längere Animation wählen.',
      409,
      'MOTION_AUDIO_DURATION'
    );
  return {
    ...body,
    audio: {
      assetId: String(asset.id),
      sha256: sha,
      filename: String(asset.filename),
      duration: facts.duration,
      mimeType: 'audio/wav',
      byteLength: bytes.length,
    },
  };
}
export async function readMotionAudio(userId: string, body: Record<string, unknown>) {
  const metadata = body.audio as { assetId: string; sha256: string } | undefined;
  if (!metadata || body.audioAssetId !== metadata.assetId)
    throw new AppError('Diese Revision enthält keine Audiospur.', 404, 'NOT_FOUND');
  const asset = await get(
    'SELECT * FROM assistant_assets WHERE id=? AND user_id=?',
    metadata.assetId,
    userId
  );
  if (!asset || createHash('sha256').update(asset.bytes).digest('hex') !== metadata.sha256)
    throw new AppError(
      'Audiooriginal ist nicht verfügbar oder verändert.',
      409,
      'ORIGINAL_AUDIO_CHANGED'
    );
  const bytes = Buffer.from(asset.bytes);
  waveFacts(bytes);
  return { bytes, mimeType: 'audio/wav', filename: String(asset.filename) };
}
export const MOTION_AUDIO_INPUT = z
  .object({ commandId: z.string().uuid(), expectedRevision: z.coerce.number().int().positive() })
  .strict();
export async function addMotionAudio(
  userId: string,
  id: string,
  raw: z.input<typeof MOTION_AUDIO_INPUT>,
  file: { buffer: Buffer; originalname: string } | null
) {
  const input = MOTION_AUDIO_INPUT.parse(raw),
    sha = file ? createHash('sha256').update(file.buffer).digest('hex') : null;
  if (file) waveFacts(file.buffer);
  const filename = file
    ? path
        .basename(file.originalname)
        .replace(/[\u0000-\u001f]/g, '')
        .slice(0, 200) || 'Audio.wav'
    : null;
  const hash = createHash('sha256')
    .update(JSON.stringify([id, input.expectedRevision, sha, filename]))
    .digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (
        prior.action !== 'motion-audio' ||
        prior.resource_id !== id ||
        prior.payload_hash !== hash
      )
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return JSON.parse(String(prior.result_json));
    }
    const artifact = await findResource(userId, id, tx);
    if (artifact.body.type !== 'video' || artifact.body.format !== 'json')
      throw new AppError('Zuerst eine Plum-Animation speichern.', 409, 'MOTION_SAVE_REQUIRED');
    if (artifact.revision !== input.expectedRevision)
      throw new AppError('Animation wurde inzwischen geändert.', 409, 'REVISION_CONFLICT');
    let assetId: string | undefined;
    if (file) {
      await tx.run(
        'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO NOTHING',
        randomUUID(),
        userId,
        filename,
        'audio/wav',
        sha,
        file.buffer,
        new Date().toISOString()
      );
      assetId = String(
        (await tx.get('SELECT id FROM assistant_assets WHERE user_id=? AND sha256=?', userId, sha))
          .id
      );
    }
    const revised = await reviseResource(
      userId,
      id,
      artifact.revision,
      artifact.title,
      { ...artifact.body, audioAssetId: assetId },
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      id,
      hash,
      'motion-audio',
      JSON.stringify(revised),
      now,
      now
    );
    return revised;
  });
}
