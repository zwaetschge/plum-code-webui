import { z } from 'zod';
import type { AssistantResource } from '@plum-code-webui/shared';
import { all, get, transaction, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, reviseResource } from './resources.js';

export const LIBRARY_ACCESS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS assistant_library_members (
    resource_id TEXT NOT NULL REFERENCES assistant_resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('viewer','editor')), granted_revision BIGINT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(resource_id,user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS assistant_library_members_user ON assistant_library_members(user_id)`,
];
const missing = () => new AppError('Quelle oder Sammlung nicht verfügbar', 404, 'NOT_FOUND');
export type LibraryAccess = {
  resource: AssistantResource;
  ownerId: string;
  ownerEmail: string;
  role: 'owner' | 'viewer' | 'editor';
  grantedRevision: number;
};
const sourceKeys = new Set([
  'text',
  'url',
  'citation',
  'mimeType',
  'filename',
  'sha256',
  'pageCount',
  'truncated',
  'pages',
  'ingestedAt',
  'ingestion',
  'assetId',
  'textEdited',
  'office',
]);
function publicResource(resource: AssistantResource) {
  return {
    ...resource,
    body:
      resource.kind === 'source'
        ? Object.fromEntries(Object.entries(resource.body).filter(([key]) => sourceKeys.has(key)))
        : {
            description: resource.body.description ?? '',
            resourceIds: resource.body.resourceIds ?? [],
            favoriteIds: [],
            tags: resource.body.tags ?? [],
            knowledge: resource.body.knowledge === true,
            notes: resource.body.notes ?? '',
          },
  };
}
/** A collection grants its current sources, never private project/profile/chat references. */
export async function libraryAccess(
  userId: string,
  id: string,
  tx?: TransactionScope,
  revision?: number
): Promise<LibraryAccess> {
  const db = tx ?? { get, all };
  const row = await db.get(
    "SELECT r.*,u.email,u.status FROM assistant_resources r JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.archived=0 AND r.kind IN ('source','collection') AND u.status<>'suspended'",
    id
  );
  if (!row) throw missing();
  const owned = row.user_id === userId;
  let role: LibraryAccess['role'] = 'owner',
    floor = 1;
  if (!owned) {
    if (JSON.parse(String(row.body_json)).temporaryChatId) throw missing();
    const direct = await db.get(
      'SELECT role,granted_revision FROM assistant_library_members WHERE resource_id=? AND user_id=?',
      id,
      userId
    );
    if (direct) {
      role = direct.role;
      floor = Number(direct.granted_revision);
    } else {
      if (row.kind !== 'source') throw missing();
      const inherited = await db.get(
        `SELECT m.role FROM assistant_library_members m JOIN assistant_resources c ON c.id=m.resource_id
        WHERE m.user_id=? AND c.user_id=? AND c.kind='collection' AND c.archived=0
        AND c.body_json::jsonb->'resourceIds' @> ?::jsonb ORDER BY CASE m.role WHEN 'editor' THEN 0 ELSE 1 END LIMIT 1`,
        userId,
        row.user_id,
        JSON.stringify([id])
      );
      if (!inherited) throw missing();
      role = inherited.role;
      // New collection members see the current source, not its prior private revisions.
      floor = Number(row.revision);
    }
  }
  let resource = await findResource(String(row.user_id), id, tx);
  if (revision !== undefined && revision !== resource.revision) {
    if (revision < floor) throw missing();
    const old = await db.get(
      'SELECT title,body_json,created_at FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      id,
      revision
    );
    if (!old) throw missing();
    resource = {
      ...resource,
      title: String(old.title),
      body: JSON.parse(String(old.body_json)),
      revision,
    };
  }
  if (!owned && resource.kind === 'collection') {
    const allowed = await db.all(
      "SELECT id FROM assistant_resources WHERE user_id=? AND kind='source' AND archived=0 AND body_json::jsonb->>'temporaryChatId' IS NULL AND id IN (SELECT jsonb_array_elements_text(?::jsonb))",
      row.user_id,
      JSON.stringify(resource.body.resourceIds ?? [])
    );
    const ids = new Set(allowed.map((item) => String(item.id)));
    resource = {
      ...resource,
      body: {
        ...resource.body,
        resourceIds: ((resource.body.resourceIds as string[]) ?? []).filter((item) =>
          ids.has(item)
        ),
      },
    };
  }
  return {
    resource: owned ? resource : publicResource(resource),
    ownerId: String(row.user_id),
    ownerEmail: String(row.email),
    role,
    grantedRevision: floor,
  };
}
export async function readableSource(
  userId: string,
  id: string,
  tx?: TransactionScope,
  revision?: number
) {
  const access = await libraryAccess(userId, id, tx, revision);
  if (access.resource.kind !== 'source') throw missing();
  return access;
}
export async function sharedLibraries(userId: string, offset = 0) {
  const rows = await all(
    `SELECT r.id FROM assistant_library_members m JOIN assistant_resources r ON r.id=m.resource_id
    JOIN users u ON u.id=r.user_id WHERE m.user_id=? AND r.archived=0 AND u.status<>'suspended' ORDER BY r.updated_at DESC,r.id LIMIT 50 OFFSET ?`,
    userId,
    offset
  );
  return Promise.all(rows.map((row) => libraryAccess(userId, String(row.id))));
}
export async function libraryMembers(userId: string, id: string) {
  const access = await libraryAccess(userId, id);
  if (access.role !== 'owner') throw missing();
  return all(
    'SELECT m.user_id AS "userId",u.email,m.role,m.granted_revision AS "grantedRevision" FROM assistant_library_members m JOIN users u ON u.id=m.user_id WHERE m.resource_id=? ORDER BY u.email',
    id
  );
}
export const LIBRARY_MEMBER_INPUT = z
  .object({
    expectedRevision: z.number().int().positive(),
    email: z.string().email().max(254),
    role: z.enum(['viewer', 'editor']).nullable(),
  })
  .strict();
export async function changeLibraryMember(
  userId: string,
  id: string,
  raw: z.input<typeof LIBRARY_MEMBER_INPUT>
) {
  const input = LIBRARY_MEMBER_INPUT.parse(raw);
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM assistant_resources WHERE id=? FOR UPDATE', id);
    const access = await libraryAccess(userId, id, tx);
    if (access.role !== 'owner') throw missing();
    if (access.resource.revision !== input.expectedRevision)
      throw new AppError(
        'Sammlung oder Quelle wurde inzwischen geändert',
        409,
        'REVISION_CONFLICT'
      );
    if (access.resource.body.temporaryChatId)
      throw new AppError('Temporäre Quellen können nicht geteilt werden', 400, 'TEMPORARY_SHARE');
    if (access.resource.kind === 'collection')
      for (const child of (access.resource.body.resourceIds as string[]) ?? []) {
        const source = await findResource(userId, child, tx);
        if (source.kind !== 'source' || source.body.temporaryChatId)
          throw new AppError('Nur Quellensammlungen können geteilt werden', 400, 'SOURCES_ONLY');
      }
    const member = await tx.get(
      "SELECT id FROM users WHERE lower(email)=lower(?) AND status<>'suspended'",
      input.email
    );
    if (!member || member.id === userId)
      throw new AppError('Aktives anderes Plum-Konto erforderlich', 400, 'MEMBER_REQUIRED');
    if (input.role)
      await tx.run(
        `INSERT INTO assistant_library_members(resource_id,user_id,role,granted_revision,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(resource_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`,
        id,
        member.id,
        input.role,
        access.resource.revision,
        new Date().toISOString()
      );
    else
      await tx.run(
        'DELETE FROM assistant_library_members WHERE resource_id=? AND user_id=?',
        id,
        member.id
      );
    await tx.run(
      "INSERT INTO audit_log(actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES(?,'library-member','assistant-library',?,?,?)",
      userId,
      id,
      JSON.stringify({ userId: member.id, role: input.role }),
      new Date().toISOString()
    );
    return { userId: member.id, role: input.role };
  });
}
export const LIBRARY_WRITE_INPUT = z
  .object({
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(500000).optional(),
    notes: z.string().max(50000).optional(),
    description: z.string().max(5000).optional(),
  })
  .strict();
export async function writeLibrary(
  userId: string,
  id: string,
  raw: z.input<typeof LIBRARY_WRITE_INPUT>
) {
  const input = LIBRARY_WRITE_INPUT.parse(raw);
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM assistant_resources WHERE id=? FOR UPDATE', id);
    const access = await libraryAccess(userId, id, tx);
    if (access.role === 'viewer')
      throw new AppError('Dieser Eintrag ist schreibgeschützt', 403, 'READ_ONLY');
    const original = await findResource(access.ownerId, id, tx);
    const body =
      original.kind === 'source'
        ? {
            ...original.body,
            ...(input.text !== undefined ? { text: input.text, textEdited: true } : {}),
          }
        : {
            ...original.body,
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          };
    const revised = await reviseResource(
      access.ownerId,
      id,
      input.expectedRevision,
      input.title,
      body,
      tx
    );
    await tx.run(
      "INSERT INTO audit_log(actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES(?,'library-edit','assistant-library',?,?,?)",
      userId,
      id,
      JSON.stringify({ revision: revised.revision }),
      new Date().toISOString()
    );
    return libraryAccess(userId, id, tx);
  });
}
export async function libraryFile(userId: string, id: string, revision?: number) {
  const access = await readableSource(userId, id, undefined, revision);
  const asset = await get(
    'SELECT filename,mime_type,bytes FROM assistant_assets WHERE id=? AND user_id=?',
    access.resource.body.assetId,
    access.ownerId
  );
  if (!asset) throw missing();
  return asset;
}
