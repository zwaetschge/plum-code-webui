import { createHash } from 'node:crypto';
import { all, get, transaction } from '../../db/pg.js';

// The same private bge-m3 service as the native swarm. No new cloud account.
const endpoint = () =>
  process.env.PLUM_MEMORY_EMBEDDING_URL ||
  process.env.EINBETTUNG_URL ||
  'http://schwarm-plum-relay:8080/einbettung';
export const embeddingModel = () => process.env.EINBETTUNG_MODELL || 'bge-m3';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** ChatGPT-style project memory: `default` shares with the account, `project-only` is sealed. */
export function projectMemoryMode(body: Record<string, unknown> | undefined) {
  if (body?.memoryMode === 'project-only' || body?.memoryMode === 'default') return body.memoryMode;
  return body?.contextMode === 'separate' ? 'project-only' : 'default';
}
export type MemoryScope = { personal: boolean; projects: string[]; prefer: string | null };
/**
 * What a chat may reference. Outside projects and in default-memory projects: personal
 * memories plus every default-memory project. Project-only: exclusively that project, and
 * its memories never reach chats elsewhere.
 */
export async function memoryScope(userId: string, projectId: string | null): Promise<MemoryScope> {
  const rows = await all(
    "SELECT id,body_json FROM assistant_resources WHERE user_id=? AND kind='project' AND archived=0",
    userId
  );
  const own = projectId ? rows.find((r) => r.id === projectId) : undefined;
  if (own && projectMemoryMode(JSON.parse(own.body_json)) === 'project-only')
    return { personal: false, projects: [own.id], prefer: own.id };
  return {
    personal: true,
    projects: rows
      .filter((r) => projectMemoryMode(JSON.parse(r.body_json)) === 'default')
      .map((r) => String(r.id)),
    prefer: own?.id ?? null,
  };
}
export async function embedMemory(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: embeddingModel(), input: texts.map((t) => t.slice(0, 6000)) }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('EMBEDDING_UNAVAILABLE');
  const result = (await response.json()) as {
    data?: { embedding: number[]; index?: number }[];
    embeddings?: number[][];
  };
  const vectors =
    result.embeddings ??
    result.data?.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((x) => x.embedding);
  if (!vectors || vectors.length !== texts.length) throw new Error('EMBEDDING_INVALID');
  return vectors.map((v) => {
    if (!Array.isArray(v) || v.length < 16 || v.length > 4096 || !v.every(Number.isFinite))
      throw new Error('EMBEDDING_INVALID');
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    if (!norm) throw new Error('EMBEDDING_INVALID');
    return v.map((x) => x / norm);
  });
}
export async function indexMemoryVectors(userId?: string, limit = 32) {
  const candidates = await all(
    `
    SELECT r.user_id,r.id,'memory' AS kind,r.revision::text AS version,r.title||' '||(r.body_json::jsonb->>'text') AS text
    FROM assistant_resources r JOIN user_settings u ON u.user_id=r.user_id
    LEFT JOIN assistant_memory_vectors v ON v.user_id=r.user_id AND v.id=r.id AND v.kind='memory' AND v.part=0 AND v.model=? AND v.version=r.revision::text
    WHERE r.kind='memory' AND r.archived=0 AND COALESCE(r.body_json::jsonb->>'state','active')='active'
      AND u.settings_json::jsonb->'assistantPersonalization'->>'memoryEnabled'='true' AND v.id IS NULL AND (?='' OR r.user_id=?)
    UNION ALL
    SELECT h.user_id,h.id,'history',h.source_hash,h.summary FROM assistant_memory_history h JOIN user_settings u ON u.user_id=h.user_id
    LEFT JOIN assistant_memory_vectors v ON v.user_id=h.user_id AND v.id=h.id AND v.kind='history' AND v.part=0 AND v.model=? AND v.version=h.source_hash
    WHERE h.summary<>'' AND v.id IS NULL AND u.settings_json::jsonb->'assistantPersonalization'->>'memoryEnabled'='true' AND (?='' OR h.user_id=?) LIMIT ?`,
    embeddingModel(),
    userId ?? '',
    userId ?? '',
    embeddingModel(),
    userId ?? '',
    userId ?? '',
    limit
  );
  if (!candidates.length) return 0;
  const windows = candidates.map((r) => {
    const parts: string[] = [];
    for (let at = 0; at < r.text.length; at += 5000) parts.push(r.text.slice(at, at + 6000));
    return parts.length ? parts : [''];
  });
  const vectors: number[][] = [];
  const input = windows.flat();
  for (let at = 0; at < input.length; at += 4)
    vectors.push(...(await embedMemory(input.slice(at, at + 4))));
  const offsets = windows.map((_, i) =>
    windows.slice(0, i).reduce((n, parts) => n + parts.length, 0)
  );
  let indexed = 0;
  for (const [i, row] of candidates.entries())
    await transaction(async (tx) => {
      await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', row.user_id);
      const enabled = await tx.get(
        "SELECT user_id FROM user_settings WHERE user_id=? AND settings_json::jsonb->'assistantPersonalization'->>'memoryEnabled'='true'",
        row.user_id
      );
      const fresh =
        row.kind === 'memory'
          ? await tx.get(
              "SELECT id FROM assistant_resources WHERE user_id=? AND id=? AND revision::text=? AND archived=0 AND COALESCE(body_json::jsonb->>'state','active')='active'",
              row.user_id,
              row.id,
              row.version
            )
          : await tx.get(
              'SELECT id FROM assistant_memory_history WHERE user_id=? AND id=? AND source_hash=?',
              row.user_id,
              row.id,
              row.version
            );
      if (!enabled || !fresh) return;
      await tx.run(
        'DELETE FROM assistant_memory_vectors WHERE user_id=? AND id=? AND kind=?',
        row.user_id,
        row.id,
        row.kind
      );
      for (let part = 0; part < windows[i]!.length; part++)
        await tx.run(
          `INSERT INTO assistant_memory_vectors(user_id,id,kind,version,model,part,vector,updated_at) VALUES(?,?,?,?,?,?,?::double precision[],?)`,
          row.user_id,
          row.id,
          row.kind,
          row.version,
          embeddingModel(),
          part,
          vectors[offsets[i]! + part],
          new Date().toISOString()
        );
      indexed++;
    });
  return indexed;
}
const queries = new Map<
  string,
  { expires: number; vector: number[]; parts?: Record<string, Map<string, number>> }
