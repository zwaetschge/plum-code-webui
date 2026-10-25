import type { TransactionScope } from '../../db/pg.js';
import { findResource } from './resources.js';
import { all, get, run } from '../../db/pg.js';
import { embedMemory, embeddingModel } from './memorySemantic.js';
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
  query?: string,
  fullDocuments = false
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
    retrieval?: string;
  }> = [];
  let budget = fullDocuments ? 96000 : 32000;
  // Local embeddings share the existing private embedding service, never a new cloud key.
  const queryVector =
    query && !fullDocuments
      ? await Promise.race([
          embedMemory([query])
            .then((v) => v[0])
            .catch(() => null),
          new Promise<null>((resolve) => {
            const t = setTimeout(() => resolve(null), 1800);
            t.unref();
          }),
        ])
      : null;
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
    const terms = [
      ...new Set((query ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
    ].slice(0, 40);
    const chunks = fullDocuments
      ? []
      : await all(
          'SELECT chunk_index,start_offset,end_offset,page,text,embedding,embedding_model FROM assistant_source_chunks WHERE resource_id=? AND revision=? ORDER BY chunk_index LIMIT 300',
          source.id,
          item.revision
        );
    // Index only immutable, owned source revisions. A failed embedding service leaves lexical retrieval usable.
    if (queryVector && chunks.some((c) => !c.embedding || c.embedding_model !== embeddingModel())) {
      const missing = chunks.filter((c) => !c.embedding || c.embedding_model !== embeddingModel());
      const vectors = await Promise.race([
        embedMemory(missing.map((c) => String(c.text))).catch(() => null),
        new Promise<null>((resolve) => {
          const t = setTimeout(() => resolve(null), 4000);
          t.unref();
        }),
      ]);
      if (vectors)
        for (const [i, chunk] of missing.entries()) {
          chunk.embedding = vectors[i];
          chunk.embedding_model = embeddingModel();
          await run(
            'UPDATE assistant_source_chunks SET embedding=?::double precision[],embedding_model=? WHERE resource_id=? AND revision=? AND chunk_index=?',
            vectors[i],
            embeddingModel(),
            source.id,
            item.revision,
            chunk.chunk_index
          );
        }
    }
    const ranked = chunks
      .map((c) => {
        const lower = String(c.text).toLocaleLowerCase();
        const lexical = terms.filter((t) => lower.includes(t)).length / Math.max(1, terms.length);
        const vector = c.embedding as number[] | null;
        const semantic =
          queryVector &&
          vector?.length === queryVector.length &&
          c.embedding_model === embeddingModel()
            ? vector.reduce((sum, v, i) => sum + v * queryVector[i]!, 0)
            : 0;
        return { ...c, score: lexical * 0.5 + semantic, semantic: !!(queryVector && vector) };
      })
      .sort((a, b) => b.score - a.score || Number(a.chunk_index) - Number(b.chunk_index));
    const allowance = Math.floor(budget / Math.max(1, selected.length - index));
    const chosen =
      fullDocuments || !ranked.length
        ? [{ text, start_offset: 0, page: null, semantic: false }]
        : ranked
            .filter(
              (c, i, list) =>
                !list
                  .slice(0, i)
                  .some((p) => Math.abs(Number(p.start_offset) - Number(c.start_offset)) < 3500)
            )
            .slice(0, 4);
    let remaining = allowance;
    for (const chunk of chosen) {
      if (remaining <= 0) break;
      const start = Number(chunk.start_offset),
        excerpt = String(chunk.text).slice(0, remaining);
      remaining -= excerpt.length;
      budget -= excerpt.length;
      const marker =
        body.pageCount && !body.textEdited
          ? [...text.slice(0, start + 1).matchAll(/\[Seite (\d+)\]/g)].at(-1)
          : null;
      sources.push({
        id: source.id,
        revision: item.revision,
        title: String(version.title),
        citation: String(body.citation ?? ''),
        text: excerpt,
        excerptOnly: excerpt.length < text.length,
        excerptStart: start,
        page: body.textEdited ? null : Number(chunk.page ?? marker?.[1]) || null,
        retrieval: fullDocuments ? 'full' : chunk.semantic ? 'hybrid' : 'lexical',
      });
    }
    if (budget <= 0) break;
  }
  return sources;
}
