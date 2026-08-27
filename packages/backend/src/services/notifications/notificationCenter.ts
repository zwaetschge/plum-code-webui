import { all as pgAll, run as pgRun } from '../../db/pg.js';
import { nanoid } from 'nanoid';
import type { Server as SocketIOServer } from 'socket.io';

/**
 * Durable "what happened" feed plus its delivery fan-out.
 *
 * Socket events are transient — a reload loses them and a closed tab never sees
 * them. Every notable event is therefore persisted here first, then pushed to
 * whoever is listening: live sockets, and browsers that registered for Web Push.
 */

export type NotificationKind = 'reply' | 'approval' | 'question' | 'error' | 'usage_alert' | 'goal';

interface NotifyInput {
  userId: string;
  sessionId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /**
   * Everything the client needs to act on the row without opening the session —
   * an approval carries `requestId` and `toolName` so the feed itself can answer.
   */
  data?: Record<string, unknown> | null;
}

let io: SocketIOServer | null = null;

export function attachNotificationIo(server: SocketIOServer): void {
  io = server;
}

/** Persist one notification and fan it out. Never throws into the caller. */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const id = nanoid();
    const data = input.data ? JSON.stringify(input.data) : null;
    const requestId =
      typeof input.data?.requestId === 'string' && input.data.requestId
        ? input.data.requestId
        : null;
    await pgRun(
      `INSERT INTO notifications (id, user_id, session_id, kind, title, body, data, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.userId,
      input.sessionId ?? null,
      input.kind,
      input.title,
      input.body ?? null,
      data,
      requestId
    );

    const payload = {
      id,
      sessionId: input.sessionId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? null,
      createdAt: new Date().toISOString(),
    };
    io?.to(`user:${input.userId}`).emit('notification:new', payload);
    void sendWebPush(input.userId, payload);
  } catch (error) {
    console.error('[Notifications] failed to record notification:', error);
  }
}

/**
 * An approval that was answered elsewhere (session view, watch, widget) must
 * stop offering its buttons in the feed. Marking it read is enough: the row
 * stays as history but renders as resolved.
 */
export async function resolveApprovalNotification(requestId: string): Promise<void> {
  try {
    await pgRun(
      `UPDATE notifications
            SET read_at = CURRENT_TIMESTAMP
          WHERE kind = 'approval' AND read_at IS NULL AND request_id = ?`,
      requestId
    );
  } catch (error) {
    console.warn('[Notifications] failed to resolve approval:', error);
  }
}

/**
 * Best-effort Web Push. `web-push` is an optional dependency: without it — or
 * without VAPID keys — this degrades to socket-only delivery instead of failing.
 */
async function sendWebPush(
  userId: string,
  payload: {
    title: string;
    body: string | null;
    sessionId: string | null;
    kind: string;
    data?: Record<string, unknown> | null;
  }
): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;

  // `web-push` is optional and may be absent from the image; import it by a
  // computed specifier so TypeScript does not demand its types at build time.
  interface WebPushLike {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string
    ): Promise<unknown>;
  }
  let webpush: WebPushLike;
  try {
    const specifier = 'web-push';
    const mod = (await import(/* @vite-ignore */ specifier)) as { default?: WebPushLike };
    webpush = (mod.default ?? (mod as unknown as WebPushLike)) as WebPushLike;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      publicKey,
      privateKey
    );
  } catch {
    return;
  }

  const subscriptions = (await pgAll(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
    userId
  )) as unknown as Array<{ endpoint: string; p256dh: string; auth: string }>;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (error) {
        // 404/410 mean the browser dropped the subscription — prune it so the
        // list does not grow with dead endpoints.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await pgRun('DELETE FROM push_subscriptions WHERE endpoint = ?', sub.endpoint);
        }
      }
    })
  );
}
