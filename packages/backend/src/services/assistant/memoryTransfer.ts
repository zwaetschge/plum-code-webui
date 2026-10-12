import { createHash } from 'node:crypto';
import { all, transaction } from '../../db/pg.js';
import { BODY_SCHEMAS, createResource, resourceFromRow, checkReferences } from './resources.js';
import { containsSecret, memoryFingerprint } from './memory.js';
import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler.js';

export async function exportMemory(userId: string) {
  const rows = await all(
    "SELECT * FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0 ORDER BY created_at,id",
    userId
  );
  return {
    format: 'plum-memory',
    version: 1,
    exportedAt: new Date().toISOString(),
    ownerId: userId,
    memories: rows.map((r) => {
      const m = resourceFromRow(r);
      return { title: m.title, body: m.body };
    }),
  };
}
export async function importMemoryText(userId: string, filename: string, text: string) {
  let notes: { title: string; body: Record<string, unknown> }[];
  try {
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      const data = JSON.parse(text),
        items = Array.isArray(data) ? data : data.memories;
      if (!Array.isArray(items)) throw new Error();
      notes = items.map((m: unknown) =>
        typeof m === 'string'
          ? { title: m.split('\n')[0]!.slice(0, 200), body: { text: m } }
          : m && typeof m === 'object' && 'text' in m && !('body' in m)
            ? { title: 'title' in m ? String(m.title) : filename, body: { text: m.text } }
            : (m as { title: string; body: Record<string, unknown> })
      );
    } else
      notes = text
        .split(/\n\s*\n/)
        .filter((s) => s.trim())
        .map((s) => ({ title: s.trim().split('\n')[0]!.slice(0, 200), body: { text: s.trim() } }));
  } catch {
    throw new AppError(
      'Eine Plum-Memory-JSON-Datei oder einen Erinnerungstext importieren.',
      400,
      'MEMORY_IMPORT_FORMAT'
    );
  }
  const valid = z
    .array(
      z.object({ title: z.string().max(200).optional(), body: z.record(z.string(), z.unknown()) })
    )
    .safeParse(notes);
  if (!valid.success)
    throw new AppError('Ungültige Erinnerungseinträge.', 400, 'MEMORY_IMPORT_FORMAT');
  if (notes.length > 10000)
    throw new AppError('Die Importdatei enthält zu viele Einträge.', 413, 'MEMORY_IMPORT_LIMIT');
  const importId = createHash('sha256')
    .update(filename + '\n' + text)
    .digest('hex');
  return transaction(async (tx) => {
    await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
    const existing = await tx.all(
      "SELECT body_json FROM assistant_resources WHERE user_id=? AND kind='memory' AND archived=0",
      userId
    );
    const fingerprints = new Set(
      existing.map((r) => memoryFingerprint(JSON.parse(r.body_json).text))
    );
    let created = 0,
      duplicates = 0,
      rejected = 0;
    for (const note of notes) {
      const parsed = BODY_SCHEMAS.memory.safeParse({
        ...note.body,
        learned: false,
        pinned: true,
        state: 'active',
        origins: [],
      });
      if (!parsed.success || containsSecret(parsed.data.text)) {
        rejected++;
        continue;
      }
      const body = parsed.data,
        fp = memoryFingerprint(body.text);
      if (fingerprints.has(fp)) {
        duplicates++;
        continue;
      }
      // Only retain project/agent references that actually belong to this installation.
      try {
        await checkReferences(userId, body);
      } catch {
        body.scope = 'personal';
        delete body.projectId;
        delete body.sourceId;
      }
      body.origins = [
        {
          type: 'import',
          id: importId,
          turnId: filename.slice(0, 200),
          quote: body.text.slice(0, 2000),
        },
      ];
      await createResource(
        userId,
        'memory',
        String(note.title || filename).slice(0, 200),
        body,
        tx
      );
      fingerprints.add(fp);
      created++;
    }
    return { created, duplicates, rejected };
  });
}
