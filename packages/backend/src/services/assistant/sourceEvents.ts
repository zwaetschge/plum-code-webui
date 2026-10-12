import { createHash } from 'node:crypto';
import type { TransactionScope } from '../../db/pg.js';
import { BODY_SCHEMAS, createResource } from './resources.js';
/** Source observation proposes work. It never starts a worker or sends an external message. */
export async function proposeSourceTasks(
  tx: TransactionScope,
  userId: string,
  sourceId: string,
  revision: number,
  title: string
) {
  const subscriptions = await tx.all(
    `SELECT * FROM assistant_resources WHERE user_id=? AND kind='event-subscription' AND archived=0 AND (body_json::jsonb)->>'sourceId'=? AND (body_json::jsonb)->>'enabled'='true'`,
    userId,
    sourceId
  );
  for (const row of subscriptions) {
    const body = JSON.parse(row.body_json);
    if (body.event !== 'source.changed') continue;
    const commandId = `source-event:${row.id}:${sourceId}:${revision}`;
    if (
      await tx.get(
        'SELECT command_id FROM assistant_commands WHERE user_id=? AND command_id=?',
        userId,
        commandId
      )
    )
      continue;
    const profile = body.profileId
      ? await tx.get(
          "SELECT id,body_json FROM assistant_resources WHERE id=? AND user_id=? AND kind='profile' AND archived=0",
          body.profileId,
          userId
        )
      : null;
    const task = await createResource(
      userId,
      'task',
      `Quelle geändert: ${title}`.slice(0, 200),
      {
        ...BODY_SCHEMAS.task.parse({
          goal: `${String(body.goal).slice(0, 48000)}\n\nBeobachtete Quelle: ${title}, Revision ${revision}, ID ${sourceId}. Prüfe den aktuellen und den vorherigen Stand.`,
          sourceIds: [sourceId],
          provider: profile ? JSON.parse(profile.body_json).provider : 'codex',
          ...(profile ? { profileId: profile.id } : {}),
        }),
        sourceEvent: {
          subscriptionId: row.id,
          subscriptionRevision: Number(row.revision),
          sourceId,
          sourceRevision: revision,
        },
      },
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      'INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      userId,
      commandId,
      task.id,
      createHash('sha256')
        .update(JSON.stringify([row.id, sourceId, revision]))
        .digest('hex'),
      'source-proposal',
      'completed',
      JSON.stringify({ taskId: task.id }),
      now,
      now
    );
  }
}
