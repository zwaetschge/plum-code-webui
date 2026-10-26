import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';
import { parse } from 'dotenv';
import { z } from 'zod';
import { matrixStatus, verifyMatrixIdentity } from './matrix.js';
import { AppError } from '../../middleware/errorHandler.js';
import { transaction, all } from '../../db/pg.js';
import { BODY_SCHEMAS, createResource, reviseResource } from './resources.js';
import { containsSecret, forgetMemory } from './memory.js';

export const NATIVE_MEMORY_ID = z
  .string()
  .regex(/^(?:swarm:\d+|hermes:[a-z0-9-]+:(?:memory|user):[a-f0-9]{64})$/);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
type Entry = {
  id: string;
  agentId: string;
  title: string;
  text: string;
  revision: string;
  runtime: 'swarm' | 'hermes';
  taskId?: string;
};
async function configuration() {
  const native = parse(
    await readFile(
      process.env.PLUM_SWARM_ENV_FILE || path.resolve('config/swarm/native.env')
    ).catch(() => Buffer.from(''))
  );
  return {
    database: process.env.PLUM_NATIVE_MEMORY_DATABASE_URL || native.DATABASE_URL,
    owner:
      process.env.PLUM_NATIVE_MEMORY_OWNER_MXID || native.OWNER_MXID || '@vale:zwaetschge-webui.ch',
  };
}
async function authorised(userId: string) {
  const config = await configuration(),
    identity = await matrixStatus(userId);
  if (!identity.connected || identity.userId !== config.owner)
    throw new AppError(
      'Das native Gedächtnis benötigt dein verbundenes Schwarm-Betreiberkonto.',
      403,
      'NATIVE_MEMORY_IDENTITY'
    );
  // Validate the current token against the homeserver, not just its stored label.
  const current = await verifyMatrixIdentity(userId);
  if (current.userId !== identity.userId || current.epoch !== identity.epoch)
    throw new AppError('Matrix-Konto wurde gewechselt.', 409, 'MATRIX_IDENTITY_CHANGED');
  return config;
}
function nativeTable(name: string) {
  const schema = process.env.PLUM_NATIVE_MEMORY_SCHEMA || 'swarm';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid native schema');
  return `"${schema}"."${name}"`;
}
let pool: Pool | null = null,
  poolUrl = '';
