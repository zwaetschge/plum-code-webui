import {
  get as pgGet,
  all as pgAll,
  run as pgRun,
  transaction as pgTransaction,
} from '../db/pg.js';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ChatUpload,
  CreateChatUploadInput,
  FileAttachmentData,
} from '@plum-code-webui/shared';

import { getDatabasePath } from '../db/index.js';
import { MAX_CHAT_MEDIA_BYTES } from './chatMedia.js';

const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const MIN_CHUNK_BYTES = 256 * 1024;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const uploadLocks = new Map<string, Promise<unknown>>();

export const MAX_CHAT_UPLOAD_FILES = 10;
export const MAX_CHAT_UPLOAD_TOTAL_BYTES = 32 * 1024 * 1024;

interface UploadRow {
  id: string;
  userId: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  chunkSize: number;
  totalChunks: number;
  receivedBytes: number;
  status: ChatUpload['status'];
  error: string | null;
  reservedDeliveryId: string | null;
  consumedMessageId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export class ChatUploadError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'INVALID_UPLOAD'
  ) {
    super(message);
  }
}

function storageRoot(): string {
  return process.env.CHAT_UPLOAD_DIR
    ? path.resolve(process.env.CHAT_UPLOAD_DIR)
    : path.join(path.dirname(getDatabasePath()), 'chat-uploads');
}

function userSegment(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 32);
}

function uploadDirectory(userId: string, uploadId: string): string {
  return path.join(storageRoot(), userSegment(userId), uploadId);
}

function chunkPath(row: Pick<UploadRow, 'userId' | 'id'>, chunkIndex: number): string {
  return path.join(uploadDirectory(row.userId, row.id), `chunk-${chunkIndex}`);
}

function completedPath(row: Pick<UploadRow, 'userId' | 'id'>): string {
  return path.join(uploadDirectory(row.userId, row.id), 'complete.bin');
}

function safeFilename(value: string): string {
  const filename = path.basename(value.replaceAll('\\', '/'));
  const clean = filename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240);
  if (!clean || /^\.+$/.test(clean)) throw new ChatUploadError('filename is invalid');
  return clean;
}

