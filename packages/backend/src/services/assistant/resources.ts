import { CHAT_OPTIONS } from './chatOptions.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AssistantResource, AssistantResourceKind } from '@plum-code-webui/shared';
import { bindArtifactImages } from './artifactImages.js';
import { bindMotionAudio } from './motionAudio.js';
import { TRY_ON_REFERENCES } from './tryOn.js';
import {
  parseAssistantNotebook,
  parseAssistantDocument,
  parseAssistantSlides,
  parseAssistantComparison,
  parseAssistantMotion,
} from '@plum-code-webui/shared';
import { all, get, run, transaction, type TransactionScope } from '../../db/pg.js';
import { proposeSourceTasks } from './sourceEvents.js';
import { indexSource } from './sourceChunks.js';
import { AppError } from '../../middleware/errorHandler.js';

const provider = z.enum(['codex', 'opencode', 'pi', 'vibe', 'claude', 'zai']);
const text = z.string().trim().min(1).max(50000);
const optionalId = z.string().min(1).max(200).optional();
const date = z.string().datetime().optional();
export const ARTIFACT_EDIT_INPUT = z
  .object({
    artifactId: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    start: z.number().int().min(0).max(50000),
    end: z.number().int().positive().max(50000),
    selectedText: z.string().min(1).max(20000),
    documentPath: z
      .object({
        block: z.number().int().min(0).max(199),
        row: z.number().int().min(0).max(99).optional(),
        column: z.number().int().min(0).max(19).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const RESOURCE_KINDS = {
  profiles: 'profile',
  tasks: 'task',
  projects: 'project',
  sources: 'source',
  memory: 'memory',
  artifacts: 'artifact',
  routines: 'routine',
  collections: 'collection',
  meetings: 'meeting',
  courses: 'course',
  connections: 'connection',
  'event-subscriptions': 'event-subscription',
  'api-chats': 'api-chat',
} as const satisfies Record<string, AssistantResourceKind>;

export const BODY_SCHEMAS: Record<AssistantResourceKind, z.ZodTypeAny> = {
  'api-chat': z.object({
    chatOptions: CHAT_OPTIONS.optional(),
    providerId: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    profileId: optionalId,
    profileRevision: z.number().int().positive().optional(),
    projectId: optionalId.nullable(),
    sourceIds: z.array(z.string().max(200)).max(20).default([]),
    parentChatId: optionalId,
    parentTurnId: optionalId,
    artifactEdit: ARTIFACT_EDIT_INPUT.optional(),
    workflow: z.literal('research').optional(),
    temporary: z.boolean().default(false),
    memoryRead: z.boolean().optional(),
    memoryLearn: z.boolean().optional(),
    expiresAt: date,
    /** Writing-style preset (style-library baseName); null = explicitly none. */
    writingStyleSkill: z.string().min(1).max(100).nullable().optional(),
  }),
  profile: z.object({
    chatOptions: CHAT_OPTIONS.optional(),
    /** Legacy hand-written notes; the editor folds them into the instructions. */
    sharedMemories: z.string().max(30000).optional(),
    includeGlobalChatInstructions: z.boolean().default(true),
    instructions: z.string().max(30000).default(''),
    provider: provider.default('codex'),
    model: z.string().max(200).nullable().optional(),
    language: z.string().max(80).default('German'),
    voice: z.string().max(100).default('Rufus Beck'),
    memory: z.enum(['off', 'read', 'read-write']).default('off'),
    projectId: optionalId,
    sourceIds: z.array(z.string().min(1).max(200)).max(20).default([]),
    apiProviderId: z.string().min(1).max(200).optional(),
  }),
  task: z.object({
    goal: text,
    provider: provider.default('codex'),
    status: z.literal('draft').default('draft'),
    originSessionId: optionalId,
    originResourceId: optionalId,
    originTurnId: optionalId,
    parentId: optionalId,
    agentId: optionalId,
    profileId: optionalId,
    priority: z.number().int().min(0).max(100).default(0),
    budgetUsd: z.number().finite().nonnegative().max(100000).optional(),
    dueAt: date,
    deliverables: z.array(z.string().max(200)).max(30).default([]),
    sourceIds: z.array(z.string().max(200)).max(20).default([]),
  }),
  project: z.object({
    includeGlobalChatInstructions: z.boolean().default(true),
    /** ChatGPT project memory; legacy `contextMode: 'separate'` reads as project-only. */
    memoryMode: z.enum(['default', 'project-only']).optional(),
    contextMode: z.enum(['shared', 'separate']).optional(),
    description: z.string().max(30000).default(''),
    instructions: z.string().max(30000).default(''),
  }),
  source: z.object({
    projectId: optionalId,
    text: z.string().trim().min(1).max(500000),
    url: z.string().url().max(2000).optional(),
    citation: z.string().max(2000).default(''),
    mimeType: z.string().max(100).default('text/plain'),
  }),
  memory: z.object({
    text,
    scope: z.enum(['personal', 'project', 'agent']).default('personal'),
    projectId: optionalId,
    agentId: optionalId,
    sourceId: optionalId,
    learned: z.boolean().default(false),
    state: z.enum(['active', 'proposed']).default('active'),
    pinned: z.boolean().default(false),
    topic: z.string().max(200).optional(),
    keywords: z.array(z.string().max(100)).max(20).default([]),
    origins: z
      .array(
        z.object({
          type: z.enum(['api', 'cli', 'agent', 'task', 'import']),
          id: z.string().max(200),
          turnId: z.string().max(200),
          quote: z.string().max(2000),
        })
      )
      .max(20)
      .default([]),
  }),
  artifact: z.object({
    type: z
      .enum([
        'document',
        'table',
        'slides',
        'code',
        'design',
        'research',
        'dataset',
        'notebook',
        'image',
        'audio',
        'video',
        'latex',
        'app',
        'comparison',
      ])
      .default('document'),
    content: z.string().max(50000).default(''),
    audioAssetId: z.string().uuid().optional(),
    format: z.enum(['markdown', 'json', 'csv', 'html', 'text']).default('markdown'),
    language: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_+-]{0,79}$/)
      .optional(),
    taskId: optionalId,
    originResourceId: optionalId,
    originTurnId: optionalId,
    sourceIds: z.array(z.string().max(200)).max(100).default([]),
    tags: z.array(z.string().max(100)).max(50).default([]),
    evidence: z
      .array(
        z.object({
          claim: z.string().trim().min(1).max(2000),
          sourceId: z.string().min(1).max(200),
          sourceRevision: z.number().int().positive(),
          quote: z.string().trim().min(1).max(4000),
          note: z.string().max(3000).default(''),
          reviewed: z.boolean().default(false),
        })
      )
      .max(100)
      .default([]),
  }),
  routine: z.object({
    goal: text,
    schedule: z.string().max(100),
    timezone: z.string().max(80).default('Europe/Zurich'),
    enabled: z.boolean().default(false),
    agentId: optionalId,
    owner: z.literal('matrix').default('matrix'),
  }),
  collection: z
    .object({
      description: z.string().max(5000).default(''),
      resourceIds: z.array(z.string().max(200)).max(1000).default([]),
      favoriteIds: z.array(z.string().max(200)).max(1000).default([]),
      tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    })
    .refine(
      (body) =>
        new Set(body.resourceIds).size === body.resourceIds.length &&
        new Set(body.favoriteIds).size === body.favoriteIds.length &&
        body.favoriteIds.every((id) => body.resourceIds.includes(id)),
      'Favoriten müssen eindeutige Einträge der Sammlung sein.'
    ),
  meeting: z.object({
    audioAssetId: optionalId,
    originalTranscript: z.string().max(50000).optional(),
    words: z
      .array(
        z
          .object({
            word: z.string().max(200),
            start: z.number().finite().nonnegative(),
            end: z.number().finite().nonnegative(),
          })
          .refine((word) => word.end >= word.start)
      )
      .max(12000)
      .default([]),
    transcript: z.string().max(50000).default(''),
    summary: z.string().max(30000).default(''),
    taskIds: z.array(z.string().max(200)).max(100).default([]),
    recordedAt: date,
  }),
  course: z.object({
    description: z.string().max(30000).default(''),
    lessons: z
      .array(
        z.object({
          title: z.string().max(200),
          content: z.string().max(10000),
          completed: z.boolean().default(false),
          sourceIds: z.array(z.string().max(200)).max(20).default([]),
          questions: z
            .array(
              z
                .object({
                  prompt: z.string().trim().min(1).max(2000),
                  choices: z.array(z.string().trim().min(1).max(1000)).min(2).max(8),
                  correct: z.number().int().min(0).max(7),
                  explanation: z.string().max(3000).default(''),
                })
                .refine((question) => question.correct < question.choices.length)
            )
            .max(30)
            .default([]),
        })
      )
      .max(100)
      .default([]),
    attempts: z
      .array(
        z.object({
          id: z.string().uuid(),
          courseRevision: z.number().int().positive(),
          lesson: z.number().int().nonnegative(),
          answers: z.array(z.number().int().min(0).max(7)).max(30),
          correct: z.number().int().nonnegative(),
          total: z.number().int().nonnegative(),
          at: z.string().datetime(),
        })
      )
      .max(100)
      .default([]),
  }),
  connection: z.object({
    type: z.enum(['matrix', 'mcp', 'office', 'calendar', 'mail', 'drive']),
    status: z.literal('disconnected').default('disconnected'),
    description: z.string().max(2000).default(''),
  }),
  'event-subscription': z.object({
    sourceId: z.string().min(1).max(200),
    profileId: optionalId,
    event: z.literal('source.changed').default('source.changed'),
    goal: text,
    enabled: z.boolean().default(false),
    quietStart: z.string().max(5).optional(),
    quietEnd: z.string().max(5).optional(),
  }),
};

interface Row {
  id: string;
  kind: AssistantResourceKind;
  title: string;
  body_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
export function resourceFromRow(row: Row): AssistantResource {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: JSON.parse(row.body_json),
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function findResource(
  userId: string,
  id: string,
  tx?: TransactionScope
): Promise<AssistantResource> {
  const row = (await (tx ?? { get }).get(
    'SELECT * FROM assistant_resources WHERE id = ? AND user_id = ? AND archived = 0',
    id,
    userId
  )) as Row | undefined;
  if (!row) throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
  const resource = resourceFromRow(row);
  if (resource.kind === 'source' && resource.body.temporaryChatId) {
    const parent = await (tx ?? { get }).get(
      "SELECT id FROM assistant_resources WHERE id=? AND user_id=? AND archived=0 AND (body_json::jsonb->>'expiresAt')>?",
      resource.body.temporaryChatId,
      userId,
      new Date().toISOString()
    );
    if (!parent) throw new AppError('Temporäre Quelle ist abgelaufen', 410, 'TEMPORARY_EXPIRED');
  }
  return resource;
}
export async function listResources(
  userId: string,
  kind?: AssistantResourceKind,
  options: {
    search?: string;
    offset?: number;
    limit?: number;
    projectId?: string;
    memoryScope?: boolean;
    status?: string;
    sort?: 'updated' | 'priority' | 'deadline';
  } = {}
): Promise<AssistantResource[]> {
  const conditions = [
    'user_id = ?',
    'archived = 0',
    "(kind <> 'source' OR body_json::jsonb->>'temporaryChatId' IS NULL)",
  ];
  const args: unknown[] = [userId];
  if (kind) {
    conditions.push('kind = ?');
    args.push(kind);
  }
  if (options.memoryScope) {
    conditions.push(
      "((body_json::jsonb)->>'scope' = 'personal' OR ((body_json::jsonb)->>'scope' = 'project' AND (body_json::jsonb)->>'projectId' = ?))"
    );
    args.push(options.projectId ?? '');
  } else if (options.projectId) {
    conditions.push("(body_json::jsonb)->>'projectId' = ?");
    args.push(options.projectId);
  }
  if (options.search) {
    conditions.push('(title ILIKE ? OR body_json ILIKE ?)');
    args.push(`%${options.search}%`, `%${options.search}%`);
  }
  if (kind === 'task' && options.status) {
    conditions.push("(body_json::jsonb)->>'status' = ?");
    args.push(options.status);
  }
  const order =
    kind === 'task' && options.sort === 'priority'
      ? "CASE WHEN jsonb_typeof(body_json::jsonb->'priority')='number' THEN (body_json::jsonb->>'priority')::numeric ELSE 0 END DESC, updated_at DESC, id"
      : kind === 'task' && options.sort === 'deadline'
        ? "NULLIF(body_json::jsonb->>'dueAt','') ASC NULLS LAST, updated_at DESC, id"
        : 'updated_at DESC, id';
  const rows = (await all(
    `SELECT * FROM assistant_resources WHERE ${conditions.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...args,
    options.limit ?? 100,
    options.offset ?? 0
  )) as Row[];
  return rows.map(resourceFromRow);
}
export async function resourceReferences(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return all(
    `SELECT id,kind,title,revision,updated_at AS "updatedAt" FROM assistant_resources WHERE user_id=? AND archived=0 AND id IN (${ids.map(() => '?').join(',')})`,
    userId,
    ...ids
  );
}
export async function checkReferences(
  userId: string,
  body: Record<string, unknown>,
  tx?: TransactionScope
): Promise<void> {
  if (body.type === 'video' && body.format === 'json') {
    try {
      parseAssistantMotion(String(body.content));
    } catch {
      throw new AppError('Ungültige Plum-Animation', 400, 'MOTION_INVALID');
    }
  }
  if (body.inputImageIds !== undefined) {
    if (
      !Array.isArray(body.inputImageIds) ||
      body.inputImageIds.length > 4 ||
      new Set(body.inputImageIds).size !== body.inputImageIds.length ||
      !body.inputImageIds.every((id) => typeof id === 'string')
    )
      throw new AppError('Ungültige Bildauswahl', 400, 'TASK_IMAGE_INVALID');
    for (const id of body.inputImageIds)
      if (
        !(await (tx ?? { get }).get(
          "SELECT id FROM assistant_assets WHERE id=? AND user_id=? AND mime_type IN ('image/png','image/jpeg','image/gif','image/webp')",
          id,
          userId
        ))
      )
        throw new AppError('Bildoriginal nicht gefunden', 404, 'NOT_FOUND');
  }
  if (body.imageEdit) {
    const edit = body.imageEdit as Record<string, unknown>;
    const ids = body.inputImageIds as string[] | undefined;
    if (
      !ids ||
      !['edit', 'inpaint'].includes(String(edit.mode)) ||
      !ids.includes(String(edit.originalAssetId)) ||
      (edit.mode === 'inpaint' && (!edit.maskAssetId || !ids.includes(String(edit.maskAssetId)))) ||
      (edit.mode === 'edit' && edit.maskAssetId !== null)
    )
      throw new AppError(
        'Original und Maske müssen Auftragseingaben bleiben',
        400,
        'IMAGE_EDIT_INPUTS_REQUIRED'
      );
  }
  if (body.imageTryOn) {
    const parsed = TRY_ON_REFERENCES.safeParse(body.imageTryOn),
      ids = body.inputImageIds as string[] | undefined;
    if (
      !parsed.success ||
      !ids ||
      parsed.data.personAssetId === parsed.data.productAssetId ||
      !ids.includes(parsed.data.personAssetId) ||
      !ids.includes(parsed.data.productAssetId)
    )
      throw new AppError(
        'Person und Produkt müssen Originaleingaben des Tasks bleiben.',
        400,
        'TRY_ON_REFERENCES_REQUIRED'
      );
    const reference = parsed.data;
    const owned = await (tx ?? { get }).get(
      "SELECT id FROM assistant_resources WHERE id=? AND user_id=? AND kind='artifact'",
      reference.comparisonId,
      userId
    );
    const version = owned
      ? await (tx ?? { get }).get(
          'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
          reference.comparisonId,
          reference.comparisonRevision
        )
      : null;
    const original = version ? JSON.parse(version.body_json) : null;
    if (
      !original ||
      original.type !== 'comparison' ||
      original.format !== 'json' ||
      !parseAssistantComparison(String(original.content)).offers.some(
        (offer) => offer.id === reference.offerId
      )
    )
      throw new AppError('Die gebundene Angebotsrevision ist nicht verfügbar.', 404, 'NOT_FOUND');
  }
  if (body.type === 'comparison') {
    let comparison;
    try {
      if (body.format !== 'json') throw new Error('JSON-Modell erforderlich');
      comparison = parseAssistantComparison(String(body.content));
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Ungültiger Vergleich',
        400,
        'COMPARISON_INVALID'
      );
    }
    for (const offer of comparison.offers) {
      const source = await (tx ?? { get }).get(
        "SELECT id FROM assistant_resources WHERE user_id=? AND id=? AND kind='source'",
        userId,
        offer.sourceId
      );
      if (!source) throw new AppError('Angebotsquelle nicht gefunden', 404, 'NOT_FOUND');
      const version = await (tx ?? { get }).get(
        'SELECT body_json,created_at FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
        source.id,
        offer.sourceRevision
      );
      const original = version ? JSON.parse(version.body_json) : null;
      if (
        !original ||
        !String(original.text ?? '').includes(offer.quote) ||
        original.url !== offer.url ||
        (original.ingestedAt ?? version!.created_at) !== offer.asOf
      )
        throw new AppError(
          'Preis, Angebotslink oder Datum passen nicht zum ausgewählten Quellenstand',
          400,
          'OFFER_EVIDENCE_INVALID'
        );
    }
  }
  if (body.type === 'document' && body.format === 'json') {
    try {
      parseAssistantDocument(String(body.content));
    } catch {
      throw new AppError('Ungültiges Plum-Dokument', 400, 'DOCUMENT_INVALID');
    }
  }
  if (body.type === 'slides' && body.format === 'json') {
    try {
      parseAssistantSlides(String(body.content));
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Ungültige Präsentation',
        400,
        'SLIDES_INVALID'
      );
    }
  }
  if (body.type === 'notebook') {
    let notebook;
    try {
      notebook = parseAssistantNotebook(String(body.content));
    } catch {
      throw new AppError('Ungültiges Notebook', 400, 'NOTEBOOK_INVALID');
    }
    const dataset = await findResource(userId, notebook.datasetId, tx);
    if (dataset.kind !== 'artifact' || !['dataset', 'table'].includes(String(dataset.body.type)))
      throw new AppError('Datensatz nicht gefunden', 404, 'NOT_FOUND');
    const db = tx ?? { get };
    if (
      !(await db.get(
        'SELECT revision FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
        dataset.id,
        notebook.datasetRevision
      ))
    )
      throw new AppError('Eingaberevision nicht gefunden', 404, 'NOT_FOUND');
    if (notebook.run) {
      const receipt = await db.get(
        "SELECT resource_id,result_json FROM assistant_commands WHERE user_id=? AND command_id=? AND action='notebook-run' AND status='accepted'",
        userId,
        notebook.run.id
      );
      const original = receipt?.result_json
        ? parseAssistantNotebook(String(JSON.parse(String(receipt.result_json)).body.content))
        : null;
      if (
        !original ||
        receipt?.resource_id !== notebook.run.notebookId ||
        original.datasetId !== notebook.datasetId ||
        original.datasetRevision !== notebook.datasetRevision ||
        JSON.stringify(original.steps) !== JSON.stringify(notebook.steps) ||
        JSON.stringify(original.run) !== JSON.stringify(notebook.run)
      )
        throw new AppError(
          'Der gespeicherte Lauf passt nicht zu dieser Berechnung; zuerst neu ausführen',
          400,
          'NOTEBOOK_RUN_INVALID'
        );
    }
  }
  if (body.artifactEdit) {
    const edit = ARTIFACT_EDIT_INPUT.parse(body.artifactEdit);
    const ref = await findResource(userId, edit.artifactId, tx);
    if (ref.kind !== 'artifact')
      throw new AppError('Ungültiger Ergebnisbezug', 400, 'INVALID_REFERENCE');
  }
  if (typeof body.audioAssetId === 'string') {
    const db = tx ?? { get };
    if (
      !(await db.get(
        'SELECT id FROM assistant_assets WHERE id = ? AND user_id = ?',
        body.audioAssetId,
        userId
      ))
    )
      throw new AppError('Audiooriginal nicht gefunden', 404, 'NOT_FOUND');
  }
  for (const key of ['projectId', 'parentId', 'profileId', 'sourceId', 'taskId']) {
    if (typeof body[key] !== 'string') continue;
    const ref = await findResource(userId, body[key] as string, tx);
    const expected =
      key === 'projectId'
        ? 'project'
        : key === 'profileId'
          ? 'profile'
          : key === 'sourceId'
            ? 'source'
            : 'task';
    if (ref.kind !== expected) throw new AppError('Ungültiger Bezug', 400, 'INVALID_REFERENCE');
  }
  for (const key of ['sourceIds', 'resourceIds', 'taskIds']) {
    for (const id of (body[key] as string[] | undefined) ?? []) {
      const ref = await findResource(userId, id, tx);
      if (key === 'sourceIds' && ref.kind !== 'source')
        throw new AppError('Ungültige Quelle', 400, 'INVALID_REFERENCE');
      if (key === 'taskIds' && ref.kind !== 'task')
        throw new AppError('Ungültiger Auftrag', 400, 'INVALID_REFERENCE');
    }
  }
  for (const item of (body.evidence as
    | Array<{ sourceId: string; sourceRevision: number; quote: string }>
    | undefined) ?? []) {
    const source = await findResource(userId, item.sourceId, tx);
    if (source.kind !== 'source')
      throw new AppError('Ungültiger Recherchebeleg', 400, 'INVALID_REFERENCE');
    const version = await (tx ?? { get }).get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id = ? AND revision = ?',
      source.id,
      item.sourceRevision
    );
    if (!version || !String(JSON.parse(version.body_json).text ?? '').includes(item.quote))
      throw new AppError(
        'Der Belegauszug fehlt in der angegebenen Quellrevision',
        400,
        'EVIDENCE_QUOTE_INVALID'
      );
  }
  for (const lesson of (body.lessons as Array<{ sourceIds?: string[] }> | undefined) ?? []) {
    for (const id of lesson.sourceIds ?? []) {
      const source = await findResource(userId, id, tx);
      if (source.kind !== 'source')
        throw new AppError('Ungültige Lektionsquelle', 400, 'INVALID_REFERENCE');
    }
  }
  if (body.originSessionId) {
    const session = await (tx ?? { get }).get(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      body.originSessionId,
      userId
    );
    if (!session) throw new AppError('Ursprung nicht gefunden', 404, 'NOT_FOUND');
  }
  if (body.originResourceId) {
    const origin = await findResource(userId, String(body.originResourceId), tx);
    if (
      body.originTurnId &&
      !(await (tx ?? { get }).get(
        "SELECT id FROM assistant_api_turns WHERE chat_id=? AND id=? AND status<>'running'",
        origin.id,
        String(body.originTurnId)
      ))
    )
      throw new AppError('Ursprungsantwort nicht gefunden', 404, 'NOT_FOUND');
  } else if (body.originTurnId) throw new AppError('Ursprung fehlt', 400, 'INVALID_REFERENCE');
}
export async function createResource(
  userId: string,
  kind: AssistantResourceKind,
  title: string,
  body: Record<string, unknown>,
  tx?: TransactionScope
): Promise<AssistantResource> {
  await checkReferences(userId, body, tx);
  const id = randomUUID();
  const now = new Date().toISOString();
  const insert = async (scope: TransactionScope) => {
    if (kind === 'task') await checkTaskParentage(scope, userId, id, body.parentId);
    if (kind === 'artifact') {
      body = await bindArtifactImages(userId, body, scope);
      body = await bindMotionAudio(userId, body, scope);
    }
    await scope.run(
      'INSERT INTO assistant_resources (id, user_id, kind, title, body_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      userId,
      kind,
      title,
      JSON.stringify(body),
      now,
      now
    );
    await scope.run(
      'INSERT INTO assistant_resource_revisions (resource_id, revision, title, body_json, created_at) VALUES (?, 1, ?, ?, ?)',
      id,
      title,
      JSON.stringify(body),
      now
    );
    if (kind === 'source') await indexSource(scope, id, 1, body);
  };
  if (tx) await insert(tx);
  else await transaction(insert);
  return findResource(userId, id, tx);
}
export async function reviseResource(
  userId: string,
  id: string,
  revision: number,
  title: string,
  body: Record<string, unknown>,
  tx?: TransactionScope
): Promise<AssistantResource> {
  const revise = async (scope: TransactionScope) => {
    const current = await findResource(userId, id, scope);
    // Status settlement may already hold a task row; only graph changes need the owner lock.
    if (current.kind === 'task' && current.body.parentId !== body.parentId)
      await checkTaskParentage(scope, userId, id, body.parentId);
    if (current.kind === 'artifact' && current.body.importOrigin)
      body = { ...body, importOrigin: current.body.importOrigin };
    if (current.kind === 'artifact' && current.body.analysisTaskIds && !body.analysisTaskIds)
      body = { ...body, analysisTaskIds: current.body.analysisTaskIds };
    if (current.kind === 'task' && current.body.notebookOrigin)
      body = { ...body, notebookOrigin: current.body.notebookOrigin };
    if (current.kind === 'task' && current.body.appOrigin)
      body = { ...body, appOrigin: current.body.appOrigin };
    if (current.kind === 'task') {
      if (
        body.status === 'queued' ||
        JSON.stringify(body.deliverables ?? []) !== JSON.stringify(current.body.deliverables ?? [])
      ) {
        body = { ...body };
        delete body.deliverableReviews;
        delete body.deliverableReviewedBy;
        delete body.deliverableReviewedAt;
      } else if (current.body.deliverableReviews && !body.deliverableReviews) {
        body = {
          ...body,
          deliverableReviews: current.body.deliverableReviews,
          deliverableReviewedBy: current.body.deliverableReviewedBy,
          deliverableReviewedAt: current.body.deliverableReviewedAt,
        };
      }
    }
    if (current.kind === 'artifact') {
      body = await bindArtifactImages(userId, body, scope);
      body = await bindMotionAudio(userId, body, scope);
    }
    if (current.kind === 'meeting' && current.body.audioAssetId) {
      body = {
        ...body,
        audioAssetId: current.body.audioAssetId,
        originalTranscript: current.body.originalTranscript,
        words: current.body.words,
        recordedAt: current.body.recordedAt,
      };
    }

    const now = new Date().toISOString();
    const result = await scope.run(
      'UPDATE assistant_resources SET title = ?, body_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ? AND archived = 0',
      title,
      JSON.stringify(body),
      now,
      id,
      userId,
      revision
    );
    if (!result.changes)
      throw new AppError(
        'Der Eintrag wurde inzwischen geändert. Bitte neu laden.',
        409,
        'REVISION_CONFLICT'
      );
    await scope.run(
      'INSERT INTO assistant_resource_revisions (resource_id, revision, title, body_json, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      current.revision + 1,
      title,
      JSON.stringify(body),
      now
    );
    if (current.kind === 'source') {
      await indexSource(scope, id, current.revision + 1, body);
      await proposeSourceTasks(scope, userId, id, current.revision + 1, title);
    }
    return findResource(userId, id, scope);
  };
  return tx ? revise(tx) : transaction(revise);
}
async function checkTaskParentage(
  scope: TransactionScope,
  userId: string,
  id: string,
  parent: unknown
) {
  await scope.get('SELECT id FROM users WHERE id=? FOR UPDATE', userId);
  const visited = new Set([id]);
  let current = parent;
  while (typeof current === 'string' && current) {
    if (visited.has(current))
      throw new AppError('Teilaufträge dürfen keinen Kreis bilden', 400, 'TASK_GRAPH_CYCLE');
    if (visited.size > 256)
      throw new AppError(
        'Die Auftragshierarchie überschreitet 256 Ebenen',
        400,
        'TASK_GRAPH_LIMIT'
      );
    visited.add(current);
    const ancestor = await findResource(userId, current, scope);
    if (ancestor.kind !== 'task')
      throw new AppError('Übergeordneter Auftrag nicht gefunden', 404, 'NOT_FOUND');
    current = ancestor.body.parentId;
  }
}
export async function archiveResource(userId: string, id: string, revision: number): Promise<void> {
  await findResource(userId, id);
  const result = await run(
    'UPDATE assistant_resources SET archived = 1, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ? AND archived = 0',
    new Date().toISOString(),
    id,
    userId,
    revision
  );
  if (!result.changes)
    throw new AppError('Der Eintrag wurde inzwischen geändert', 409, 'REVISION_CONFLICT');
}
