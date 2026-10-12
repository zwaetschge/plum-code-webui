import { randomUUID, createHash } from 'node:crypto';
import { transaction } from '../../db/pg.js';
import { assistantTranscription } from './voice.js';
import { createResource, BODY_SCHEMAS } from './resources.js';
import { AppError } from '../../middleware/errorHandler.js';
export async function importMeeting(
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string }
) {
  if (!file.mimetype.startsWith('audio/') && file.mimetype !== 'video/mp4')
    throw new AppError('Bitte eine Audioaufnahme auswählen', 400, 'INVALID_AUDIO');
  const transcript = await assistantTranscription(userId, file, 'de');
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const assetId = await transaction(async (tx) => {
    const id = randomUUID();
    await tx.run(
      `INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO NOTHING`,
      id,
      userId,
      file.originalname.slice(0, 200),
      file.mimetype,
      sha256,
      file.buffer,
      new Date().toISOString()
    );
    const row = await tx.get(
      'SELECT id FROM assistant_assets WHERE user_id = ? AND sha256 = ?',
      userId,
      sha256
    );
    return String(row.id);
  });
  const words = Array.isArray(transcript.words)
    ? transcript.words
        .flatMap((raw: unknown) => {
          if (!raw || typeof raw !== 'object') return [];
          const value = raw as Record<string, unknown>;
          return typeof value.word === 'string' &&
            typeof value.start === 'number' &&
            typeof value.end === 'number' &&
            Number.isFinite(value.start) &&
            Number.isFinite(value.end) &&
            value.start >= 0 &&
            value.end >= value.start
            ? [{ word: value.word.slice(0, 200), start: value.start, end: value.end }]
            : [];
        })
        .slice(0, 12000)
    : [];
  return createResource(
    userId,
    'meeting',
    file.originalname.slice(0, 200),
    BODY_SCHEMAS.meeting.parse({
      transcript: transcript.text,
      originalTranscript: transcript.text,
      words,
      audioAssetId: assetId,
      recordedAt: new Date().toISOString(),
    })
  );
}
