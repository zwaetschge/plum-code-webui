import { createHash } from 'node:crypto';
import type { MemoryTopicPage, MemoryTopicDocument } from '@plum-code-webui/shared';
import { all, transaction, type TransactionScope } from '../../db/pg.js';
import { resourceFromRow } from './resources.js';
import { forgetMemory } from './memory.js';
import { AppError } from '../../middleware/errorHandler.js';

// Topics are a live projection over original facts, never another independent fact store.
const topicName = "COALESCE(NULLIF(TRIM(body_json::jsonb->>'topic'),''),title)";
const scopeName = "COALESCE(body_json::jsonb->>'scope','personal')";
const scopeId = "COALESCE(body_json::jsonb->>'projectId',body_json::jsonb->>'agentId','')";
const topicId = `encode(sha256(convert_to(user_id||chr(31)||${scopeName}||chr(31)||${scopeId}||chr(31)||${topicName},'UTF8')),'hex')`;
const fingerprint = (rows: Record<string, unknown>[]) =>
  createHash('sha256')
    .update(JSON.stringify(rows.map((r) => [r.id, Number(r.revision)])))
    .digest('hex');

export async function memoryTopics(
  userId: string,
  search = '',
  offset = 0
): Promise<MemoryTopicPage> {
  const rows = await all(
    `SELECT ${topicId} AS id,${topicName} AS title,${scopeName} AS scope,${scopeId} AS scope_id,COUNT(*) AS count,MAX(updated_at) AS updated_at
    FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0
    GROUP BY ${topicId},${topicName},${scopeName},${scopeId} HAVING BOOL_OR(${topicName} ILIKE ? OR body_json::jsonb->>'text' ILIKE ?) ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?`,
    userId,
    '%' + search + '%',
    '%' + search + '%',
    offset
  );
  return {
    topics: rows.slice(0, 50).map((r) => ({
      id: r.id,
      title: r.title,
      scope: r.scope,
      scopeId: r.scope_id,
      count: Number(r.count),
      updatedAt: r.updated_at,
    })),
    nextOffset: rows.length > 50 ? offset + 50 : null,
  };
}

async function topicRows(userId: string, id: string, tx?: TransactionScope) {
  return (tx ?? { all }).all(
    `SELECT id,revision FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0 AND ${topicId}=? ORDER BY id`,
    userId,
    id
  );
}
export async function memoryTopic(
  userId: string,
  id: string,
  offset = 0
): Promise<MemoryTopicDocument> {
  const refs = await topicRows(userId, id);
  if (!refs.length) throw new AppError('Thema nicht gefunden', 404, 'NOT_FOUND');
  const rows = await all(
    `SELECT * FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0 AND ${topicId}=? ORDER BY created_at,id LIMIT 101 OFFSET ?`,
    userId,
    id,
    offset
  );
  return {
    entries: rows.slice(0, 100).map(resourceFromRow),
    version: fingerprint(refs),
    nextOffset: rows.length > 100 ? offset + 100 : null,
  };
}
export async function forgetMemoryTopic(userId: string, id: string, expectedVersion: string) {
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const rows = await topicRows(userId, id, tx);
    if (!rows.length) throw new AppError('Thema nicht gefunden', 404, 'NOT_FOUND');
    if (fingerprint(rows) !== expectedVersion)
      throw new AppError(
        'Das Thema wurde inzwischen geändert. Bitte neu laden.',
        409,
        'REVISION_CONFLICT'
      );
    for (const row of rows) await forgetMemory(userId, row.id, Number(row.revision), tx);
    return { forgotten: rows.length };
  });
}
