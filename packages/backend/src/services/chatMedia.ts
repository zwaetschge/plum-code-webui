import { get as pgGet, all as pgAll, run as pgRun } from '../db/pg.js';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ChatMedia, ChatMediaSource } from '@plum-code-webui/shared';
import { getDatabasePath } from '../db/index.js';

export const MAX_CHAT_MEDIA_BYTES = 25 * 1024 * 1024;

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp|gif|bin)$/i;

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
]);

interface PendingChatMediaBase {
  filename?: string;
  mimeType?: string;
  altText?: string;
  source: ChatMediaSource;
  /** Provider/job id used to make repeated delivery idempotent. */
  sourceId?: string;
}

export interface PendingChatMediaBuffer extends PendingChatMediaBase {
  kind: 'buffer';
  buffer: Buffer;
}

export interface PendingChatMediaFile extends PendingChatMediaBase {
  kind: 'file';
  filePath: string;
  /** The resolved file must remain inside at least one of these roots. */
  allowedRoots: string[];
}

export type PendingChatMedia = PendingChatMediaBuffer | PendingChatMediaFile;

export interface PersistMessageMediaInput {
  messageId: string;
  sessionId: string;
  userId: string;
  media: PendingChatMedia[];
}

export interface ResolvedChatMedia extends ChatMedia {
  filePath: string;
  sha256: string;
}

interface MessageMediaRow {
  id: string;
  messageId: string;
  sessionId: string;
  userId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  altText: string | null;
  source: ChatMediaSource;
  sourceId: string | null;
}

interface PreparedChatMedia {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  altText: string | null;
  source: ChatMediaSource;
  sourceId: string | null;
}

export function chatMediaStorageDirectory(): string {
  return process.env.CHAT_MEDIA_DIR
    ? path.resolve(process.env.CHAT_MEDIA_DIR)
    : path.join(path.dirname(getDatabasePath()), 'chat-media');
}

function userStorageSegment(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 32);
}

function userStorageDirectory(userId: string): string {
  return path.join(chatMediaStorageDirectory(), userStorageSegment(userId));
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function detectChatMediaMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const signature = bytes.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function cleanFilename(filename: string | undefined, mimeType: string): string {
  const imageExtension = MIME_TO_EXTENSION[mimeType];
  const fallback = imageExtension ? `image${imageExtension}` : 'attachment';
  const raw = path.basename(filename || fallback);
  const withoutControls = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const compact = (withoutControls && !/^\.+$/.test(withoutControls) ? withoutControls : fallback)
    .slice(0, 240)
    .trim();
  if (!imageExtension) return compact || fallback;
  const stem = path.basename(compact, path.extname(compact)).trim() || 'image';
  return `${stem.slice(0, 220)}${imageExtension}`;
}

function cleanAltText(altText: string | undefined): string | null {
  const cleaned = altText
    ?.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 1000) : null;
}

function cleanSourceId(sourceId: string | undefined): string | null {
  if (!sourceId) return null;
  const cleaned = sourceId.trim();
  if (!cleaned || cleaned.length > 256 || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new Error('invalid chat media source id');
  }
  return cleaned;
}

function validateBytes(
  bytes: Buffer,
  declaredMimeType: string | undefined,
  filename: string | undefined,
  source: ChatMediaSource,
  sourceId: string | undefined,
  altText: string | undefined
): PreparedChatMedia {
  if (bytes.length === 0) throw new Error('chat media is empty');
  if (bytes.length > MAX_CHAT_MEDIA_BYTES) throw new Error('chat media exceeds 25 MB');

  const declared = declaredMimeType?.split(';', 1)[0]?.trim().toLowerCase();
  const detectedImage = detectChatMediaMime(bytes);
  let mimeType: string;

  if (detectedImage) {
    if (declared && declared !== detectedImage && declared !== 'application/octet-stream') {
      throw new Error(`chat media type mismatch (declared ${declared}, detected ${detectedImage})`);
    }
    mimeType = detectedImage;
  } else if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    if (declared && declared !== 'application/pdf' && declared !== 'application/octet-stream') {
      throw new Error(`chat media type mismatch (declared ${declared}, detected application/pdf)`);
    }
    mimeType = 'application/pdf';
  } else if (declared?.startsWith('text/') || (declared && TEXT_MIME_TYPES.has(declared))) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      mimeType = declared;
    } catch {
      mimeType = 'application/octet-stream';
    }
  } else {
    // Unknown documents stay downloadable but never inherit a client supplied
    // executable MIME type. The route serves them as attachments with nosniff.
    mimeType = 'application/octet-stream';
  }

  return {
    bytes,
    filename: cleanFilename(filename, mimeType),
    mimeType,
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    altText: cleanAltText(altText),
    source,
    sourceId: cleanSourceId(sourceId),
  };
}

