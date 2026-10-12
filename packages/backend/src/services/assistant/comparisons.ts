import { createHash } from 'node:crypto';
import { transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createResource, findResource, BODY_SCHEMAS } from './resources.js';
export async function createComparison(
  userId: string,
  input: { commandId: string; title: string }
) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const hash = createHash('sha256')
      .update(JSON.stringify(['comparison-create', input.title]))
      .digest('hex');
    const prior = await tx.get(
      'SELECT action,payload_hash,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'comparison-create' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      return findResource(userId, JSON.parse(prior.result_json).artifactId, tx);
    }
    const artifact = await createResource(
      userId,
      'artifact',
      input.title,
      BODY_SCHEMAS.artifact.parse({
        type: 'comparison',
        format: 'json',
        content: JSON.stringify({ type: 'plum-comparison', version: 1, offers: [], decision: '' }),
      }),
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      artifact.id,
      hash,
      'comparison-create',
      JSON.stringify({ artifactId: artifact.id }),
      now,
      now
    );
    return artifact;
  });
}
