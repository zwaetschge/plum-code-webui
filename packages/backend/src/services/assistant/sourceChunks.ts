import type { TransactionScope } from '../../db/pg.js';
import { all } from '../../db/pg.js';
/** Character offsets refer to the stored UTF-16 text, not byte positions in the original file. */
export async function indexSource(
  tx: TransactionScope,
  id: string,
  revision: number,
  body: Record<string, unknown>
) {
  const text = String(body.text ?? '');
  for (let start = 0, index = 0; start < text.length; start += 3600, index++) {
    const end = Math.min(start + 4000, text.length);
    const marker = [...text.slice(0, start + 1).matchAll(/\[Seite (\d+)\]/g)].at(-1);
    await tx.run(
      'INSERT INTO assistant_source_chunks(resource_id,revision,chunk_index,start_offset,end_offset,page,text) VALUES (?,?,?,?,?,?,?)',
      id,
      revision,
      index,
      start,
      end,
      marker ? Number(marker[1]) : null,
      text.slice(start, end)
    );
    if (end === text.length) break;
  }
}
export async function searchSourceChunks(
  userId: string,
  projectId: string,
  query: string,
  allProjects = false
) {
  const escaped = query.replace(/[\\%_]/g, '\\$&');
  const rows = await all(
    `SELECT r.id,r.title,r.revision,r.body_json,c.chunk_index,c.start_offset,c.end_offset,c.page,c.text
    FROM assistant_source_chunks c JOIN assistant_resources r ON r.id=c.resource_id AND r.revision=c.revision
    WHERE r.user_id=? AND r.kind='source' AND r.archived=0 AND (? OR (r.body_json::jsonb)->>'projectId'=?) AND (c.text ILIKE ? OR r.title ILIKE ?)
    ORDER BY r.updated_at DESC,c.chunk_index LIMIT 20`,
    userId,
    allProjects,
    projectId,
    `%${escaped}%`,
    `%${escaped}%`
  );
  return rows.map((row) => {
    const body = JSON.parse(row.body_json),
      text = String(row.text),
      match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()),
      start = Math.max(0, match - 200);
    const absolute = Number(row.start_offset) + Math.max(0, match);
    const marker =
      body.pageCount && !body.textEdited
        ? [
            ...String(body.text)
              .slice(0, absolute + 1)
              .matchAll(/\[Seite (\d+)\]/g),
          ].at(-1)
        : null;
    const atPosition =
      body.pageCount && !body.textEdited
        ? /^\[Seite (\d+)\]/.exec(String(body.text).slice(absolute))
        : null;
    const page = atPosition ? Number(atPosition[1]) : marker ? Number(marker[1]) : null;
    return {
      id: String(row.id),
      kind: 'source',
      title: String(row.title),
      revision: Number(row.revision),
      chunk: Number(row.chunk_index),
      page,
      excerpt: text.slice(start, start + 1200),
      excerptStart: Number(row.start_offset) + start,
      citation: `${body.citation || row.title}${page ? ` · Seite ${page}` : ''} · Revision ${row.revision}`,
      url: body.url ?? null,
      sha256: body.sha256 ?? null,
      truncated: body.truncated === true,
      reference: `[${row.title} · Revision ${row.revision}](/assistant/sources?resource=${encodeURIComponent(String(row.id))}&revision=${row.revision})`,
    };
  });
}
