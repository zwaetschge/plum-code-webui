import { createHash, randomUUID } from 'node:crypto';
import { get, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createResource, findResource } from './resources.js';
import { imageMime } from './apiFiles.js';
export interface ChatToolFile {
  id: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  artifactId: string | null;
}
function mediaType(bytes: Buffer, supplied: string) {
  try {
    return imageMime(bytes);
  } catch {
    /* Other file types remain downloadable. */
  }
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE')
    return 'audio/wav';
  if (bytes.subarray(0, 4).toString() === 'fLaC') return 'audio/flac';
  if (bytes.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (bytes.subarray(0, 3).toString() === 'ID3') return 'audio/mpeg';
  if (bytes.subarray(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (['text/plain', 'text/csv', 'application/json'].includes(supplied)) {
    try {
      new TextDecoder('utf8', { fatal: true }).decode(bytes);
      return supplied;
    } catch {
      /* Binary. */
    }
  }
  return 'application/octet-stream';
}
/** Persist embedded MCP results only. Never follow server file:// paths or fetch a remote URL. */
export async function handoffChatToolResult(
  userId: string,
  chatId: string,
  turnId: string,
  raw: unknown
) {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { content?: unknown }).content))
    return { result: raw, files: [] as ChatToolFile[] };
  const result = raw as Record<string, unknown> & { content: unknown[] };
  const content: unknown[] = [],
    files: ChatToolFile[] = [];
  let budget = 3 * 1024 * 1024;
  for (const item of result.content.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    const resource =
      block.resource && typeof block.resource === 'object'
        ? (block.resource as Record<string, unknown>)
        : null;
    const encoded = ['image', 'audio'].includes(String(block.type)) ? block.data : resource?.blob;
    const text = block.type === 'resource' ? resource?.text : undefined;
    if (typeof encoded !== 'string' && typeof text !== 'string') {
      content.push(block);
      continue;
    }
    const data =
      typeof encoded === 'string' ? encoded : Buffer.from(String(text)).toString('base64');
    if (
      files.length >= 12 ||
      data.length > 4 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    ) {
      content.push({
        type: 'text',
        text: 'Dateiergebnis überschreitet die Übertragungsgrenze oder ist ungültig.',
      });
      continue;
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > budget) {
      content.push({ type: 'text', text: 'Dateiergebnis überschreitet zusammen 3 MB.' });
      continue;
    }
    const supplied = String(
      block.mimeType ??
        resource?.mimeType ??
        (text !== undefined ? 'text/plain' : 'application/octet-stream')
    );
    const mime = mediaType(bytes, supplied),
      sha = createHash('sha256').update(bytes).digest('hex');
    const uriName = String(resource?.uri ?? '')
      .split('/')
      .pop()
      ?.split(/[?#]/)[0];
    const extension =
      (
        {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/webp': 'webp',
          'image/gif': 'gif',
          'audio/wav': 'wav',
          'audio/mpeg': 'mp3',
          'audio/ogg': 'ogg',
          'audio/flac': 'flac',
          'video/mp4': 'mp4',
          'application/pdf': 'pdf',
          'text/plain': 'txt',
          'text/csv': 'csv',
          'application/json': 'json',
        } as Record<string, string>
      )[mime] ?? 'bin';
    const filename =
      String(block.name ?? uriName ?? `Ergebnis-${files.length + 1}.${extension}`)
        .replace(/[\\/\u0000-\u001f[\]()]/g, '_')
        .slice(0, 180) || `Ergebnis.${extension}`;
    const file = await transaction(async (tx) => {
      await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
      const chat = await findResource(userId, chatId, tx);
      const turn = await tx.get(
        "SELECT id FROM assistant_api_turns WHERE id=? AND chat_id=? AND status='running'",
        turnId,
        chatId
      );
      if (!turn || chat.kind !== 'api-chat')
        throw new AppError('Chatlauf ist nicht mehr aktiv', 409, 'TURN_STOPPED');
      const asset = await tx.get(
        `INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id,filename,mime_type`,
        randomUUID(),
        userId,
        filename,
        mime,
        sha,
        bytes,
        new Date().toISOString()
      );
      await tx.run(
        'INSERT INTO assistant_api_files(chat_id,asset_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING',
        chatId,
        asset.id,
        new Date().toISOString()
      );
      const metadata: ChatToolFile = {
        id: String(asset.id),
        filename: String(asset.filename),
        mimeType: String(asset.mime_type),
        byteLength: bytes.length,
        sha256: sha,
        artifactId: null,
      };
      if (!chat.body.temporary) {
        const prior = await tx.get(
          "SELECT id FROM assistant_resources WHERE user_id=? AND kind='artifact' AND archived=0 AND body_json::jsonb->'toolOrigin'->>'turnId'=? AND body_json::jsonb->'toolOrigin'->>'sha256'=? LIMIT 1",
          userId,
          turnId,
          sha
        );
        if (prior) metadata.artifactId = String(prior.id);
        else {
          const artifact = await createResource(
            userId,
            'artifact',
            metadata.filename,
            {
              type: mime.startsWith('image/')
                ? 'image'
                : mime.startsWith('audio/')
                  ? 'audio'
                  : mime.startsWith('video/')
                    ? 'video'
                    : 'document',
              format: 'markdown',
              content: mime.startsWith('image/')
                ? `![${filename}](/assistant-images/${metadata.id})`
                : '',
              originResourceId: chatId,
              sourceIds: [],
              toolFiles: [{ ...metadata, artifactId: undefined }],
              toolOrigin: { turnId, sha256: sha },
            },
            tx
          );
          metadata.artifactId = artifact.id;
        }
      }
      return metadata;
    });
    budget -= bytes.length;
    files.push(file);
    content.push({
      type: 'text',
      text: `Datei gespeichert: ${file.filename}`,
      file,
      downloadPath: `/api/assistant/api-chats/${chatId}/tool-files/${file.id}`,
    });
  }
  return { result: { ...result, content }, files };
}
export async function artifactToolFile(userId: string, artifactId: string, assetId: string) {
  const artifact = await findResource(userId, artifactId);
  const file = (artifact.body.toolFiles as ChatToolFile[] | undefined)?.find(
    (file) => file.id === assetId
  );
  if (artifact.kind !== 'artifact' || !file)
    throw new AppError('Datei nicht verfügbar', 404, 'NOT_FOUND');
  const row = await get(
    'SELECT filename,mime_type,bytes,sha256 FROM assistant_assets WHERE id=? AND user_id=?',
    assetId,
    userId
  );
  if (!row || createHash('sha256').update(Buffer.from(row.bytes)).digest('hex') !== file.sha256)
    throw new AppError('Dateioriginal nicht verfügbar', 404, 'NOT_FOUND');
  return row;
}
