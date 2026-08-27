import { get as pgGet } from '../db/pg.js';
import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  SessionPresenceSnapshot,
  SessionSendAck,
  SessionSendPayload,
} from '@plum-code-webui/shared';
import { config } from '../config.js';
import { ClaudeProcessManager } from '../services/claude/ClaudeProcessManager.js';
import { getRunnerAccessDecision } from '../utils/runnerAccess.js';
import {
  claimMessageDelivery,
  finishMessageDelivery,
  hashDeliveryPayload,
} from '../services/messageDelivery.js';
import {
  ChatUploadError,
  MAX_CHAT_UPLOAD_FILES,
  MAX_CHAT_UPLOAD_TOTAL_BYTES,
  releaseChatUploadReservations,
  resolveChatUploads,
} from '../services/chatUploads.js';
import { getSessionSyncState, resolveSessionSendChatId } from '../services/sessionSync.js';

// Per-socket token bucket for message-send events.
// Each socket gets WS_MSG_BURST tokens that refill at WS_MSG_RATE per second.
const WS_MSG_BURST = 10;
const WS_MSG_RATE = 0.5; // 0.5 tokens/sec → steady-state ~30 msg/min

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

function makeBucket(): TokenBucket {
  return { tokens: WS_MSG_BURST, lastRefill: Date.now() };
}

function takeToken(bucket: TokenBucket): boolean {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(WS_MSG_BURST, bucket.tokens + elapsed * WS_MSG_RATE);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function decodedBase64ByteSize(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

type SessionSendAcknowledge = (result: SessionSendAck) => void;

interface SendReceipt {
  payloadHash: string;
  promise: Promise<SessionSendAck>;
}

// Authorization helper: owner OR admin may access a session.
// Returns false on any DB error (fail-closed).
async function canAccessSession(sessionId: string, userId: string): Promise<boolean> {
  if (!sessionId || !userId) return false;
  try {
    const row = await pgGet(
      `SELECT 1 FROM sessions s
         WHERE s.id = ?
           AND (s.user_id = ? OR EXISTS (
             SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'admin'
           ))`,
      sessionId,
      userId,
      userId
    );
    return !!row;
  } catch (err) {
    console.error(
      `[WS] canAccessSession check failed sessionId=${sessionId} userId=${userId}:`,
      err
    );
    return false;
  }
}

async function ownsSession(sessionId: string, userId: string): Promise<boolean> {
  if (!sessionId || !userId) return false;
  try {
    return !!(await pgGet(
      `SELECT 1 FROM sessions WHERE id = ? AND user_id = ?`,
      sessionId,
      userId
    ));
  } catch {
    return false;
  }
}

// Authorization helper for write/control operations: owner ONLY (no admin bypass).
// Admins may observe (subscribe/reconnect via canAccessSession) but must not drive
// someone else's session. ProcessManager enforces the same rule downstream; this
// is the outer layer so unauthorized writes never touch in-memory state like
// pendingModes (which sits upstream of startSession's DB check).
async function controlDenialReason(sessionId: string, userId: string): Promise<string | null> {
  if (!sessionId || !userId) return 'Runner authorization failed';
  try {
    const row = (await pgGet(`SELECT user_id FROM sessions WHERE id = ?`, sessionId)) as unknown as
      | { user_id: string }
      | undefined;
    if (!row || row.user_id !== userId) return 'Forbidden: session not owned';

    const runnerAccess = await getRunnerAccessDecision(userId);
    return runnerAccess.allowed ? null : runnerAccess.reason || 'Runner access denied';
  } catch (err) {
    console.error(
      `[WS] canControlSession check failed sessionId=${sessionId} userId=${userId}:`,
      err
    );
    return 'Runner authorization failed';
  }
}

// Module-level processManager reference for external access
let _processManager: ClaudeProcessManager | null = null;
let _io: Server | null = null;

async function isActiveUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const row = await pgGet(`SELECT 1 FROM users WHERE id = ? AND status = 'active'`, userId);
    return !!row;
  } catch {
    return false;
  }
}

