import { createHash, randomUUID } from 'node:crypto';
import { all, get, run, transaction, type TransactionScope } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { BODY_SCHEMAS, createResource, findResource, reviseResource } from './resources.js';
import { fetchPublicSource, publicSourceUrl } from './publicSources.js';
import { requireAssistantExecutor } from './executor.js';

const captures = new Map<string, number>();
async function capture(userId: string, url: string) {
  if ((captures.get(userId) ?? 0) >= 2 || [...captures.values()].reduce((s, v) => s + v, 0) >= 20)
    throw new AppError('Quellenabrufe sind gerade ausgelastet; kurz warten', 429, 'SOURCE_BUSY');
  captures.set(userId, (captures.get(userId) ?? 0) + 1);
  try {
    return await fetchPublicSource(url);
  } finally {
    const remaining = (captures.get(userId) ?? 1) - 1;
    if (remaining) captures.set(userId, remaining);
    else captures.delete(userId);
  }
}
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
async function receipt(
  userId: string,
  commandId: string,
  action: string,
  hash: string,
  tx?: TransactionScope
) {
  const row = await (tx ?? { get }).get(
    'SELECT * FROM assistant_commands WHERE user_id=? AND command_id=?',
    userId,
    commandId
  );
  if (!row) return null;
  if (row.action !== action || row.payload_hash !== hash)
    throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
  return JSON.parse(String(row.result_json));
}
async function saveReceipt(
  tx: TransactionScope,
  userId: string,
  id: string,
  commandId: string,
  action: string,
  hash: string,
  result: unknown
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
}
async function capturedBody(
  tx: TransactionScope,
  userId: string,
  result: Awaited<ReturnType<typeof fetchPublicSource>>,
  projectId?: string
) {
  const sha256 = createHash('sha256').update(result.bytes).digest('hex'),
    filename = `${new URL(result.url).hostname}.${result.mimeType === 'text/html' ? 'html' : 'txt'}`,
    now = new Date().toISOString();
  const asset = await tx.get(
    'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
    randomUUID(),
    userId,
    filename,
    result.mimeType,
    sha256,
    result.bytes,
    now
  );
  return {
    ...BODY_SCHEMAS.source.parse({
      text: result.text,
      url: result.url,
      mimeType: result.mimeType,
      citation: `${result.url} · abgerufen ${now}`,
      ...(projectId ? { projectId } : {}),
    }),
    assetId: asset.id,
    filename,
    sha256,
    ingestedAt: now,
    truncated: result.truncated,
    pages: [],
    ingestion: 'ready',
    capture: 'public-web',
  };
}
export async function importWebSource(
  userId: string,
  input: { commandId: string; url: string; projectId?: string; title?: string }
) {
  const url = publicSourceUrl(input.url).href,
    hash = digest([url, input.projectId ?? null, input.title ?? null]);
  const prior = await receipt(userId, input.commandId, 'web-source-import', hash);
  if (prior) return prior;
  if (input.projectId && (await findResource(userId, input.projectId)).kind !== 'project')
    throw new AppError('Wissensprojekt nicht gefunden', 404, 'NOT_FOUND');
  const result = await capture(userId, url);
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const duplicate = await receipt(userId, input.commandId, 'web-source-import', hash, tx);
    if (duplicate) return duplicate;
    const body = await capturedBody(tx, userId, result, input.projectId),
      title = (input.title || result.title || new URL(url).hostname).slice(0, 200);
    const source = await createResource(userId, 'source', title, body, tx);
    await saveReceipt(tx, userId, source.id, input.commandId, 'web-source-import', hash, source);
    return source;
  });
}
export async function sourceWatch(userId: string, id: string) {
  const source = await findResource(userId, id);
  if (source.kind !== 'source') throw new AppError('Quelle nicht gefunden', 404, 'NOT_FOUND');
  const row = await get(
    'SELECT * FROM assistant_source_watches WHERE source_id=? AND user_id=?',
    id,
    userId
  );
  return {
    revision: Number(row?.revision ?? 0),
    enabled: row?.enabled === 1 || Number(row?.enabled) === 1,
    intervalMinutes: Number(row?.interval_minutes ?? 60),
    checkedAt: row?.checked_at ?? null,
    nextCheckAt: row?.next_check_at ?? null,
    error: row?.error ?? null,
  };
}
export async function configureSourceWatch(
  userId: string,
  id: string,
  input: {
    commandId: string;
    expectedRevision: number;
    expectedWatchRevision: number;
    enabled: boolean;
    intervalMinutes: number;
  }
) {
  const hash = digest([
    id,
    input.expectedRevision,
    input.expectedWatchRevision,
    input.enabled,
    input.intervalMinutes,
  ]);
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await receipt(userId, input.commandId, 'source-watch', hash, tx);
    if (prior) return prior;
    const source = await findResource(userId, id, tx);
    if (source.kind !== 'source') throw new AppError('Quelle nicht gefunden', 404, 'NOT_FOUND');
    if (source.revision !== input.expectedRevision)
      throw new AppError('Quelle wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    if (input.enabled) {
      if (source.body.capture !== 'public-web')
        throw new AppError(
          'Quelle zuerst über ihre öffentliche Webadresse einlesen',
          400,
          'SOURCE_NOT_WEB'
        );
      publicSourceUrl(String(source.body.url ?? ''));
    }
    const current = await tx.get(
      'SELECT revision FROM assistant_source_watches WHERE source_id=?',
      id
    );
    if (Number(current?.revision ?? 0) !== input.expectedWatchRevision)
      throw new AppError('Beobachtung wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
    if (input.enabled) {
      const count = await tx.get(
        'SELECT COUNT(*) AS count FROM assistant_source_watches WHERE user_id=? AND enabled=1 AND source_id<>?',
        userId,
        id
      );
      if (Number(count?.count) >= 20)
        throw new AppError('Höchstens 20 aktive Webquellen pro Konto', 400, 'SOURCE_WATCH_LIMIT');
    }
    const now = new Date().toISOString(),
      revision = input.expectedWatchRevision + 1;
    await tx.run(
      'INSERT INTO assistant_source_watches(source_id,user_id,revision,enabled,interval_minutes,next_check_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,next_check_at=excluded.next_check_at,updated_at=excluded.updated_at,error=NULL',
      id,
      userId,
      revision,
      input.enabled ? 1 : 0,
      input.intervalMinutes,
      now,
      now
    );
    const result = { revision, enabled: input.enabled, intervalMinutes: input.intervalMinutes };
    await saveReceipt(tx, userId, id, input.commandId, 'source-watch', hash, result);
    return result;
  });
}
export async function refreshWebSource(
  userId: string,
  id: string,
  input: { commandId: string; expectedRevision: number },
  watchRevision?: number
) {
  const hash = digest([id, input.expectedRevision]);
  const prior = await receipt(userId, input.commandId, 'web-source-refresh', hash);
  if (prior) return prior;
  const source = await findResource(userId, id);
  if (source.kind !== 'source' || source.body.capture !== 'public-web')
    throw new AppError('Dies ist keine direkt abrufbare Webquelle', 400, 'SOURCE_NOT_WEB');
  if (source.revision !== input.expectedRevision)
    throw new AppError('Quelle wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
  const result = await capture(userId, String(source.body.url));
  if (watchRevision !== undefined) await requireAssistantExecutor();
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const duplicate = await receipt(userId, input.commandId, 'web-source-refresh', hash, tx);
    if (duplicate) return duplicate;
    const current = await findResource(userId, id, tx);
    if (current.revision !== input.expectedRevision)
      throw new AppError('Quelle wurde während der Abfrage geändert', 409, 'REVISION_CONFLICT');
    const watch = await tx.get(
      'SELECT * FROM assistant_source_watches WHERE source_id=? AND user_id=?',
      id,
      userId
    );
    if (
      watchRevision !== undefined &&
      (!watch || Number(watch.revision) !== watchRevision || Number(watch.enabled) !== 1)
    )
      throw new AppError(
        'Beobachtung wurde während der Abfrage beendet',
        409,
        'SOURCE_WATCH_CHANGED'
      );
    const sha = createHash('sha256').update(result.bytes).digest('hex');
    const changed = sha !== current.body.sha256;
    const latest = changed
      ? await reviseResource(
          userId,
          id,
          current.revision,
          current.title,
          await capturedBody(
            tx,
            userId,
            result,
            typeof current.body.projectId === 'string' ? current.body.projectId : undefined
          ),
          tx
        )
      : current;
    const now = new Date().toISOString();
    if (watch)
      await tx.run(
        'UPDATE assistant_source_watches SET checked_at=?,error=NULL,next_check_at=?,updated_at=? WHERE source_id=? AND revision=?',
        now,
        new Date(Date.now() + Number(watch.interval_minutes) * 60000).toISOString(),
        now,
        id,
        Number(watch.revision)
      );
    const output = { source: latest, changed, checkedAt: now };
    await saveReceipt(tx, userId, id, input.commandId, 'web-source-refresh', hash, output);
    return output;
  });
}
export function startSourceObservation() {
  if (process.env.PLUM_ASSISTANT_EXECUTOR === 'false') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await requireAssistantExecutor();
      const due = await all(
        "SELECT w.*,r.revision AS source_revision FROM assistant_source_watches w JOIN assistant_resources r ON r.id=w.source_id AND r.user_id=w.user_id JOIN users u ON u.id=w.user_id WHERE w.enabled=1 AND w.next_check_at<=? AND r.archived=0 AND u.status='active' ORDER BY w.next_check_at LIMIT 10",
        new Date().toISOString()
      );
      for (const watch of due) {
        await requireAssistantExecutor();
        try {
          await refreshWebSource(
            String(watch.user_id),
            String(watch.source_id),
            { commandId: randomUUID(), expectedRevision: Number(watch.source_revision) },
            Number(watch.revision)
          );
        } catch (failure) {
          await run(
            'UPDATE assistant_source_watches SET error=?,checked_at=?,next_check_at=? WHERE source_id=? AND revision=?',
            failure instanceof AppError ? failure.message : 'Quellenabruf ist fehlgeschlagen',
            new Date().toISOString(),
            new Date(Date.now() + Number(watch.interval_minutes) * 60000).toISOString(),
            String(watch.source_id),
            Number(watch.revision)
          );
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick().catch(() => {}), 60000);
  timer.unref();
}
