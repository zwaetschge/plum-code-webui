import { io as connectSocket, type Socket } from 'socket.io-client';
import { config } from '../../config.js';
import { generateUserToken } from '../../utils/authTokens.js';

/**
 * The Plum Browser extension's chat panel, served over its bridge socket.
 *
 * The extension's pairing token grants no API access, so the panel cannot hold
 * a Plum socket itself. Instead each bridge connection gets one loopback
 * Socket.IO client, signed in as the token's owner with a JWT that never
 * leaves the server. Sending, interrupting and approving go through the same
 * socket handlers the WebUI uses (ownership, rate limits, idempotency, chat
 * pinning), and the events of the sessions the panel shows are forwarded.
 */

/** Session events the panel renders; everything else stays on the server. */
const FORWARDED_EVENTS = [
  'session:output',
  'session:message',
  'session:thinking',
  'session:tool_use',
  'session:status',
  'session:lifecycle',
  'session:permission_request',
  'session:question_request',
  'session:queue',
  'session:error',
] as const;

/**
 * Some harnesses (Vibe, Kimi) acknowledge a send only once the whole turn has
 * finished. The panel does not wait that long: the user-message echo already
 * shows the send landed, so after this the call reports it as dispatched.
 */
const SEND_ACK_WAIT_MS = 12_000;

export class ChatRelay {
  private socket: Socket | null = null;
  private readonly watched = new Set<string>();

  constructor(
    private readonly userId: string,
    private readonly forward: (event: string, payload: unknown) => void
  ) {}

  private connection(): Socket {
    if (this.socket) return this.socket;
    const socket = connectSocket(`http://127.0.0.1:${config.port}`, {
      transports: ['websocket'],
      // A fresh short-lived token on every (re)connect.
      auth: (callback) => callback({ token: generateUserToken(this.userId, { expiresIn: '10m' }) }),
      reconnectionDelayMax: 10_000,
    });
    for (const event of FORWARDED_EVENTS) {
      socket.on(event, (payload: { sessionId?: string } | undefined) => {
        if (payload?.sessionId && this.watched.has(payload.sessionId)) {
          this.forward(event, payload);
        }
      });
    }
    // The server forgets room membership across reconnects.
    socket.on('connect', () => {
      for (const sessionId of this.watched) socket.emit('session:subscribe', sessionId);
    });
    this.socket = socket;
    return socket;
  }

  watch(sessionId: string): void {
    this.watched.add(sessionId);
    const socket = this.connection();
    if (socket.connected) socket.emit('session:subscribe', sessionId);
  }

  unwatch(sessionId: string): void {
    if (!this.watched.delete(sessionId)) return;
    this.socket?.emit('session:unsubscribe', sessionId);
  }

  send(payload: {
    sessionId: string;
    message: string;
    clientMessageId: string;
    activeFollowupMode?: 'queue' | 'steer';
  }): Promise<unknown> {
    this.watch(payload.sessionId);
    const socket = this.connection();
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ clientMessageId: payload.clientMessageId, status: 'dispatched' }),
        SEND_ACK_WAIT_MS
      );
      socket.emit('session:send', payload, (ack: unknown) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  interrupt(sessionId: string): void {
    this.connection().emit('session:interrupt', sessionId);
  }

  /** Legacy denial flow (Claude stream-json): approve re-runs with the tools allowed. */
  approveDenied(sessionId: string, toolNames: string[], originalMessage: string): void {
    this.connection().emit('session:approve_permission', { sessionId, toolNames, originalMessage });
  }

  denyDenied(sessionId: string): void {
    this.connection().emit('session:deny_permission', { sessionId });
  }

  close(): void {
    this.watched.clear();
    this.socket?.disconnect();
    this.socket = null;
  }
}
