import type { TransactionScope } from '../../db/pg.js';
import { findResource } from './resources.js';
import { get } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
export async function captureTaskSources(
  tx: TransactionScope,
  userId: string,
  sourceIds: string[]
) {
  const result: Array<{ id: string; revision: number }> = [];
  for (const id of sourceIds) {
    const source = await findResource(userId, id, tx);
    if (source.kind !== 'source')
      throw new AppError('Ungültige Auftragsquelle', 400, 'INVALID_REFERENCE');
    result.push({ id: source.id, revision: source.revision });
  }
  return result;
}
export async function taskOriginContext(
  userId: string,
  body: Record<string, unknown>,
  tx?: TransactionScope
) {
  if (!body.originResourceId || !body.originTurnId) return null;
  const row = await (tx ?? { get }).get(
    `SELECT r.title,t.prompt,t.response,t.source_versions,t.image_asset_ids FROM assistant_resources r JOIN assistant_api_turns t ON t.chat_id=r.id WHERE r.id=? AND r.user_id=? AND r.archived=0 AND t.id=? AND t.status<>'running'`,
    String(body.originResourceId),
    userId,
    String(body.originTurnId)
  );
  if (!row) return null;
  return {
    id: body.originResourceId,
    turnId: body.originTurnId,
    title: row.title,
    prompt: String(row.prompt).slice(0, 4000),
    response: String(row.response).slice(0, 12000),
    sourceVersions: JSON.parse(row.source_versions),
    imageAssetIds: JSON.parse(row.image_asset_ids ?? '[]'),
    excerptOnly: String(row.prompt).length > 4000 || String(row.response).length > 12000,
  };
}
export async function taskSourceContext(
  userId: string,
  versions: Array<{ id: string; revision: number }>,
  query?: string
) {
  const sources: Array<{
    id: string;
    revision: number;
    title: string;
    citation: string;
    text: string;
    excerptOnly: boolean;
    excerptStart: number;
    page: number | null;
  }> = [];
  let budget = 16000;
  const selected = versions.slice(0, 20);
  for (const [index, item] of selected.entries()) {
    const source = await findResource(userId, item.id).catch(() => null);
    if (!source || source.kind !== 'source') continue;
    const version = await get(
      'SELECT title,body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      source.id,
      item.revision
    );
    if (!version) continue;
    const body = JSON.parse(version.body_json),
      text = String(body.text ?? '');
    let start = 0;
    const terms = [
      ...new Set((query ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []),
    ].slice(0, 40);
    if (terms.length) {
      // Retrieval stays on the exact input revision, including when a file is replaced mid-turn.
      const chunks = await get(
        `SELECT start_offset,text FROM assistant_source_chunks WHERE resource_id=? AND revision=? ORDER BY (${terms.map(() => '(CASE WHEN text ILIKE ? THEN 1 ELSE 0 END)').join('+')}) DESC,chunk_index LIMIT 1`,
        source.id,
        item.revision,
        ...terms.map((term) => '%' + term + '%')
      );
      if (chunks) {
        const lower = String(chunks.text).toLocaleLowerCase(),
          positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0);
        start =
          Number(chunks.start_offset) +
          Math.max(0, (positions.length ? Math.min(...positions) : 0) - 200);
      }
    }
    const length = Math.min(query ? Math.floor(budget / (selected.length - index)) : 2000, budget);
    start = Math.min(start, Math.max(0, text.length - length));
    const excerpt = text.slice(start, start + length);
    const marker =
      body.pageCount && !body.textEdited
        ? [...text.slice(0, start + 1).matchAll(/\[Seite (\d+)\]/g)].at(-1)
        : null;
    budget -= excerpt.length;
    sources.push({
      id: source.id,
      revision: item.revision,
      title: String(version.title),
      citation: String(body.citation ?? ''),
      text: excerpt,
      excerptOnly: excerpt.length < text.length,
      excerptStart: start,
      page: marker ? Number(marker[1]) : null,
    });
    if (budget <= 0) break;
  }
  return sources;
}
