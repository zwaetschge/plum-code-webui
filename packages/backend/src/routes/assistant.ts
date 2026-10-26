import { chatWorkbenchRouter } from './chatWorkbench.js';
import {
  nativeMemoryList,
  importNativeMemory,
  changeNativeMemory,
  NATIVE_MEMORY_ID,
} from '../services/assistant/nativeMemory.js';
import { exportMemory, importMemoryText } from '../services/assistant/memoryTransfer.js';
import {
  memoryStatus,
  memoryHistory,
  forgetMemoryHistory,
  cancelMemoryBackfill,
  forgetMemory,
  importAgentMemory,
  backfillMemory,
} from '../services/assistant/memory.js';
import {
  readPersonalization,
  updatePersonalization,
  changeReferencePhoto,
  referencePhoto,
  PERSONALIZATION_INPUT,
  PHOTO_SLOT,
} from '../services/assistant/personalization.js';
import { taskLimits } from '../services/assistant/taskLimits.js';
import { issueOfficeTicket } from '../services/assistant/officeSessions.js';
import {
  documentAccess,
  sharedDocuments,
  documentMembers,
  changeDocumentMember,
  writeSharedDocument,
  DOCUMENT_MEMBER_INPUT,
  DOCUMENT_WRITE_INPUT,
} from '../services/assistant/documentAccess.js';
import { addDocumentImage, DOCUMENT_IMAGE_INPUT } from '../services/assistant/documentImages.js';
import {
  addMotionAudio,
  readMotionAudio,
  MOTION_AUDIO_INPUT,
} from '../services/assistant/motionAudio.js';
import { readArtifactImage } from '../services/assistant/artifactImages.js';
import { searchAssistantLibrary } from '../services/assistant/librarySearch.js';
import { createComparison } from '../services/assistant/comparisons.js';
import {
  createPublication,
  listPublications,
  revokePublication,
  PUBLICATION_INPUT,
} from '../services/assistant/publications.js';
import {
  createPersonalWorkspace,
  PERSONAL_WORKSPACE_INPUT,
} from '../services/assistant/personalWorkspaces.js';
import { createTryOnTask, TRY_ON_INPUT } from '../services/assistant/tryOn.js';
import { createImageEditTask, IMAGE_EDIT_INPUT } from '../services/assistant/imageEdits.js';
import {
  uploadTaskImage,
  taskImages,
  taskImage,
  removeTaskImage,
} from '../services/assistant/taskFiles.js';
import { Router, type Request, type RequestHandler } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import multer from 'multer';
import {
  requireAuth,
  requireActive,
  requireAdmin,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { directoryContainers, swarmDirectory } from '../services/assistant/swarmDirectory.js';
import { dockerHost } from '../services/docker/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { all, get, run, transaction } from '../db/pg.js';
import {
  BODY_SCHEMAS,
  RESOURCE_KINDS,
  listResources,
  findResource,
  createResource,
  reviseResource,
  archiveResource,
  checkReferences,
  resourceReferences,
} from '../services/assistant/resources.js';
import { bindProfile, buildAssistantContext } from '../services/assistant/context.js';
import { executeTaskCommand, TASK_COMMAND, taskAttempts } from '../services/assistant/tasks.js';
import { getEnabledCliProvidersForUser } from './settings.js';
import { getProviderStatuses } from '../services/cli-providers.js';
import { requireHookSecret } from '../middleware/hookSecret.js';
import { executeAssistantTool } from '../services/assistant/tools.js';
import {
  connectMatrix,
  disconnectMatrix,
  matrixStatus,
  matrixRooms,
  matrixMessages,
  matrixEvent,
  matrixSend,
  matrixRead,
  matrixAccountData,
  matrixPreferences,
  updateMatrixPreferences,
  MATRIX_PREFERENCES_INPUT,
  matrixSetAccountData,
  matrixBrianConversation,
  matrixUpload,
  matrixDownload,
  matrixImportHistory,
  matrixSync,
  matrixInvitations,
  matrixMembers,
  matrixMembership,
} from '../services/assistant/matrix.js';
import { matrixImportStatus } from '../services/assistant/matrixArchive.js';
import { ingestSource } from '../services/assistant/ingestion.js';
import { officeArtifact } from '../services/assistant/office.js';
import { apiChatProviders } from '../services/assistant/apiTransport.js';
import { apiUsage } from '../services/assistant/apiUsage.js';
import { uploadApiImage, apiChatImages, apiChatImage } from '../services/assistant/apiFiles.js';
import {
  API_CHAT_INPUT,
  API_TURN_INPUT,
  createApiChat,
  updateApiChat,
  apiChatTurns,
  startApiTurn,
  stopApiTurn,
  branchApiChat,
  activateApiTurnVersion,
  deleteApiChat,
  deleteProject,
  updateApiChatMeta,
  materializeApiAnswer,
  applyApiSelection,
} from '../services/assistant/apiChats.js';
import { createAppFrame, consumeAppFrame, APP_FRAME_CSP } from '../services/assistant/frames.js';
import { exportArtifact } from '../services/assistant/exports.js';
import { runNotebook, createNotebook, importDataset } from '../services/assistant/notebooks.js';
import {
  taskResultCandidates,
  reviewTaskResults,
  taskResultInput,
} from '../services/assistant/taskResults.js';
import { createAnalysisTask, analysisTaskInput } from '../services/assistant/analysisTasks.js';
import {
  importWebSource,
  sourceWatch,
  configureSourceWatch,
  refreshWebSource,
} from '../services/assistant/webSources.js';
import { assistantAppState } from '../services/assistant/appState.js';
import { createAppTask, APP_TASK_INPUT } from '../services/assistant/appTasks.js';
import { submitQuiz, QUIZ_ANSWER } from '../services/assistant/learning.js';
import { importMeeting } from '../services/assistant/meetings.js';
import { branchConversation } from '../services/assistant/branches.js';
import {
  assistantExportSnapshot,
  streamAssistantExport,
} from '../services/assistant/accountExport.js';
import {
  assistantVoices,
  assistantSpeech,
  assistantVoiceWarmup,
  assistantTranscription,
} from '../services/assistant/voice.js';

const router = Router();
const handle =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
const owner = (req: Request) => (req as AuthenticatedRequest).userId;
const parse = <Schema extends z.ZodTypeAny>(schema: Schema, value: unknown): z.output<Schema> => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('Ungültige Eingabe', 400, 'VALIDATION_ERROR');
  return parsed.data;
};
const envelope = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.record(z.unknown()),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
const params = z.object({
  projectId: z.string().min(1).max(200).optional(),
  search: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z
    .enum([
      'draft',
      'queued',
      'running',
      'waiting_input',
      'paused',
      'completed',
      'cancelled',
      'failed',
      'interrupted',
    ])
    .optional(),
  sort: z.enum(['updated', 'priority', 'deadline']).optional(),
});
const kindFor = (name: string) => {
  const kind = RESOURCE_KINDS[name as keyof typeof RESOURCE_KINDS];
  if (!kind) throw new AppError('Bereich nicht gefunden', 404, 'NOT_FOUND');
  return kind;
};
router.post(
  '/internal/tool',
  requireHookSecret,
  handle(async (req, res) => {
    const sessionId = req.header('x-webui-session-id') || '';
    const session = (await get('SELECT user_id FROM sessions WHERE id = ?', sessionId)) as
      | { user_id: string }
      | undefined;
    if (!session) throw new AppError('Gültige Sitzung erforderlich', 403, 'SESSION_REQUIRED');
    (req as AuthenticatedRequest).userId = session.user_id;
    await requireActive(req, res, () => {});
    res.json({
      success: true,
      data: await executeAssistantTool(sessionId, session.user_id, req.body),
    });
  })
);
router.get(
  '/app-frames/:ticket',
  handle(async (req, res) => {
    const html = await consumeAppFrame(String(req.params.ticket));
    res.setHeader('Content-Security-Policy', APP_FRAME_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.type('html').send(html);
  })
);
router.use(requireAuth, requireActive);
router.use(chatWorkbenchRouter);
router.use('/memory-system', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get(
  '/memory-system',
  handle(async (req, res) => res.json({ success: true, data: await memoryStatus(owner(req)) }))
);
router.get(
  '/memory-system/history',
  handle(async (req, res) => {
    const input = parse(
      z.object({
        search: z.string().max(200).default(''),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      req.query
    );
    res.json({
      success: true,
      data: await memoryHistory(owner(req), input.search, input.offset, input.limit),
    });
  })
);
router.delete(
  '/memory-system/history/:id',
  handle(async (req, res) => {
    const input = parse(
      z.object({ expectedRevision: z.number().int().nonnegative() }).strict(),
      req.body
    );
    await forgetMemoryHistory(owner(req), String(req.params.id), input.expectedRevision);
    res.json({ success: true });
  })
);
router.get(
  '/memory-system/models',
  handle(async (req, res) => {
    const { memoryCliAvailable } = await import('../services/assistant/memoryCli.js');
    const { CLI_PROVIDERS } = await import('../services/cli-providers.js');
    const api = await apiChatProviders(owner(req));
    const cli = (await memoryCliAvailable(owner(req)))
      ? [
          {
            id: 'cli:codex',
            name: 'Codex · vorhandener CLI-Login',
            models: CLI_PROVIDERS.codex.models ?? [CLI_PROVIDERS.codex.defaultModel ?? 'gpt-5.5'],
          },
        ]
      : [];
    res.json({ success: true, data: [...cli, ...api] });
  })
);
router.post(
  '/memory-system/backfill',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          expectedRevision: z.number().int().nonnegative(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await backfillMemory(owner(req), input.expectedRevision, input.limit),
    });
  })
);
router.post(
  '/memory-system/backfill/cancel',
  handle(async (req, res) => {
    const input = parse(
      z.object({ expectedRevision: z.number().int().nonnegative() }).strict(),
      req.body
    );
    await cancelMemoryBackfill(owner(req), input.expectedRevision);
    res.json({ success: true });
  })
);
router.post(
  '/memory-system/import',
  handle(async (req, res) => {
    const input = parse(
      z.object({ id: z.string().max(200), expectedRevision: z.number().int().positive() }).strict(),
      req.body
    );
    res.json({
      success: true,
      data: await importAgentMemory(owner(req), input.id, input.expectedRevision),
    });
  })
);
router.get(
  '/memory-system/export',
  handle(async (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="plum-memory.json"');
    res.json(await exportMemory(owner(req)));
  })
);
router.post(
  '/memory-system/transfer',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ filename: z.string().min(1).max(200), text: z.string().min(1).max(1000000) })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await importMemoryText(owner(req), input.filename, input.text),
    });
  })
);
router.get(
  '/memory-system/native',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          search: z.string().max(200).default(''),
          offset: z.coerce.number().int().nonnegative().default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict(),
      req.query
    );
    res.json({
      success: true,
      data: await nativeMemoryList(owner(req), input.search, input.offset, input.limit),
    });
  })
);
router.post(
  '/memory-system/native/import',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ id: NATIVE_MEMORY_ID, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await importNativeMemory(owner(req), input.id, input.expectedRevision),
    });
  })
);
router.post(
  '/memory-system/native/change',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          id: NATIVE_MEMORY_ID,
          expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
          text: z.string().trim().min(1).max(50000).optional(),
        })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await changeNativeMemory(owner(req), input.id, input.expectedRevision, input.text),
    });
  })
);
router.delete(
  '/memory-system/:id',
  handle(async (req, res) => {
    const input = parse(
      z.object({ expectedRevision: z.number().int().positive() }).strict(),
      req.body
    );
    await forgetMemory(owner(req), String(req.params.id), input.expectedRevision);
    res.json({ success: true });
  })
);
router.delete(
  '/memory-system',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          expectedRevision: z.number().int().nonnegative(),
          historyOnly: z.boolean().optional(),
        })
        .strict(),
      req.body
    );
    await transaction(async (tx) => {
      await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE', owner(req));
      const pref = await readPersonalization(owner(req), tx);
      if (pref.revision !== input.expectedRevision)
        throw new AppError('Personalisierung wurde inzwischen geändert.', 409, 'REVISION_CONFLICT');
      await tx.run(
        "UPDATE assistant_memory_jobs SET status='cancelled',error=NULL,usage_json=NULL WHERE user_id=?",
        owner(req)
      );
      await tx.run('DELETE FROM assistant_api_compactions WHERE user_id=?', owner(req));
      await tx.run('DELETE FROM assistant_memory_history WHERE user_id=?', owner(req));
      await tx.run(
        "UPDATE assistant_memory_backfills SET status='cancelled' WHERE user_id=?",
        owner(req)
      );
      await tx.run(
        "DELETE FROM assistant_memory_vectors WHERE user_id=? AND kind='history'",
        owner(req)
      );
      if (!input.historyOnly) {
        const rows = await tx.all(
          "SELECT id,body_json FROM assistant_resources WHERE user_id=? AND kind='memory' AND body_json::jsonb->>'scope'<>'agent'",
          owner(req)
        );
        for (const r of rows) {
          const revision = await tx.get(
            'SELECT revision FROM assistant_resources WHERE id=?',
            r.id
          );
          await forgetMemory(owner(req), r.id, revision!.revision, tx);
        }
      }
    });
    res.json({ success: true });
  })
);
router.use('/personalization', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get(
  '/personalization',
  handle(async (req, res) =>
    res.json({ success: true, data: await readPersonalization(owner(req)) })
  )
);
router.put(
  '/personalization',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await updatePersonalization(owner(req), parse(PERSONALIZATION_INPUT, req.body)),
    })
  )
);
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const uploadReferencePhoto: RequestHandler = (req, res, next) =>
  photoUpload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError)
      return next(
        new AppError(
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Ein Referenzfoto darf höchstens 5 MB gross sein.'
            : 'Bitte genau ein Referenzfoto wählen.',
          error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          'INVALID_REFERENCE_PHOTO'
        )
      );
    next(error);
  });
