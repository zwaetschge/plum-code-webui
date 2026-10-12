import { Router, type Request, type NextFunction, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { createHash } from 'node:crypto';
import {
  officeSession,
  redeemOfficeTicket,
  disconnectOffice,
  officeCommandId,
  assertOfficeChat,
  createOfficeTask,
} from '../services/assistant/officeSessions.js';
import { apiChatProviders } from '../services/assistant/apiTransport.js';
import {
  API_CHAT_INPUT,
  API_TURN_INPUT,
  createApiChat,
  apiChatTurns,
  startApiTurn,
  stopApiTurn,
} from '../services/assistant/apiChats.js';
const router = Router();
const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch((error) =>
      next(
        error instanceof z.ZodError
          ? new AppError('Ungültige Office-Anfrage', 400, 'VALIDATION_ERROR')
          : error
      )
    );
  };
function token(req: Request) {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer plum_office_'))
    throw new AppError('Office-Verbindung fehlt', 401, 'OFFICE_AUTH_REQUIRED');
  return value.slice(7);
}
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});
router.post(
  '/redeem',
  handle(async (req, res) => {
    const input = z
      .object({
        ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict()
      .parse(req.body);
    res.json({ success: true, data: await redeemOfficeTicket(input.ticket, input.verifier) });
  })
);
router.get(
  '/providers',
  handle(async (req, res) => {
    const session = await officeSession(token(req));
    res.json({ success: true, data: await apiChatProviders(session.userId) });
  })
);
router.post(
  '/tasks',
  handle(async (req, res) => {
    const session = await officeSession(token(req));
    const input = z
      .object({
        commandId: z.string().uuid(),
        original: z.string().min(1).max(12000),
        instruction: z.string().min(1).max(1000),
      })
      .strict()
      .parse(req.body);
    res.status(201).json({ success: true, data: await createOfficeTask(session, input) });
  })
);
router.post(
  '/chats',
  handle(async (req, res) => {
    const session = await officeSession(token(req));
    const input = z
      .object({
        commandId: z.string().uuid(),
        providerId: z.string().max(100),
        model: z.string().max(200),
      })
      .strict()
      .parse(req.body);
    const commandId = officeCommandId(session, input.commandId),
      hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = session.creations.get(commandId);
    if (prior && prior.hash !== hash)
      throw new AppError('Befehlskennung hat anderen Inhalt', 409, 'COMMAND_CONFLICT');
    if (!prior && session.creations.size >= 8)
      throw new AppError(
        'Office-Verbindung enthält bereits acht Gespräche; neu verbinden',
        429,
        'OFFICE_CAPACITY'
      );
    if (!prior) {
      const promise = createApiChat(
        session.userId,
        API_CHAT_INPUT.parse({
          ...input,
          commandId,
          title: 'Office · Textauswahl',
          temporary: true,
          sourceIds: [],
        })
      )
        .then(async (chat) => {
          await officeSession(token(req));
          session.chats.add(chat.id);
          return chat;
        })
        .catch((error) => {
          session.creations.delete(commandId);
          throw error;
        });
      session.creations.set(commandId, { hash, promise });
    }
    const chat = await session.creations.get(commandId)!.promise;
    res.status(201).json({ success: true, data: chat });
  })
);
router.get(
  '/chats/:id',
  handle(async (req, res) => {
    const session = await officeSession(token(req));
    const id = String(req.params.id);
    assertOfficeChat(session, id);
    res.json({ success: true, data: await apiChatTurns(session.userId, id) });
  })
);
router.post(
  '/chats/:id/turns',
  handle(async (req, res) => {
    const session = await officeSession(token(req));
    const id = String(req.params.id);
    assertOfficeChat(session, id);
    const input = API_TURN_INPUT.parse(req.body);
    if (input.imageAssetIds?.length)
      throw new AppError(
        'Office-Textdialog übernimmt nur die ausgewählte Textstelle',
        400,
        'OFFICE_TEXT_ONLY'
      );
    if (session.closing)
      throw new AppError('Office-Verbindung wurde beendet', 401, 'OFFICE_AUTH_REQUIRED');
    const promise = startApiTurn(session.userId, id, {
      ...input,
      commandId: officeCommandId(session, input.commandId),
    });
    session.starts.add(promise);
    let turn;
    try {
      turn = await promise;
    } finally {
      session.starts.delete(promise);
    }
    if (session.closing) {
      await stopApiTurn(session.userId, id, turn.id);
      throw new AppError('Office-Verbindung wurde beendet', 401, 'OFFICE_AUTH_REQUIRED');
    }
    res.status(202).json({ success: true, data: turn });
  })
);
router.post(
  '/chats/:id/stop',
  handle(async (req, res) => {
    const session = await officeSession(token(req));
    const id = String(req.params.id);
    assertOfficeChat(session, id);
    const input = z.object({ turnId: z.string().uuid() }).strict().parse(req.body);
    res.json({ success: true, data: await stopApiTurn(session.userId, id, input.turnId) });
  })
);
router.post(
  '/disconnect',
  handle(async (req, res) => {
    await disconnectOffice(token(req));
    res.json({ success: true });
  })
);
export default router;