async function nativeDb(database?: string) {
  if (!database)
    throw new AppError('Native Schwarm-Konfiguration fehlt.', 409, 'NATIVE_MEMORY_UNAVAILABLE');
  if (poolUrl !== database) {
    await pool?.end();
    pool = new Pool({
      connectionString: database,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 6000,
      allowExitOnIdle: true,
    });
    poolUrl = database;
  }
  return pool!;
}
function hermesRoots(): Record<string, string> {
  if (process.env.PLUM_HERMES_MEMORY_ROOTS)
    return z.record(z.string(), z.string()).parse(JSON.parse(process.env.PLUM_HERMES_MEMORY_ROOTS));
  return {
    brian: '/mnt/user/appdata/hermes-agent/state/memories',
    trader: '/mnt/user/appdata/hermes-trader/state/memories',
  };
}
async function hermes(agent: string, target: string, input: Record<string, unknown>) {
  const root = hermesRoots()[agent];
  if (!root) throw new AppError('Hermes-Agent ist nicht registriert.', 404, 'NOT_FOUND');
  const helper = fileURLToPath(
    new URL('../../../../../scripts/plum-hermes-memory.py', import.meta.url)
  );
  return await new Promise<{ hash: string; entries: { hash: string; text: string }[] }>(
    (resolve, reject) => {
      const child = spawn(process.env.PLUM_PYTHON || 'python3', [helper], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '',
        failed = false;
      const timer = setTimeout(() => {
        failed = true;
        child.kill('SIGTERM');
        reject(new AppError('Hermes-Gedächtnis ist belegt.', 503, 'NATIVE_MEMORY_BUSY'));
      }, 15000);
      child.stdout.on('data', (b) => {
        output += b.toString();
        if (output.length > 1500000) {
          failed = true;
          child.kill();
          reject(new AppError('Gedächtnis ist zu gross.', 413, 'NATIVE_MEMORY_LIMIT'));
        }
      });
      child.stderr.resume();
      child.on('error', () => {
        clearTimeout(timer);
        reject(
          new AppError('Hermes-Dateizugriff fehlgeschlagen.', 503, 'NATIVE_MEMORY_UNAVAILABLE')
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failed) return;
        try {
          if (code !== 0) throw new Error();
          const result = JSON.parse(output);
          if (result.error)
            throw new AppError(
              result.error === 'REVISION_CONFLICT'
                ? 'Gedächtnis wurde inzwischen geändert.'
                : 'Native Gedächtnisänderung abgelehnt.',
              result.error === 'REVISION_CONFLICT' ? 409 : 400,
              result.error
            );
          resolve(result);
        } catch (e) {
          reject(
            e instanceof AppError
              ? e
              : new AppError(
                  'Hermes-Dateizugriff fehlgeschlagen.',
                  503,
                  'NATIVE_MEMORY_UNAVAILABLE'
                )
          );
        }
      });
      child.stdin.end(JSON.stringify({ root, target, ...input }));
    }
  );
}
export async function nativeMemoryList(userId: string, search = '', offset = 0, limit = 50) {
  const config = await authorised(userId);
  const entries: Entry[] = [],
    unavailable: string[] = [];
  let hasMore = false;
  try {
    const db = await nativeDb(config.database);
    const rows = await db.query(
      `SELECT id,agent,text,task_id FROM ${nativeTable('gedaechtnis')} WHERE text ILIKE $1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
      ['%' + search + '%', limit, offset]
    );
    hasMore = rows.rows.length >= limit;
    entries.push(
      ...rows.rows
        .filter((r) => !containsSecret(r.text))
        .map((r) => ({
          id: `swarm:${r.id}`,
          agentId: r.agent || 'swarm',
          title: r.text.split('\n')[0].slice(0, 200),
          text: r.text,
          revision: digest(r.text),
          runtime: 'swarm' as const,
          taskId: r.task_id ?? undefined,
        }))
    );
  } catch {
    unavailable.push('swarm');
  }
  await Promise.all(
    Object.entries(hermesRoots()).map(async ([agent, root]) => {
      try {
        await access(root);
      } catch {
        unavailable.push(agent);
        return;
      }
      await Promise.all(
        ['memory', 'user'].map(async (target) => {
          try {
            const data = await hermes(agent, target, { action: 'read' });
            const found = data.entries.filter(
              (e) =>
                !containsSecret(e.text) &&
                e.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())
            );
            if (offset === 0)
              entries.push(
                ...found.map((e) => ({
                  id: `hermes:${agent}:${target}:${e.hash}`,
                  agentId: agent,
                  title: e.text.split('\n')[0]!.slice(0, 200),
                  text: e.text,
                  revision: data.hash,
                  runtime: 'hermes' as const,
                }))
              );
          } catch {
            if (!unavailable.includes(agent)) unavailable.push(agent);
          }
        })
      );
    })
  );
  return {
    entries,
    unavailable,
    hasMore,
  };
}
async function nativeMemoryRead(userId: string, id: string) {
  NATIVE_MEMORY_ID.parse(id);
  const config = await authorised(userId);
  if (id.startsWith('hermes:')) {
    const [, agent, target, key] = id.split(':');
    const data = await hermes(agent!, target!, { action: 'read' }),
      entry = data.entries.find((e) => e.hash === key);
    if (!entry) throw new AppError('Native Erinnerung nicht gefunden.', 404, 'NOT_FOUND');
    return {
      id,
      agentId: agent!,
      title: entry.text.split('\n')[0]!.slice(0, 200),
      text: entry.text,
      revision: data.hash,
      runtime: 'hermes' as const,
    };
  }
  const db = await nativeDb(config.database),
    result = await db.query(
      `SELECT id,agent,text,task_id FROM ${nativeTable('gedaechtnis')} WHERE id=$1`,
      [id.slice(6)]
    ),
    entry = result.rows[0];
  if (!entry) throw new AppError('Native Erinnerung nicht gefunden.', 404, 'NOT_FOUND');
  return {
    id,
    agentId: entry.agent || 'swarm',
    title: entry.text.split('\n')[0].slice(0, 200),
    text: entry.text,
    revision: digest(entry.text),
    runtime: 'swarm' as const,
    taskId: entry.task_id as string | undefined,
  };
}
export async function importNativeMemory(userId: string, id: string, expectedRevision: string) {
  const entry = await nativeMemoryRead(userId, id);
  if (entry.revision !== expectedRevision)
    throw new AppError('Native Erinnerung wurde geändert.', 409, 'REVISION_CONFLICT');
  if (containsSecret(entry.text))
    throw new AppError('Zugangsdaten werden nicht übernommen.', 400, 'MEMORY_SECRET');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const prior = await tx.get(
      "SELECT id FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0 AND body_json::jsonb->'origins' @> ?::jsonb",
      userId,
      JSON.stringify([{ type: 'agent', id, turnId: entry.revision }])
    );
    if (prior) return prior;
    return createResource(
      userId,
      'memory',
      entry.title,
      BODY_SCHEMAS.memory.parse({
        text: entry.text,
        scope: 'agent',
        agentId: entry.agentId,
        pinned: true,
        origins: [{ type: 'agent', id, turnId: entry.revision, quote: entry.text.slice(0, 2000) }],
      }),
      tx
    );
  });
}
export async function changeNativeMemory(
  userId: string,
  id: string,
  expectedRevision: string,
  text?: string
) {
  const entry = await nativeMemoryRead(userId, id);
  if (entry.revision !== expectedRevision)
    throw new AppError('Native Erinnerung wurde geändert.', 409, 'REVISION_CONFLICT');
  if (
    text !== undefined &&
    (containsSecret(text) ||
      /ignore (?:all|previous)|reveal.*(?:secret|token)|ignoriere.*(?:anweisung|regel)/i.test(text))
  )
    throw new AppError('Unsichere native Gedächtnisanweisung.', 400, 'MEMORY_SECRET');
  let nextId = id,
    nextRevision = text === undefined ? '' : digest(text);
  if (id.startsWith('hermes:')) {
    const [, agent, target, key] = id.split(':');
    const updated = await hermes(agent!, target!, {
      action: text === undefined ? 'forget' : 'revise',
      expectedHash: expectedRevision,
      entryHash: key,
      text,
    });
    if (text !== undefined) {
      nextId = `hermes:${agent}:${target}:${digest(text.trim())}`;
      nextRevision = updated.hash;
    }
  } else {
    const config = await configuration(),
      db = await nativeDb(config.database);
    const columns = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='gedaechtnis' AND column_name='einbettung'",
      [process.env.PLUM_NATIVE_MEMORY_SCHEMA || 'swarm']
    );
    const result =
      text === undefined
        ? await db.query(
            `WITH forgotten AS (DELETE FROM ${nativeTable('gedaechtnis')} WHERE id=$1 AND text=$2 RETURNING task_id), suppressed AS (INSERT INTO ${nativeTable('gedaechtnis_verworfen')}(task_id) SELECT task_id FROM forgotten WHERE task_id IS NOT NULL ON CONFLICT DO NOTHING) SELECT task_id FROM forgotten`,
            [id.slice(6), entry.text]
          )
        : await db.query(
            `UPDATE ${nativeTable('gedaechtnis')} SET text=$1${columns.rowCount ? ',einbettung=NULL' : ''} WHERE id=$2 AND text=$3`,
            [text, id.slice(6), entry.text]
          );
    if (!result.rowCount)
      throw new AppError('Native Erinnerung wurde geändert.', 409, 'REVISION_CONFLICT');
  }
  // Remove imported versions too, so the forgotten native fact cannot persist in Plum.
  if (text === undefined) {
    const copies = await all(
      "SELECT id,revision FROM assistant_resources WHERE user_id=? AND kind='memory' AND body_json::jsonb->'origins' @> ?::jsonb",
      userId,
      JSON.stringify([{ type: 'agent', id }])
    );
    for (const copy of copies) await forgetMemory(userId, copy.id, copy.revision);
  } else {
    await transaction(async (tx) => {
      await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
      const copies = await tx.all(
        "SELECT * FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0 AND body_json::jsonb->'origins' @> ?::jsonb",
        userId,
        JSON.stringify([{ type: 'agent', id }])
      );
      for (const copy of copies) {
        const body = JSON.parse(copy.body_json);
        // Explicit personal corrections remain authoritative over an imported snapshot.
        if (body.text === entry.text || body.scope === 'agent') body.text = text;
        // Keep lineage current even for a personal override, so explicit native forgetting
        // can still remove every derived copy after the native entry hash changes.
        body.origins = body.origins.map((o: { type: string; id: string }) =>
          o.type === 'agent' && o.id === id
            ? { ...o, id: nextId, turnId: nextRevision, quote: text.slice(0, 2000) }
            : o
        );
        await reviseResource(
          userId,
          copy.id,
          copy.revision,
          copy.title,
          BODY_SCHEMAS.memory.parse(body),
          tx
        );
      }
    });
  }
  return { changed: true, requiresNewHermesSession: entry.runtime === 'hermes' };
}