export function getProcessManager(): ClaudeProcessManager {
  if (!_processManager) {
    throw new Error('ProcessManager not initialized. Call setupWebSocket first.');
  }
  return _processManager;
}

/** Immediately revoke live sockets and stop active CLI sessions for a user. */
export async function disconnectUserSockets(userId: string): Promise<number> {
  if (!_io || !userId) return 0;

  let disconnected = 0;
  for (const socket of _io.sockets.sockets.values()) {
    if (socket.data.userId !== userId) continue;
    disconnected += 1;
    socket.disconnect(true);
  }

  if (_processManager) {
    for (const sessionId of _processManager.getRunningSessionIds()) {
      try {
        const owner = (await pgGet(
          'SELECT user_id FROM sessions WHERE id = ?',
          sessionId
        )) as unknown as { user_id: string } | undefined;
        if (owner?.user_id === userId) await _processManager.stopSession(sessionId, userId);
      } catch (error) {
        console.warn(`[WS] Failed to stop revoked user session ${sessionId}:`, error);
      }
    }
  }

  return disconnected;
}

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: (origin, callback) => {
          // Allow same-origin requests (no origin header)
          if (!origin) {
            return callback(null, true);
          }
          // Check if origin is in the allowed list
          const normalizedOrigin = origin.toLowerCase();
          if (config.allowedOrigins.includes(normalizedOrigin)) {
            return callback(null, true);
          }
          // Reject unauthorized origins
          console.warn(`WebSocket CORS: Rejected connection from unauthorized origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
      },
      maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for large images
    }
  );

  const processManager = new ClaudeProcessManager(io);
  _processManager = processManager;
  _io = io;

  // Live duplicates share one promise; terminal receipts live in SQLite so a
  // retry after either a socket or backend restart remains idempotent.
  const sendReceipts = new Map<string, SendReceipt>();
  const sessionSendChains = new Map<string, Promise<void>>();
  const presenceBySession = new Map<
    string,
    Map<
      string,
      {
        socketId: string;
        deviceId: string;
        label?: string;
        state: 'active' | 'idle';
        activeAt: string;
        lastReadMessageId?: string | null;
      }
    >
  >();

  const broadcastPresence = (sessionId: string): void => {
    const viewers = [...(presenceBySession.get(sessionId)?.values() ?? [])].map(
      ({ socketId: _socketId, ...viewer }) => viewer
    );
    const snapshot: SessionPresenceSnapshot = { sessionId, viewers, total: viewers.length };
    io.to(`session:${sessionId}`).emit('session:presence', snapshot);
  };

  const leavePresence = (socketId: string, sessionId?: string): void => {
    const sessionEntries = sessionId
      ? ([[sessionId, presenceBySession.get(sessionId)]] as const)
      : [...presenceBySession.entries()];
    for (const [currentSessionId, viewers] of sessionEntries) {
      if (!viewers) continue;
      let changed = false;
      for (const [key, viewer] of viewers) {
        if (viewer.socketId !== socketId) continue;
        viewers.delete(key);
        changed = true;
      }
      if (viewers.size === 0) presenceBySession.delete(currentSessionId);
      if (changed) broadcastPresence(currentSessionId);
    }
  };

  const enqueueSessionSend = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = sessionSendChains.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const completion = current.then(
      () => undefined,
      () => undefined
    );
    sessionSendChains.set(key, completion);
    void completion.then(async () => {
      if (sessionSendChains.get(key) === completion) sessionSendChains.delete(key);
    });
    return current;
  };

  // Authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      if (!(await isActiveUser(decoded.userId))) {
        return next(new Error('Account unavailable'));
      }
      socket.data.userId = decoded.userId;
      socket.data.subscribedSessions = new Set();
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`Client connected: ${socket.id} (user: ${socket.data.userId})`);

    // Account-wide room: notification-centre events are not tied to one
    // session, so they fan out per user rather than per session.
    if (socket.data.userId) await socket.join(`user:${socket.data.userId}`);

    // Per-socket rate limit bucket for outbound messages to Claude.
    const messageBucket = makeBucket();
    // Re-check lifecycle state on every event so a suspended/deleted user
    // cannot keep an already-authenticated JWT socket alive.
    // Cached for a few seconds per socket: this middleware runs per event, and
    // presence heartbeats alone made it a DB query per packet per tab. Eager
    // revocation still works — disconnectUserSockets tears sockets down
    // directly when a user is suspended.
    let lifecycleCheckedAt = 0;
    let lifecycleOk = false;
    socket.use(async (_event, next) => {
      const now = Date.now();
      if (now - lifecycleCheckedAt > 5_000) {
        lifecycleOk = await isActiveUser(socket.data.userId);
        lifecycleCheckedAt = now;
      }
      if (lifecycleOk) return next();
      socket.disconnect(true);
    });

    const rateLimited = (sessionId: string, event: string): boolean => {
      if (takeToken(messageBucket)) return false;
      console.warn(
        `[WS] RATE_LIMITED event=${event} userId=${socket.data.userId} socketId=${socket.id}`
      );
      socket.emit('session:error', { sessionId, error: 'Rate limit exceeded. Slow down.' });
      return true;
    };

    // Debug: log all incoming events. Unconditional stdout per packet blocks
    // under piped Docker log drivers, so this is opt-in.
    if (process.env.WEBUI_DEBUG_SOCKET_EVENTS === '1') {
      socket.onAny((eventName, ...args) => {
        console.log(
          `[SOCKET EVENT] ${eventName}:`,
          args[0]?.sessionId || '',
          args[0]?.message?.substring(0, 30) || ''
        );
      });
    }

    // Subscribe to session output
    socket.on('session:subscribe', async (sessionId) => {
      if (!(await canAccessSession(sessionId, socket.data.userId))) {
        console.warn(
          `[WS] DENIED session:subscribe userId=${socket.data.userId} sessionId=${sessionId}`
        );
        socket.emit('session:error', { sessionId, error: 'Forbidden: session not owned' });
        return;
      }
      socket.data.subscribedSessions.add(sessionId);
      await socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} subscribed to session ${sessionId}`);
      try {
        await processManager.recoverInterruptedKimiTurn(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:subscribe-recovery', sessionId, err) || 'Failed to recover Kimi',
        });
      }
    });

    // Unsubscribe from session output
    socket.on('session:unsubscribe', async (sessionId) => {
      socket.data.subscribedSessions.delete(sessionId);
      await socket.leave(`session:${sessionId}`);
      leavePresence(socket.id, sessionId);
      console.log(`Socket ${socket.id} unsubscribed from session ${sessionId}`);

      // If the last subscriber just left, mark the session as headless so a
      // later reconnect can report that no browser is attached. The CLI keeps
      // running in the background.
      const roomSize = io.sockets.adapter.rooms.get(`session:${sessionId}`)?.size ?? 0;
      if (roomSize === 0) {
        processManager.markSessionDisconnected(sessionId);
      }
    });

    socket.on(
      'session:presence',
      async ({ sessionId, deviceId, label, state, lastReadMessageId }) => {
        if (!(await ownsSession(sessionId, socket.data.userId))) {
          socket.emit('session:error', { sessionId, error: 'Forbidden: session not owned' });
          return;
        }
        const cleanDeviceId = deviceId?.trim();
        const cleanLabel = label
          ?.replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (
          !cleanDeviceId ||
          cleanDeviceId.length > 128 ||
          !/^[a-zA-Z0-9._:-]+$/.test(cleanDeviceId) ||
          (cleanLabel?.length ?? 0) > 80 ||
          !['active', 'idle', 'leave'].includes(state) ||
          (lastReadMessageId !== undefined &&
            lastReadMessageId !== null &&
            (typeof lastReadMessageId !== 'string' || lastReadMessageId.length > 160))
        ) {
          socket.emit('session:error', { sessionId, error: 'Invalid presence payload' });
          return;
        }
        if (lastReadMessageId !== undefined) {
          const validMarker =
            lastReadMessageId === null ||
            !!(await pgGet(
              `SELECT 1
                   FROM messages m
                   JOIN sessions s ON s.id = m.session_id
                  WHERE m.id = ? AND m.session_id = ? AND s.user_id = ?
                    AND m.chat_id IS s.active_chat_id`,
              lastReadMessageId,
              sessionId,
              socket.data.userId
            ));
          if (!validMarker) {
            socket.emit('session:error', { sessionId, error: 'Invalid read marker' });
            return;
          }
        }
        const key = `${socket.id}:${cleanDeviceId}`;
        const viewers = presenceBySession.get(sessionId) ?? new Map();
        if (state === 'leave') {
          viewers.delete(key);
        } else {
          viewers.set(key, {
            socketId: socket.id,
            deviceId: cleanDeviceId,
            ...(cleanLabel ? { label: cleanLabel } : {}),
            state,
            activeAt: new Date().toISOString(),
            ...(lastReadMessageId === undefined ? {} : { lastReadMessageId }),
          });
        }
        if (viewers.size > 0) presenceBySession.set(sessionId, viewers);
        else presenceBySession.delete(sessionId);
        socket.data.subscribedSessions.add(sessionId);
        await socket.join(`session:${sessionId}`);
        broadcastPresence(sessionId);
      }
    );

    const logError = (event: string, sessionId: string, err: unknown): string => {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(
        `[WS ERROR] event=${event} sessionId=${sessionId} userId=${socket.data.userId} socketId=${socket.id}`,
        stack || message
      );
      return message;
    };

    const denyControl = async (sessionId: string, event: string): Promise<boolean> => {
      const reason = await controlDenialReason(sessionId, socket.data.userId);
      if (!reason) return false;
      console.warn(`[WS] DENIED ${event} userId=${socket.data.userId} sessionId=${sessionId}`);
      socket.emit('session:error', { sessionId, error: reason });
      return true;
    };

    // Socket.IO acknowledgements are intentionally supported without changing
    // the shared legacy event signature: old clients keep working, while new
    // clients can wait until the message is durably recorded and dispatched or
    // queued. The cast adds only the optional runtime acknowledgement argument.
    const onReliableSend = socket.on.bind(socket) as (
      event: 'session:send',
      listener: (data: SessionSendPayload, acknowledge?: SessionSendAcknowledge) => void
    ) => void;

    onReliableSend(
      'session:send',
      async (
        { sessionId, chatId, message, images, uploadIds, activeFollowupMode, clientMessageId },
        acknowledge
      ) => {
        const sendId = clientMessageId?.trim() || '';
        const receiptKey = sendId ? `${socket.data.userId}:${sessionId}:${sendId}` : '';
        const chainKey = `${socket.data.userId}:${sessionId}`;
        const reject = (error: string, retryable: boolean): SessionSendAck => ({
          clientMessageId: sendId,
          ...(chatId !== undefined ? { chatId } : {}),
          status: 'rejected',
          error,
          retryable,
        });
        const acknowledgeRejected = (error: string, retryable: boolean) => {
          const result = reject(error, retryable);
          acknowledge?.(result);
          return result;
        };
        const invalidInlineAttachment =
          images !== undefined &&
          (!Array.isArray(images) ||
            images.some(
              (attachment) =>
                !attachment ||
                typeof attachment !== 'object' ||
                typeof attachment.data !== 'string' ||
                attachment.data.length === 0 ||
                attachment.data.length > 35_000_000 ||
                !/^[a-zA-Z0-9+/]*={0,2}$/.test(attachment.data) ||
                attachment.data.length % 4 !== 0 ||
                typeof attachment.mimeType !== 'string' ||
                attachment.mimeType.length < 1 ||
                attachment.mimeType.length > 200 ||
                /[\u0000-\u001f\u007f]/.test(attachment.mimeType) ||
                (attachment.filename !== undefined &&
                  (typeof attachment.filename !== 'string' || attachment.filename.length > 240))
            ));
        const inlineUploadBytes = Array.isArray(images)
          ? images.reduce(
              (total, attachment) =>
                total +
                (attachment && typeof attachment.data === 'string'
                  ? decodedBase64ByteSize(attachment.data)
                  : 0),
              0
            )
          : 0;
        const inlineUploadCount = Array.isArray(images) ? images.length : 0;
        const stagedUploadCount = Array.isArray(uploadIds) ? uploadIds.length : 0;

        if (
          !sessionId ||
          sessionId.length > 160 ||
          !/^[a-zA-Z0-9._:-]+$/.test(sessionId) ||
          (chatId !== undefined &&
            chatId !== null &&
            (typeof chatId !== 'string' ||
              chatId.length === 0 ||
              chatId.length > 160 ||
              !/^[a-zA-Z0-9_-]+$/.test(chatId))) ||
          typeof message !== 'string' ||
          message.length > 40_000 ||
          sendId.length > 160 ||
          (sendId.length > 0 && !/^[a-zA-Z0-9._:-]+$/.test(sendId)) ||
          (activeFollowupMode !== undefined &&
            activeFollowupMode !== 'queue' &&
            activeFollowupMode !== 'steer') ||
          (images && (!Array.isArray(images) || images.length > MAX_CHAT_UPLOAD_FILES)) ||
          inlineUploadCount + stagedUploadCount > MAX_CHAT_UPLOAD_FILES ||
          inlineUploadBytes > MAX_CHAT_UPLOAD_TOTAL_BYTES ||
          invalidInlineAttachment ||
          (uploadIds &&
            (!Array.isArray(uploadIds) ||
              uploadIds.length > MAX_CHAT_UPLOAD_FILES ||
              uploadIds.some(
                (id) =>
                  typeof id !== 'string' ||
                  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
              ))) ||
          (uploadIds && uploadIds.length > 0 && !sendId)
        ) {
          acknowledgeRejected('Invalid message payload', false);
          return;
        }

        const denialReason = await controlDenialReason(sessionId, socket.data.userId);
        if (denialReason) {
          console.warn(
            `[WS] DENIED session:send userId=${socket.data.userId} sessionId=${sessionId}`
          );
          socket.emit('session:error', { sessionId, error: denialReason });
          acknowledgeRejected(denialReason, false);
          return;
        }

        let pinnedChatId: string | null;
        try {
          pinnedChatId = await resolveSessionSendChatId(sessionId, socket.data.userId, chatId);
        } catch (error) {
          acknowledgeRejected(error instanceof Error ? error.message : 'Invalid chat', false);
          return;
        }

        const payloadHash = hashDeliveryPayload({
          sessionId,
          chatId: pinnedChatId,
          message,
          images,
          uploadIds,
          activeFollowupMode,
        });

        // A completed or in-flight retry is free: it neither consumes another
        // rate-limit token nor enters the provider queue twice.
        const existingReceipt = receiptKey ? sendReceipts.get(receiptKey) : undefined;
        if (existingReceipt) {
          if (existingReceipt.payloadHash !== payloadHash) {
            acknowledgeRejected('clientMessageId was already used for a different payload', false);
            return;
          }
          console.log(`[WS] session:send retry clientMessageId=${sendId} sessionId=${sessionId}`);
          void existingReceipt.promise.then(acknowledge);
          return;
        }

        if (sendId) {
          const claim = await claimMessageDelivery(
            socket.data.userId,
            sessionId,
            sendId,
            payloadHash
          );
          if (claim.kind !== 'claimed') {
            acknowledge?.(claim.acknowledgement);
            return;
          }
        }

        if (
          (await getSessionSyncState(sessionId, socket.data.userId)).activeChatId !== pinnedChatId
        ) {
          const stale = acknowledgeRejected(
            'This message belongs to a different chat. Return to that chat and retry.',
            true
          );
          if (sendId) {
            await finishMessageDelivery(socket.data.userId, sessionId, sendId, stale);
          }
          return;
        }

        if (!takeToken(messageBucket)) {
          const error = 'Rate limit exceeded. Slow down.';
          console.warn(
            `[WS] RATE_LIMITED event=session:send userId=${socket.data.userId} socketId=${socket.id}`
          );
          socket.emit('session:error', { sessionId, error });
          const rejected = acknowledgeRejected(error, true);
          if (sendId) {
            await finishMessageDelivery(socket.data.userId, sessionId, sendId, rejected);
          }
          return;
        }

        console.log(`Received session:send for ${sessionId}: "${message.substring(0, 50)}..."`);
        const terminalPromise = enqueueSessionSend(chainKey, async () => {
          try {
            const staged = uploadIds?.length
              ? await resolveChatUploads(socket.data.userId, sessionId, uploadIds, sendId, {
                  fileCount: inlineUploadCount,
                  byteSize: inlineUploadBytes,
                })
              : [];
            const combinedAttachments = [
              ...(images ?? []),
              ...staged.map(({ uploadId: _uploadId, ...attachment }) => attachment),
            ];
            const result = await processManager.sendMessage(
              sessionId,
              socket.data.userId,
              message,
              combinedAttachments.length ? combinedAttachments : undefined,
              {
                chatId: pinnedChatId,
                activeFollowupMode,
                clientMessageId: sendId || undefined,
                uploadIds,
              }
            );
            const accepted: SessionSendAck = {
              clientMessageId: sendId,
              chatId: result.chatId,
              status: 'accepted',
              acceptedAt: new Date().toISOString(),
              ...(result.messageId ? { messageId: result.messageId } : {}),
              disposition: result.disposition,
              highWatermark: result.highWatermark,
              ...(uploadIds?.length
                ? {
                    attachments: uploadIds.map((uploadId, index) => ({
                      uploadId,
                      filename: staged[index]?.filename ?? 'attachment',
                      status: 'accepted' as const,
                    })),
                  }
                : {}),
            };
            if (sendId) {
              await finishMessageDelivery(socket.data.userId, sessionId, sendId, accepted);
            }
            return accepted;
          } catch (err) {
            if (sendId && uploadIds?.length) {
              releaseChatUploadReservations(socket.data.userId, sessionId, uploadIds, sendId);
            }
            const error = logError('session:send', sessionId, err) || 'Failed to send message';
            const retryable = !(err instanceof ChatUploadError) || err.statusCode >= 500;
            const rejected = reject(error, retryable);
            if (sendId) {
              await finishMessageDelivery(socket.data.userId, sessionId, sendId, rejected);
            }
            socket.emit('session:error', { sessionId, error });
            return rejected;
          }
        });

        if (receiptKey) {
          sendReceipts.set(receiptKey, { payloadHash, promise: terminalPromise });
          void terminalPromise.finally(() => {
            if (sendReceipts.get(receiptKey)?.promise === terminalPromise) {
              sendReceipts.delete(receiptKey);
            }
          });
        }

        void terminalPromise.then(acknowledge);
      }
    );

    // Interrupt the active CLI session.
    socket.on('session:interrupt', async (sessionId) => {
      if (await denyControl(sessionId, 'session:interrupt')) return;
      try {
        await processManager.interrupt(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:interrupt', sessionId, err) || 'Failed to interrupt session',
        });
      }
    });

    // Set session permission mode
    socket.on('session:set-mode', async ({ sessionId, mode }) => {
      if (await denyControl(sessionId, 'session:set-mode')) return;
      console.log(`Setting session ${sessionId} mode to ${mode}`);
      try {
        await processManager.setMode(sessionId, socket.data.userId, mode);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:set-mode', sessionId, err) || 'Failed to set mode',
        });
      }
    });

    // Restart session (stop and start fresh)
    socket.on('session:restart', async (sessionId) => {
      if (await denyControl(sessionId, 'session:restart')) return;
      console.log(`Restart request for session ${sessionId}`);
      try {
        await processManager.restartSession(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:restart', sessionId, err) || 'Failed to restart session',
        });
      }
    });

    // Send raw input for interactive prompts (trust dialogs, etc.)
    socket.on('session:input', async ({ sessionId, input }) => {
      if (await denyControl(sessionId, 'session:input')) return;
      if (rateLimited(sessionId, 'session:input')) return;
      console.log(`Received session:input for ${sessionId}: "${input}"`);
      try {
        await processManager.sendRawInput(sessionId, socket.data.userId, input);
        console.log(`Input sent successfully to session ${sessionId}`);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:input', sessionId, err) || 'Failed to send input',
        });
      }
    });

    // Approve permission request
    socket.on('session:approve_permission', async ({ sessionId, toolNames, originalMessage }) => {
      if (await denyControl(sessionId, 'session:approve_permission')) return;
      console.log(
        `Received session:approve_permission for ${sessionId}: tools=${toolNames.join(', ')}`
      );
      try {
        await processManager.approvePermission(
          sessionId,
          socket.data.userId,
          toolNames,
          originalMessage
        );
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error:
            logError('session:approve_permission', sessionId, err) ||
            'Failed to approve permission',
        });
      }
    });

    // Deny permission request
    socket.on('session:deny_permission', async ({ sessionId }) => {
      if (await denyControl(sessionId, 'session:deny_permission')) return;
      console.log(`Received session:deny_permission for ${sessionId}`);
      try {
        processManager.denyPermission(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:deny_permission', sessionId, err) || 'Failed to deny permission',
        });
      }
    });

    // Reconnect to a running session
    socket.on('session:reconnect', async ({ sessionId, lastTimestamp, lastSequence }) => {
      console.log(`Reconnect request for session ${sessionId} from socket ${socket.id}`);

      if (!(await canAccessSession(sessionId, socket.data.userId))) {
        console.warn(
          `[WS] DENIED session:reconnect userId=${socket.data.userId} sessionId=${sessionId}`
        );
        socket.emit('session:error', { sessionId, error: 'Forbidden: session not owned' });
        return;
      }

      // ALWAYS subscribe to the session room, regardless of running state
      // This ensures the socket receives events when a session starts
      socket.data.subscribedSessions.add(sessionId);
      await socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} joined session room ${sessionId}`);

      // Kimi ACP requests cannot survive a container replacement. If the
      // persisted transcript ends with an unanswered user message, reopening
      // the chat resumes the native session and continues it automatically.
      try {
        await processManager.recoverInterruptedKimiTurn(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: logError('session:reconnect-recovery', sessionId, err) || 'Failed to recover Kimi',
        });
      }

      const isRunning = processManager.isSessionRunning(sessionId);

      if (isRunning) {
        processManager.markSessionReconnected(sessionId);

        // getSessionBufferStatus signals needsFullResync when the circular buffer rolled
        // over since lastTimestamp — client should then fetch full state via REST instead
        // of trusting the truncated replay.
        const { items: bufferedMessages, needsFullResync } =
          await processManager.getSessionBufferStatus(sessionId, lastTimestamp, lastSequence);
        const syncState = await getSessionSyncState(sessionId, socket.data.userId);

        console.log(
          `Session ${sessionId} reconnected with ${bufferedMessages.length} buffered messages (needsFullResync=${needsFullResync})`
        );

        socket.emit('session:reconnected', {
          sessionId,
          // A truncated replay must not advance per-item cursors either. REST
          // replaces it atomically when a gap is known.
          bufferedMessages: needsFullResync ? [] : bufferedMessages,
          isRunning: true,
          needsFullResync,
          // Never advance a client cursor across a known replay gap. The REST
          // snapshot carries the authoritative watermark after it is applied.
          ...(needsFullResync ? {} : { highWatermark: syncState.highWatermark }),
          snapshotRevision: syncState.snapshotRevision,
        });
      } else {
        const syncState = await getSessionSyncState(sessionId, socket.data.userId);
        const needsFullResync =
          lastSequence === undefined
            ? syncState.highWatermark > 0
            : lastSequence < syncState.highWatermark;
        socket.emit('session:reconnected', {
          sessionId,
          bufferedMessages: [],
          isRunning: false,
          needsFullResync,
          ...(needsFullResync ? {} : { highWatermark: syncState.highWatermark }),
          snapshotRevision: syncState.snapshotRevision,
        });
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      leavePresence(socket.id);
      // Mark subscribed sessions as headless, but leave the underlying process
      // alone so it can finish without an open browser tab.
      for (const sessionId of socket.data.subscribedSessions) {
        processManager.markSessionDisconnected(sessionId);
      }
    });
  });

  return io;
}

export type { Server };
