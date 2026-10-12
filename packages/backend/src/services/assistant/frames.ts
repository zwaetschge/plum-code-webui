import { createHash, randomBytes } from 'node:crypto';
import { get } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource } from './resources.js';
import { readArtifactImage } from './artifactImages.js';
import type { AssistantArtifactImage } from '@plum-code-webui/shared';

export const APP_FRAME_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts; frame-ancestors 'self'";
const pending = new Map<
  string,
  { userId: string; html: string; until: number; artifactId: string; shareHash?: string }
>();
export async function createAppFrame(
  userId: string,
  input: {
    artifactId?: string;
    shareToken?: string;
    revision?: number;
    content?: string;
    channel: string;
    stateEnabled: boolean;
    actionsEnabled?: boolean;
  }
) {
  let body: Record<string, unknown>,
    revision: number,
    artifactId: string,
    shareHash: string | undefined;
  let imageOwner = userId;
  if (input.shareToken) {
    shareHash = createHash('sha256').update(input.shareToken).digest('hex');
    const row = await get(
      `SELECT r.id,r.user_id,r.kind,v.body_json,v.revision FROM assistant_shares s JOIN assistant_resources r ON r.id=s.resource_id JOIN assistant_resource_revisions v ON v.resource_id=r.id AND v.revision=s.revision WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND r.archived=0`,
      shareHash,
      new Date().toISOString()
    );
    if (!row || row.kind !== 'artifact')
      throw new AppError('Freigabe ist nicht verfügbar', 404, 'NOT_FOUND');
    if (input.stateEnabled || input.actionsEnabled || input.content !== undefined)
      throw new AppError('Geteilte App-Version ist schreibgeschützt', 403, 'SHARE_READ_ONLY');
    body = JSON.parse(row.body_json);
    revision = Number(row.revision);
    artifactId = String(row.id);
    imageOwner = String(row.user_id);
  } else {
    const artifact = await findResource(userId, input.artifactId ?? '');
    if (artifact.kind !== 'artifact')
      throw new AppError('Ergebnis nicht gefunden', 404, 'NOT_FOUND');
    artifactId = artifact.id;
    revision = input.revision ?? artifact.revision;
    const row = await get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      artifact.id,
      revision
    );
    if (!row) throw new AppError('Revision nicht gefunden', 404, 'NOT_FOUND');
    body = JSON.parse(row.body_json);
  }
  const content = input.content ?? String(body.content ?? '');
  if (content.length > 50000) throw new AppError('App-Vorschau ist zu gross', 413, 'FRAME_LIMIT');
  if (
    (input.stateEnabled || input.actionsEnabled) &&
    (body.type !== 'app' || body.format !== 'html' || content !== body.content)
  )
    throw new AppError('Die App zuerst als Revision speichern', 409, 'APP_SAVE_REQUIRED');
  if (!/^[A-Za-z0-9:._-]{1,255}$/.test(input.channel))
    throw new AppError('Ungültige Vorschaukennung', 400, 'VALIDATION_ERROR');
  const methods = [
    ...(input.stateEnabled
      ? ["loadState:()=>request('load')", "saveState:state=>request('save',state)"]
      : []),
    ...(input.actionsEnabled ? ["proposeTask:proposal=>request('propose-task',proposal)"] : []),
  ].join(',');
  const bridge = methods
    ? `<script>(()=>{const channel=${JSON.stringify(input.channel)},pending=new Map();let sequence=0;window.addEventListener('message',event=>{if(event.source!==parent||event.data?.channel!==channel)return;const item=pending.get(event.data.id);if(!item)return;pending.delete(event.data.id);clearTimeout(item.timer);event.data.error?item.reject(new Error(event.data.error)):item.resolve(event.data.result??event.data.state);});const request=(action,state)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Plum hat nicht rechtzeitig geantwortet'));},30000);pending.set(id,{resolve,reject,timer});parent.postMessage({channel,id,action,state},'*');});window.Plum=Object.freeze({${methods}});})();</script>`
    : '';
  // Only revision-bound originals enter the offline sandbox; no authenticated URL or account token does.
  const embedded = new Map<string, string>();
  let imageBytes = 0;
  for (const metadata of (Array.isArray(body.images)
    ? body.images
    : []) as AssistantArtifactImage[]) {
    if (!content.includes(metadata.url)) continue;
    const image = await readArtifactImage(imageOwner, body, metadata.assetId);
    imageBytes += image.bytes.length;
    if (imageBytes > 2 * 1024 * 1024)
      throw new AppError(
        'App-Vorschau unterstützt zusammen höchstens 2 MB eingebettete Bilder',
        413,
        'FRAME_IMAGE_LIMIT'
      );
    embedded.set(metadata.url, `data:${image.mimeType};base64,${image.bytes.toString('base64')}`);
  }
  const prepared = content.replace(
    /(<img\s[^>]*?src=["'])([^"']+)(["'])/gi,
    (all, before: string, url: string, after: string) =>
      embedded.has(url) ? `${before}${embedded.get(url)}${after}` : all
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">${bridge}</head><body>${prepared}</body></html>`;
  const now = Date.now();
  for (const [key, item] of pending) if (item.until < now) pending.delete(key);
  while ([...pending.values()].filter((item) => item.userId === userId).length >= 20) {
    const oldest = [...pending].find(([, item]) => item.userId === userId);
    if (oldest) pending.delete(oldest[0]);
    else break;
  }
  while (pending.size >= 200) pending.delete(pending.keys().next().value!);
  // One-use capability grants this HTML only, not an account or any API permission.
  const token = randomBytes(32).toString('base64url'),
    digest = createHash('sha256').update(token).digest('hex');
  pending.set(digest, { userId, html, until: now + 120000, artifactId, shareHash });
  return { path: `/api/assistant/app-frames/${token}`, revision };
}
export async function consumeAppFrame(token: string) {
  const digest = createHash('sha256').update(token).digest('hex'),
    item = pending.get(digest);
  pending.delete(digest);
  if (!item || item.until < Date.now())
    throw new AppError('Vorschau ist abgelaufen; neu laden', 404, 'FRAME_EXPIRED');
  const user = await get('SELECT status FROM users WHERE id=?', item.userId);
  if (!user || user.status === 'suspended')
    throw new AppError('Vorschau ist nicht verfügbar', 404, 'FRAME_EXPIRED');
  const available = item.shareHash
    ? await get(
        'SELECT r.id FROM assistant_shares s JOIN assistant_resources r ON r.id=s.resource_id WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND r.archived=0',
        item.shareHash,
        new Date().toISOString()
      )
    : await get(
        'SELECT id FROM assistant_resources WHERE id=? AND user_id=? AND archived=0',
        item.artifactId,
        item.userId
      );
  if (!available) throw new AppError('Vorschau ist nicht verfügbar', 404, 'FRAME_EXPIRED');
  return item.html;
}
