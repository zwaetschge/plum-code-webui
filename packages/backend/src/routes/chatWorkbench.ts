import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { all, get, transaction } from '../db/pg.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { CHAT_OPTIONS } from '../services/assistant/chatOptions.js';
import { findResource, reviseResource } from '../services/assistant/resources.js';
import { ingestSource } from '../services/assistant/ingestion.js';
import { exportChat, importChats, shareChat } from '../services/assistant/chatPortability.js';
import { apiChatEndpoint } from '../services/assistant/apiTransport.js';

export const chatWorkbenchRouter = Router();
const router = chatWorkbenchRouter;
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 4 },
});
async function chat(userId: string, id: string) {
  const resource = await findResource(userId, id);
  if (resource.kind !== 'api-chat') throw new AppError('Chat nicht gefunden', 404, 'NOT_FOUND');
  if (resource.body.temporary && Date.parse(String(resource.body.expiresAt)) <= Date.now())
    throw new AppError('Gespräch abgelaufen', 410, 'TEMPORARY_EXPIRED');
  return resource;
}
router.put(
  '/api-chats/:id/options',
  handle(async (req, res) => {
    await chat(owner(req), String(req.params.id));
    const input = z
        .object({ expectedRevision: z.number().int().positive(), options: CHAT_OPTIONS })
        .strict()
        .parse(req.body),
      userId = owner(req),
      id = String(req.params.id);
    for (const candidate of input.options.comparisonModels)
      await apiChatEndpoint(userId, candidate.providerId, candidate.model);
    const updated = await transaction(async (tx) => {
      await tx.get(
        'SELECT id FROM assistant_resources WHERE id=? AND user_id=? FOR UPDATE',
        id,
        userId
      );
      const current = await findResource(userId, id, tx);
      if (current.kind !== 'api-chat') throw new AppError('Chat nicht gefunden', 404, 'NOT_FOUND');
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
