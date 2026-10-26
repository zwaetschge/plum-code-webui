import { get } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, RESOURCE_KINDS } from './resources.js';

export async function resourceRevisionDiff(
  userId: string,
  collection: keyof typeof RESOURCE_KINDS,
  id: string,
  from: number,
  to: number
) {
  const resource = await findResource(userId, id);
  if (resource.kind !== RESOURCE_KINDS[collection])
    throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
  const versions = await Promise.all(
    [from, to].map(async (revision) => {
      const row = await get(
        'SELECT title,body_json,created_at FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
        id,
        revision
      );
      if (!row) throw new AppError('Revision nicht gefunden', 404, 'NOT_FOUND');
      return {
        revision,
        title: String(row.title),
        body: JSON.parse(row.body_json),
        createdAt: String(row.created_at),
      };
    })
  );
  const lines = versions.map((v) =>
    (`# ${v.title}\n\n` + JSON.stringify(v.body, null, 2)).split('\n')
  );
  let prefix = 0,
    suffix = 0;
  while (
    prefix < lines[0]!.length &&
    prefix < lines[1]!.length &&
    lines[0]![prefix] === lines[1]![prefix]
  )
    prefix++;
  while (
    suffix < lines[0]!.length - prefix &&
    suffix < lines[1]!.length - prefix &&
    lines[0]![lines[0]!.length - suffix - 1] === lines[1]![lines[1]!.length - suffix - 1]
  )
    suffix++;
  return {
    from: versions[0],
    to: versions[1],
    lines: [
      ...lines[0]!.slice(0, prefix).map((text) => ({ type: 'same', text })),
      ...lines[0]!
        .slice(prefix, lines[0]!.length - suffix)
        .map((text) => ({ type: 'removed', text })),
      ...lines[1]!
        .slice(prefix, lines[1]!.length - suffix)
        .map((text) => ({ type: 'added', text })),
      ...lines[0]!.slice(lines[0]!.length - suffix).map((text) => ({ type: 'same', text })),
    ],
  };
}
