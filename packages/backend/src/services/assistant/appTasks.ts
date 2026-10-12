import { createHash } from 'node:crypto';
import { z } from 'zod';
import { transaction } from '../../db/pg.js';
import { findResource, createResource, BODY_SCHEMAS } from './resources.js';
import { AppError } from '../../middleware/errorHandler.js';
export const APP_TASK_INPUT = z
  .object({
    commandId: z.string().uuid(),
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    goal: z.string().trim().min(1).max(4000),
  })
  .strict();
export async function createAppTask(
  userId: string,
  id: string,
  input: z.infer<typeof APP_TASK_INPUT>
) {
  const hash = createHash('sha256')
    .update(JSON.stringify([id, input.revision, input.title, input.goal]))
    .digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT action,payload_hash,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'app-task' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung hat anderen Inhalt.', 409, 'COMMAND_CONFLICT');
      return JSON.parse(prior.result_json);
    }
    const artifact = await findResource(userId, id, tx),
      row =
        artifact.kind === 'artifact'
          ? await tx.get(
              'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
              id,
              input.revision
            )
          : null,
      body = row ? JSON.parse(row.body_json) : null;
    if (!body || body.type !== 'app' || body.format !== 'html')
      throw new AppError('Gespeicherte eigene App-Revision nicht gefunden.', 404, 'NOT_FOUND');
    const task = await createResource(
      userId,
      'task',
      input.title,
      {
        ...BODY_SCHEMAS.task.parse({ goal: input.goal, originResourceId: id }),
        appOrigin: { id, revision: input.revision },
      },
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      task.id,
      hash,
      'app-task',
      JSON.stringify(task),
      now,
      now
    );
    return task;
  });
}
