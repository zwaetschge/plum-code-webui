import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  libraryAccess,
  libraryFile,
  sharedLibraries,
  libraryMembers,
  changeLibraryMember,
  writeLibrary,
  readableSource,
} from '../services/assistant/libraryAccess.js';
import {
  createApiChat,
  API_CHAT_INPUT,
  startApiTurn,
  API_TURN_INPUT,
} from '../services/assistant/apiChats.js';
import { createHash } from 'node:crypto';

export const libraryWorkbenchRouter = Router();
const router = libraryWorkbenchRouter;
const owner = (req: Request) => (req as AuthenticatedRequest).userId;
const handle =
  (fn: (req: Request, res: import('express').Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res).catch((error) =>
      next(
        error instanceof z.ZodError
          ? new AppError('Ungültige Bibliotheksdaten', 400, 'VALIDATION_ERROR')
          : error
      )
    );
  };
router.get(
  '/libraries/shared',
  handle(async (req, res) => {
    const offset = z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset);
    res.json({ success: true, data: await sharedLibraries(owner(req), offset) });
  })
);
router.get(
  '/libraries/:id/access',
  handle(async (req, res) =>
    res.json({ success: true, data: await libraryAccess(owner(req), String(req.params.id)) })
  )
);
router.get(
  '/libraries/:id/members',
  handle(async (req, res) =>
    res.json({ success: true, data: await libraryMembers(owner(req), String(req.params.id)) })
  )
);
router.put(
  '/libraries/:id/members',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await changeLibraryMember(owner(req), String(req.params.id), req.body),
    })
  )
);
router.put(
  '/libraries/:id/content',
  handle(async (req, res) =>
    res.json({
      success: true,
      data: await writeLibrary(owner(req), String(req.params.id), req.body),
    })
  )
);
router.get(
  '/sources/:id',
  handle(async (req, res) => {
    const revision = z.coerce.number().int().positive().optional().parse(req.query.revision);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      data: (await readableSource(owner(req), String(req.params.id), undefined, revision)).resource,
    });
  })
);
router.get(
  '/sources/:id/file',
  handle(async (req, res) => {
    const revision = z.coerce.number().int().positive().optional().parse(req.query.revision);
    const file = await libraryFile(owner(req), String(req.params.id), revision);
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
router.post(
  '/libraries/:id/chat',
  handle(async (req, res) => {
    const input = z
      .object({
        commandId: z.string().uuid(),
        providerId: z.string().min(1).max(200),
        model: z.string().min(1).max(200),
        sourceIds: z.array(z.string().max(200)).min(1).max(20),
        prompt: z.string().trim().min(1).max(12000),
      })
      .strict()
      .parse(req.body);
    const access = await libraryAccess(owner(req), String(req.params.id));
    const allowed =
      access.resource.kind === 'source'
        ? [access.resource.id]
        : ((access.resource.body.resourceIds as string[]) ?? []);
    if (input.sourceIds.some((id) => !allowed.includes(id)))
      throw new AppError('Quelle gehört nicht zum Notebook', 400, 'INVALID_REFERENCE');
    for (const id of input.sourceIds) await readableSource(owner(req), id);
    const chat = await createApiChat(
      owner(req),
      API_CHAT_INPUT.parse({
        commandId: input.commandId,
        title: `${access.resource.title}: ${input.prompt}`.slice(0, 200),
        providerId: input.providerId,
        model: input.model,
        sourceIds: input.sourceIds,
        memoryRead: false,
        memoryLearn: false,
      })
    );
    const hex = createHash('sha256')
      .update('notebook-turn:' + input.commandId)
      .digest('hex');
    const commandId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    // Notes are intentionally not copied into an implicit system prompt; selected source revisions supply the evidence.
    await startApiTurn(
      owner(req),
      chat.id,
      API_TURN_INPUT.parse({ commandId, expectedRevision: chat.revision, prompt: input.prompt })
    );
    res.json({ success: true, data: chat });
  })
);