async function readOwnedUpload(
  userId: string,
  sessionId: string,
  uploadId: string
): Promise<UploadRow> {
  const row = (await pgGet(
    `SELECT id, user_id AS userId, session_id AS sessionId, filename,
              mime_type AS mimeType, byte_size AS byteSize, sha256,
              chunk_size AS chunkSize, total_chunks AS totalChunks,
              received_bytes AS receivedBytes, status, error,
              reserved_delivery_id AS reservedDeliveryId,
              consumed_message_id AS consumedMessageId,
              expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt
         FROM chat_uploads
        WHERE id = ? AND user_id = ? AND session_id = ?`,
    uploadId,
    userId,
    sessionId
  )) as unknown as UploadRow | undefined;
  if (!row) throw new ChatUploadError('Upload not found', 404, 'UPLOAD_NOT_FOUND');
  if (
    row.status !== 'cancelled' &&
    !row.consumedMessageId &&
    Date.parse(row.expiresAt) <= Date.now()
  ) {
    await pgTransaction(async (tx) => {
      await tx.run(`DELETE FROM chat_upload_chunks WHERE upload_id = ?`, row.id);
      await tx.run(
        `UPDATE chat_uploads
            SET status = 'cancelled', received_bytes = 0,
                error = 'Upload expired', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        row.id
      );
    });
    void rm(uploadDirectory(row.userId, row.id), { recursive: true, force: true });
    throw new ChatUploadError('Upload expired', 410, 'UPLOAD_EXPIRED');
  }
  return row;
}

async function chunkIndexes(uploadId: string): Promise<number[]> {
  return (
    (await pgAll(
      `SELECT chunk_index AS chunkIndex
           FROM chat_upload_chunks
          WHERE upload_id = ? ORDER BY chunk_index ASC`,
      uploadId
    )) as unknown as Array<{ chunkIndex: number }>
  ).map((row) => row.chunkIndex);
}

function toPublicUpload(row: UploadRow, receivedChunks: number[]): ChatUpload {
  const received = new Set(receivedChunks);
  const missingChunks = Array.from({ length: row.totalChunks }, (_, index) => index).filter(
    (index) => !received.has(index)
  );
  return {
    id: row.id,
    sessionId: row.sessionId,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    chunkSize: row.chunkSize,
    totalChunks: row.totalChunks,
    receivedBytes: row.receivedBytes,
    receivedChunks,
    missingChunks,
    progress: Math.min(1, row.receivedBytes / row.byteSize),
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function withUploadLock<T>(uploadId: string, action: () => Promise<T>): Promise<T> {
  const previous = uploadLocks.get(uploadId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  uploadLocks.set(uploadId, current);
  return current.finally(() => {
    if (uploadLocks.get(uploadId) === current) uploadLocks.delete(uploadId);
  });
}

export async function createChatUpload(
  userId: string,
  sessionId: string,
  input: CreateChatUploadInput
): Promise<ChatUpload> {
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new ChatUploadError('byteSize must be a positive integer');
  }
  if (input.byteSize > MAX_CHAT_MEDIA_BYTES) {
    throw new ChatUploadError('Upload exceeds 25 MB', 413, 'UPLOAD_TOO_LARGE');
  }
  if (!SHA256_PATTERN.test(input.sha256)) throw new ChatUploadError('sha256 is invalid');
  const session = await pgGet(
    `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
    sessionId,
    userId
  );
  if (!session) throw new ChatUploadError('Session not found', 404, 'SESSION_NOT_FOUND');
  const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_BYTES;
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize < MIN_CHUNK_BYTES ||
    chunkSize > MAX_CHUNK_BYTES
  ) {
    throw new ChatUploadError(
      `chunkSize must be between ${MIN_CHUNK_BYTES} and ${MAX_CHUNK_BYTES} bytes`
    );
  }
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
  const mimeType = input.mimeType?.trim() || 'application/octet-stream';
  if (mimeType.length > 200 || /[\u0000-\u001f\u007f]/.test(mimeType)) {
    throw new ChatUploadError('mimeType is invalid');
  }
  await mkdir(uploadDirectory(userId, id), { recursive: true, mode: 0o700 });
  await pgRun(
    `INSERT INTO chat_uploads (
       id, user_id, session_id, filename, mime_type, byte_size, sha256,
       chunk_size, total_chunks, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    sessionId,
    safeFilename(input.filename),
    mimeType,
    input.byteSize,
    input.sha256.toLowerCase(),
    chunkSize,
    Math.ceil(input.byteSize / chunkSize),
    expiresAt
  );
  return getChatUpload(userId, sessionId, id);
}

export async function getChatUpload(
  userId: string,
  sessionId: string,
  uploadId: string
): Promise<ChatUpload> {
  const row = await readOwnedUpload(userId, sessionId, uploadId);
  return toPublicUpload(row, await chunkIndexes(uploadId));
}

async function assembleUpload(row: UploadRow): Promise<void> {
  const destination = completedPath(row);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const hash = createHash('sha256');
  let assembledBytes = 0;
  const output = await open(temporary, 'wx', 0o600);
  try {
    // Read and append one bounded chunk at a time. Promise.all + Buffer.concat
    // briefly held multiple copies of every large attachment in memory.
    for (let index = 0; index < row.totalChunks; index += 1) {
      const bytes = await readFile(chunkPath(row, index));
      assembledBytes += bytes.length;
      hash.update(bytes);
      await output.writeFile(bytes);
    }
  } catch (error) {
    await output.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
  await output.close();
  const actualHash = hash.digest('hex');
  if (assembledBytes !== row.byteSize || actualHash !== row.sha256) {
    await rm(temporary, { force: true });
    await pgRun(
      `UPDATE chat_uploads
            SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      'Assembled upload failed size or SHA-256 validation',
      row.id
    );
    throw new ChatUploadError(
      'Assembled upload failed size or SHA-256 validation',
      422,
      'UPLOAD_INTEGRITY_FAILED'
    );
  }
  await rename(temporary, destination);
  await pgRun(
    `UPDATE chat_uploads
          SET status = 'complete', error = NULL, received_bytes = byte_size,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    row.id
  );
}

export async function putChatUploadChunk(
  userId: string,
  sessionId: string,
  uploadId: string,
  chunkIndex: number,
  bytes: Buffer,
  declaredSha256?: string,
  contentRange?: { start: number; end: number; total: number }
): Promise<ChatUpload> {
  return withUploadLock(uploadId, async () => {
    const row = await readOwnedUpload(userId, sessionId, uploadId);
    if (row.status === 'cancelled' || row.status === 'failed') {
      throw new ChatUploadError(`Upload is ${row.status}`, 409, 'UPLOAD_NOT_PENDING');
    }
    if (row.status === 'complete') return getChatUpload(userId, sessionId, uploadId);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= row.totalChunks) {
      throw new ChatUploadError('Chunk index is outside upload range');
    }
    const expectedStart = chunkIndex * row.chunkSize;
    const expectedBytes = Math.min(row.chunkSize, row.byteSize - expectedStart);
    if (bytes.length !== expectedBytes) {
      throw new ChatUploadError(`Chunk must contain exactly ${expectedBytes} bytes`);
    }
    if (
      contentRange &&
      (contentRange.start !== expectedStart ||
        contentRange.end !== expectedStart + expectedBytes - 1 ||
        contentRange.total !== row.byteSize)
    ) {
      throw new ChatUploadError('Content-Range does not match this chunk');
    }
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (declaredSha256 && declaredSha256.toLowerCase() !== actualHash) {
      throw new ChatUploadError('Chunk SHA-256 does not match', 422, 'CHUNK_INTEGRITY_FAILED');
    }
    const existing = (await pgGet(
      `SELECT byte_size AS byteSize, sha256
           FROM chat_upload_chunks WHERE upload_id = ? AND chunk_index = ?`,
      uploadId,
      chunkIndex
    )) as unknown as { byteSize: number; sha256: string } | undefined;
    if (existing) {
      if (existing.byteSize !== bytes.length || existing.sha256 !== actualHash) {
        throw new ChatUploadError(
          'Chunk index already contains different data',
          409,
          'CHUNK_CONFLICT'
        );
      }
      return getChatUpload(userId, sessionId, uploadId);
    }

    const destination = chunkPath(row, chunkIndex);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
    try {
      await pgTransaction(async (tx) => {
        await tx.run(
          `INSERT INTO chat_upload_chunks (upload_id, chunk_index, byte_size, sha256)
           VALUES (?, ?, ?, ?)`,
          uploadId,
          chunkIndex,
          bytes.length,
          actualHash
        );
        await tx.run(
          `UPDATE chat_uploads
              SET received_bytes = received_bytes + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
          bytes.length,
          uploadId
        );
      });
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
    const afterChunk = await readOwnedUpload(userId, sessionId, uploadId);
    if ((await chunkIndexes(uploadId)).length === row.totalChunks) await assembleUpload(afterChunk);
    return getChatUpload(userId, sessionId, uploadId);
  });
}

