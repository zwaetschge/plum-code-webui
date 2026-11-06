import { createHash, randomUUID } from 'node:crypto';
import { all, get, run, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource } from './resources.js';
import { apiImagePayloads } from './apiFiles.js';
import type { API_TURN_INPUT } from './apiChats.js';
import type { z } from 'zod';

type Input = z.infer<typeof API_TURN_INPUT>;
export function apiTurnHash(id: string, input: Input) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id,
        prompt: input.prompt,
        expectedRevision: input.expectedRevision,
        imageAssetIds: input.imageAssetIds ?? [],
        documentSourceIds: input.documentSourceIds ?? [],
        mergeTurnId: input.mergeTurnId ?? null,
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        ...(input.voice ? { voice: true } : {}),
        ...(input.regenerate ? { regenerate: input.regenerate } : {}),
      })
    )
    .digest('hex');
}

/** Queue entries are real transcript turns: stable IDs and sequence numbers, no client-only drafts. */
export async function enqueueApiTurn(userId: string, chatId: string, input: Input) {
  const hash = apiTurnHash(chatId, input);
  await transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    await tx.get(
      'SELECT id FROM assistant_resources WHERE id=? AND user_id=? FOR UPDATE',
      chatId,
      userId
    );
    const chat = await findResource(userId, chatId, tx);
    if (chat.kind !== 'api-chat') throw new AppError('Modellchat nicht gefunden', 404, 'NOT_FOUND');
    const prior = await tx.get('SELECT * FROM assistant_api_turns WHERE id=?', input.commandId);
    if (prior) {
      if (prior.chat_id !== chatId || prior.payload_hash !== hash)
        throw new AppError(
          'Befehlskennung wurde mit anderem Inhalt verwendet',
          409,
          'COMMAND_CONFLICT'
        );
      return;
    }
    if (chat.body.temporary && Date.parse(String(chat.body.expiresAt)) <= Date.now())
      throw new AppError('Dieses temporäre Gespräch ist abgelaufen', 410, 'TEMPORARY_EXPIRED');
    if (chat.revision !== input.expectedRevision)
      throw new AppError(
        'Gespräch wurde inzwischen geändert. Bitte neu laden.',
        409,
        'REVISION_CONFLICT'
      );
    if (
      input.regenerate &&
      !(await tx.get(
        'SELECT id FROM assistant_api_turns WHERE id=? AND chat_id=? AND hidden_by IS NULL',
        input.regenerate,
        chatId
      ))
    )
      throw new AppError('Diese Antwort ist nicht mehr sichtbar', 409, 'REVISION_CONFLICT');
    if (
      input.mergeTurnId &&
      !(await tx.get(
        "SELECT id FROM assistant_api_turns WHERE id=? AND chat_id=? AND status='completed'",
        input.mergeTurnId,
        chatId
      ))
    )
      throw new AppError('Vergleich nicht gefunden', 404, 'NOT_FOUND');
    const pending = await tx.all(
      "SELECT id,profile_json FROM assistant_api_turns WHERE chat_id=? AND status IN ('queued','preparing')",
      chatId
    );
    if (pending.length >= 20)
      throw new AppError(
        'In diesem Gespräch warten bereits 20 Nachrichten',
        429,
        'API_QUEUE_CAPACITY'
      );
    if (
      (input.regenerate && pending.length) ||
      pending.some((row) => JSON.parse(row.profile_json).queueInput?.regenerate)
    )
      throw new AppError(
        'Die vorgemerkte Neubearbeitung zuerst abschliessen oder entfernen',
        409,
        'API_CHAT_BUSY'
      );
    const count = await tx.get(
      "SELECT COUNT(*) AS n FROM assistant_api_turns t JOIN assistant_resources r ON r.id=t.chat_id WHERE r.user_id=? AND t.status IN ('queued','preparing')",
      userId
    );
    if (Number(count.n) >= 50)
      throw new AppError('Für dein Konto warten bereits 50 Nachrichten', 429, 'API_QUEUE_CAPACITY');
    // Validate owner-bound attachment references before accepting an autonomous future action.
    await apiImagePayloads(userId, chatId, input.imageAssetIds ?? [], tx);
    for (const id of input.documentSourceIds ?? []) {
      const source = await findResource(userId, id, tx);
      if (
        source.kind !== 'source' ||
        (source.body.temporaryChatId && source.body.temporaryChatId !== chatId)
      )
        throw new AppError('Ungültiger Dokumentanhang', 400, 'INVALID_REFERENCE');
    }
    const seq = Number(
      (
        await tx.get(
          'SELECT COALESCE(MAX(seq),0)+1 AS seq FROM assistant_api_turns WHERE chat_id=?',
          chatId
        )
      ).seq
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,status,model,profile_json,image_asset_ids,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?)",
      input.commandId,
      chatId,
      seq,
      hash,
      input.prompt,
      String(chat.body.model),
      JSON.stringify({
        providerId: chat.body.providerId,
        profileId: chat.body.profileId ?? null,
        profileRevision: chat.body.profileRevision ?? null,
        queueInput: input,
      }),
      JSON.stringify(input.imageAssetIds ?? []),
      now,
      now,
      new Date(Date.now() + 86400000).toISOString()
    );
    await tx.run('UPDATE assistant_resources SET updated_at=? WHERE id=?', now, chatId);
  });
  await pumpApiChatQueue(userId, chatId);
  const accepted = await get(
    'SELECT * FROM assistant_api_turns WHERE id=? AND chat_id=?',
    input.commandId,
    chatId
  );
  if (!accepted) throw new AppError('Gespräch wurde inzwischen entfernt', 404, 'NOT_FOUND');
  return accepted;
}