router.post(
  '/personalization/photos/:slot',
  uploadReferencePhoto,
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Bitte ein Referenzfoto wählen.', 400, 'FILE_REQUIRED');
    res.json({
      success: true,
      data: await changeReferencePhoto(
        owner(req),
        parse(PHOTO_SLOT, req.params.slot),
        parse(z.coerce.number().int().nonnegative(), req.body.expectedRevision),
        req.file
      ),
    });
  })
);
router.delete(
  '/personalization/photos/:slot',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await changeReferencePhoto(
        owner(req),
        parse(PHOTO_SLOT, req.params.slot),
        parse(z.number().int().nonnegative(), req.body.expectedRevision)
      ),
    })
  )
);
router.get(
  '/personalization/photos/:slot',
  handle(async (req, res) => {
    const photo = await referencePhoto(owner(req), parse(PHOTO_SLOT, req.params.slot));
    res.type(photo.mimeType).send(photo.bytes);
  })
);
router.get(
  '/publications',
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await listPublications(
        owner(req),
        req.query.resourceId === undefined
          ? undefined
          : parse(z.string().uuid(), req.query.resourceId)
      ),
    });
  })
);
router.post(
  '/publications',
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await createPublication(owner(req), parse(PUBLICATION_INPUT, req.body)),
    });
  })
);
router.delete(
  '/publications/:id',
  handle(async (req, res) => {
    res.json({ success: true, data: await revokePublication(owner(req), String(req.params.id)) });
  })
);
router.post(
  '/personal-workspaces',
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await createPersonalWorkspace(owner(req), parse(PERSONAL_WORKSPACE_INPUT, req.body)),
    });
  })
);
router.use('/documents', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.get(
  '/documents/shared',
  handle(async (req, res) => {
    const offset = parse(z.coerce.number().int().min(0).max(100000).default(0), req.query.offset);
    res.json({ success: true, data: await sharedDocuments(owner(req), offset) });
  })
);
router.get(
  '/documents/:id/access',
  handle(async (req, res) => {
    const revision =
      req.query.revision === undefined
        ? undefined
        : parse(z.coerce.number().int().positive(), req.query.revision);
    res.json({
      success: true,
      data: await documentAccess(owner(req), String(req.params.id), undefined, revision),
    });
  })
);
router.get(
  '/documents/:id/members',
  handle(async (req, res) =>
    res.json({ success: true, data: await documentMembers(owner(req), String(req.params.id)) })
  )
);
router.post(
  '/documents/:id/members',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await changeDocumentMember(
        owner(req),
        String(req.params.id),
        parse(DOCUMENT_MEMBER_INPUT, req.body)
      ),
    })
  )
);
router.post(
  '/documents/:id/edits',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await writeSharedDocument(
        owner(req),
        String(req.params.id),
        parse(DOCUMENT_WRITE_INPUT, req.body)
      ),
    })
  )
);
router.get(
  '/documents/:id/images/:asset',
  handle(async (req, res) => {
    const revision = parse(z.coerce.number().int().positive(), req.query.revision);
    const access = await documentAccess(owner(req), String(req.params.id), undefined, revision);
    const image = await readArtifactImage(
      access.ownerId,
      access.resource.body,
      String(req.params.asset)
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.mimeType).send(image.bytes);
  })
);
router.get(
  '/tasks/:id/results',
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await taskResultCandidates(owner(req), String(req.params.id)),
    });
  })
);
router.post(
  '/tasks/:id/results',
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await reviewTaskResults(
        owner(req),
        String(req.params.id),
        parse(taskResultInput, req.body)
      ),
    });
  })
);
router.post(
  '/office-tickets',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), origin: z.string().url() })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await issueOfficeTicket(owner(req), input.challenge, input.origin),
    });
  })
);
router.post(
  '/artifacts/:id/image-edit',
  handle(async (req, res) => {
    res.status(201).json({
      success: true,
      data: await createImageEditTask(
        owner(req),
        String(req.params.id),
        parse(IMAGE_EDIT_INPUT, req.body),
        'artifact'
      ),
    });
  })
);
router.post(
  '/artifacts/:id/app-task',
  handle(async (req, res) =>
    res.status(201).json({
      success: true,
      data: await createAppTask(owner(req), String(req.params.id), parse(APP_TASK_INPUT, req.body)),
    })
  )
);
router.get(
  '/artifacts/:id/images/:asset',
  handle(async (req, res) => {
    const input = parse(
      z.object({ revision: z.coerce.number().int().positive() }).strict(),
      req.query
    );
    const resource = await findResource(owner(req), String(req.params.id));
    if (resource.kind !== 'artifact')
      throw new AppError('Ergebnis nicht gefunden', 404, 'NOT_FOUND');
    const version = await get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      resource.id,
      input.revision
    );
    if (!version) throw new AppError('Ergebnisstand nicht gefunden', 404, 'NOT_FOUND');
    const file = await readArtifactImage(
      owner(req),
      JSON.parse(version.body_json),
      String(req.params.asset)
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.bytes);
  })
);
router.get(
  '/shared/:token/images/:asset',
  handle(async (req, res) => {
    const row = await get(
      `SELECT s.user_id,v.body_json FROM assistant_shares s JOIN assistant_resources r ON r.id=s.resource_id JOIN assistant_resource_revisions v ON v.resource_id=s.resource_id AND v.revision=s.revision WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND r.archived=0 AND r.kind='artifact'`,
      createHash('sha256').update(String(req.params.token)).digest('hex'),
      new Date().toISOString()
    );
    if (!row) throw new AppError('Freigabe ist nicht verfügbar', 404, 'NOT_FOUND');
    const file = await readArtifactImage(
      row.user_id,
      JSON.parse(row.body_json),
      String(req.params.asset)
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.bytes);
  })
);
router.post(
  '/tasks/:id/image-edit',
  handle(async (req, res) => {
    res.status(201).json({
      success: true,
      data: await createImageEditTask(
        owner(req),
        String(req.params.id),
        parse(IMAGE_EDIT_INPUT, req.body),
        'task'
      ),
    });
  })
);
router.post(
  '/sources/import-url',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          commandId: z.string().uuid(),
          url: z.string().url().max(2000),
          title: z.string().trim().min(1).max(200).optional(),
          projectId: z.string().min(1).max(200).optional(),
        })
        .strict(),
      req.body
    );
    res.status(201).json({ success: true, data: await importWebSource(owner(req), input) });
  })
);
router.get(
  '/sources/:id/watch',
  handle(async (req, res) =>
    res.json({ success: true, data: await sourceWatch(owner(req), String(req.params.id)) })
  )
);
router.post(
  '/sources/:id/watch',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          commandId: z.string().uuid(),
          expectedRevision: z.number().int().positive(),
          expectedWatchRevision: z.number().int().nonnegative(),
          enabled: z.boolean(),
          intervalMinutes: z.number().int().min(15).max(1440),
        })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await configureSourceWatch(owner(req), String(req.params.id), input),
    });
  })
);
router.post(
  '/sources/:id/refresh',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ commandId: z.string().uuid(), expectedRevision: z.number().int().positive() })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await refreshWebSource(owner(req), String(req.params.id), input),
    });
  })
);
router.post(
  '/artifacts/:id/notebook',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ commandId: z.string().uuid(), expectedRevision: z.number().int().positive() })
        .strict(),
      req.body
    );
    res.status(201).json({
      success: true,
      data: await createNotebook(owner(req), String(req.params.id), input),
    });
  })
);
router.post(
  '/artifacts/:id/analysis-task',
  handle(async (req, res) => {
    res.status(201).json({
      success: true,
      data: await createAnalysisTask(
        owner(req),
        String(req.params.id),
        parse(analysisTaskInput, req.body)
      ),
    });
  })
);
router.post(
  '/artifacts/:id/run',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ commandId: z.string().uuid(), expectedRevision: z.number().int().positive() })
        .strict(),
      req.body
    );
    res.json({ success: true, data: await runNotebook(owner(req), String(req.params.id), input) });
  })
);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
const tryOnUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 4, fieldSize: 20000 },
});
router.post(
  '/artifacts/:id/try-on',
  tryOnUpload.fields([
    { name: 'person', maxCount: 1 },
    { name: 'product', maxCount: 1 },
  ]),
  handle(async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    if (!files?.person?.[0] || !files?.product?.[0])
      throw new AppError(
        'Ein Personenbild und ein Produktbild auswählen.',
        400,
        'TRY_ON_REFERENCES_REQUIRED'
      );
    const input = parse(TRY_ON_INPUT, req.body);
    res.status(201).json({
      success: true,
      data: await createTryOnTask(
        owner(req),
        String(req.params.id),
        { ...input, instructions: input.instructions ?? '' },
        files.person[0],
        files.product[0]
      ),
    });
  })
);
router.post(
  '/artifacts/:id/audio',
  imageUpload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('WAV-Datei fehlt', 400, 'AUDIO_REQUIRED');
    res.status(201).json({
      success: true,
      data: await addMotionAudio(
        owner(req),
        String(req.params.id),
        parse(MOTION_AUDIO_INPUT, req.body),
        req.file
      ),
    });
  })
);
router.post(
  '/artifacts/:id/audio/remove',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await addMotionAudio(
        owner(req),
        String(req.params.id),
        parse(MOTION_AUDIO_INPUT, req.body),
        null
      ),
    })
  )
);
router.get(
  '/artifacts/:id/audio',
  handle(async (req, res) => {
    const revision = parse(z.coerce.number().int().positive(), req.query.revision);
    const artifact = await findResource(owner(req), String(req.params.id));
    const row = await get(
      'SELECT body_json FROM assistant_resource_revisions WHERE resource_id=? AND revision=?',
      artifact.id,
      revision
    );
    if (!row) throw new AppError('Revision nicht gefunden', 404, 'NOT_FOUND');
    const audio = await readMotionAudio(owner(req), JSON.parse(String(row.body_json)));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(audio.mimeType).send(audio.bytes);
  })
);
router.get(
  '/shared/:token/audio',
  handle(async (req, res) => {
    const hash = createHash('sha256').update(String(req.params.token)).digest('hex');
    const row = await get(
      `SELECT s.user_id,v.body_json FROM assistant_shares s JOIN assistant_resources r ON r.id=s.resource_id JOIN assistant_resource_revisions v ON v.resource_id=s.resource_id AND v.revision=s.revision
    WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND r.archived=0 AND r.kind='artifact'`,
      hash,
      new Date().toISOString()
    );
    if (!row) throw new AppError('Freigabe ist nicht verfügbar', 404, 'NOT_FOUND');
    const audio = await readMotionAudio(String(row.user_id), JSON.parse(String(row.body_json)));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(audio.mimeType).send(audio.bytes);
  })
);
router.post(
  '/artifacts/:id/images',
  imageUpload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Bild fehlt', 400, 'IMAGE_REQUIRED');
    res.status(201).json({
      success: true,
      data: await addDocumentImage(
        owner(req),
        String(req.params.id),
        parse(DOCUMENT_IMAGE_INPUT, req.body),
        req.file
      ),
    });
  })
);
router.post(
  '/tasks/:id/images',
  imageUpload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Bilddatei fehlt', 400, 'FILE_REQUIRED');
    const input = parse(
      z.object({ expectedRevision: z.coerce.number().int().positive() }).strict(),
      req.body
    );
    res.status(201).json({
      success: true,
      data: await uploadTaskImage(
        owner(req),
        String(req.params.id),
        input.expectedRevision,
        req.file
      ),
    });
  })
);
router.get(
  '/tasks/:id/images',
  handle(async (req, res) => {
    const input = parse(
      z.object({ revision: z.coerce.number().int().positive().optional() }).strict(),
      req.query
    );
    res.json({
      success: true,
      data: await taskImages(owner(req), String(req.params.id), input.revision),
    });
  })
);
router.get(
  '/tasks/:id/images/:asset',
  handle(async (req, res) => {
    const input = parse(
      z.object({ revision: z.coerce.number().int().positive().optional() }).strict(),
      req.query
    );
    const file = await taskImage(
      owner(req),
      String(req.params.id),
      String(req.params.asset),
      undefined,
      input.revision
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`
    );
    res.send(file.bytes);
  })
);
router.delete(
  '/tasks/:id/images/:asset',
  handle(async (req, res) => {
    const input = parse(
      z.object({ expectedRevision: z.coerce.number().int().positive() }).strict(),
      req.query
    );
    res.json({
      success: true,
      data: await removeTaskImage(
        owner(req),
        String(req.params.id),
        String(req.params.asset),
        input.expectedRevision
      ),
    });
  })
);
router.post(
  '/api-chats/:id/images',
  imageUpload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Bilddatei fehlt', 400, 'FILE_REQUIRED');
    res.status(201).json({
      success: true,
      data: await uploadApiImage(owner(req), String(req.params.id), req.file),
    });
  })
);
router.get(
  '/api-chats/:id/images',
  handle(async (req, res) =>
    res.json({ success: true, data: await apiChatImages(owner(req), String(req.params.id)) })
  )
);
router.get(
  '/api-chats/:id/images/:asset',
  handle(async (req, res) => {
    const file = await apiChatImage(owner(req), String(req.params.id), String(req.params.asset));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`
    );
    res.send(file.bytes);
  })
);
router.get(
  '/api-chat-usage',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() })
        .strict(),
      req.query
    );
    if (input.from && input.to && input.from >= input.to)
      throw new AppError('Ungültiger Zeitraum', 400, 'INVALID_WINDOW');
    res.json({ success: true, data: await apiUsage(owner(req), input.from, input.to) });
  })
);
router.get(
  '/api-chat-providers',
  handle(async (req, res) => res.json({ success: true, data: await apiChatProviders(owner(req)) }))
);
router.post(
  '/api-chats',
  handle(async (req, res) => {
    const input = parse(API_CHAT_INPUT, req.body);
    res.status(201).json({
      success: true,
      data: await createApiChat(owner(req), { ...input, sourceIds: input.sourceIds ?? [] }),
    });
  })
);
router.get(
  '/api-chats/:id/turns',
  handle(async (req, res) => {
    const { offset, beforeSeq } = parse(
      z.object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        beforeSeq: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      }),
      req.query
    );
    res.json({
      success: true,
      data: await apiChatTurns(owner(req), String(req.params.id), offset, beforeSeq),
    });
  })
);
router.post(
  '/api-chats/:id/turns',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await startApiTurn(owner(req), String(req.params.id), parse(API_TURN_INPUT, req.body)),
    })
  )
);
router.post(
  '/api-chats/:id/turns/:turn/stop',
  handle(async (req, res) => {
    await stopApiTurn(owner(req), String(req.params.id), String(req.params.turn));
    res.json({ success: true });
  })
);
router.post(
  '/api-chats/:id/turns/:turn/activate',
  handle(async (req, res) => {
    await activateApiTurnVersion(owner(req), String(req.params.id), String(req.params.turn));
    res.json({ success: true });
  })
);
router.post(
  '/api-chats/:id/meta',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          expectedRevision: z.number().int().positive(),
          title: z.string().trim().min(1).max(200).optional(),
          projectId: z.string().min(1).max(200).nullable().optional(),
        })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await updateApiChatMeta(owner(req), String(req.params.id), input),
    });
  })
);
router.post(
  '/projects/:id/delete',
  handle(async (req, res) => {
    res.json({ success: true, data: await deleteProject(owner(req), String(req.params.id)) });
  })
);
router.post(
  '/api-chats/:id/delete',
  handle(async (req, res) => {
    await deleteApiChat(owner(req), String(req.params.id));
    res.json({ success: true });
  })
);
router.post(
  '/api-chats/:id/branches',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          commandId: z.string().uuid(),
          turnId: z.string().uuid(),
          includeAnswer: z.boolean(),
        })
        .strict(),
      req.body
    );
    res.status(201).json({
      success: true,
      data: await branchApiChat(
        owner(req),
        String(req.params.id),
        input.turnId,
        input.includeAnswer,
        input.commandId
      ),
    });
  })
);
router.post(
  '/api-chats/:id/results',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          commandId: z.string().uuid(),
          turnId: z.string().uuid(),
          kind: z.enum(['document', 'task', 'memory', 'research']),
          goal: z.string().trim().min(1).max(50000).optional(),
        })
        .strict(),
      req.body
    );
    res.status(201).json({
      success: true,
      data: await materializeApiAnswer(owner(req), String(req.params.id), input),
    });
  })
);
router.patch(
  '/api-chats/:id',
  handle(async (req, res) => {
    const input = parse(
      API_CHAT_INPUT.omit({
        commandId: true,
        artifactEdit: true,
        workflow: true,
        temporary: true,
      }).extend({
        expectedRevision: z.number().int().positive(),
      }),
      req.body
    );
    res.json({
      success: true,
      data: await updateApiChat(owner(req), String(req.params.id), {
        ...input,
        sourceIds: input.sourceIds ?? [],
      }),
    });
  })
);
router.post(
  '/api-chats/:id/selection',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          commandId: z.string().uuid(),
          turnId: z.string().uuid(),
          replacement: z.string().max(50000),
        })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await applyApiSelection(owner(req), String(req.params.id), input),
    });
  })
);
router.post(
  '/app-frames',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          artifactId: z.string().max(200).optional(),
          shareToken: z.string().max(255).optional(),
          revision: z.number().int().positive().optional(),
          content: z.string().max(50000).optional(),
          channel: z.string().min(1).max(255),
          stateEnabled: z.boolean().default(false),
          actionsEnabled: z.boolean().default(false),
        })
        .strict()
        .refine((value) => !!value.artifactId !== !!value.shareToken),
      req.body
    );
    res.json({
      success: true,
      data: await createAppFrame(owner(req), {
        ...input,
        stateEnabled: input.stateEnabled ?? false,
      }),
    });
  })
);
router.post(
  '/artifacts/comparison',
  handle(async (req, res) => {
    const input = parse(
      z.object({ commandId: z.string().uuid(), title: z.string().trim().min(1).max(200) }).strict(),
      req.body
    );
    res.json({ success: true, data: await createComparison(owner(req), input) });
  })
);
router.post(
  '/references',
  handle(async (req, res) => {
    const input = parse(
      z.object({ ids: z.array(z.string().min(1).max(200)).max(1000) }).strict(),
      req.body
    );
    res.json({ success: true, data: await resourceReferences(owner(req), input.ids) });
  })
);
router.get(
  '/identity',
  handle(async (req, res) => {
    const instance = await get(
      "INSERT INTO app_config (key,value) VALUES ('plum_instance_id', ?) ON CONFLICT(key) DO UPDATE SET value = app_config.value RETURNING value",
      randomUUID()
    );
    res.json({ success: true, data: { instanceId: String(instance.value), userId: owner(req) } });
  })
);
router.get(
  '/search',
  handle(async (req, res) => {
    const input = parse(params, req.query);
    res.json({ success: true, data: await listResources(owner(req), undefined, input) });
  })
);
router.get(
  '/library-search',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          query: z.string().trim().min(2).max(200),
          category: z.enum(['all', 'library', 'chats', 'code']).default('all'),
          offset: z.coerce.number().int().min(0).max(10000).default(0),
        })
        .strict(),
      req.query
    );
    res.json({ success: true, data: await searchAssistantLibrary(owner(req), input) });
  })
);
router.post(
  '/sessions/:id/branches',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          messageId: z.string().min(1).max(200),
          includeMessage: z.boolean().default(true),
          title: z.string().trim().min(1).max(100),
        })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await branchConversation(owner(req), String(req.params.id), {
        ...input,
        includeMessage: input.includeMessage ?? true,
      }),
    });
  })
);
router.get(
  '/sessions/:id/profile',
  handle(async (req, res) => {
    const session = await get(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      req.params.id,
      owner(req)
    );
    if (!session) throw new AppError('Gespräch nicht gefunden', 404, 'NOT_FOUND');
    const binding = await get(
      'SELECT profile_id AS "profileId",profile_revision AS "profileRevision",project_id AS "projectId",temporary,temporary_expires_at AS "expiresAt" FROM assistant_session_bindings WHERE session_id = ?',
      session.id
    );
    res.json({
      success: true,
      data: binding ?? { profileId: null, profileRevision: null, projectId: null, temporary: 0 },
    });
  })
);
router.get(
  '/sources/:id/file',
  handle(async (req, res) => {
    const source = await findResource(owner(req), String(req.params.id));
    if (source.kind !== 'source' || !source.body.assetId)
      throw new AppError('Originaldatei nicht vorhanden', 404, 'NOT_FOUND');
    const input = parse(
      z.object({ revision: z.coerce.number().int().positive().optional() }).strict(),
      req.query
    );
    const version = input.revision
      ? await get(
          'SELECT body_json FROM assistant_resource_revisions WHERE resource_id = ? AND revision = ?',
          source.id,
          input.revision
        )
      : null;
    if (input.revision && !version)
      throw new AppError('Quellrevision nicht gefunden', 404, 'NOT_FOUND');
    const sourceBody = version ? JSON.parse(version.body_json) : source.body;
    const file = await get(
      'SELECT filename,mime_type,bytes FROM assistant_assets WHERE id = ? AND user_id = ?',
      sourceBody.assetId,
      owner(req)
    );
    if (!file) throw new AppError('Originaldatei nicht gefunden', 404, 'NOT_FOUND');
    res.setHeader('Content-Type', String(file.mime_type));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(String(file.filename))}`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.bytes);
  })
);
router.get(
  '/artifacts/:id/state',
  handle(async (req, res) => {
    const input = parse(
      z.object({ revision: z.coerce.number().int().positive() }).strict(),
      req.query
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      data: await assistantAppState(owner(req), String(req.params.id), input.revision),
    });
  })
);
router.post(
  '/sources/:id/office-artifact',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          commandId: z.string().uuid(),
          expectedRevision: z.number().int().positive(),
          sheet: z.number().int().nonnegative().max(19).optional(),
        })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await officeArtifact(owner(req), String(req.params.id), input),
    });
  })
);
router.patch(
  '/artifacts/:id/state',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          revision: z.number().int().positive(),
          expectedVersion: z.number().int().nonnegative(),
          state: z.unknown(),
        })
        .strict(),
      req.body
    );
    if (!Object.hasOwn(req.body, 'state'))
      throw new AppError('App-Eingaben fehlen', 400, 'APP_STATE_INVALID');
    res.json({
      success: true,
      data: await assistantAppState(owner(req), String(req.params.id), input.revision, {
        expectedVersion: input.expectedVersion,
        state: input.state,
      }),
    });
  })
);
router.get(
  '/artifacts/:id/export',
  handle(async (req, res) => {
    const resource = await findResource(owner(req), String(req.params.id));
    if (resource.kind !== 'artifact')
      throw new AppError('Ergebnis nicht gefunden', 404, 'NOT_FOUND');
    const input = parse(
      z
        .object({
          format: z.enum([
            'py',
            'md',
            'txt',
            'csv',
            'json',
            'tex',
            'html',
            'docx',
            'xlsx',
            'pptx',
            'pdf',
            'mp4',
            'png',
            'svg',
          ]),
          revision: z.coerce.number().int().positive().optional(),
        })
        .strict(),
      req.query
    );
    const version = input.revision
      ? await get(
          'SELECT revision,title,body_json FROM assistant_resource_revisions WHERE resource_id = ? AND revision = ?',
          resource.id,
          input.revision
        )
      : null;
    if (input.revision && !version) throw new AppError('Revision nicht gefunden', 404, 'NOT_FOUND');
    const snapshot = version
      ? {
          ...resource,
          title: String(version.title),
          revision: Number(version.revision),
          body: JSON.parse(version.body_json),
        }
      : resource;
    const output = await exportArtifact(snapshot, input.format, owner(req));
    res.setHeader('Content-Type', output.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${snapshot.title}.${input.format}`)}`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(output.data);
  })
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
router.post(
  '/datasets/import',
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 200000, files: 1 } }).single(
    'file'
  ),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Datensatz fehlt', 400, 'FILE_REQUIRED');
    const input = parse(
      z.object({ commandId: z.string().uuid(), format: z.enum(['csv', 'json']) }).strict(),
      req.body
    );
    res.status(201).json({
      success: true,
      data: await importDataset(owner(req), req.file, input.commandId, input.format),
    });
  })
);
router.get(
  '/voice/voices',
  handle(async (req, res) => {
    res.json({ success: true, data: await assistantVoices(owner(req)) });
  })
);
router.post(
  '/voice/speech',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          text: z.string().trim().min(1).max(5000),
          voice: z.string().trim().min(1).max(100).default('Rufus Beck'),
          language: z.string().max(80).default('German'),
        })
        .strict(),
      req.body
    );
    const audio = await assistantSpeech(owner(req), {
      text: input.text,
      voice: input.voice ?? 'Rufus Beck',
      language: input.language ?? 'German',
    });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(audio);
  })
);
router.post(
  '/voice/warmup',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          voice: z.string().trim().min(1).max(100).default('Rufus Beck'),
          language: z.string().max(80).default('German'),
        })
        .strict(),
      req.body ?? {}
    );
    res.json({
      success: true,
      data: await assistantVoiceWarmup(owner(req), {
        voice: input.voice ?? 'Rufus Beck',
        language: input.language ?? 'German',
      }),
    });
  })
);
router.post(
  '/voice/transcribe',
  upload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Audiodatei fehlt', 400, 'VALIDATION_ERROR');
    const input = parse(
      z.object({ language: z.string().max(80).default('de') }).strict(),
      req.body
    );
    res.json({
      success: true,
      data: await assistantTranscription(owner(req), req.file, input.language ?? 'de'),
    });
  })
);
router.post(
  '/meetings/import',
  upload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Audioaufnahme fehlt', 400, 'VALIDATION_ERROR');
    res.status(201).json({ success: true, data: await importMeeting(owner(req), req.file) });
  })
);
router.post(
  '/courses/:id/answers',
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await submitQuiz(owner(req), String(req.params.id), parse(QUIZ_ANSWER, req.body)),
    });
  })
);
router.get(
  '/meetings/:id/audio',
  handle(async (req, res) => {
    const meeting = await findResource(owner(req), String(req.params.id));
    if (meeting.kind !== 'meeting' || typeof meeting.body.audioAssetId !== 'string')
      throw new AppError('Audiooriginal nicht vorhanden', 404, 'NOT_FOUND');
    const asset = await get(
      'SELECT bytes,mime_type FROM assistant_assets WHERE id = ? AND user_id = ?',
      meeting.body.audioAssetId,
      owner(req)
    );
    if (!asset) throw new AppError('Audiooriginal nicht vorhanden', 404, 'NOT_FOUND');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', String(asset.mime_type));
    res.send(asset.bytes);
  })
);
router.post(
  '/sources/import',
  upload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Datei fehlt', 400, 'VALIDATION_ERROR');
    const input = parse(
      z.object({ projectId: z.string().min(1).max(200).optional() }).strict(),
      req.body
    );
    res
      .status(201)
      .json({ success: true, data: await ingestSource(owner(req), req.file, input.projectId) });
  })
);
router.get(
  '/matrix/import',
  handle(async (req, res) => {
    res.json({ success: true, data: await matrixImportStatus(owner(req)) });
  })
);
router.post(
  '/matrix/rooms/:id/import',
  handle(async (req, res) => {
    const input = parse(
      z.object({ pages: z.number().int().min(1).max(10).default(2) }).strict(),
      req.body
    );
    res.json({
      success: true,
      data: await matrixImportHistory(owner(req), String(req.params.id), input.pages ?? 2),
    });
  })
);
router.post(
  '/matrix/brian/conversation',
  handle(async (req, res) => {
    res.json({ success: true, data: await matrixBrianConversation(owner(req)) });
  })
);
router.put(
  '/matrix/account-data/:type',
  handle(async (req, res) => {
    const content = parse(z.record(z.unknown()), req.body);
    if (JSON.stringify(content).length > 50000)
      throw new AppError('Einstellungen sind zu gross', 400, 'VALIDATION_ERROR');
    await matrixSetAccountData(owner(req), String(req.params.type), content);
    res.json({ success: true });
  })
);
router.get(
  '/matrix/preferences',
  handle(async (req, res) => res.json({ success: true, data: await matrixPreferences(owner(req)) }))
);
router.post(
  '/matrix/preferences',
  handle(async (req, res) => {
    const input = parse(MATRIX_PREFERENCES_INPUT, req.body);
    res.json({
      success: true,
      data: await updateMatrixPreferences(owner(req), {
        ...input,
        changes: {
          ...input.changes,
          ...(input.changes.vorlagen
            ? {
                vorlagen: input.changes.vorlagen.map((v) => ({
                  ...v,
                  favorit: v.favorit ?? false,
                })),
              }
            : {}),
        },
      }),
    });
  })
);
router.post(
  '/matrix/rooms/:id/media',
  upload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Datei fehlt', 400, 'VALIDATION_ERROR');
    res.json({
      success: true,
      data: await matrixUpload(
        owner(req),
        String(req.params.id),
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      ),
    });
  })
);
router.get(
  '/matrix/rooms/:id/events/:eventId/media',
  handle(async (req, res) => {
    const media = await matrixDownload(
      owner(req),
      String(req.params.id),
      String(req.params.eventId)
    );
    res.setHeader('Content-Type', media.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(media.filename)}`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(media.data);
  })
);

