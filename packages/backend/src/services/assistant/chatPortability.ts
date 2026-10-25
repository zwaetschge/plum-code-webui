import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, get, run, transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createResource, findResource } from './resources.js';
import { apiChatEndpoint } from './apiTransport.js';
import { apiChatTurns } from './apiChats.js';
import { BODY_SCHEMAS } from './resources.js';
import { imageMime } from './apiFiles.js';

const messageSchema = z
  .object({
    id: z.string().max(200).optional(),
    parentId: z.string().max(200).nullable().optional(),
    role: z.string().max(40),
    content: z.union([z.string().max(1000000), z.array(z.unknown()).max(100)]).optional(),
    model: z.string().max(200).optional(),
    models: z.array(z.string().max(200)).optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();
type ImportedMessage = z.infer<typeof messageSchema>;
const textOf = (message: ImportedMessage) =>
  typeof message.content === 'string'
    ? message.content
    : (message.content ?? [])
        .map((part) =>
          typeof part === 'object' && part && 'text' in part ? String(part.text) : ''
        )
        .join('\n');
export function parseChatArchive(value: unknown) {
  const root = z.union([z.array(z.unknown()).max(500), z.record(z.unknown())]).parse(value);
  const list = Array.isArray(root) ? root : Array.isArray(root.chats) ? root.chats : [root];
  const result: Array<{ title: string; messages: ImportedMessage[]; sourceId: string }> = [];
  let total = 0;
  for (const [number, raw] of list.entries()) {
    const item = z.record(z.unknown()).parse(raw),
      chat = z.record(z.unknown()).parse(item.chat ?? item);
    const title = String(chat.title ?? item.title ?? 'Importiertes Gespräch').slice(0, 180),
      sourceId = String(item.id ?? number);
    const history = chat.history as
      | { messages?: Record<string, unknown>; currentId?: string }
      | undefined;
    if (history?.messages && Object.keys(history.messages).length) {
      const graph = new Map(
        Object.entries(history.messages).map(([id, m]) => [
          id,
          messageSchema.parse({ ...z.record(z.unknown()).parse(m), id }),
        ])
      );
      const parents = new Set([...graph.values()].map((m) => m.parentId).filter(Boolean));
      const leaves = [...graph.keys()].filter((id) => !parents.has(id));
      if (history.currentId && graph.has(history.currentId)) {
        const at = leaves.indexOf(history.currentId);
        if (at >= 0) leaves.splice(at, 1);
        leaves.unshift(history.currentId);
      }
      if (!leaves.length)
        throw new AppError('Zyklischer Nachrichtenverlauf', 400, 'CHAT_IMPORT_INVALID');
      for (const [branch, leaf] of leaves.entries()) {
        const seen = new Set<string>(),
          chain: ImportedMessage[] = [];
        let id: string | null | undefined = leaf;
        while (id) {
          if (seen.has(id) || !graph.has(id))
            throw new AppError('Beschädigter Nachrichtenverlauf', 400, 'CHAT_IMPORT_INVALID');
          seen.add(id);
          const message: ImportedMessage = graph.get(id)!;
          chain.unshift(message);
          id = message.parentId;
        }
        result.push({
          title: branch ? `${title} · Variante ${branch + 1}` : title,
          messages: chain,
          sourceId: `${sourceId}:${leaf}`,
        });
        total += chain.length;
      }
    } else {
      const messages = z
        .array(messageSchema)
        .max(5000)
        .parse(chat.messages ?? []);
      result.push({ title, messages, sourceId });
      total += messages.length;
    }
    if (result.length > 1000 || total > 25000)
      throw new AppError(
        'Archiv ist zu gross; in kleineren Teilen importieren',
        413,
        'CHAT_IMPORT_LIMIT'
      );
  }
  if (!result.length)
    throw new AppError('Das Archiv enthält keine Chats', 400, 'CHAT_IMPORT_EMPTY');
  return result;
}
export async function exportChat(userId: string, id: string) {
  await apiChatTurns(userId, id);
  const chat = await findResource(userId, id);
  if (chat.kind !== 'api-chat') throw new AppError('Chat nicht gefunden', 404, 'NOT_FOUND');
  const turns = await all(
    'SELECT id,seq,prompt,response,model,created_at,hidden_by,version_of,workbench_json,image_asset_ids FROM assistant_api_turns WHERE chat_id=? ORDER BY seq',
    id
  );
  const images = await all(
    'SELECT a.id,a.filename,a.mime_type,a.bytes FROM assistant_api_files f JOIN assistant_assets a ON a.id=f.asset_id WHERE f.chat_id=? AND a.user_id=?',
    id,
    userId
  );
  const versions = new Map<string, { id: string; revision: number }>();
  for (const row of await all(
    'SELECT source_versions FROM assistant_api_turns WHERE chat_id=?',
    id
  ))
    for (const source of JSON.parse(row.source_versions))
      versions.set(`${source.id}:${source.revision}`, source);
  const sources = [];
  for (const item of versions.values()) {
    const version = await get(
      'SELECT v.title,v.body_json FROM assistant_resource_revisions v JOIN assistant_resources r ON r.id=v.resource_id WHERE r.user_id=? AND v.resource_id=? AND v.revision=?',
      userId,
      item.id,
      item.revision
    );
    if (!version) continue;
    const body = JSON.parse(version.body_json),
      asset = body.assetId
        ? await get(
            'SELECT filename,mime_type,bytes FROM assistant_assets WHERE id=? AND user_id=?',
            body.assetId,
            userId
          )
        : null;
    sources.push({
      id: item.id,
      revision: item.revision,
      title: version.title,
      body,
      file: asset
        ? {
            filename: asset.filename,
            mimeType: asset.mime_type,
            data: Buffer.from(asset.bytes).toString('base64'),
          }
        : null,
    });
  }
  return {
    format: 'plum-chat',
    version: 1,
    title: chat.title,
    exportedAt: new Date().toISOString(),
    chat: {
      title: chat.title,
      messages: turns
        .filter((t) => !t.hidden_by)
        .flatMap((t) => [
          { role: 'user', content: t.prompt },
          { role: 'assistant', content: t.response, model: t.model },
        ]),
    },
    turns: turns.map((t) => ({ ...t, workbench: JSON.parse(String(t.workbench_json ?? '{}')) })),
    images: images.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mime_type,
      data: Buffer.from(a.bytes).toString('base64'),
    })),
    sources,
  };
}
const portableWorkbench = z.object({
  documentSourceIds: z.array(z.string().max(200)).max(20).default([]),
  sources: z
    .array(
      z.object({
        id: z.string().max(200),
        revision: z.number().int().positive(),
        title: z.string().max(200),
        text: z.string().max(100000),
        citation: z.string().max(2000).default(''),
        page: z.number().int().positive().nullable(),
        excerptStart: z.number().int().nonnegative(),
        retrieval: z.string().max(30).optional(),
      })
    )
    .max(100)
    .default([]),
  toolEvents: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(200),
        status: z.enum(['running', 'completed', 'failed']),
        result: z.string().max(32000).optional(),
      })
    )
    .max(100)
    .default([]),
  comparisons: z
    .array(
      z.object({
        providerId: z.string().max(200),
        model: z.string().max(200),
        response: z.string().max(100000),
        status: z.enum(['running', 'completed', 'failed']),
        error: z.string().max(1000).optional(),
      })
    )
    .max(3)
    .default([]),
});
export async function importChats(
  userId: string,
  buffer: Buffer,
  providerId: string,
  model: string
) {
  await apiChatEndpoint(userId, providerId, model);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    throw new AppError('Ungültiges JSON-Archiv', 400, 'CHAT_IMPORT_INVALID');
  }
  const portable =
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).format === 'plum-chat'
      ? (value as Record<string, unknown>)
      : null;
  const chats = parseChatArchive(value),
    digest = createHash('sha256').update(buffer).digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      'SELECT result_json FROM assistant_commands WHERE user_id=? AND command_id=?',
      userId,
      `chat-import:${digest}`
    );
    if (prior) return JSON.parse(String(prior.result_json));
    const archive = await tx.get(
      'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
      randomUUID(),
      userId,
      'chat-import.json',
      'application/json',
      digest,
      buffer,
      new Date().toISOString()
    );
    const resources = [];
    let attachments = 0;
    for (const imported of chats) {
      const chat = await createResource(
        userId,
        'api-chat',
        imported.title,
        {
          providerId,
          model,
          sourceIds: [],
          projectId: null,
          temporary: false,
          importArchiveAssetId: archive.id,
          importSourceId: imported.sourceId,
        },
        tx
      );
      if (portable && Array.isArray(portable.turns)) {
        const imageMap = new Map<string, string>(),
          sourceMap = new Map<string, string>();
        const imageRows = z
          .array(
            z.object({
              id: z.string().max(200),
              filename: z.string().max(200),
              mimeType: z.string().max(100),
              data: z.string().max(8_000_000),
            })
          )
          .max(30)
          .parse(portable.images ?? []);
        for (const image of imageRows) {
          const bytes = Buffer.from(image.data, 'base64');
          if (!bytes.length || bytes.length > 5 * 1024 * 1024)
            throw new AppError('Ungültiger Bildanhang im Archiv', 400, 'CHAT_IMPORT_INVALID');
          const mime = imageMime(bytes),
            sha = createHash('sha256').update(bytes).digest('hex');
          const asset = await tx.get(
            'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
            randomUUID(),
            userId,
            image.filename,
            mime,
            sha,
            bytes,
            new Date().toISOString()
          );
          imageMap.set(image.id, asset.id);
          await tx.run(
            'INSERT INTO assistant_api_files(chat_id,asset_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING',
            chat.id,
            asset.id,
            new Date().toISOString()
          );
        }
        const sourceRows = z
          .array(
            z.object({
              id: z.string().max(200),
              revision: z.number().int().positive(),
              title: z.string().max(200),
              body: z.record(z.unknown()),
              file: z
                .object({
                  filename: z.string().max(200),
                  mimeType: z.string().max(100),
                  data: z.string().max(34_000_000),
                })
                .nullable()
                .optional(),
            })
          )
          .max(200)
          .parse(portable.sources ?? []);
        for (const source of sourceRows) {
          const body = BODY_SCHEMAS.source.parse({ ...source.body, projectId: undefined });
          if (source.file) {
            const bytes = Buffer.from(source.file.data, 'base64');
            if (bytes.length > 25 * 1024 * 1024)
              throw new AppError('Dateianhang zu gross', 413, 'CHAT_IMPORT_LIMIT');
            const sha = createHash('sha256').update(bytes).digest('hex');
            const asset = await tx.get(
              'INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',
              randomUUID(),
              userId,
              source.file.filename,
              source.file.mimeType,
              sha,
              bytes,
              new Date().toISOString()
            );
            Object.assign(body, { assetId: asset.id, filename: source.file.filename, sha256: sha });
          }
          const restored = await createResource(userId, 'source', source.title, body, tx);
          sourceMap.set(`${source.id}:${source.revision}`, restored.id);
          sourceMap.set(source.id, restored.id);
        }
        const rows = z
          .array(
            z.object({
              id: z.string().max(200),
              prompt: z.string().max(1_000_000),
              response: z.string().max(1_000_000),
              model: z.string().max(200),
              hidden_by: z.string().nullable().optional(),
              version_of: z.string().nullable().optional(),
              source_versions: z.string().max(50000).optional(),
              image_asset_ids: z.string().max(50000).optional(),
              workbench: z.record(z.unknown()).optional(),
            })
          )
          .max(5000)
          .parse(portable.turns);
        const idMap = new Map(rows.map((row) => [row.id, randomUUID()]));
        for (const [index, row] of rows.entries()) {
          const wb = portableWorkbench.parse(row.workbench ?? {}),
            images = z
              .array(z.string())
              .max(4)
              .parse(JSON.parse(row.image_asset_ids ?? '[]'))
              .map((old) => imageMap.get(old))
              .filter(Boolean);
          const versions = z
            .array(z.object({ id: z.string(), revision: z.number() }))
            .max(20)
            .parse(JSON.parse(row.source_versions ?? '[]'))
            .map((old) => ({ id: sourceMap.get(`${old.id}:${old.revision}`), revision: 1 }))
            .filter((v) => v.id);
          const sources = Array.isArray(wb.sources)
            ? wb.sources.flatMap((raw) => {
                const ref = raw as Record<string, unknown>;
                const id = sourceMap.get(`${ref.id}:${ref.revision}`);
                return id ? [{ ...ref, id, revision: 1 }] : [];
              })
            : [];
          const documents = Array.isArray(wb.documentSourceIds)
            ? wb.documentSourceIds.map((old) => sourceMap.get(String(old))).filter(Boolean)
            : [];
          const now = new Date().toISOString();
          await tx.run(
            "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,source_versions,image_asset_ids,workbench_json,created_at,updated_at,expires_at,hidden_by,version_of) VALUES(?,?,?,?,?,?,'completed',?,?,?,?,?,?,?,?,?,?)",
            idMap.get(row.id),
            chat.id,
            index + 1,
            digest,
            row.prompt,
            row.response,
            row.model,
            JSON.stringify({ providerId, imported: true }),
            JSON.stringify(versions),
            JSON.stringify(images),
            JSON.stringify({
              sources,
              documentSourceIds: documents,
              toolEvents: Array.isArray(wb.toolEvents) ? wb.toolEvents : [],
              comparisons: Array.isArray(wb.comparisons) ? wb.comparisons : [],
            }),
            now,
            now,
            now,
            idMap.get(row.hidden_by ?? '') ?? null,
            idMap.get(row.version_of ?? '') ?? null
          );
        }
        resources.push({ id: chat.id, title: chat.title });
        continue;
      }
      let prompt = '',
        seq = 0;
      for (const message of imported.messages) {
        if (Array.isArray(message.files)) attachments += message.files.length;
        const content = textOf(message);
        if (message.role !== 'assistant') {
          prompt +=
            (prompt ? '\n\n' : '') +
            (message.role === 'system' ? '[Importierte Systemnachricht]\n' : '') +
            content;
          continue;
        }
        const now = new Date().toISOString(),
          id = randomUUID();
        await tx.run(
          "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,source_versions,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,'completed',?,?,'[]',?,?,?)",
          id,
          chat.id,
          ++seq,
          digest,
          prompt,
          content,
          message.model ?? model,
          JSON.stringify({ providerId, imported: true }),
          now,
          now,
          now
        );
        prompt = '';
      }
      if (prompt) {
        const now = new Date().toISOString();
        await tx.run(
          "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,response,status,model,profile_json,source_versions,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,'completed',?,?,'[]',?,?,?)",
          randomUUID(),
          chat.id,
          ++seq,
          digest,
          prompt,
          '',
          model,
          JSON.stringify({ providerId, imported: true }),
          now,
          now,
          now
        );
      }
      resources.push({ id: chat.id, title: chat.title });
    }
    const result = {
      chats: resources,
      count: resources.length,
      referencedAttachments: attachments,
      attachmentNotice: attachments
        ? 'Externe Dateiverweise sind im Originalarchiv erhalten. Dateien zusätzlich exportieren und in Plum anhängen.'
        : null,
    };
    const now = new Date().toISOString();
    await tx.run(
      "INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?)",
      userId,
      `chat-import:${digest}`,
      resources[0]!.id,
      digest,
      'chat-import',
      JSON.stringify(result),
      now,
      now
    );
    return result;
  });
}
export async function shareChat(userId: string, id: string) {
  const current = await apiChatTurns(userId, id);
  if (current.chat.body.temporary)
    throw new AppError(
      'Temporäre Chats können nicht geteilt werden',
      400,
      'TEMPORARY_RESULT_DISABLED'
    );
  const rows = await all(
    "SELECT prompt,response,model,workbench_json FROM assistant_api_turns WHERE chat_id=? AND hidden_by IS NULL AND status<>'running' ORDER BY seq LIMIT 1000",
    id
  );
  const snapshot = {
    title: current.chat.title,
    kind: 'api-chat',
    body: {
      turns: rows.map((t) => ({
        prompt: t.prompt,
        response: t.response,
        model: t.model,
        comparisons: JSON.parse(String(t.workbench_json ?? '{}')).comparisons ?? [],
      })),
    },
  };
  const token = randomBytes(32).toString('base64url'),
    shareId = randomUUID(),
    expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await run(
    'INSERT INTO assistant_shares(id,user_id,resource_id,revision,token_hash,expires_at,created_at,snapshot_json) VALUES(?,?,?,?,?,?,?,?)',
    shareId,
    userId,
    id,
    current.chat.revision,
    createHash('sha256').update(token).digest('hex'),
    expiresAt,
    new Date().toISOString(),
    JSON.stringify(snapshot)
  );
  return { id: shareId, viewPath: `/shared/${token}`, expiresAt };
}
