import archiver from 'archiver';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { Writable } from 'node:stream';
import { transaction, get } from '../../db/pg.js';
import { resolveOwnedChatMedia } from '../chatMedia.js';
import { matrixDownload } from './matrix.js';
import { exportOwnedChatUpload } from '../chatUploads.js';

/** Owner-scoped, repeatable snapshot. Credentials, provider homes and server configuration are excluded. */
export async function assistantExportSnapshot(userId: string) {
  return transaction(
    async (tx) => {
      const owned = 'SELECT id FROM sessions WHERE user_id = ?';
      const resource = 'SELECT id FROM assistant_resources WHERE user_id = ?';
      return {
        format: 'plum-assistant',
        version: 2,
        exportedAt: new Date().toISOString(),
        personalization:
          (
            await tx.get(
              "SELECT COALESCE(NULLIF(settings_json,'')::jsonb,'{}'::jsonb)->'assistantPersonalization' AS preferences FROM user_settings WHERE user_id=?",
              userId
            )
          )?.preferences ?? null,
        memoryJobs: await tx.all('SELECT * FROM assistant_memory_jobs WHERE user_id=?', userId),
        memoryBackfills: await tx.all(
          'SELECT * FROM assistant_memory_backfills WHERE user_id=?',
          userId
        ),
        memoryHistory: await tx.all(
          'SELECT * FROM assistant_memory_history WHERE user_id=?',
          userId
        ),
        publications: await tx.all(
          'SELECT id,resource_id,revision,title,html,content_sha256,expires_at,revoked,created_at FROM assistant_publications WHERE user_id=? ORDER BY created_at,id',
          userId
        ),
        appStates: await tx.all('SELECT * FROM assistant_app_state WHERE user_id = ?', userId),
        apiChatTurns: await tx.all(
          `SELECT * FROM assistant_api_turns WHERE chat_id IN (${resource}) ORDER BY chat_id,seq`,
          userId
        ),
        apiChatUsage: await tx.all(
          'SELECT * FROM assistant_api_usage WHERE user_id=? ORDER BY created_at,id',
          userId
        ),
        apiChatFiles: await tx.all(
          `SELECT f.* FROM assistant_api_files f JOIN assistant_resources r ON r.id=f.chat_id WHERE r.user_id=? ORDER BY f.chat_id,f.created_at`,
          userId
        ),
        resources: await tx.all('SELECT * FROM assistant_resources WHERE user_id = ?', userId),
        sourceWatches: await tx.all(
          'SELECT * FROM assistant_source_watches WHERE user_id=?',
          userId
        ),
        revisions: await tx.all(
          `SELECT * FROM assistant_resource_revisions WHERE resource_id IN (${resource})`,
          userId
        ),
        attempts: await tx.all(
          `SELECT * FROM assistant_attempts WHERE task_id IN (${resource})`,
          userId
        ),
        commands: await tx.all('SELECT * FROM assistant_commands WHERE user_id = ?', userId),
        sessions: await tx.all('SELECT * FROM sessions WHERE user_id = ?', userId),
        chats: await tx.all(`SELECT * FROM session_chats WHERE session_id IN (${owned})`, userId),
        messages: await tx.all(
          `SELECT * FROM messages WHERE session_id IN (${owned}) ORDER BY session_id,seq`,
          userId
        ),
        uploads: await tx.all(
          `SELECT * FROM chat_uploads WHERE user_id = ? AND session_id IN (${owned})`,
          userId,
          userId
        ),
        media: await tx.all(
          `SELECT * FROM message_media WHERE user_id = ? AND session_id IN (${owned})`,
          userId,
          userId
        ),
        bindings: await tx.all(
          `SELECT * FROM assistant_session_bindings WHERE session_id IN (${owned})`,
          userId
        ),
        branches: await tx.all(
          `SELECT * FROM assistant_branches WHERE session_id IN (${owned})`,
          userId
        ),
        nativeRooms: await tx.all('SELECT * FROM assistant_matrix_rooms WHERE user_id = ?', userId),
        nativeEvents: await tx.all(
          'SELECT * FROM assistant_matrix_events WHERE user_id = ? ORDER BY origin_ts',
          userId
        ),
        nativeMappings: await tx.all(
          'SELECT * FROM assistant_source_mappings WHERE user_id = ?',
          userId
        ),
        assets: await tx.all(
          'SELECT id,filename,mime_type,sha256,created_at FROM assistant_assets WHERE user_id = ?',
          userId
        ),
      };
    },
    { isolation: 'repeatable read' }
  );
}
export async function streamAssistantExport(
  userId: string,
  destination: Writable,
  includeNativeMedia: boolean
) {
  const snapshot = await assistantExportSnapshot(userId);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const missing: Array<{ kind: string; id: string; reason: string }> = [];
  const files: Array<{ path: string; id: string; sha256: string; bytes: number }> = [];
  let aborted = false;
  destination.once('close', () => {
    aborted = true;
    archive.abort();
  });
  const complete = new Promise<void>((resolve, reject) => {
    archive.once('error', reject);
    destination.once('error', reject);
    destination.once('finish', resolve);
    destination.once('close', () => {
      if (!destination.writableFinished) reject(new Error('Export wurde abgebrochen'));
    });
  });
  // Observe stream failures immediately, even while an upstream media download is pending.
  void complete.catch(() => {});
  archive.pipe(destination);
  archive.append(JSON.stringify(snapshot, null, 2), { name: 'data.json' });
  const append = (id: string, kind: string, bytes: Buffer) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const name = `files/${kind}/${sha256}.bin`;
    if (!files.some((file) => file.path === name)) archive.append(bytes, { name });
    files.push({ path: name, id, sha256, bytes: bytes.length });
  };
  try {
    for (const asset of snapshot.assets) {
      if (aborted) break;
      const row = await get(
        'SELECT bytes,sha256 FROM assistant_assets WHERE id = ? AND user_id = ?',
        asset.id,
        userId
      );
      if (!row) {
        missing.push({
          kind: 'source',
          id: String(asset.id),
          reason: 'Originaldatei nicht mehr vorhanden',
        });
        continue;
      }
      const bytes = Buffer.from(row.bytes);
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
        missing.push({ kind: 'source', id: String(asset.id), reason: 'Prüfsumme stimmt nicht' });
        continue;
      }
      append(String(asset.id), 'source', bytes);
    }
    for (const upload of snapshot.uploads) {
      if (aborted) break;
      try {
        append(
          String(upload.id),
          'upload',
          await exportOwnedChatUpload(userId, String(upload.session_id), String(upload.id))
        );
      } catch {
        missing.push({
          kind: 'upload',
          id: String(upload.id),
          reason: 'Originaler Upload nicht mehr vorhanden oder unvollständig',
        });
      }
    }
    for (const media of snapshot.media) {
      if (aborted) break;
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const resolved = await resolveOwnedChatMedia({
          userId,
          sessionId: String(media.session_id),
          mediaId: String(media.id),
        });
        if (!resolved) {
          missing.push({
            kind: 'chat',
            id: String(media.id),
            reason: 'Anhang nicht mehr verfügbar',
          });
          continue;
        }
        file = await open(resolved.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const bytes = await file.readFile();
        if (createHash('sha256').update(bytes).digest('hex') !== media.sha256)
          throw new Error('Prüfsumme stimmt nicht');
        append(String(media.id), 'chat', bytes);
      } catch {
        missing.push({
          kind: 'chat',
          id: String(media.id),
          reason: 'Anhang konnte nicht unverändert gelesen werden',
        });
      } finally {
        await file?.close();
      }
    }
    for (const event of snapshot.nativeEvents) {
      if (aborted) break;
      const raw = JSON.parse(String(event.event_json));
      if (raw.type !== 'm.room.message' || (!raw.content?.url && !raw.content?.file)) continue;
      if (!includeNativeMedia) {
        missing.push({
          kind: 'matrix',
          id: String(event.event_id),
          reason: 'Native Medien beim Export abgewählt',
        });
        continue;
      }
      try {
        const media = await matrixDownload(userId, String(event.room_id), String(event.event_id));
        append(String(event.event_id), 'matrix', media.data);
      } catch {
        missing.push({
          kind: 'matrix',
          id: String(event.event_id),
          reason: 'Medium nicht verfügbar oder nicht mehr berechtigt',
        });
      }
    }
    archive.append(
      JSON.stringify(
        {
          format: 'plum-assistant-archive',
          version: 1,
          exportedAt: snapshot.exportedAt,
          files,
          missing,
          complete:
            missing.length === 0 &&
            snapshot.nativeRooms.every((room) => room.history_complete === 1),
          nativeHistory: snapshot.nativeRooms.map((room) => ({
            roomId: room.room_id,
            complete: room.history_complete === 1,
          })),
          credentialsIncluded: false,
        },
        null,
        2
      ),
      { name: 'manifest.json' }
    );
    await archive.finalize();
    await complete;
  } catch (error) {
    archive.abort();
    throw error;
  }
}