async function readAllowedFile(filePath: string, allowedRoots: string[]): Promise<Buffer> {
  if (!path.isAbsolute(filePath)) throw new Error('chat media file path must be absolute');
  if (allowedRoots.length === 0) throw new Error('chat media file has no allowed root');

  const roots = await Promise.all(
    allowedRoots.map(async (root) => {
      const resolved = await realpath(root);
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error('chat media allowed root is not a directory');
      return resolved;
    })
  );
  const resolvedFile = await realpath(filePath);
  if (!roots.some((root) => isPathInside(root, resolvedFile))) {
    throw new Error('chat media file is outside allowed roots');
  }

  const handle = await open(resolvedFile, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    // Re-check the opened inode through procfs. This closes the realpath/open
    // race for mutable workspace trees and rejects a symlink swap to a host file.
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`).catch(() => resolvedFile);
    if (!roots.some((root) => isPathInside(root, openedPath))) {
      throw new Error('chat media file escaped allowed roots');
    }
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('chat media path is not a regular file');
    if (info.size === 0) throw new Error('chat media is empty');
    if (info.size > MAX_CHAT_MEDIA_BYTES) throw new Error('chat media exceeds 25 MB');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function preparePendingMedia(pending: PendingChatMedia): Promise<PreparedChatMedia> {
  const bytes =
    pending.kind === 'buffer'
      ? pending.buffer
      : await readAllowedFile(pending.filePath, pending.allowedRoots);
  const filename =
    pending.filename || (pending.kind === 'file' ? path.basename(pending.filePath) : undefined);
  return validateBytes(
    bytes,
    pending.mimeType,
    filename,
    pending.source,
    pending.sourceId,
    pending.altText
  );
}

function toChatMedia(row: MessageMediaRow): ChatMedia {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    ...(row.altText ? { altText: row.altText } : {}),
    source: row.source,
  };
}

const MEDIA_SELECT = `
  SELECT
    message_media.id,
    message_media.message_id AS messageId,
    message_media.session_id AS sessionId,
    message_media.user_id AS userId,
    message_media.storage_key AS storageKey,
    message_media.filename,
    message_media.mime_type AS mimeType,
    message_media.byte_size AS byteSize,
    message_media.sha256,
    message_media.alt_text AS altText,
    message_media.source,
    message_media.source_id AS sourceId
  FROM message_media
`;

async function ensureStoredBlob(
  userId: string,
  prepared: PreparedChatMedia,
  reusableStorageKey?: string
): Promise<string> {
  const userDirectory = userStorageDirectory(userId);
  await mkdir(userDirectory, { recursive: true, mode: 0o700 });

  const extension = MIME_TO_EXTENSION[prepared.mimeType] ?? '.bin';
  const storageKey =
    reusableStorageKey && STORAGE_KEY_PATTERN.test(reusableStorageKey)
      ? reusableStorageKey
      : `${randomUUID()}${extension}`;
  const destination = path.join(userDirectory, storageKey);

  try {
    const existing = await stat(destination);
    if (existing.isFile() && existing.size === prepared.byteSize) return storageKey;
  } catch {
    // Missing blob is written below. A stale DB row can therefore self-heal.
  }

  const temporary = path.join(userDirectory, `.${storageKey}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, prepared.bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return storageKey;
}

/** Persist validated media rows and return only the public, path-free shape. */
export async function persistMessageMedia(input: PersistMessageMediaInput): Promise<ChatMedia[]> {
  if (input.media.length === 0) return [];

  const owner = await pgGet(
    `SELECT m.id
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.id = ? AND m.session_id = ? AND s.user_id = ?`,
    input.messageId,
    input.sessionId,
    input.userId
  );
  if (!owner) throw new Error('chat media message does not belong to session owner');

  const preparedItems = await Promise.all(input.media.map(preparePendingMedia));
  const results: ChatMedia[] = [];
  const resultIds = new Set<string>();
  const addResult = (media: ChatMedia): void => {
    if (resultIds.has(media.id)) return;
    resultIds.add(media.id);
    results.push(media);
  };

  for (const prepared of preparedItems) {
    const existingForMessage = (await pgGet(
      `${MEDIA_SELECT} WHERE message_id = ? AND sha256 = ? LIMIT 1`,
      input.messageId,
      prepared.sha256
    )) as unknown as MessageMediaRow | undefined;
    if (existingForMessage) {
      addResult(toChatMedia(existingForMessage));
      continue;
    }

    if (prepared.sourceId) {
      const sourceMatch = (await pgGet(
        `${MEDIA_SELECT}
           WHERE session_id = ? AND source = ? AND source_id = ? LIMIT 1`,
        input.sessionId,
        prepared.source,
        prepared.sourceId
      )) as unknown as MessageMediaRow | undefined;
      if (sourceMatch) {
        if (sourceMatch.messageId !== input.messageId) {
          throw new Error('chat media source id is already attached to another message');
        }
        addResult(toChatMedia(sourceMatch));
        continue;
      }
    }

    const reusable = (await pgGet(
      `SELECT storage_key AS storageKey
         FROM message_media
         WHERE user_id = ? AND sha256 = ?
         ORDER BY created_at ASC, id ASC LIMIT 1`,
      input.userId,
      prepared.sha256
    )) as unknown as { storageKey: string } | undefined;
    const storageKey = await ensureStoredBlob(input.userId, prepared, reusable?.storageKey);
    const id = randomUUID();

    await pgRun(
      `INSERT INTO message_media (
           id, message_id, session_id, user_id, storage_key, filename,
           mime_type, byte_size, sha256, alt_text, source, source_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.messageId,
      input.sessionId,
      input.userId,
      storageKey,
      prepared.filename,
      prepared.mimeType,
      prepared.byteSize,
      prepared.sha256,
      prepared.altText,
      prepared.source,
      prepared.sourceId
    );

    addResult(
      toChatMedia({
        id,
        messageId: input.messageId,
        sessionId: input.sessionId,
        userId: input.userId,
        storageKey,
        filename: prepared.filename,
        mimeType: prepared.mimeType,
        byteSize: prepared.byteSize,
        sha256: prepared.sha256,
        altText: prepared.altText,
        source: prepared.source,
        sourceId: prepared.sourceId,
      })
    );
  }

  return results;
}

/** Load persisted public media grouped by message id for REST hydration. */
export async function loadMessageMedia(messageIds: string[]): Promise<Map<string, ChatMedia[]>> {
  const grouped = new Map<string, ChatMedia[]>();
  if (messageIds.length === 0) return grouped;

  for (let offset = 0; offset < messageIds.length; offset += 500) {
    const batch = messageIds.slice(offset, offset + 500);
    const placeholders = batch.map(() => '?').join(', ');
    const rows = (await pgAll(
      `${MEDIA_SELECT}
         WHERE message_id IN (${placeholders})
         ORDER BY created_at ASC, message_media.seq ASC`,
      ...batch
    )) as unknown as MessageMediaRow[];
    for (const row of rows) {
      const media = grouped.get(row.messageId) ?? [];
      media.push(toChatMedia(row));
      grouped.set(row.messageId, media);
    }
  }
  return grouped;
}

/** Resolve one file only when both the session and media belong to the caller. */
export async function resolveOwnedChatMedia(input: {
  mediaId: string;
  sessionId: string;
  userId: string;
}): Promise<ResolvedChatMedia | null> {
  const row = (await pgGet(
    `${MEDIA_SELECT}
       JOIN sessions s ON s.id = message_media.session_id
       WHERE message_media.id = ?
         AND message_media.session_id = ?
         AND message_media.user_id = ?
         AND s.user_id = ?
       LIMIT 1`,
    input.mediaId,
    input.sessionId,
    input.userId,
    input.userId
  )) as unknown as MessageMediaRow | undefined;
  if (!row || !STORAGE_KEY_PATTERN.test(row.storageKey)) return null;

  const userDirectory = userStorageDirectory(input.userId);
  let root: string;
  let filePath: string;
  try {
    root = await realpath(userDirectory);
    filePath = await realpath(path.join(userDirectory, row.storageKey));
    const info = await stat(filePath);
    if (!info.isFile() || info.size !== row.byteSize || !isPathInside(root, filePath)) return null;
  } catch {
    return null;
  }

  return {
    ...toChatMedia(row),
    filePath,
    sha256: row.sha256,
  };
}

/** Convenience helper for controlled adapters that already own a file Buffer. */
export async function readOwnedChatMediaBytes(media: ResolvedChatMedia): Promise<Buffer> {
  return readFile(media.filePath);
}
