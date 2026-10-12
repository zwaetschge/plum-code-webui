import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  AssistantResource,
  AssistantArtifactImage,
  AssistantDocumentAccess,
} from '@plum-code-webui/shared';
import { parseAssistantDocument } from '@plum-code-webui/shared';
import { all, get, transaction, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, reviseResource } from './resources.js';
export const DOCUMENT_MEMBER_INPUT = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    email: z.string().email().max(254),
    role: z.enum(['viewer', 'editor']).nullable(),
  })
  .strict();
export const DOCUMENT_WRITE_INPUT = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(50000),
  })
  .strict();
const missing = () => new AppError('Gemeinsames Dokument ist nicht verfügbar', 404, 'NOT_FOUND');
function documentOnly(resource: AssistantResource) {
  if (
    resource.kind !== 'artifact' ||
    resource.body.type !== 'document' ||
    !['markdown', 'text', 'json'].includes(String(resource.body.format))
  )
    throw new AppError(
      'Gemeinsame Bearbeitung unterstützt Text- und formatierte Dokumente.',
      400,
      'DOCUMENT_REQUIRED'
    );
  if (resource.body.format === 'json') parseAssistantDocument(String(resource.body.content));
}
function publicResource(resource: AssistantResource): AssistantResource {
  // Sharing a document does not grant its private task/source/profile references.
  return {
    ...resource,
    body: {
      type: 'document',
      format: resource.body.format,
      content: resource.body.content,
      images: resource.body.images ?? [],
    },
  };
}
async function access(
  userId: string,
  id: string,
  tx?: TransactionScope,
  revision?: number
): Promise<AssistantDocumentAccess> {
  const db = tx ?? { get };
  const row = await db.get(
    'SELECT r.user_id,u.email,u.status FROM assistant_resources r JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.archived=0',
    id
  );
  if (!row || row.status === 'suspended') throw missing();
  const member =
    userId === row.user_id
      ? null
      : await db.get(
          'SELECT role,granted_revision FROM assistant_document_members WHERE resource_id=? AND user_id=?',
          id,
          userId
        );
  if (userId !== row.user_id && !member) throw missing();
  let resource = await findResource(String(row.user_id), id, tx);
  documentOnly(resource);
  if (revision !== undefined) {
    if (member && revision < Number(member.granted_revision)) throw missing();
    const old = await db.get(
      'SELECT * FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      id,
      revision
    );
    if (!old) throw missing();
    resource = {
      ...resource,
      revision: Number(old.revision),
      title: String(old.title),
      body: JSON.parse(String(old.body_json)),
    };
    documentOnly(resource);
  }
  return {
    resource: publicResource(resource),
    role: member ? member.role : 'owner',
    ownerId: String(row.user_id),
    ownerEmail: String(row.email),
  };
}
export const documentAccess = access;
export async function sharedDocuments(userId: string, offset = 0) {
  const rows = await all(
    `SELECT r.id FROM assistant_document_members m JOIN assistant_resources r ON r.id=m.resource_id
    JOIN users u ON u.id=r.user_id WHERE m.user_id=? AND r.archived=0 AND r.kind='artifact' AND (r.body_json::jsonb)->>'type'='document' AND u.status<>'suspended' ORDER BY r.updated_at DESC,r.id LIMIT 20 OFFSET ?`,
    userId,
    offset
  );
  return Promise.all(rows.map((row) => access(userId, String(row.id))));
}
export async function documentMembers(userId: string, id: string) {
  const resource = await findResource(userId, id);
  documentOnly(resource);
  const members = await all(
    'SELECT m.user_id AS "userId",u.email,m.role,m.granted_revision AS "grantedRevision" FROM assistant_document_members m JOIN users u ON u.id=m.user_id WHERE m.resource_id=? ORDER BY u.email',
    id
  );
  const audit = await all(
    'SELECT actor_user_id AS "actorId",action,metadata_json AS metadata,created_at AS "createdAt" FROM audit_log WHERE resource_type=\'assistant-document\' AND resource_id=? ORDER BY id DESC LIMIT 50',
    id
  );
  return {
    members,
    audit: audit.map((row) => ({ ...row, metadata: JSON.parse(String(row.metadata ?? '{}')) })),
  };
}
async function receipt(
  tx: TransactionScope,
  userId: string,
  id: string,
  commandId: string,
  action: string,
  payload: unknown
) {
  const hash = createHash('sha256').update(JSON.stringify({ id, payload })).digest('hex');
  const row = await tx.get(
    'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
    userId,
    commandId
  );
  if (row && (row.resource_id !== id || row.action !== action || row.payload_hash !== hash))
    throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
  return { hash, prior: row ? JSON.parse(String(row.result_json)) : null };
}
async function record(
  tx: TransactionScope,
  userId: string,
  id: string,
  commandId: string,
  action: string,
  hash: string,
  result: unknown,
  metadata: unknown
) {
  const now = new Date().toISOString();
  await tx.run(
    "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
    userId,
    commandId,
    id,
    hash,
    action,
    JSON.stringify(result),
    now,
    now
  );
  await tx.run(
    "INSERT INTO audit_log(actor_user_id,action,resource_type,resource_id,metadata_json,created_at) VALUES(?,?,'assistant-document',?,?,?)",
    userId,
    action,
    id,
    JSON.stringify(metadata),
    now
  );
}
export async function changeDocumentMember(
  userId: string,
  id: string,
  raw: z.input<typeof DOCUMENT_MEMBER_INPUT>
) {
  const input = DOCUMENT_MEMBER_INPUT.parse(raw);
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    await tx.get('SELECT id FROM assistant_resources WHERE id=? FOR UPDATE', id);
    const own = await findResource(userId, id, tx);
    documentOnly(own);
    const saved = await receipt(tx, userId, id, input.commandId, 'document-member', input);
    if (saved.prior) return saved.prior;
    if (own.revision !== input.expectedRevision)
      throw new AppError(
        'Dokument wurde inzwischen geändert. Bitte neu laden.',
        409,
        'REVISION_CONFLICT'
      );
    const member = await tx.get(
      "SELECT id,email FROM users WHERE lower(email)=lower(?) AND status<>'suspended'",
      input.email
    );
    if (!member || member.id === userId)
      throw new AppError('Aktives anderes Plum-Konto erforderlich', 400, 'MEMBER_REQUIRED');
    if (input.role)
      await tx.run(
        `INSERT INTO assistant_document_members(resource_id,user_id,role,granted_revision,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(resource_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`,
        id,
        member.id,
        input.role,
        own.revision,
        new Date().toISOString()
      );
    else
      await tx.run(
        'DELETE FROM assistant_document_members WHERE resource_id=? AND user_id=?',
        id,
        member.id
      );
    const result = {
      userId: String(member.id),
      email: String(member.email),
      role: input.role,
      revision: own.revision,
    };
    await record(tx, userId, id, input.commandId, 'document-member', saved.hash, result, {
      userId: member.id,
      role: input.role,
      revision: own.revision,
    });
    return result;
  });
}
function retainedImages(current: AssistantResource, content: string) {
  const images = (current.body.images ?? []) as AssistantArtifactImage[];
  const allowed = new Set(
    images.flatMap((image) => [image.url, `/assistant-images/${image.assetId}`])
  );
  const urls =
    current.body.format === 'json'
      ? parseAssistantDocument(content)
          .blocks.filter((block) => block.type === 'image')
          .map((block) => `/assistant-images/${block.assetId}`)
      : [
          ...content.matchAll(
            /!\[[^\]\n]*\]\(\s*((?:\/assistant-images\/|\/generated\/)[^\s)]+)\s*\)|<img\s[^>]*?src=["']((?:\/assistant-images\/|\/generated\/)[^"']+)["']/gi
          ),
        ].map((match) => match[1] ?? match[2]);
  if (urls.some((url) => !allowed.has(url!)))
    throw new AppError(
      'Gemeinsame Bearbeitung kann nur bereits geteilte Originalbilder verwenden.',
      403,
      'DOCUMENT_IMAGE_SCOPE'
    );
}
export async function writeSharedDocument(
  userId: string,
  id: string,
  raw: z.input<typeof DOCUMENT_WRITE_INPUT>
) {
  const input = DOCUMENT_WRITE_INPUT.parse(raw);
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    // Membership changes, revocation and accepted writes share the same row lock.
    await tx.get('SELECT id FROM assistant_resources WHERE id=? FOR UPDATE', id);
    const permitted = await access(userId, id, tx);
    if (permitted.role === 'viewer')
      throw new AppError('Dieses Konto kann das Dokument nur lesen.', 403, 'DOCUMENT_READ_ONLY');
    const saved = await receipt(tx, userId, id, input.commandId, 'document-edit', input);
    if (saved.prior) return saved.prior as AssistantDocumentAccess;
    const current = await findResource(permitted.ownerId, id, tx);
    retainedImages(current, input.content);
    const revised = await reviseResource(
      permitted.ownerId,
      id,
      input.expectedRevision,
      input.title,
      { ...current.body, content: input.content },
      tx
    );
    const result = { ...permitted, resource: publicResource(revised) };
    await record(tx, userId, id, input.commandId, 'document-edit', saved.hash, result, {
      fromRevision: input.expectedRevision,
      toRevision: revised.revision,
    });
    return result;
  });
}
