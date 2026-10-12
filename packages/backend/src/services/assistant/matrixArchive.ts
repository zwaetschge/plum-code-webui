import { AppError } from '../../middleware/errorHandler.js';
import { transaction, all } from '../../db/pg.js';
import { BODY_SCHEMAS, createResource, findResource, reviseResource } from './resources.js';
import type { MatrixEvent } from './matrix.js';

export const NATIVE_TASK_STATES: Record<string, string> = {
  submitted: 'queued',
  working: 'running',
  'input-required': 'waiting_input',
  'auth-required': 'waiting_input',
  completed: 'completed',
  failed: 'failed',
  canceled: 'cancelled',
  rejected: 'failed',
};

/** Preserve source events, including edits and reactions, under the actual account owner. */
export async function archiveMatrixEvents(
  userId: string,
  nativeUserId: string,
  roomId: string,
  events: MatrixEvent[],
  identityEpoch?: string
) {
  const hub = `@schwarm:${nativeUserId.split(':').slice(1).join(':')}`;
  const mappingSource = `matrix-task:${hub.split(':').slice(1).join(':')}`;
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', userId);
    if (identityEpoch !== undefined) {
      const credential = await tx.get(
        "SELECT public_json FROM assistant_credentials WHERE user_id=? AND service='matrix'",
        userId
      );
      const current = credential ? JSON.parse(credential.public_json) : null;
      if (!current || current.userId !== nativeUserId || (current.epoch ?? '') !== identityEpoch)
        throw new AppError(
          'Matrix-Verbindung wurde inzwischen gewechselt',
          409,
          'MATRIX_IDENTITY_CHANGED'
        );
    }

    let imported = 0;
    for (const event of [...events].sort(
      (a, b) => (a.origin_server_ts ?? 0) - (b.origin_server_ts ?? 0)
    )) {
      if (!event.event_id || !event.type || !event.content) continue;
      const result = await tx.run(
        `INSERT INTO assistant_matrix_events (user_id, room_id, event_id, event_json, origin_ts,native_user_id)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id,room_id,event_id) DO UPDATE SET event_json = excluded.event_json`,
        userId,
        roomId,
        event.event_id,
        JSON.stringify(event),
        event.origin_server_ts ?? 0,
        nativeUserId
      );
      imported += result.changes;
      if (event.type !== 'm.room.message' || event.sender !== hub) continue;
      const relation = event.content['m.relates_to'] as
        | { rel_type?: string; event_id?: string }
        | undefined;
      const rejection =
        /^🚫\s+Abgelehnt\b/u.test(String(event.content.body ?? '')) ||
        String(event.content.body ?? '').startsWith('Plum-Auftragsdaten sind ungültig');
      if (rejection && relation?.rel_type === 'm.thread' && relation.event_id) {
        const rejectedRow = await tx.get(
          "SELECT id FROM assistant_resources WHERE user_id=? AND kind='task' AND archived=0 AND (body_json::jsonb)->>'matrixThreadId'=?",
          userId,
          relation.event_id
        );
        if (rejectedRow) {
          const task = await findResource(userId, String(rejectedRow.id), tx);
          if (task.body.status === 'queued' && !task.body.nativeTaskId) {
            await reviseResource(
              userId,
              task.id,
              task.revision,
              task.title,
              {
                ...task.body,
                status: 'failed',
                nativeState: 'rejected',
                waitingReason: String(event.content.body).slice(0, 2000),
              },
              tx
            );
            await tx.run(
              "UPDATE assistant_attempts SET status='failed',finished_at=?,result_json=? WHERE task_id=? AND command_id=? AND status='submitted'",
              new Date().toISOString(),
              JSON.stringify({ rejectionEventId: event.event_id }),
              task.id,
              task.body.nativeCommandId
            );
          }
        }
      }
      const receiptId = /^\S+\s+(T-\d+)\s+→\s/u.exec(String(event.content.body ?? ''))?.[1];
      if (receiptId && relation?.rel_type === 'm.thread' && relation.event_id) {
        const targetRow = await tx.get(
          "SELECT id FROM assistant_resources WHERE user_id = ? AND kind = 'task' AND archived = 0 AND (body_json::jsonb)->>'matrixThreadId' = ?",
          userId,
          relation.event_id
        );
        if (targetRow) {
          const existing = await tx.get(
            'SELECT resource_id FROM assistant_source_mappings WHERE user_id = ? AND source = ? AND native_id = ?',
            userId,
            mappingSource,
            receiptId
          );
          if (existing && existing.resource_id !== targetRow.id) {
            const previous = await findResource(userId, String(existing.resource_id), tx).catch(
              () => null
            );
            const target = await findResource(userId, String(targetRow.id), tx);
            if (previous) {
              const nativeFields = Object.fromEntries(
                Object.entries(previous.body).filter(([key]) =>
                  [
                    'nativeTaskId',
                    'matrixUserId',
                    'nativeState',
                    'nativeUpdatedAt',
                    'matrixCardRoomId',
                    'matrixCardEventId',
                    'nativeCard',
                    'status',
                  ].includes(key)
                )
              );
              await reviseResource(
                userId,
                target.id,
                target.revision,
                target.title,
                { ...target.body, ...nativeFields },
                tx
              );
              await tx.run(
                'UPDATE assistant_resources SET archived = 1, revision = revision + 1 WHERE id = ? AND user_id = ? AND revision = ?',
                previous.id,
                userId,
                previous.revision
              );
            }
          }
          await tx.run(
            'INSERT INTO assistant_source_mappings (user_id,source,native_id,resource_id) VALUES (?, ?, ?, ?) ON CONFLICT(user_id,source,native_id) DO UPDATE SET resource_id = excluded.resource_id',
            userId,
            mappingSource,
            receiptId,
            targetRow.id
          );
        }
      }
      let content = event.content;
      if (relation?.rel_type === 'm.replace') {
        // Native edits must refer to a Hub-authored event in this exact room.
        const original = await tx.get(
          'SELECT event_json FROM assistant_matrix_events WHERE user_id = ? AND room_id = ? AND event_id = ?',
          userId,
          roomId,
          relation.event_id
        );
        if (!original || JSON.parse(original.event_json).sender !== hub) continue;
        content = (event.content['m.new_content'] as Record<string, unknown>) ?? {};
      }
      const card = content['ch.zwaetschge.swarm.task'] as Record<string, unknown> | undefined;
      if (card && (card.v ?? 1) !== 1) continue;
      const board =
        /^\S+\s+(T-\d+)\s+·\s+(submitted|working|input-required|auth-required|completed|failed|canceled|rejected)\s+·\s+([^\n]+)/u.exec(
          String(content.body ?? '')
        );
      const nativeId = typeof card?.id === 'string' ? card.id : board?.[1];
      const state = typeof card?.state === 'string' ? card.state : board?.[2];
      if (!nativeId || !/^T-\d+$/.test(nativeId) || !state || !NATIVE_TASK_STATES[state]) continue;
      let mapping = await tx.get(
        'SELECT resource_id FROM assistant_source_mappings WHERE user_id = ? AND source = ? AND native_id = ?',
        userId,
        mappingSource,
        nativeId
      );
      // Correlate a submitted Plum task through its exact native receipt thread, never by goal text.
      if (!mapping && card) {
        const receipts = await tx.all(
          'SELECT event_json FROM assistant_matrix_events WHERE user_id = ? AND event_json LIKE ?',
          userId,
          `%${nativeId}%`
        );
        for (const row of receipts) {
          const receipt = JSON.parse(row.event_json) as MatrixEvent;
          const rel = receipt.content['m.relates_to'] as
            | { rel_type?: string; event_id?: string }
            | undefined;
          if (
            receipt.sender !== hub ||
            rel?.rel_type !== 'm.thread' ||
            !String(receipt.content.body ?? '').match(
              new RegExp(`^\\S+\\s+${nativeId}\\s+→\\s`, 'u')
            )
          )
            continue;
          const task = await tx.get(
            "SELECT id FROM assistant_resources WHERE user_id = ? AND kind = 'task' AND archived = 0 AND (body_json::jsonb)->>'matrixThreadId' = ?",
            userId,
            rel.event_id
          );
          if (task) {
            mapping = { resource_id: task.id };
            break;
          }
        }
      }
      if (!mapping && !card) continue;
      const agentId = String(card?.assignee ?? board?.[3] ?? 'unknown');
      const goal = String(card?.goal ?? String(content.body ?? '').split('\n')[1] ?? nativeId);
      const current = mapping
        ? await findResource(userId, String(mapping.resource_id), tx).catch(() => null)
        : null;
      if (mapping && !current) continue; // An archived import stays archived.
      let incomingTs = event.origin_server_ts ?? 0;
      let projectedState = state;
      // Backward imports can encounter a newer board entry before its older task card.
      // Reconcile from retained Hub events when the card establishes the identity.
      if (card) {
        const storedBoards = await tx.all(
          `SELECT room_id,event_json,origin_ts FROM assistant_matrix_events
          WHERE user_id = ? AND (event_json::jsonb)->>'sender' = ? AND origin_ts > ?
          AND ((event_json::jsonb)->'content'->>'body' LIKE ?)
          ORDER BY origin_ts DESC LIMIT 100`,
          userId,
          hub,
          incomingTs,
          `%${nativeId}%`
        );
        for (const stored of storedBoards) {
          const candidate = JSON.parse(stored.event_json) as MatrixEvent;
          let body = String(candidate.content.body ?? '');
          const rel = candidate.content['m.relates_to'] as
            | { rel_type?: string; event_id?: string }
            | undefined;
          if (rel?.rel_type === 'm.replace') {
            const original = await tx.get(
              'SELECT event_json FROM assistant_matrix_events WHERE user_id = ? AND room_id = ? AND event_id = ?',
              userId,
              stored.room_id,
              rel.event_id
            );
            if (!original || JSON.parse(original.event_json).sender !== hub) continue;
            body = String(
              (candidate.content['m.new_content'] as Record<string, unknown> | undefined)?.body ??
                ''
            );
          }
          const match =
            /^\S+\s+(T-\d+)\s+·\s+(submitted|working|input-required|auth-required|completed|failed|canceled|rejected)\s+·/u.exec(
              body
            );
          if (match?.[1] === nativeId && match[2]) {
            projectedState = match[2];
            incomingTs = Number(stored.origin_ts);
            break;
          }
        }
      }
      if (current && incomingTs < Number(current.body.nativeUpdatedAt ?? 0)) continue;
      const body = {
        ...(current?.body ?? BODY_SCHEMAS.task.parse({ goal })),
        nativeTaskId: nativeId,
        matrixUserId: nativeUserId,
        agentId: `matrix:${agentId}`,
        nativeState: projectedState,
        status: NATIVE_TASK_STATES[projectedState],
        nativeUpdatedAt: incomingTs,
        ...(card && relation?.rel_type !== 'm.replace'
          ? { matrixCardRoomId: roomId, matrixCardEventId: event.event_id, nativeCard: card }
          : {}),
        ...(current?.body.coordinator ? {} : { coordinator: 'matrix' }),
      };
      const task = current
        ? JSON.stringify(current.body) === JSON.stringify(body)
          ? current
          : await reviseResource(userId, current.id, current.revision, current.title, body, tx)
        : await createResource(userId, 'task', `${nativeId} · ${goal}`.slice(0, 200), body, tx);
      await tx.run(
        'INSERT INTO assistant_source_mappings (user_id, source, native_id, resource_id, source_revision) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id,source,native_id) DO UPDATE SET source_revision = excluded.source_revision',
        userId,
        mappingSource,
        nativeId,
        task.id,
        String(incomingTs)
      );
      await tx.run(
        "UPDATE assistant_attempts SET native_id = ?, status = ?, finished_at = ? WHERE task_id = ? AND status NOT IN ('completed','failed','cancelled')",
        nativeId,
        body.status,
        ['completed', 'failed', 'cancelled'].includes(body.status!)
          ? new Date().toISOString()
          : null,
        task.id
      );
    }
    return { processed: imported };
  });
}

export async function matrixImportStatus(userId: string) {
  return all(
    `SELECT r.room_id, r.history_cursor, r.history_complete, r.updated_at,
    (SELECT count(*) FROM assistant_matrix_events e WHERE e.user_id = r.user_id AND e.room_id = r.room_id) AS imported_count
    FROM assistant_matrix_rooms r WHERE r.user_id = ? ORDER BY r.room_id`,
    userId
  );
}
