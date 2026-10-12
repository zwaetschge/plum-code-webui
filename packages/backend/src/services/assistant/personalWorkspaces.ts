import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PERSONAL_WORKSPACES } from '@plum-code-webui/shared';
import { transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createResource, findResource, BODY_SCHEMAS } from './resources.js';

export const PERSONAL_WORKSPACE_INPUT = z
  .object({
    commandId: z.string().uuid(),
    preset: z.enum(['health', 'finance']),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

/** One explicit owner-scoped creation: project and profile cannot be half-created. */
export async function createPersonalWorkspace(
  userId: string,
  input: z.output<typeof PERSONAL_WORKSPACE_INPUT>
) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const hash = createHash('sha256')
      .update(JSON.stringify(['personal-workspace', input.preset, input.title]))
      .digest('hex');
    const prior = await tx.get(
      'SELECT action,payload_hash,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'personal-workspace' || prior.payload_hash !== hash)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      const ids = JSON.parse(prior.result_json);
      return {
        project: await findResource(userId, ids.projectId, tx),
        profile: await findResource(userId, ids.profileId, tx),
      };
    }
    const preset = PERSONAL_WORKSPACES[input.preset];
    const project = await createResource(
      userId,
      'project',
      input.title,
      BODY_SCHEMAS.project.parse({
        description: preset.description,
        instructions: preset.instructions,
      }),
      tx
    );
    const profile = await createResource(
      userId,
      'profile',
      `${input.title} · Dokumentassistenz`.slice(0, 200),
      BODY_SCHEMAS.profile.parse({
        instructions:
          'Summarise the selected documents with precise source references and dates. State missing information. Keep this work within the bound project.',
        projectId: project.id,
        memory: 'off',
      }),
      tx
    );
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      project.id,
      hash,
      'personal-workspace',
      JSON.stringify({ projectId: project.id, profileId: profile.id }),
      now,
      now
    );
    return { project, profile };
  });
}
