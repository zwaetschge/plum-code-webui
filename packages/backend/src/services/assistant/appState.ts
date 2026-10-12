import { transaction } from '../../db/pg.js';
import { findResource } from './resources.js';
import { AppError } from '../../middleware/errorHandler.js';
export async function assistantAppState(
  userId: string,
  id: string,
  revision: number,
  input?: { expectedVersion: number; state: unknown }
) {
  return transaction(async (tx) => {
    const resource = await findResource(userId, id, tx);
    if (resource.kind !== 'artifact') throw new AppError('App nicht gefunden', 404, 'NOT_FOUND');
    const snapshot = await tx.get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      resource.id,
      revision
    );
    const body = snapshot ? JSON.parse(snapshot.body_json) : null;
    if (!body || body.type !== 'app' || body.format !== 'html')
      throw new AppError('Diese Revision ist keine interaktive App', 400, 'APP_STATE_UNSUPPORTED');
    if (input)
      await tx.get('SELECT id FROM assistant_resources WHERE id=? FOR UPDATE', resource.id);
    const row = await tx.get(
      'SELECT version,state_json FROM assistant_app_state WHERE user_id=? AND resource_id=? AND revision=?',
      userId,
      resource.id,
      revision
    );
    if (!input)
      return {
        version: row ? Number(row.version) : 0,
        state: row ? JSON.parse(row.state_json) : null,
      };
    if ((row ? Number(row.version) : 0) !== input.expectedVersion)
      throw new AppError(
        'Die gespeicherten Eingaben wurden inzwischen geändert. Lade sie erneut.',
        409,
        'APP_STATE_CONFLICT'
      );
    let state: string | undefined;
    try {
      state = JSON.stringify(input.state);
    } catch {
      throw new AppError('Ungültige App-Eingaben', 400, 'APP_STATE_INVALID');
    }
    if (state === undefined || Buffer.byteLength(state) > 32768)
      throw new AppError('App-Eingaben überschreiten 32 KB', 400, 'APP_STATE_INVALID');
    const version = input.expectedVersion + 1;
    await tx.run(
      `INSERT INTO assistant_app_state(user_id,resource_id,revision,version,state_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,resource_id,revision) DO UPDATE SET version=excluded.version,state_json=excluded.state_json,updated_at=excluded.updated_at`,
      userId,
      resource.id,
      revision,
      version,
      state,
      new Date().toISOString()
    );
    return { version, state: input.state };
  });
}
