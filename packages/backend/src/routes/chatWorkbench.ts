import { apiChatImage } from '../services/assistant/apiFiles.js';
import { artifactToolFile } from '../services/assistant/chatToolAssets.js';
import { chatSchedules, saveChatSchedule, runChatSchedule, removeChatSchedule } from '../services/assistant/chatSchedules.js';
import { libraryWorkbenchRouter } from './libraryWorkbench.js';
import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { all, get, transaction } from '../db/pg.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { CHAT_OPTIONS } from '../services/assistant/chatOptions.js';
import { findResource, reviseResource, RESOURCE_KINDS } from '../services/assistant/resources.js';
import { ingestSource } from '../services/assistant/ingestion.js';
import { exportChat, importChats, shareChat } from '../services/assistant/chatPortability.js';
import { apiChatEndpoint } from '../services/assistant/apiTransport.js';
import { chatToolset } from '../services/assistant/chatTools.js';
import { decideChatToolApproval } from '../services/assistant/chatToolApprovals.js';
import { selectedChatSkills } from '../services/assistant/chatSkills.js';
import {
  memoryTopics,
  memoryTopic,
  forgetMemoryTopic,
} from '../services/assistant/memoryTopics.js';
import { resourceRevisionDiff } from '../services/assistant/revisionDiff.js';
import {
  BULK_CHAT_INPUT,
  bulkManageChats,
  managedChats,
} from '../services/assistant/chatManagement.js';

export const chatWorkbenchRouter = Router();
const router = chatWorkbenchRouter;
router.use(libraryWorkbenchRouter);
const owner = (req: Request) => (req as AuthenticatedRequest).userId;
const handle =
  (fn: (req: Request, res: import('express').Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res).catch((error) =>
      next(
        error instanceof z.ZodError
          ? new AppError('Ungültige Chat-Daten', 400, 'VALIDATION_ERROR')
          : error
      )
    );
  };