export async function pumpApiChatQueue(userId: string, chatId: string) {
  const claimed = await transaction(async (tx) => {
    const account = await tx.get('SELECT id,status FROM users WHERE id=? FOR UPDATE', userId);
    if (account?.status !== 'active') {
      await tx.run(
        "UPDATE assistant_api_turns SET status='cancelled',error='Konto nicht mehr aktiv' WHERE chat_id=? AND status IN ('queued','preparing') AND EXISTS(SELECT 1 FROM assistant_resources r WHERE r.id=chat_id AND r.user_id=?)",
        chatId,
        userId
      );
      return null;
    }
    const resource = await tx.get(
      'SELECT archived FROM assistant_resources WHERE id=? AND user_id=? FOR UPDATE',
      chatId,
      userId
    );
    if (!resource) return null;
    const now = new Date().toISOString();
    if (resource.archived) {
      await tx.run(
        "UPDATE assistant_api_turns SET status='cancelled',error='Gespräch archiviert' WHERE chat_id=? AND status IN ('queued','preparing')",
        chatId
      );
      return null;
    }
    await tx.run(
      "UPDATE assistant_api_turns SET status='queued' WHERE chat_id=? AND status='preparing' AND expires_at<=?",
      chatId,
      now
    );
    await tx.run(
      "UPDATE assistant_api_turns SET status='interrupted',error='Der vorherige Antwortlauf wurde nicht bestätigt.' WHERE chat_id=? AND status='running' AND expires_at<=?",
      chatId,
      now
    );
    await tx.run(
      "UPDATE assistant_api_usage SET status='interrupted',updated_at=? WHERE chat_id=? AND status='running' AND id IN (SELECT id FROM assistant_api_turns WHERE chat_id=? AND status='interrupted')",
      now,
      chatId,
      chatId
    );
    if (
      await tx.get(
        "SELECT id FROM assistant_api_turns WHERE chat_id=? AND status IN ('preparing','running')",
        chatId
      )
    )
      return null;
    const running = await tx.get(
      "SELECT COUNT(*) AS n FROM assistant_api_turns t JOIN assistant_resources r ON r.id=t.chat_id WHERE r.user_id=? AND t.status IN ('preparing','running') AND t.expires_at>?",
      userId,
      now
    );
    if (Number(running.n) >= 5) return null;
    const row = await tx.get(
      "SELECT * FROM assistant_api_turns WHERE chat_id=? AND status='queued' AND hidden_by IS NULL ORDER BY seq LIMIT 1 FOR UPDATE",
      chatId
    );
    if (!row) return null;
    const context = JSON.parse(row.profile_json);
    const lease = randomUUID();
    await tx.run(
      "UPDATE assistant_api_turns SET status='preparing',profile_json=?,expires_at=?,updated_at=? WHERE id=?",
      JSON.stringify({ ...context, queueLease: lease }),
      new Date(Date.now() + 180000).toISOString(),
      now,
      row.id
    );
    return { input: context.queueInput as Input, lease, id: row.id };
  });
  if (!claimed) return;
  try {
    const { executeApiTurn } = await import('./apiChats.js');
    await executeApiTurn(userId, chatId, claimed.input, claimed.lease);
  } catch (failure) {
    await run(
      "UPDATE assistant_api_turns SET status='failed',error=?,updated_at=? WHERE id=? AND status='preparing' AND profile_json::jsonb->>'queueLease'=?",
      failure instanceof AppError
        ? failure.message
        : 'Nachricht konnte nicht gestartet werden. Vorgaben und Modellverbindung prüfen.',
      new Date().toISOString(),
      claimed.id,
      claimed.lease
    );
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let polling = false;
export function startApiChatQueueWorker() {
  if (timer) return;
  const tick = async () => {
    if (polling) return;
    polling = true;
    try {
      const chats = await all(
        "SELECT DISTINCT r.user_id,t.chat_id FROM assistant_api_turns t JOIN assistant_resources r ON r.id=t.chat_id WHERE t.status IN ('queued','preparing') AND NOT EXISTS(SELECT 1 FROM assistant_api_turns busy WHERE busy.chat_id=t.chat_id AND busy.status IN ('running','preparing') AND busy.expires_at>?) ORDER BY t.chat_id LIMIT 128",
        new Date().toISOString()
      );
      // DB claims, not this interval, guarantee single execution across server processes.
      await Promise.allSettled(chats.map((row) => pumpApiChatQueue(row.user_id, row.chat_id)));
    } finally {
      polling = false;
    }
  };
  timer = setInterval(() => {
    void tick().catch(() => {});
  }, 2000);
  timer.unref();
  void tick().catch(() => {});
}
