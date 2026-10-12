import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { get, all, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { safeEncrypt, safeDecrypt } from '../../utils/encryption.js';
import { findResource } from './resources.js';
import { exportArtifact } from './exports.js';

export const PUBLICATION_INPUT = z
  .object({
    commandId: z.string().uuid(),
    resourceId: z.string().uuid(),
    revision: z.number().int().positive(),
    expiresAt: z.string().datetime(),
    acknowledgePublic: z.literal(true),
  })
  .strict();
export function publicationsEnabled() {
  return process.env.PLUM_PUBLICATIONS_ENABLED === 'true';
}
function publicationOrigin() {
  try {
    const value = new URL(process.env.FRONTEND_URL ?? '');
    if (
      value.username ||
      value.password ||
      !(
        value.protocol === 'https:' ||
        (value.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname))
      )
    )
      return null;
    return value.origin;
  } catch {
    return null;
  }
}
function enabled() {
  if (!publicationsEnabled())
    throw new AppError(
      'Öffentliche Veröffentlichungen sind für diese Installation nicht aktiviert',
      503,
      'PUBLICATION_DISABLED'
    );
  if (!publicationOrigin())
    throw new AppError(
      'Kanonische Plum-Adresse ist für Veröffentlichungen nicht eingerichtet',
      503,
      'PUBLICATION_ORIGIN_REQUIRED'
    );
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function metadata(row: Record<string, unknown>, includePath = true) {
  const token = includePath ? safeDecrypt(String(row.token_encrypted ?? '')) : null;
  return {
    id: String(row.id),
    resourceId: String(row.resource_id),
    revision: Number(row.revision),
    title: String(row.title),
    expiresAt: String(row.expires_at),
    revoked: !!Number(row.revoked),
    createdAt: String(row.created_at),
    contentSha256: String(row.content_sha256),
    ...(token
      ? {
          path: `/published/${token}`,
          ...(publicationOrigin() ? { url: `${publicationOrigin()}/published/${token}` } : {}),
        }
      : {}),
  };
}
export async function listPublications(userId: string, resourceId?: string) {
  return {
    enabled: publicationsEnabled(),
    items: (
      await all(
        'SELECT id,resource_id,revision,title,expires_at,revoked,created_at,content_sha256,token_encrypted FROM assistant_publications WHERE user_id=? AND (?::text IS NULL OR resource_id=?) ORDER BY created_at DESC LIMIT 100',
        userId,
        resourceId ?? null,
        resourceId ?? null
      )
    ).map((row) => metadata(row)),
  };
}
export async function createPublication(userId: string, input: z.output<typeof PUBLICATION_INPUT>) {
  enabled();
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const payloadHash = hash(
      JSON.stringify(['publish', input.resourceId, input.revision, input.expiresAt])
    );
    const prior = await tx.get(
      'SELECT action,payload_hash,result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      input.commandId
    );
    if (prior) {
      if (prior.action !== 'publish' || prior.payload_hash !== payloadHash)
        throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
      const row = await tx.get(
        'SELECT * FROM assistant_publications WHERE id=? AND user_id=?',
        JSON.parse(prior.result_json).id,
        userId
      );
      if (!row) throw new AppError('Veröffentlichung nicht gefunden', 404, 'NOT_FOUND');
      return metadata(row);
    }
    const until = Date.parse(input.expiresAt);
    if (until <= Date.now() || until > Date.now() + 30 * 86400000)
      throw new AppError(
        'Ablauf muss innerhalb der nächsten 30 Tage liegen',
        400,
        'VALIDATION_ERROR'
      );
    const artifact = await findResource(userId, input.resourceId, tx);
    if (
      artifact.kind !== 'artifact' ||
      !['app', 'design', 'document'].includes(String(artifact.body.type))
    )
      throw new AppError(
        'Diese Ergebnisart unterstützt keine öffentliche HTML-Veröffentlichung',
        400,
        'PUBLICATION_TYPE'
      );
    const version = await tx.get(
      'SELECT title,body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      artifact.id,
      input.revision
    );
    if (!version) throw new AppError('Ergebnisrevision nicht gefunden', 404, 'NOT_FOUND');
    const body = JSON.parse(version.body_json);
    if (!['app', 'design', 'document'].includes(String(body.type)))
      throw new AppError(
        'Diese Ergebnisrevision unterstützt keine öffentliche HTML-Veröffentlichung',
        400,
        'PUBLICATION_TYPE'
      );
    const file = await exportArtifact(
      { ...artifact, title: version.title, revision: input.revision, body },
      'html',
      userId
    );
    let html = file.data.toString('utf8');
    // Only saved HTML apps have script capability. They remain opaque, offline and without a Plum bridge.
    if (body.type === 'app' && body.format === 'html')
      html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '');
    if (Buffer.byteLength(html) > 3 * 1024 * 1024)
      throw new AppError('Veröffentlichung ist zu gross', 413, 'PUBLICATION_LIMIT');
    const token = randomBytes(32).toString('base64url'),
      encrypted = safeEncrypt(token);
    if (!encrypted)
      throw new AppError('Verschlüsselung ist nicht eingerichtet', 503, 'ENCRYPTION_UNAVAILABLE');
    const id = randomUUID(),
      now = new Date().toISOString(),
      sha = hash(html);
    await tx.run(
      'INSERT INTO assistant_publications(id,user_id,resource_id,revision,token_hash,token_encrypted,title,html,content_sha256,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id,
      userId,
      artifact.id,
      input.revision,
      hash(token),
      encrypted,
      version.title,
      html,
      sha,
      input.expiresAt,
      now
    );
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',?,?,?)",
      userId,
      input.commandId,
      artifact.id,
      payloadHash,
      'publish',
      JSON.stringify({ id }),
      now,
      now
    );
    return metadata((await tx.get('SELECT * FROM assistant_publications WHERE id=?', id))!);
  });
}
export async function revokePublication(userId: string, id: string) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const row = await tx.get(
      'SELECT id FROM assistant_publications WHERE id=? AND user_id=?',
      id,
      userId
    );
    if (!row) throw new AppError('Veröffentlichung nicht gefunden', 404, 'NOT_FOUND');
    await tx.run(
      'UPDATE assistant_publications SET revoked=1 WHERE id=? AND user_id=?',
      id,
      userId
    );
    return { id, revoked: true };
  });
}
export async function publicPublication(token: string) {
  enabled();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError('Veröffentlichung nicht gefunden', 404, 'NOT_FOUND');
  const row = await get(
    "SELECT p.title,p.html,p.content_sha256 FROM assistant_publications p JOIN assistant_resources r ON r.id=p.resource_id JOIN users u ON u.id=p.user_id WHERE p.token_hash=? AND p.revoked=0 AND p.expires_at>? AND r.archived=0 AND u.status<>'suspended'",
    hash(token),
    new Date().toISOString()
  );
  if (!row) throw new AppError('Veröffentlichung nicht gefunden', 404, 'NOT_FOUND');
  return row as { title: string; html: string; content_sha256: string };
}