router.post(
  '/sources/:id/import',
  upload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Quelldatei fehlt', 400, 'VALIDATION_ERROR');
    const input = parse(
      z.object({ expectedRevision: z.coerce.number().int().positive() }).strict(),
      req.body
    );
    res.json({
      success: true,
      data: await ingestSource(owner(req), req.file, undefined, {
        id: String(req.params.id),
        expectedRevision: input.expectedRevision,
      }),
    });
  })
);
router.get(
  '/matrix/status',
  handle(async (req, res) => {
    res.json({ success: true, data: await matrixStatus(owner(req)) });
  })
);
router.post(
  '/matrix/connect',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          username: z.string().min(1).max(200).optional(),
          password: z.string().min(1).max(1000).optional(),
          accessToken: z.string().min(1).max(4000).optional(),
        })
        .strict()
        .refine((v) => !!v.accessToken || !!(v.username && v.password)),
      req.body
    );
    res.json({ success: true, data: await connectMatrix(owner(req), input) });
  })
);
router.delete(
  '/matrix/connection',
  handle(async (req, res) => {
    await disconnectMatrix(owner(req));
    res.json({ success: true });
  })
);
router.get(
  '/matrix/rooms',
  handle(async (req, res) => {
    res.json({ success: true, data: await matrixRooms(owner(req)) });
  })
);
router.get(
  '/matrix/invitations',
  handle(async (req, res) => {
    res.json({ success: true, data: await matrixInvitations(owner(req)) });
  })
);
router.get(
  '/matrix/rooms/:id/members',
  handle(async (req, res) => {
    res.json({ success: true, data: await matrixMembers(owner(req), String(req.params.id)) });
  })
);
router.post(
  '/matrix/rooms/:id/membership',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          action: z.enum(['join', 'leave', 'invite']),
          nativeUserId: z.string().min(1).max(255),
          target: z
            .string()
            .max(255)
            .regex(/^@[^:\s]+:[^\s]+$/)
            .optional(),
        })
        .strict()
        .refine((value) => value.action !== 'invite' || !!value.target),
      req.body
    );
    res.json({
      success: true,
      data: await matrixMembership(owner(req), String(req.params.id), input),
    });
  })
);
router.get(
  '/matrix/account-data',
  handle(async (req, res) => {
    res.json({ success: true, data: await matrixAccountData(owner(req)) });
  })
);
router.get(
  '/matrix/rooms/:id/messages',
  handle(async (req, res) => {
    const options = parse(
      z.object({ from: z.string().max(1000).optional(), threadId: z.string().max(200).optional() }),
      req.query
    );
    res.json({
      success: true,
      data: await matrixMessages(owner(req), String(req.params.id), options),
    });
  })
);
router.get(
  '/matrix/rooms/:id/events/:eventId',
  handle(async (req, res) => {
    res.json({
      success: true,
      data: await matrixEvent(owner(req), String(req.params.id), String(req.params.eventId)),
    });
  })
);
router.post(
  '/matrix/rooms/:id/events',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({
          commandId: z.string().min(1).max(128),
          type: z.enum(['m.room.message', 'm.reaction', 'ch.zwaetschge.swarm.vorlesen']),
          nativeUserId: z.string().max(255).optional(),
          identityEpoch: z.string().max(128).optional(),
          content: z.record(z.unknown()),
        })
        .strict(),
      req.body
    );
    if (JSON.stringify(input.content).length > 50000)
      throw new AppError('Inhalt ist zu gross', 400, 'VALIDATION_ERROR');
    res.status(202).json({
      success: true,
      data: await matrixSend(
        owner(req),
        String(req.params.id),
        input.commandId,
        input.type,
        input.content,
        input.nativeUserId,
        input.identityEpoch
      ),
    });
  })
);
router.post(
  '/matrix/rooms/:id/read',
  handle(async (req, res) => {
    const input = parse(
      z
        .object({ eventId: z.string().min(1).max(200), threadId: z.string().max(200).optional() })
        .strict(),
      req.body
    );
    res.json({
      success: true,
      data: await matrixRead(owner(req), String(req.params.id), input.eventId, input.threadId),
    });
  })
);

