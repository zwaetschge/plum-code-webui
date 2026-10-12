import { createHash } from 'node:crypto';
import { z } from 'zod';
import { all, transaction, type TransactionScope } from '../../db/pg.js';
import { findResource, reviseResource } from './resources.js';
import { AppError } from '../../middleware/errorHandler.js';

export const taskResultInput = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    items: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(29),
            artifactId: z.string().uuid(),
            revision: z.number().int().positive(),
          })
          .strict()
      )
      .max(30),
  })
  .strict();
export async function taskResultCandidates(userId: string, taskId: string) {
  const task = await findResource(userId, taskId);
  if (task.kind !== 'task') throw new AppError('Auftrag nicht gefunden', 404, 'NOT_FOUND');
  const rows = await all(
    "SELECT id,title,revision,body_json::jsonb->>'type' AS type FROM assistant_resources WHERE user_id=? AND kind='artifact' AND archived=0 AND body_json::jsonb->>'taskId'=? ORDER BY updated_at DESC,id LIMIT 100",
    userId,
    taskId
  );
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    revision: Number(row.revision),
    type: String(row.type ?? 'document'),
  }));
}

async function validateResults(
  tx: TransactionScope,
  userId: string,
  taskId: string,
  labels: string[],
  reviews: Array<{ index: number; label?: string; artifactId: string; revision: number }>
) {
  if (
    reviews.length !== labels.length ||
    new Set(reviews.map((r) => r.index)).size !== labels.length
  )
    throw new AppError(
      'Jedes gewünschte Ergebnis muss ausdrücklich einem geprüften Artefakt zugeordnet sein',
      409,
      'DELIVERABLES_INCOMPLETE'
    );
  for (const item of reviews) {
    if (
      item.index < 0 ||
      item.index >= labels.length ||
      (item.label !== undefined && item.label !== labels[item.index])
    )
      throw new AppError(
        'Die Ergebnisliste wurde inzwischen geändert',
        409,
        'DELIVERABLES_INCOMPLETE'
      );
    await tx.get(
      'SELECT id FROM assistant_resources WHERE id=? AND user_id=? AND archived=0 FOR SHARE',
      item.artifactId,
      userId
    );
    const resource = await findResource(userId, item.artifactId, tx);
    const version = await tx.get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      resource.id,
      item.revision
    );
    if (
      resource.kind !== 'artifact' ||
      !version ||
      JSON.parse(String(version.body_json)).taskId !== taskId
    )
      throw new AppError(
        'Ergebnis gehört nicht zu diesem Auftrag oder dieser Revision',
        409,
        'DELIVERABLE_REFERENCE_INVALID'
      );
  }
}
export async function assertTaskResults(
  tx: TransactionScope,
  userId: string,
  taskId: string,
  body: Record<string, unknown>
) {
  const labels = (body.deliverables ?? []) as string[];
  if (!labels.length) return;
  if (body.deliverableReviewedBy !== userId)
    throw new AppError(
      'Die gewünschten Artefakte müssen zuerst geprüft werden',
      409,
      'DELIVERABLES_INCOMPLETE'
    );
  await validateResults(
    tx,
    userId,
    taskId,
    labels,
    (body.deliverableReviews ?? []) as Array<{
      index: number;
      label?: string;
      artifactId: string;
      revision: number;
    }>
  );
}

export async function reviewTaskResults(
  userId: string,
  taskId: string,
  raw: z.infer<typeof taskResultInput>
) {
  const input = taskResultInput.parse(raw);
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const hash = createHash('sha256')
      .update(JSON.stringify([taskId, input.expectedRevision, input.items]))
      .digest('hex');
    const prior = await tx.get(
      'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'task-result-review' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return JSON.parse(String(prior.result_json));
    }
    const task = await findResource(userId, taskId, tx);
    if (
      task.kind !== 'task' ||
      task.body.status !== 'waiting_input' ||
      String(task.body.agentId ?? '').startsWith('matrix:')
    )
      throw new AppError(
        'Dieser Auftrag wartet nicht auf eine lokale Ergebnisprüfung',
        409,
        'TASK_REVIEW_UNAVAILABLE'
      );
    if (task.revision !== input.expectedRevision)
      throw new AppError('Auftrag wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    const labels = (task.body.deliverables ?? []) as string[];
    await validateResults(tx, userId, taskId, labels, input.items);
    const now = new Date().toISOString();
    const result = await reviseResource(
      userId,
      taskId,
      task.revision,
      task.title,
      {
        ...task.body,
        deliverableReviews: input.items.map((item) => ({ ...item, label: labels[item.index] })),
        deliverableReviewedBy: userId,
        deliverableReviewedAt: now,
      },
      tx
    );
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      taskId,
      hash,
      'task-result-review',
      JSON.stringify(result),
      now,
      now
    );
    return result;
  });
}