export async function cancelChatUpload(
  userId: string,
  sessionId: string,
  uploadId: string
): Promise<ChatUpload> {
  return withUploadLock(uploadId, async () => {
    const row = await readOwnedUpload(userId, sessionId, uploadId);
    if (row.consumedMessageId) {
      throw new ChatUploadError('Upload is already attached to a message', 409, 'UPLOAD_CONSUMED');
    }
    await pgTransaction(async (tx) => {
      await tx.run(`DELETE FROM chat_upload_chunks WHERE upload_id = ?`, uploadId);
      await tx.run(
        `UPDATE chat_uploads
            SET status = 'cancelled', received_bytes = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        uploadId
      );
    });
    await rm(uploadDirectory(userId, uploadId), { recursive: true, force: true });
    return getChatUpload(userId, sessionId, uploadId);
  });
}

export async function resolveChatUploads(
  userId: string,
  sessionId: string,
  uploadIds: string[],
  reservationId: string,
  additional: { fileCount?: number; byteSize?: number } = {}
): Promise<Array<FileAttachmentData & { uploadId: string }>> {
  const uniqueIds = [...new Set(uploadIds)];
  const additionalFiles = Math.max(0, additional.fileCount ?? 0);
  const additionalBytes = Math.max(0, additional.byteSize ?? 0);
  if (
    !Number.isSafeInteger(additionalFiles) ||
    !Number.isSafeInteger(additionalBytes) ||
    uploadIds.length + additionalFiles > MAX_CHAT_UPLOAD_FILES ||
    uniqueIds.length + additionalFiles > MAX_CHAT_UPLOAD_FILES
  ) {
    throw new ChatUploadError(
      `A message can contain at most ${MAX_CHAT_UPLOAD_FILES} uploads`,
      413,
      'TOO_MANY_UPLOADS'
    );
  }
  if (additionalBytes > MAX_CHAT_UPLOAD_TOTAL_BYTES) {
    throw new ChatUploadError('Combined uploads exceed 32 MiB', 413, 'UPLOAD_TOTAL_TOO_LARGE');
  }
  if (!reservationId || reservationId.length > 160) {
    throw new ChatUploadError('A valid delivery id is required', 400, 'INVALID_DELIVERY_ID');
  }
  const rows = await pgTransaction(async (tx) => {
    const validated: UploadRow[] = [];
    let totalBytes = additionalBytes;
    for (const uploadId of uniqueIds) {
      const row = await readOwnedUpload(userId, sessionId, uploadId);
      if (row.status !== 'complete') {
        throw new ChatUploadError(`Upload ${uploadId} is not complete`, 409, 'UPLOAD_NOT_COMPLETE');
      }
      if (row.consumedMessageId) {
        throw new ChatUploadError(
          `Upload ${uploadId} is already attached to a message`,
          409,
          'UPLOAD_CONSUMED'
        );
      }
      totalBytes += row.byteSize;
      if (totalBytes > MAX_CHAT_UPLOAD_TOTAL_BYTES) {
        throw new ChatUploadError('Combined uploads exceed 32 MiB', 413, 'UPLOAD_TOTAL_TOO_LARGE');
      }
      const claimed = await tx.run(
        `UPDATE chat_uploads
              SET reserved_delivery_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ? AND session_id = ?
              AND consumed_message_id IS NULL
              AND (reserved_delivery_id IS NULL OR reserved_delivery_id = ?)`,
        reservationId,
        uploadId,
        userId,
        sessionId,
        reservationId
      );
      if (claimed.changes !== 1) {
        throw new ChatUploadError(`Upload ${uploadId} is already reserved`, 409, 'UPLOAD_RESERVED');
      }
      validated.push(row);
    }
    return validated;
  });
  const resolved: Array<FileAttachmentData & { uploadId: string }> = [];
  // Resolve sequentially so raw Buffers are not all resident at once. The
  // returned base64 strings are the only unavoidable aggregate allocation.
  for (const row of rows) {
    const bytes = await readFile(completedPath(row));
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== row.byteSize || actualHash !== row.sha256) {
      throw new ChatUploadError(
        'Completed upload failed integrity check',
        422,
        'UPLOAD_INTEGRITY_FAILED'
      );
    }
    resolved.push({
      uploadId: row.id,
      data: bytes.toString('base64'),
      mimeType: row.mimeType,
      filename: row.filename,
    });
  }
  return resolved;
}

export async function markChatUploadsConsumed(
  userId: string,
  sessionId: string,
  uploadIds: string[],
  messageId: string,
  reservationId: string
): Promise<void> {
  await pgTransaction(async (tx) => {
    for (const uploadId of [...new Set(uploadIds)]) {
      const linked = await tx.run(
        `UPDATE chat_uploads
            SET consumed_message_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND session_id = ?
            AND status = 'complete' AND consumed_message_id IS NULL
            AND reserved_delivery_id = ?`,
        messageId,
        uploadId,
        userId,
        sessionId,
        reservationId
      );
      if (linked.changes !== 1) {
        throw new ChatUploadError(`Upload ${uploadId} could not be linked`, 409, 'UPLOAD_CONSUMED');
      }
    }
  });
  for (const uploadId of [...new Set(uploadIds)]) {
    void rm(uploadDirectory(userId, uploadId), { recursive: true, force: true });
  }
}

export async function releaseChatUploadReservations(
  userId: string,
  sessionId: string,
  uploadIds: string[],
  reservationId: string
): Promise<void> {
  await pgTransaction(async (tx) => {
    for (const uploadId of [...new Set(uploadIds)]) {
      await tx.run(
        `UPDATE chat_uploads
            SET reserved_delivery_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND session_id = ?
            AND reserved_delivery_id = ? AND consumed_message_id IS NULL`,
        uploadId,
        userId,
        sessionId,
        reservationId
      );
    }
  });
}

/** Remove expired and DB-orphaned opaque upload directories. */
export async function cleanupExpiredChatUploads(): Promise<number> {
  const expired = (await pgAll(`SELECT id, user_id AS userId
         FROM chat_uploads
        WHERE consumed_message_id IS NULL
          AND status IN ('pending', 'complete', 'failed')
          AND expires_at <= CURRENT_TIMESTAMP`)) as unknown as Array<{
    id: string;
    userId: string;
  }>;
  await pgTransaction(async (tx) => {
    for (const upload of expired) {
      await tx.run(`DELETE FROM chat_upload_chunks WHERE upload_id = ?`, upload.id);
      await tx.run(
        `UPDATE chat_uploads
            SET status = 'cancelled', received_bytes = 0, error = 'Upload expired',
                reserved_delivery_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        upload.id
      );
    }
  });
  await Promise.all(
    expired.map(
      async (upload) =>
        await rm(uploadDirectory(upload.userId, upload.id), { recursive: true, force: true })
    )
  );

  // Cascading a session/user deletion removes DB rows before this service can
  // see them, so prune server-generated UUID directories that have no row.
  let removedOrphans = 0;
  const root = storageRoot();
  const userDirectories = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const userDirectory of userDirectories) {
    if (!userDirectory.isDirectory() || !/^[a-f0-9]{32}$/.test(userDirectory.name)) continue;
    const absoluteUserDirectory = path.join(root, userDirectory.name);
    const entries = await readdir(absoluteUserDirectory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
      if (await pgGet(`SELECT 1 FROM chat_uploads WHERE id = ?`, entry.name)) continue;
      const orphanPath = path.join(absoluteUserDirectory, entry.name);
      const info = await lstat(orphanPath).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink()) continue;
      await rm(orphanPath, { recursive: true, force: true });
      removedOrphans += 1;
    }
  }
  return expired.length + removedOrphans;
}

const cleanupTimer = setInterval(
  () => {
    void cleanupExpiredChatUploads().catch(() => undefined);
  },
  15 * 60 * 1000
);
cleanupTimer.unref();