router.get(
  '/overview',
  handle(async (req, res) => {
    if ((await matrixStatus(owner(req))).connected) await matrixSync(owner(req)).catch(() => null);
    const resources = await listResources(owner(req), undefined, { limit: 100 });
    const counts = await all(
      'SELECT kind, count(*) AS count FROM assistant_resources WHERE user_id = ? AND archived = 0 GROUP BY kind',
      owner(req)
    );
    res.json({
      success: true,
      data: {
        counts: Object.fromEntries(counts.map((row) => [row.kind, Number(row.count)])),
        tasks: await listResources(owner(req), 'task', { limit: 100 }),
        recent: resources.filter((r) => r.kind !== 'task').slice(0, 20),
        agents: await assistantAgents(owner(req)),
      },
    });
  })
);
async function cliAgents(userId: string) {
  const [providers, enabled] = await Promise.all([
    getProviderStatuses(),
    getEnabledCliProvidersForUser(userId),
  ]);
  return enabled.map((provider) => ({
    id: `cli:${provider}`,
    name: provider,
    source: 'cli',
    provider,
    available: providers[provider]?.installed ?? false,
    capabilities: ['conversation', 'attachments', 'tools', 'cancel', 'history'],
  }));
}
async function assistantAgents(userId: string) {
  const cli = await cliAgents(userId);
  const status = await matrixStatus(userId);
  if (!status.connected) return cli;
  const rooms = await matrixRooms(userId).catch(() => null);
  if (!rooms)
    return [
      ...cli,
      {
        id: 'matrix:unavailable',
        name: 'Schwarm-Verbindung',
        source: 'matrix',
        available: false,
        state: 'unreachable',
        capabilities: [],
      },
    ];
  const agents = new Map(rooms.flatMap((room) => room.agents).map((agent) => [agent.id, agent]));
  return [...cli, ...agents.values()];
}
router.get(
  '/agents',
  handle(async (req, res) => {
    res.json({ success: true, data: await assistantAgents(owner(req)) });
  })
);
router.get(
  '/swarm/directory',
  handle(async (req, res) => {
    res.json({ success: true, data: await swarmDirectory(owner(req)) });
  })
);
// Only containers the directory knows; the hub itself can be restarted, never stopped.
router.post(
  '/swarm/containers/:name/:action',
  requireAdmin,
  handle(async (req, res) => {
    const name = String(req.params.name);
    const action = z.enum(['start', 'stop', 'restart']).parse(req.params.action);
    if (!directoryContainers().has(name))
      throw new AppError('Container gehört nicht zum Schwarm', 404, 'NOT_FOUND');
    if (name === 'plum-swarm-coordinator' && action === 'stop')
      throw new AppError(
        'Den Hub stoppt der Not-Aus, nicht der Container',
        400,
        'VALIDATION_ERROR'
      );
    await dockerHost.containerAction(name, action);
    res.json({ success: true, data: { name, action } });
  })
);
router.post(
  '/sessions/:id/profile',
  handle(async (req, res) => {
    const body = parse(z.object({ profileId: z.string().min(1).nullable() }).strict(), req.body);
    await bindProfile(owner(req), String(req.params.id), body.profileId);
    res.json({ success: true, data: { sessionId: req.params.id, profileId: body.profileId } });
  })
);
router.get(
  '/sessions/:id/context',
  handle(async (req, res) => {
    const session = await get(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ?',
      req.params.id,
      owner(req)
    );
    if (!session) throw new AppError('Gespräch nicht gefunden', 404, 'NOT_FOUND');
    res.json({
      success: true,
      data: { context: await buildAssistantContext(String(req.params.id), owner(req)) },
    });
  })
);
router.get(
  '/tasks/:id/limits',
  handle(async (req, res) => {
    res.json({ success: true, data: await taskLimits(owner(req), String(req.params.id)) });
  })
);
router.post(
  '/tasks/:id/commands',
  handle(async (req, res) => {
    res.status(202).json({
      success: true,
      data: await executeTaskCommand(
        owner(req),
        String(req.params.id),
        parse(TASK_COMMAND, req.body)
      ),
    });
  })
);
router.get(
  '/tasks/:id/attempts',
  handle(async (req, res) => {
    res.json({ success: true, data: await taskAttempts(owner(req), String(req.params.id)) });
  })
);