router.get('/api-chats/:id/tool-files/:assetId', handle(async (req, res) => {
  const file = await apiChatImage(owner(req), String(req.params.id), String(req.params.assetId));
  res.setHeader('Content-Type', file.mimeType); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(file.bytes);
}));
router.get('/artifacts/:id/tool-files/:assetId', handle(async (req, res) => {
  const file = await artifactToolFile(owner(req), String(req.params.id), String(req.params.assetId));
  res.setHeader('Content-Type', String(file.mime_type)); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(String(file.filename))}`); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(file.bytes);
}));
router.get('/chat-schedules', handle(async (req, res) => res.json({ success: true, data: await chatSchedules(owner(req), z.string().optional().parse(req.query.chatId)) })));
router.post('/chat-schedules', handle(async (req, res) => res.json({ success: true, data: await saveChatSchedule(owner(req), req.body) })));
router.put('/chat-schedules/:id', handle(async (req, res) => res.json({ success: true, data: await saveChatSchedule(owner(req), req.body, String(req.params.id)) })));
router.post('/chat-schedules/:id/run', handle(async (req, res) => res.json({ success: true, data: await runChatSchedule(owner(req), String(req.params.id), z.string().uuid().parse(req.body.commandId)) })));
router.delete('/chat-schedules/:id', handle(async (req, res) => res.json({ success: true, data: await removeChatSchedule(owner(req), String(req.params.id), z.number().int().positive().parse(req.body.expectedRevision)) })));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 4 },
});
router.get(
  '/api-chats/manage',
  handle(async (req, res) => {
    const input = z
      .object({
        archived: z.enum(['true', 'false']).default('false'),
        search: z.string().max(200).default(''),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse(req.query);
    res.json({
      success: true,
      data: await managedChats(owner(req), input.archived === 'true', input.search, input.offset),
    });
  })
);
router.post(
  '/api-chats/bulk',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await bulkManageChats(owner(req), BULK_CHAT_INPUT.parse(req.body)),
    })
  )
);
router.get(
  '/revision-diff/:collection/:id',
  handle(async (req, res) => {
    const collection = String(req.params.collection) as keyof typeof RESOURCE_KINDS;
    if (!Object.hasOwn(RESOURCE_KINDS, collection))
      throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
    const input = z
      .object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() })
      .parse(req.query);
    res.json({
      success: true,
      data: await resourceRevisionDiff(
        owner(req),
        collection,
        String(req.params.id),
        input.from,
        input.to
      ),
    });
  })
);
router.get(
  '/memory-system/topics',
  handle(async (req, res) => {
    const input = z
      .object({
        search: z.string().max(200).default(''),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse(req.query);
    res.json({ success: true, data: await memoryTopics(owner(req), input.search, input.offset) });
  })
);
router.get(
  '/memory-system/topics/:topic',
  handle(async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.topic);
    const { offset } = z
      .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
      .parse(req.query);
    res.json({ success: true, data: await memoryTopic(owner(req), id, offset) });
  })
);
router.delete(
  '/memory-system/topics/:topic',
  handle(async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.topic);
    const { expectedVersion } = z
      .object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    res.json({ success: true, data: await forgetMemoryTopic(owner(req), id, expectedVersion) });
  })
);
async function chat(userId: string, id: string) {
  const resource = await findResource(userId, id);
  if (resource.kind !== 'api-chat') throw new AppError('Chat nicht gefunden', 404, 'NOT_FOUND');
  if (resource.body.temporary && Date.parse(String(resource.body.expiresAt)) <= Date.now())
    throw new AppError('Gespräch abgelaufen', 410, 'TEMPORARY_EXPIRED');
  return resource;
}
router.post(
  '/api-chat-tools/catalog',
  handle(async (req, res) => {
    const options = CHAT_OPTIONS.parse(req.body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const tools = await chatToolset(
        owner(req),
        { ...options, skillNames: [] },
        controller.signal
      );
      try {
        res.json({ success: true, data: tools.catalog });
      } finally {
        tools.close();
      }
    } finally {
      clearTimeout(timer);
    }
  })
);
router.post(
  '/api-chats/:id/turns/:turn/tools/:call/decision',
  handle(async (req, res) => {
    await chat(owner(req), String(req.params.id));
    const { decision } = z
      .object({ decision: z.enum(['allow', 'deny']) })
      .strict()
      .parse(req.body);
    res.json({
      success: true,
      data: await decideChatToolApproval(
        owner(req),
        String(req.params.id),
        String(req.params.turn),
        String(req.params.call),
        decision
      ),
    });
  })
);
router.put(
  ['/api-chats/:id/options', '/profiles/:id/options'],
  handle(async (req, res) => {
    const profileMode = req.path.startsWith('/profiles/');
    if (!profileMode) await chat(owner(req), String(req.params.id));
    const input = z
        .object({ expectedRevision: z.number().int().positive(), options: CHAT_OPTIONS })
        .strict()
        .parse(req.body),
      userId = owner(req),
      id = String(req.params.id);
    for (const candidate of input.options.comparisonModels)
      await apiChatEndpoint(userId, candidate.providerId, candidate.model);
    await selectedChatSkills(input.options.skillNames);
    const updated = await transaction(async (tx) => {
      await tx.get(
        'SELECT id FROM assistant_resources WHERE id=? AND user_id=? FOR UPDATE',
        id,
        userId
      );
      const current = await findResource(userId, id, tx);
      if (current.kind !== (profileMode ? 'profile' : 'api-chat'))
        throw new AppError('Eintrag nicht gefunden', 404, 'NOT_FOUND');
      if (
        await tx.get(
          "SELECT id FROM assistant_api_turns WHERE chat_id=? AND status='running' AND expires_at>?",
          id,
          new Date().toISOString()
        )
      )
        throw new AppError('Antwort zuerst stoppen', 409, 'API_CHAT_BUSY');
      return reviseResource(
        userId,
        id,
        input.expectedRevision,
        current.title,
        { ...current.body, chatOptions: input.options },
        tx
      );
    });
    res.json({ success: true, data: updated });
  })
);
router.post(
  '/api-chats/:id/documents',
  upload.single('file'),
  handle(async (req, res) => {
    const current = await chat(owner(req), String(req.params.id));
    if (!req.file) throw new AppError('Datei fehlt', 400, 'FILE_REQUIRED');
    const source = await ingestSource(
      owner(req),
      req.file,
      undefined,
      undefined,
      current.body.temporary ? { temporaryChatId: current.id } : undefined
    );
    res.status(201).json({
      success: true,
      data: {
        id: source.id,
        title: source.title,
        revision: source.revision,
        pageCount: source.body.pageCount,
        truncated: source.body.truncated,
      },
    });
  })
);
router.get(
  '/api-chats/:id/export',
  handle(async (req, res) => {
    const archive = await exportChat(owner(req), String(req.params.id));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="plum-chat.json"');
    res.json(archive);
  })
);
router.get(
  '/api-chats/:id/import-archive',
  handle(async (req, res) => {
    const current = await chat(owner(req), String(req.params.id));
    const asset = await get(
      'SELECT bytes FROM assistant_assets WHERE id=? AND user_id=?',
      String(current.body.importArchiveAssetId ?? ''),
      owner(req)
    );
    if (!asset) throw new AppError('Kein Importarchiv vorhanden', 404, 'NOT_FOUND');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="original-chat-import.json"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(asset.bytes);
  })
);
router.post(
  '/api-chats/import',
  upload.single('file'),
  handle(async (req, res) => {
    if (!req.file) throw new AppError('Archiv fehlt', 400, 'FILE_REQUIRED');
    const input = z
      .object({ providerId: z.string().min(1).max(200), model: z.string().min(1).max(200) })
      .strict()
      .parse(req.body);
    res.status(201).json({
      success: true,
      data: await importChats(owner(req), req.file.buffer, input.providerId, input.model),
    });
  })
);
router.post(
  '/api-chats/:id/share',
  handle(async (req, res) =>
    res
      .status(201)
      .json({ success: true, data: await shareChat(owner(req), String(req.params.id)) })
  )
);
router.get(
  '/api-chats/:id/shares',
  handle(async (req, res) => {
    await chat(owner(req), String(req.params.id));
    res.json({
      success: true,
      data: await all(
        'SELECT id,expires_at AS "expiresAt",revoked FROM assistant_shares WHERE user_id=? AND resource_id=? ORDER BY created_at DESC',
        owner(req),
        req.params.id
      ),
    });
  })
);