>();
export async function semanticMemoryScores(
  userId: string,
  scope: MemoryScope,
  query: string,
  kind: 'memory' | 'history'
) {
  if (!query.trim()) return new Map<string, number>();
  const available = await get(
    'SELECT id FROM assistant_memory_vectors WHERE user_id=? AND kind=? AND model=? LIMIT 1',
    userId,
    kind,
    embeddingModel()
  );
  if (!available) return new Map<string, number>();
  const key = hash(userId + ':' + embeddingModel() + ':' + query);
  let cached = queries.get(key);
  if (!cached || cached.expires < Date.now()) {
    const vector = (await embedMemory([query]))[0]!;
    cached = { vector, expires: Date.now() + 300000 };
    if (queries.size >= 256) queries.delete(queries.keys().next().value!);
    queries.set(key, cached);
  }
  const rows =
    kind === 'memory'
      ? await all(
          `SELECT * FROM (SELECT DISTINCT ON (id) * FROM (SELECT v.id,v.part,(SELECT SUM(a.x*b.x) FROM unnest(v.vector) WITH ORDINALITY a(x,n) JOIN unnest(?::double precision[]) WITH ORDINALITY b(x,n) USING(n)) AS similarity
      FROM assistant_memory_vectors v JOIN assistant_resources r ON r.id=v.id AND r.user_id=v.user_id AND r.revision::text=v.version
      WHERE v.user_id=? AND v.kind='memory' AND v.model=? AND r.archived=0 AND COALESCE(r.body_json::jsonb->>'state','active')='active'
      AND ((r.body_json::jsonb->>'scope'='personal' AND ?::boolean) OR (r.body_json::jsonb->>'scope'='project' AND r.body_json::jsonb->>'projectId'=ANY(?::text[])))
      AND cardinality(v.vector)=? ) candidates ORDER BY id,similarity DESC) winners ORDER BY similarity DESC LIMIT 40`,
          cached.vector,
          userId,
          embeddingModel(),
          scope.personal,
          scope.projects,
          cached.vector.length
        )
      : await all(
          `SELECT * FROM (SELECT DISTINCT ON (id) * FROM (SELECT v.id,v.part,(SELECT SUM(a.x*b.x) FROM unnest(v.vector) WITH ORDINALITY a(x,n) JOIN unnest(?::double precision[]) WITH ORDINALITY b(x,n) USING(n)) AS similarity
      FROM assistant_memory_vectors v JOIN assistant_memory_history h ON h.id=v.id AND h.user_id=v.user_id AND h.source_hash=v.version
      WHERE v.user_id=? AND v.kind='history' AND v.model=? AND ((h.project_id IS NULL AND ?::boolean) OR h.project_id=ANY(?::text[])) AND cardinality(v.vector)=? ) candidates ORDER BY id,similarity DESC) winners ORDER BY similarity DESC LIMIT 40`,
          cached.vector,
          userId,
          embeddingModel(),
          scope.personal,
          scope.projects,
          cached.vector.length
        );
  cached.parts ??= {};
  cached.parts[kind] = new Map(rows.map((r) => [r.id, Number(r.part)]));
  return new Map<string, number>(
    rows.filter((r) => Number(r.similarity) >= 0.4).map((r) => [r.id, Number(r.similarity)])
  );
}

export function semanticExcerptStart(userId: string, id: string, query: string, kind = 'memory') {
  const key = hash(userId + ':' + embeddingModel() + ':' + query);
  return (queries.get(key)?.parts?.[kind]?.get(id) ?? 0) * 5000;
}