router.get(
  '/export',
  handle(async (req, res) => {
    const options = parse(
      z
        .object({
          format: z.enum(['json', 'zip']).default('zip'),
          nativeMedia: z.enum(['true', 'false']).default('true'),
        })
        .strict(),
      req.query
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="plum-assistant-export.${options.format}"`
    );
    if (options.format === 'json') res.json(await assistantExportSnapshot(owner(req)));
    else {
      res.setHeader('Content-Type', 'application/zip');
      try {
        await streamAssistantExport(owner(req), res, options.nativeMedia !== 'false');
      } catch (error) {
        if (res.headersSent) {
          res.destroy();
        } else throw error;
      }
    }
  })
);
router.get(
  '/shares',
  handle(async (req, res) => {
    const rows = await all(
      'SELECT id,resource_id AS "resourceId",revision,expires_at AS "expiresAt",revoked,created_at AS "createdAt" FROM assistant_shares WHERE user_id = ? ORDER BY created_at DESC',
      owner(req)
    );
    res.json({ success: true, data: rows });
  })
);
router.post(
  '/shares',
  handle(async (req, res) => {
    const body = parse(
      z
        .object({
          resourceId: z.string().min(1),
          revision: z.number().int().positive(),
          expiresAt: z.string().datetime(),
        })
        .strict(),
      req.body
    );
    const resource = await findResource(owner(req), body.resourceId);
    if (!['artifact', 'project'].includes(resource.kind))
      throw new AppError(
        'Dieser Inhalt kann nicht als Ergebnis geteilt werden',
        400,
        'INVALID_SHARE'
      );
    if (
      Date.parse(body.expiresAt) <= Date.now() ||
      Date.parse(body.expiresAt) > Date.now() + 30 * 86400000
    )
      throw new AppError('Ablauf muss innerhalb von 30 Tagen liegen', 400, 'INVALID_EXPIRY');
    const version = await get(
      'SELECT revision FROM assistant_resource_revisions WHERE resource_id = ? AND revision = ?',
      resource.id,
      body.revision
    );
    if (!version) throw new AppError('Revision nicht gefunden', 404, 'NOT_FOUND');
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await run(
      'INSERT INTO assistant_shares (id, user_id, resource_id, revision, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      owner(req),
      resource.id,
      body.revision,
      createHash('sha256').update(token).digest('hex'),
      body.expiresAt,
      new Date().toISOString()
    );
    // Authenticated snapshot access: reverse proxy protection is intentionally retained.
    res.status(201).json({
      success: true,
      data: {
        id,
        token,
        path: `/api/assistant/shared/${token}`,
        viewPath: `/shared/${token}`,
        expiresAt: body.expiresAt,
      },
    });
  })
);
router.get(
  '/shared/:token',
  handle(async (req, res) => {
    const row = await get(
      `SELECT s.id, s.snapshot_json, r.kind, v.title, v.body_json, v.revision FROM assistant_shares s JOIN assistant_resources r ON r.id = s.resource_id
    JOIN assistant_resource_revisions v ON v.resource_id = s.resource_id AND v.revision = s.revision
    WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ? AND r.archived = 0`,
      createHash('sha256').update(String(req.params.token)).digest('hex'),
      new Date().toISOString()
    );
    if (!row) throw new AppError('Freigabe ist nicht verfügbar', 404, 'NOT_FOUND');
    res.json({
      success: true,
      data: {
        id: row.id,
        ...(row.snapshot_json ? JSON.parse(row.snapshot_json) : {}),
        kind: row.kind,
        title: row.title,
        revision: Number(row.revision),
        body: row.snapshot_json ? JSON.parse(row.snapshot_json).body : JSON.parse(row.body_json),
      },
    });
  })
);
router.delete(
  '/shares/:id',
  handle(async (req, res) => {
    const result = await run(
      'UPDATE assistant_shares SET revoked = 1 WHERE id = ? AND user_id = ?',
      req.params.id,
      owner(req)
    );
    if (!result.changes) throw new AppError('Freigabe nicht gefunden', 404, 'NOT_FOUND');
    res.json({ success: true });
  })
);

router.get(
  '/:collection',
  handle(async (req, res) => {
    const options = parse(params, req.query);
    const kind = kindFor(String(req.params.collection));
    let nativeSyncError: string | undefined;
    if (kind === 'task' && (await matrixStatus(owner(req))).connected)
      await matrixSync(owner(req)).catch(() => {
        nativeSyncError =
          'Schwarm nicht erreichbar; angezeigter Stand stammt aus der letzten Synchronisierung.';
      });
    res.json({
      success: true,
      data: await listResources(owner(req), kind, options),
      ...(nativeSyncError ? { nativeSyncError } : {}),
      pagination: { offset: options.offset, limit: options.limit },
    });
  })
);
router.post(
  '/:collection',
  handle(async (req, res) => {
    const kind = kindFor(String(req.params.collection));
    const input = parse(envelope, req.body);
    const body = parse(BODY_SCHEMAS[kind], input.body) as Record<string, unknown>;
    if (kind === 'memory') {
      body.learned = false;
      body.pinned = true;
      body.state = 'active';
      body.origins = [];
    }
    const resource = await createResource(owner(req), kind, input.title, body);
    res.status(201).json({ success: true, data: resource });
  })
);
router.get(
  '/:collection/:id/versions',
  handle(async (req, res) => {
    const resource = await findResource(owner(req), String(req.params.id));
    if (resource.kind !== kindFor(String(req.params.collection)))
      throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
    const versions = await all(
      'SELECT revision, title, body_json, created_at FROM assistant_resource_revisions WHERE resource_id = ? ORDER BY revision DESC LIMIT 100',
      resource.id
    );
    res.json({
      success: true,
      data: versions.map((row) => ({
        revision: Number(row.revision),
        title: row.title,
        body: JSON.parse(row.body_json),
        createdAt: row.created_at,
      })),
    });
  })
);
router.get(
  '/:collection/:id',
  handle(async (req, res) => {
    const resource = await findResource(owner(req), String(req.params.id));
    if (resource.kind !== kindFor(String(req.params.collection)))
      throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
    const input = parse(
      z.object({ revision: z.coerce.number().int().positive().optional() }).strict(),
      req.query
    );
    const version = input.revision
      ? await get(
          'SELECT revision,title,body_json,created_at FROM assistant_resource_revisions WHERE resource_id = ? AND revision = ?',
          resource.id,
          input.revision
        )
      : null;
    if (input.revision && !version) throw new AppError('Revision nicht gefunden', 404, 'NOT_FOUND');
    res.json({
      success: true,
      data: version
        ? {
            ...resource,
            title: String(version.title),
            body: JSON.parse(version.body_json),
            revision: Number(version.revision),
            updatedAt: String(version.created_at),
          }
        : resource,
    });
  })
);
router.patch(
  '/:collection/:id',
  handle(async (req, res) => {
    const kind = kindFor(String(req.params.collection));
    const current = await findResource(owner(req), String(req.params.id));
    if (current.kind !== kind) throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
    const input = parse(envelope, req.body);
    if (!input.expectedRevision) throw new AppError('Revision fehlt', 400, 'REVISION_REQUIRED');
    if (kind === 'task' && current.body.status !== 'draft')
      throw new AppError(
        'Laufende Aufträge über ihre Befehle ändern',
        409,
        'TASK_COMMAND_REQUIRED'
      );
    const parsedBody = parse(BODY_SCHEMAS[kind], input.body) as Record<string, unknown>;
    const body =
      kind === 'source' && current.body.assetId
        ? {
            ...parsedBody,
            assetId: current.body.assetId,
            sha256: current.body.sha256,
            filename: current.body.filename,
            pageCount: current.body.pageCount,
            truncated: current.body.truncated,
            textEdited: true,
            pages: current.body.text === parsedBody.text ? current.body.pages : [],
            ingestedAt: current.body.ingestedAt,
            office: current.body.office,
            ...(current.body.capture ? { capture: current.body.capture } : {}),
          }
        : kind === 'task'
          ? {
              ...parsedBody,
              inputImageIds: current.body.inputImageIds ?? [],
              ...(current.body.imageEdit ? { imageEdit: current.body.imageEdit } : {}),
              ...(current.body.imageTryOn ? { imageTryOn: current.body.imageTryOn } : {}),
            }
          : kind === 'course'
            ? { ...parsedBody, attempts: current.body.attempts ?? [] }
            : kind === 'memory'
              ? { ...parsedBody, origins: current.body.origins ?? [], pinned: true }
              : parsedBody;
    await checkReferences(owner(req), body);
    res.json({
      success: true,
      data: await transaction(async (tx) => {
        const result = await reviseResource(
          owner(req),
          current.id,
          input.expectedRevision!,
          input.title,
          body,
          tx
        );
        if (
          kind === 'source' &&
          current.body.capture === 'public-web' &&
          (current.body.text !== body.text || current.body.url !== body.url)
        )
          await tx.run(
            'UPDATE assistant_source_watches SET enabled=0,revision=revision+1,error=NULL,updated_at=? WHERE source_id=? AND user_id=?',
            new Date().toISOString(),
            current.id,
            owner(req)
          );
        return result;
      }),
    });
  })
);
router.delete(
  '/:collection/:id',
  handle(async (req, res) => {
    const resource = await findResource(owner(req), String(req.params.id));
    if (resource.kind !== kindFor(String(req.params.collection)))
      throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
    const body = parse(
      z.object({ expectedRevision: z.number().int().positive() }).strict(),
      req.body
    );
    if (
      resource.kind === 'api-chat' &&
      (await get(
        "SELECT id FROM assistant_api_turns WHERE chat_id=? AND status='running' AND expires_at>?",
        resource.id,
        new Date().toISOString()
      ))
    )
      throw new AppError('Die aktuelle Antwort zuerst stoppen', 409, 'API_CHAT_BUSY');
    if (resource.kind === 'task' && ['running', 'queued'].includes(String(resource.body.status)))
      throw new AppError('Auftrag zuerst abbrechen', 409, 'TASK_RUNNING');
    await archiveResource(owner(req), resource.id, body.expectedRevision);
    res.json({ success: true });
  })
);
export default router;
