import { get, all, run, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { rm, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../../config.js';
import { resolveOwnedChatMedia } from '../chatMedia.js';
import { purgeSessionChatUploads } from '../chatUploads.js';
import { requireAssistantExecutor } from './executor.js';
import { purgeTemporaryApiChat } from './apiChats.js';

export async function temporaryRuntime(sessionId: string): Promise<boolean> {
  const binding = await get(
    'SELECT temporary,temporary_expires_at FROM assistant_session_bindings WHERE session_id = ?',
    sessionId
  );
  if (!binding?.temporary) return false;
  if (binding.temporary_expires_at && Date.parse(binding.temporary_expires_at) <= Date.now())
    throw new AppError('Dieses temporäre Gespräch ist abgelaufen', 410, 'TEMPORARY_EXPIRED');
  return true;
}
/** Content-free usage remains in its original ledger; transcript and private workspace are removed. */
export async function purgeTemporarySession(
  sessionId: string,
  stop: (id: string, userId: string) => Promise<void>
) {
  const session = await get(
    `SELECT s.id,s.user_id,s.working_directory FROM sessions s JOIN assistant_session_bindings b ON b.session_id = s.id
    WHERE s.id = ? AND b.temporary = 1 AND b.temporary_expires_at <= ? AND b.temporary_purged_at IS NULL`,
    sessionId,
    new Date().toISOString()
  );
  if (!session) return false;
  await stop(String(session.id), String(session.user_id));
  await purgeSessionChatUploads(String(session.user_id), String(session.id));
  const media = await all(
    'SELECT id,storage_key FROM message_media WHERE session_id = ? AND user_id = ?',
    session.id,
    session.user_id
  );
  const resolved = await Promise.all(
    media.map(async (row) => ({
      key: row.storage_key,
      file: await resolveOwnedChatMedia({
        sessionId: String(session.id),
        userId: String(session.user_id),
        mediaId: String(row.id),
      }),
    }))
  );
  await transaction(async (tx) => {
    for (const table of [
      'message_deliveries',
      'chat_uploads',
      'session_agent_runs',
      'notes',
      'session_checkpoints',
      'messages',
      'session_chats',
    ])
      await tx.run(`DELETE FROM ${table} WHERE session_id = ?`, session.id);
    await tx.run(
      "UPDATE discord_outbox SET title='Temporäres Gespräch',summary='',payload_json='{}' WHERE session_id = ?",
      session.id
    );
    await tx.run(
      "UPDATE sessions SET name='Temporäres Gespräch (gelöscht)',archived=1,status='stopped',claude_session_id=NULL,active_chat_id=NULL,last_message=NULL,icon_path=NULL,icon_source=NULL,category=NULL WHERE id = ?",
      session.id
    );
    await tx.run(
      'UPDATE assistant_session_bindings SET profile_id=NULL,profile_revision=NULL,project_id=NULL,runtime_id=NULL WHERE session_id = ?',
      session.id
    );
  });
  for (const entry of resolved)
    if (
      entry.file &&
      !(await get(
        'SELECT id FROM message_media WHERE storage_key = ? AND user_id = ? LIMIT 1',
        entry.key,
        session.user_id
      ))
    )
      await unlink(entry.file.filePath).catch(() => {});
  const root = path.resolve(
    process.env.PLUM_ASSISTANT_WORKSPACE_ROOT ||
      path.join(config.allowedBasePaths[0] || '', '.plum-assistant')
  );
  const owner = createHash('sha256').update(String(session.user_id)).digest('hex').slice(0, 24);
  const directory = path.resolve(String(session.working_directory));
  // Only a workspace minted by Plum can be removed; never an arbitrary session directory.
  if (
    path.dirname(directory) !== path.join(root, owner) ||
    !/^[0-9a-f-]{36}$/.test(path.basename(directory))
  )
    throw new Error('Temporärer Arbeitsbereich stimmt nicht mit seinem Eigentümer überein');
  const actual = await realpath(directory).catch(() => null);
  if (actual && actual !== directory)
    throw new Error('Temporärer Arbeitsbereich enthält einen unerwarteten Pfadverweis');
  if (actual) await rm(directory, { recursive: true, force: true });
  await run(
    'UPDATE assistant_session_bindings SET temporary_purged_at = ? WHERE session_id = ?',
    new Date().toISOString(),
    session.id
  );
  return true;
}
export function startTemporaryRetention(stop: (id: string, userId: string) => Promise<void>) {
  if (process.env.PLUM_ASSISTANT_EXECUTOR === 'false') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await requireAssistantExecutor();
      const expired = await all(
        'SELECT session_id FROM assistant_session_bindings WHERE temporary=1 AND temporary_expires_at <= ? AND temporary_purged_at IS NULL LIMIT 50',
        new Date().toISOString()
      );
      for (const row of expired)
        await purgeTemporarySession(String(row.session_id), stop).catch(() =>
          console.error('[assistant] Temporary retention remains pending')
        );
      const apiChats = await all(
        "SELECT id,user_id FROM assistant_resources WHERE kind='api-chat' AND (body_json::jsonb)->>'temporary'='true' AND (body_json::jsonb)->>'expiresAt'<=? LIMIT 50",
        new Date().toISOString()
      );
      for (const row of apiChats)
        await purgeTemporaryApiChat(String(row.user_id), String(row.id)).catch(() =>
          console.error('[assistant] Temporary model-chat retention remains pending')
        );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick().catch(() => {}), 60_000);
  timer.unref();
  void tick().catch(() => {});
}
