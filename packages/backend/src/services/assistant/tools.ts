import {
  relevantMemories,
  containsSecret,
  memoryFingerprint,
  forgetMemory,
  MEMORY_EXTRACTION,
  learnFromCliTurn,
} from './memory.js';
import { readPersonalization, memoryPermission, referencePhoto } from './personalization.js';
import { searchSourceChunks } from './sourceChunks.js';
import { z } from 'zod';
import { get } from '../../db/pg.js';
import { peerService } from '../session-mesh/PeerService.js';
import { listSessionDirectory, resolveSessionTarget } from '../session-mesh/sessionDirectory.js';
import { AppError } from '../../middleware/errorHandler.js';
import { apiChatImage } from './apiFiles.js';
import { taskImage } from './taskFiles.js';
import { taskImageWorkspace } from './taskImageWorkspace.js';
import { createNotebook, runNotebook } from './notebooks.js';
import { createAnalysisTask, analysisTaskInput } from './analysisTasks.js';
import { importWebSource } from './webSources.js';
import {
  BODY_SCHEMAS,
  createResource,
  findResource,
  listResources,
  reviseResource,
  checkReferences,
} from './resources.js';

const tools = z.discriminatedUnion('name', [
  z.object({
    name: z.literal('plum_process_memory'),
    arguments: z
      .object({ sourceHash: z.string().regex(/^[a-f0-9]{64}$/), data: MEMORY_EXTRACTION })
      .strict(),
  }),
  z.object({
    name: z.literal('plum_read_reference_photo'),
    arguments: z.object({ slot: z.enum(['portrait', 'fullBody']) }).strict(),
  }),
  z.object({
    name: z.literal('plum_create_analysis_task'),
    arguments: analysisTaskInput.extend({ id: z.string().uuid() }).strict(),
  }),
  z.object({
    name: z.literal('plum_capture_url'),
    arguments: z
      .object({
        commandId: z.string().uuid(),
        url: z.string().url().max(2000),
        title: z.string().trim().min(1).max(200).optional(),
        projectId: z.string().max(200).optional(),
      })
      .strict(),
  }),
  z.object({
    name: z.literal('plum_create_notebook'),
    arguments: z
      .object({
        datasetId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
        commandId: z.string().uuid(),
      })
      .strict(),
  }),
  z.object({
    name: z.literal('plum_run_notebook'),
    arguments: z
      .object({
        id: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
        commandId: z.string().uuid(),
      })
      .strict(),
  }),
  z.object({
    name: z.literal('plum_read_task_upload'),
    arguments: z.object({ taskId: z.string().uuid(), assetId: z.string().uuid() }).strict(),
  }),
  z.object({
    name: z.literal('plum_read_task_image'),
    arguments: z.object({ chatId: z.string().uuid(), assetId: z.string().uuid() }).strict(),
  }),
  z.object({
    name: z.literal('plum_create_source'),
    arguments: z.object({ title: z.string().trim().min(1).max(200), body: BODY_SCHEMAS.source }),
  }),

  z.object({
    name: z.literal('plum_read_resource'),
    arguments: z.object({
      id: z.string().min(1).max(200),
      revision: z.number().int().positive().optional(),
    }),
  }),
  z.object({
    name: z.literal('plum_create_learning_resource'),
    arguments: z.object({
      kind: z.enum(['course', 'collection', 'meeting']),
      title: z.string().trim().min(1).max(200),
      body: z.record(z.unknown()),
    }),
  }),
  z.object({
    name: z.literal('plum_revise_learning_resource'),
    arguments: z.object({
      id: z.string().min(1).max(200),
      expectedRevision: z.number().int().positive(),
      title: z.string().trim().min(1).max(200),
      body: z.record(z.unknown()),
    }),
  }),

  z.object({
    name: z.literal('plum_search_knowledge'),
    arguments: z.object({ query: z.string().min(1).max(200) }),
  }),
  z.object({
    name: z.literal('plum_list_artifacts'),
    arguments: z.object({ query: z.string().max(200).default('') }),
  }),
  z.object({
    name: z.literal('plum_create_artifact'),
    arguments: z.object({ title: z.string().min(1).max(200), body: BODY_SCHEMAS.artifact }),
  }),
  z.object({
    name: z.literal('plum_revise_artifact'),
    arguments: z.object({
      id: z.string().min(1),
      expectedRevision: z.number().int().positive(),
      title: z.string().min(1).max(200),
      body: BODY_SCHEMAS.artifact,
    }),
  }),
  z.object({
    name: z.literal('plum_forget_memory'),
    arguments: z
      .object({ id: z.string().max(200), expectedRevision: z.number().int().positive() })
      .strict(),
  }),
  z.object({
    name: z.literal('plum_revise_memory'),
    arguments: z
      .object({
        id: z.string().max(200),
        expectedRevision: z.number().int().positive(),
        title: z.string().min(1).max(200),
        text: z.string().min(1).max(10000),
      })
      .strict(),
  }),
  z.object({
    name: z.literal('plum_remember'),
    arguments: z.object({ title: z.string().min(1).max(200), text: z.string().min(1).max(10000) }),
  }),
  z.object({
    name: z.literal('plum_create_task'),
    arguments: z.object({ title: z.string().min(1).max(200), body: BODY_SCHEMAS.task }),
  }),
  z.object({
    name: z.literal('plum_list_sessions'),
    arguments: z.object({ query: z.string().max(200).optional() }).default({}),
  }),
  z.object({
    name: z.literal('plum_message_session'),
    arguments: z.object({
      to: z.string().min(1).max(200),
      message: z.string().min(1).max(20000),
    }),
  }),
]);
export async function executeAssistantTool(sessionId: string, userId: string, input: unknown) {
  const parsed = tools.safeParse(input);
  if (!parsed.success) throw new AppError('Ungültige Werkzeugparameter', 400, 'VALIDATION_ERROR');
  const tool = parsed.data;
  const binding = (await get(
    `SELECT b.project_id, b.temporary, v.body_json
    FROM assistant_session_bindings b LEFT JOIN assistant_resources p ON p.id = b.profile_id AND p.user_id = ? AND p.archived = 0
    LEFT JOIN assistant_resource_revisions v ON v.resource_id = p.id AND v.revision = b.profile_revision
    WHERE b.session_id = ?`,
    userId,
    sessionId
  )) as { project_id: string | null; temporary: number; body_json: string | null } | undefined;
  const profile = binding?.body_json ? JSON.parse(binding.body_json) : null;
  const personal = await readPersonalization(userId);
  const sessionSurface = await get(
    'SELECT surface FROM sessions WHERE id=? AND user_id=?',
    sessionId,
    userId
  );
  const allProjects =
    personal.projectSearch && sessionSurface?.surface === 'chat' && !binding?.temporary;
  const canReadMemory = memoryPermission(
    personal,
    profile?.memory,
    !!binding?.temporary,
    false,
    sessionSurface?.surface
  );
  const canWriteMemory = memoryPermission(
    personal,
    profile?.memory,
    !!binding?.temporary,
    true,
    sessionSurface?.surface
  );
  if (
    binding?.temporary &&
    [
      'plum_create_artifact',
      'plum_revise_artifact',
      'plum_create_task',
      'plum_create_source',
      'plum_create_learning_resource',
      'plum_revise_learning_resource',
      'plum_create_notebook',
      'plum_run_notebook',
      'plum_create_analysis_task',
      'plum_capture_url',
    ].includes(tool.name)
  )
    throw new AppError(
      'Temporäre Chats speichern keine dauerhaften Bibliothekseinträge oder Aufträge. Übernimm das Ergebnis ausdrücklich über die Oberfläche.',
      403,
      'TEMPORARY_PERSISTENCE_DISABLED'
    );
  switch (tool.name) {
    case 'plum_list_sessions': {
      const { getProcessManager } = await import('../../websocket/index.js');
      return listSessionDirectory(userId, sessionId, getProcessManager(), {
        query: tool.arguments.query,
      });
    }
    case 'plum_message_session': {
      const { getProcessManager } = await import('../../websocket/index.js');
      const runtime = getProcessManager();
      const sessions = await listSessionDirectory(userId, sessionId, runtime, { limit: 1000 });
      const target = resolveSessionTarget(sessions, tool.arguments.to, sessionId);
      const wasRunning = runtime.isSessionRunning(target.id);
      const delegation = await peerService.createDelegation({
        fromSessionId: sessionId,
        toSessionId: target.id,
        userId,
        content: tool.arguments.message,
        kind: 'consult',
      });
      return {
        delivered: delegation.status !== 'error',
        to: { id: target.id, name: target.name },
        wasRunning,
        delegationId: delegation.id,
        note: wasRunning
          ? 'Zugestellt; die Session antwortet mit plum_message_session an dich.'
          : 'Die Session war gestoppt und wurde mit der Nachricht gestartet; sie antwortet mit plum_message_session an dich.',
      };
    }
    case 'plum_read_reference_photo': {
      const session = await get(
        'SELECT id,surface FROM sessions WHERE id=? AND user_id=?',
        sessionId,
        userId
      );
      if (!session || binding?.temporary || session.surface === 'code')
        throw new AppError(
          'Referenzfoto ist in diesem Gespräch nicht verfügbar.',
          403,
          'REFERENCE_PHOTO_DISABLED'
        );
      const file = await referencePhoto(userId, tool.arguments.slot);
      return {
        image: { mimeType: file.mimeType, data: file.bytes.toString('base64') },
        filename: file.filename,
        path: await taskImageWorkspace(sessionId, userId, file),
      };
    }
    case 'plum_read_task_upload': {
      const activeTask = await get(
        "SELECT id FROM assistant_resources WHERE user_id=? AND id=? AND kind='task' AND archived=0 AND body_json::jsonb->>'sessionId'=?",
        userId,
        tool.arguments.taskId,
        sessionId
      );
      if (!activeTask)
        throw new AppError(
          'Bild gehört nicht zu diesem aktiven Auftrag',
          403,
          'TASK_IMAGE_NOT_SELECTED'
        );
      const file = await taskImage(userId, tool.arguments.taskId, tool.arguments.assetId);
      return {
        image: { mimeType: file.mimeType, data: file.bytes.toString('base64') },
        filename: file.filename,
        path: await taskImageWorkspace(sessionId, userId, file),
      };
    }
    case 'plum_capture_url': {
      if (tool.arguments.projectId && tool.arguments.projectId !== binding?.project_id)
        throw new AppError(
          'Quelle gehört nicht zum aktiven Wissensprojekt',
          403,
          'SOURCE_SCOPE_DENIED'
        );
      return importWebSource(userId, {
        ...tool.arguments,
        projectId: tool.arguments.projectId ?? binding?.project_id ?? undefined,
      });
    }
    case 'plum_create_notebook':
      return createNotebook(userId, tool.arguments.datasetId, tool.arguments);
    case 'plum_create_analysis_task': {
      const { id, ...input } = tool.arguments;
      return createAnalysisTask(userId, id, input);
    }
    case 'plum_run_notebook':
      return runNotebook(userId, tool.arguments.id, tool.arguments);
    case 'plum_read_task_image': {
      const task = await get(
        "SELECT body_json FROM assistant_resources WHERE user_id=? AND kind='task' AND archived=0 AND body_json::jsonb->>'sessionId'=? ORDER BY updated_at DESC LIMIT 1",
        userId,
        sessionId
      );
      const body = task ? JSON.parse(task.body_json) : null;
      const origin =
        body?.originResourceId === tool.arguments.chatId
          ? await get(
              'SELECT image_asset_ids FROM assistant_api_turns WHERE chat_id=? AND id=?',
              tool.arguments.chatId,
              body.originTurnId
            )
          : null;
      if (
        !origin ||
        !(JSON.parse(origin.image_asset_ids) as string[]).includes(tool.arguments.assetId)
      )
        throw new AppError(
          'Bild ist keine Eingabe dieses Auftrags',
          403,
          'TASK_IMAGE_NOT_SELECTED'
        );
      const file = await apiChatImage(userId, tool.arguments.chatId, tool.arguments.assetId);
      return {
        image: { mimeType: file.mimeType, data: file.bytes.toString('base64') },
        filename: file.filename,
        path: await taskImageWorkspace(sessionId, userId, file),
      };
    }
    case 'plum_read_resource': {
      const resource = await findResource(userId, tool.arguments.id);
      if (
        resource.kind === 'memory' &&
        (!canReadMemory ||
          resource.body.scope === 'agent' ||
          (resource.body.scope === 'project' && resource.body.projectId !== binding?.project_id))
      )
        throw new AppError(
          'Personalisierung oder Profil erlaubt keinen Zugriff auf diese Erinnerung',
          403,
          'MEMORY_READ_DISABLED'
        );
      const task = await get(
        `SELECT body_json FROM assistant_resources WHERE user_id=? AND kind='task' AND archived=0 AND (body_json::jsonb)->>'sessionId'=? ORDER BY updated_at DESC LIMIT 1`,
        userId,
        sessionId
      );
      const taskBody = task ? JSON.parse(task.body_json) : {};
      const selectedSources = taskBody.sourceVersions ?? [];
      const taskSource = selectedSources.find(
        (item: { id: string; revision: number }) => item.id === resource.id
      );
      if (
        resource.kind === 'source' &&
        resource.body.projectId &&
        resource.body.projectId !== binding?.project_id &&
        !taskSource &&
        !allProjects
      )
        throw new AppError(
          'Quelle gehört nicht zum aktiven Wissensprojekt',
          403,
          'SOURCE_SCOPE_DENIED'
        );
      const analysis = taskBody.notebookOrigin;
      const pinnedAnalysis =
        analysis &&
        (resource.id === analysis.datasetId
          ? analysis.datasetRevision
          : resource.id === analysis.notebookId
            ? analysis.notebookRevision
            : undefined);
      if (pinnedAnalysis && tool.arguments.revision && tool.arguments.revision !== pinnedAnalysis)
        throw new AppError(
          'Die Analyseeingabe ist an die Auftragsrevision gebunden',
          409,
          'ANALYSIS_INPUT_CONFLICT'
        );
      const revision = pinnedAnalysis ?? tool.arguments.revision ?? taskSource?.revision;
      if (revision) {
        const version = await get(
          'SELECT title,body_json,created_at FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
          resource.id,
          revision
        );
        if (!version) throw new AppError('Revision nicht gefunden', 404, 'NOT_FOUND');
        return {
          ...resource,
          title: String(version.title),
          body: JSON.parse(version.body_json),
          revision,
          updatedAt: String(version.created_at),
        };
      }
      return resource;
    }
    case 'plum_create_learning_resource': {
      const body = BODY_SCHEMAS[tool.arguments.kind].parse(tool.arguments.body);
      return createResource(userId, tool.arguments.kind, tool.arguments.title, body);
    }
    case 'plum_revise_learning_resource': {
      const resource = await findResource(userId, tool.arguments.id);
      if (!['course', 'collection', 'meeting'].includes(resource.kind))
        throw new AppError('Lern-/Meetingressource nicht gefunden', 404, 'NOT_FOUND');
      const body = BODY_SCHEMAS[resource.kind].parse(tool.arguments.body);
      if (resource.kind === 'course') body.attempts = resource.body.attempts ?? [];
      await checkReferences(userId, body);
      return reviseResource(
        userId,
        resource.id,
        tool.arguments.expectedRevision,
        tool.arguments.title,
        body
      );
    }

    case 'plum_list_artifacts':
      return listResources(userId, 'artifact', { search: tool.arguments.query, limit: 30 });
    case 'plum_create_source': {
      if (tool.arguments.body.projectId && tool.arguments.body.projectId !== binding?.project_id)
        throw new AppError(
          'Quelle gehört nicht zum aktiven Wissensprojekt',
          403,
          'SOURCE_SCOPE_DENIED'
        );
      return createResource(userId, 'source', tool.arguments.title, {
        ...tool.arguments.body,
        ...(binding?.project_id ? { projectId: binding.project_id } : {}),
      });
    }
    case 'plum_create_artifact':
      return createResource(userId, 'artifact', tool.arguments.title, {
        ...tool.arguments.body,
        evidence: (tool.arguments.body.evidence ?? []).map((item: Record<string, unknown>) => ({
          ...item,
          reviewed: false,
        })),
      });
    case 'plum_revise_artifact': {
      const resource = await findResource(userId, tool.arguments.id);
      if (resource.kind !== 'artifact')
        throw new AppError('Ergebnis nicht gefunden', 404, 'NOT_FOUND');
      tool.arguments.body.evidence = (tool.arguments.body.evidence ?? []).map(
        (item: Record<string, unknown>) => ({ ...item, reviewed: false })
      );
      await checkReferences(userId, tool.arguments.body);
      return reviseResource(
        userId,
        resource.id,
        tool.arguments.expectedRevision,
        tool.arguments.title,
        tool.arguments.body
      );
    }
    case 'plum_create_task':
      return createResource(userId, 'task', tool.arguments.title, {
        ...tool.arguments.body,
        originSessionId: sessionId,
      });
    case 'plum_process_memory':
      return learnFromCliTurn(userId, sessionId, tool.arguments.sourceHash, tool.arguments.data);
    case 'plum_forget_memory':
    case 'plum_revise_memory': {
      const resource = await findResource(userId, tool.arguments.id);
      if (
        !canWriteMemory ||
        resource.kind !== 'memory' ||
        resource.body.scope === 'agent' ||
        (resource.body.scope === 'project' && resource.body.projectId !== binding?.project_id)
      )
        throw new AppError(
          'Profil oder Personalisierung erlaubt keine Änderung dieser Erinnerung.',
          403,
          'MEMORY_WRITE_DISABLED'
        );
      if (tool.name === 'plum_forget_memory') {
        await forgetMemory(userId, resource.id, tool.arguments.expectedRevision);
        return { forgotten: true, id: resource.id };
      }
      if (containsSecret(tool.arguments.text))
        throw new AppError('Zugangsdaten gehören nicht ins Gedächtnis.', 400, 'MEMORY_SECRET');
      return reviseResource(
        userId,
        resource.id,
        tool.arguments.expectedRevision,
        tool.arguments.title,
        { ...resource.body, text: tool.arguments.text, state: 'active', pinned: true }
      );
    }
    case 'plum_remember': {
      if (!canWriteMemory)
        throw new AppError(
          'Personalisierung oder Profil erlaubt kein Speichern von Erinnerungen',
          403,
          'MEMORY_WRITE_DISABLED'
        );
      if (containsSecret(tool.arguments.text))
        throw new AppError('Zugangsdaten gehören nicht ins Gedächtnis.', 400, 'MEMORY_SECRET');
      const prior = await listResources(userId, 'memory', {
        limit: 100,
        memoryScope: true,
        projectId: binding?.project_id ?? undefined,
      });
      const same = prior.find(
        (r) => memoryFingerprint(String(r.body.text)) === memoryFingerprint(tool.arguments.text)
      );
      if (same) return same;
      return createResource(
        userId,
        'memory',
        tool.arguments.title,
        BODY_SCHEMAS.memory.parse({
          text: tool.arguments.text,
          pinned: true,
          scope: binding?.project_id ? 'project' : 'personal',
          ...(binding?.project_id ? { projectId: binding.project_id } : {}),
        })
      );
    }
    case 'plum_search_knowledge': {
      const project = binding?.project_id
        ? await findResource(userId, binding.project_id).catch(() => null)
        : null;
      const sources =
        project || allProjects
          ? await searchSourceChunks(userId, project?.id ?? '', tool.arguments.query, allProjects)
          : [];
      const recalled = canReadMemory
        ? await relevantMemories(userId, project?.id ?? null, tool.arguments.query)
        : [];
      const notes = await Promise.all(
        recalled
          .filter((r) => !tool.arguments.query || Number(r.relevance) > 0)
          .slice(0, 10)
          .map((r) => findResource(userId, String(r.id)))
      );
      const memories = notes.map((resource) => {
        const text = String(resource.body.text ?? ''),
          at = Math.max(
            0,
            text.toLocaleLowerCase().indexOf(tool.arguments.query.toLocaleLowerCase())
          ),
          start = Math.max(0, at - 200);
        return {
          id: resource.id,
          kind: resource.kind,
          title: resource.title,
          revision: resource.revision,
          excerpt: text.slice(start, start + 1200),
          excerptStart: start,
          citation: resource.body.citation ?? '',
          url: resource.body.url ?? null,
          sha256: resource.body.sha256 ?? null,
          truncated: resource.body.truncated === true,
          reference: `[${resource.title} · Revision ${resource.revision}](/assistant/memory?resource=${encodeURIComponent(resource.id)}&revision=${resource.revision})`,
        };
      });
      return [...sources, ...memories].slice(0, 30);
    }
  }
}
