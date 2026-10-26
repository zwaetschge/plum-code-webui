import { createHash } from 'node:crypto';
import { z } from 'zod';
import { all, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, resourceFromRow, reviseResource } from './resources.js';

const command = {
  commandId: z.string().uuid(),
  chats: z
    .array(
      z
        .object({ id: z.string().min(1).max(200), expectedRevision: z.number().int().positive() })
        .strict()
    )
    .min(1)
    .max(100),
};
export const BULK_CHAT_INPUT = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      action: z.literal('move'),
      projectId: z.string().min(1).max(200).nullable(),
    })
    .strict(),
  z.object({ ...command, action: z.literal('archive') }).strict(),
  z.object({ ...command, action: z.literal('restore') }).strict(),
]);

export async function managedChats(userId: string, archived = false, search = '', offset = 0) {
  const rows = await all(
    `SELECT * FROM assistant_resources WHERE user_id=? AND kind='api-chat' AND archived=? AND title ILIKE ?
    AND (COALESCE((body_json::jsonb->>'temporary')::boolean,false)=false OR body_json::jsonb->>'expiresAt'>?) ORDER BY updated_at DESC,id LIMIT 101 OFFSET ?`,
    userId,
    archived ? 1 : 0,
    '%' + search + '%',
    new Date().toISOString(),
    offset
  );
  const entries = rows.slice(0, 100).map(resourceFromRow);
  const busy = await all(
    "SELECT chat_id,BOOL_OR(status='running') AS running FROM assistant_api_turns WHERE chat_id=ANY(?::text[]) AND (status IN ('queued','preparing') OR (status='running' AND expires_at>?)) GROUP BY chat_id",
    entries.map((r) => r.id),
    new Date().toISOString()
  );
  return {
    entries,
    nextOffset: rows.length > 100 ? offset + 100 : null,
    busyChats: Object.fromEntries(busy.map((r) => [r.chat_id, r.running ? 'running' : 'queued'])),
  };
}

export async function bulkManageChats(userId: string, input: z.infer<typeof BULK_CHAT_INPUT>) {
  const items = [...input.chats].sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new AppError('Gespräch doppelt ausgewählt', 400, 'VALIDATION_ERROR');
  const hash = createHash('sha256')
    .update(JSON.stringify({ ...input, chats: items }))
    .digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT action,payload_hash,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'api-chat-bulk' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung wurde bereits verwendet', 409, 'COMMAND_CONFLICT');
      return JSON.parse(prior.result_json);
    }
    if (input.action === 'move' && input.projectId) {
      const project = await findResource(userId, input.projectId, tx);
      if (project.kind !== 'project')
        throw new AppError('Projekt nicht gefunden', 404, 'NOT_FOUND');
    }
    const selected = [];
    for (const item of items) {
      const row = await tx.get(
        "SELECT * FROM assistant_resources WHERE id=? AND user_id=? AND kind='api-chat' AND archived=? FOR UPDATE",
        item.id,
        userId,
        input.action === 'restore' ? 1 : 0
      );
      if (!row) throw new AppError('Gespräch nicht gefunden', 404, 'NOT_FOUND');
      if (Number(row.revision) !== item.expectedRevision)
        throw new AppError(
          'Ein ausgewähltes Gespräch wurde inzwischen geändert. Bitte neu laden.',
          409,
          'REVISION_CONFLICT'
        );
      if (input.action === 'move' && input.projectId && JSON.parse(row.body_json).temporary)
        throw new AppError('Temporäre Gespräche gehören zu keinem Projekt', 400, 'TEMPORARY_CHAT');
      selected.push(resourceFromRow(row));
    }
    const now = new Date().toISOString();
    await tx.run(
      "UPDATE assistant_api_turns SET status='interrupted',error='Der vorherige Antwortlauf wurde nicht bestätigt.' WHERE chat_id=ANY(?::text[]) AND status='running' AND expires_at<=?",
      items.map((item) => item.id),
      now
    );
    await tx.run(
      "UPDATE assistant_api_usage SET status='interrupted',updated_at=? WHERE chat_id=ANY(?::text[]) AND status='running' AND id IN (SELECT id FROM assistant_api_turns WHERE status='interrupted')",
      now,
      items.map((item) => item.id)
    );
    if (
      await tx.get(
        "SELECT id FROM assistant_api_turns WHERE chat_id=ANY(?::text[]) AND status IN ('queued','preparing','running') LIMIT 1",
        items.map((item) => item.id)
      )
    )
      throw new AppError(
        'Ausgewählte Gespräche haben laufende oder wartende Nachrichten.',
        409,
        'API_CHAT_BUSY'
      );
    for (const resource of selected) {
      if (input.action === 'move')
        await reviseResource(
          userId,
          resource.id,
          resource.revision,
          resource.title,
          { ...resource.body, projectId: input.projectId },
          tx
        );
      else
        await tx.run(
          'UPDATE assistant_resources SET archived=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?',
          input.action === 'archive' ? 1 : 0,
          now,
          resource.id,
          userId
        );
    }
    const result = { action: input.action, ids: items.map((item) => item.id), count: items.length };
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,'api-chat-bulk','completed',?,?,?)",
      userId,
      input.commandId,
      items[0]!.id,
      hash,
      JSON.stringify(result),
      now,
      now
    );
    return result;
  });
}
