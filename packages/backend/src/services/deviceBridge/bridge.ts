import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { config } from '../../config.js';

/**
 * Android device control bridge.
 *
 * The Plum Android app pairs as a companion: its accessibility service drives
 * the phone (read screen, tap, type, scroll, screenshot) and a foreground
 * service holds a WebSocket open to the backend. Agent tool calls arrive from
 * the `android-device` MCP server at POST /api/device-bridge/internal/call
 * (hook secret + WebUI session id) and are relayed over that socket — the
 * same pattern as the Firefox browser bridge, but the client is the user's
 * signed-in Android app instead of a plum_ff token, and no adb is involved.
 */

const DEVICE_BRIDGE_PATH = '/ws/device-bridge';
const HELLO_TIMEOUT_MS = 20_000;
const PING_INTERVAL_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MAX_CALL_TIMEOUT_MS = 120_000;

export interface DeviceConnectionSummary {
  id: string;
  label: string;
  model: string;
  version: string;
  connectedAt: string;
  lastSeenAt: string;
  activeAt: string;
}

interface DeviceToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface DeviceCallResult {
  content: DeviceToolContent[];
  isError?: boolean;
}

interface DeviceCallSession {
  id: string;
  name: string;
}

interface PendingCall {
  resolve: (result: DeviceCallResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  id: string;
  userId: string;
  device: { label: string; model: string; version: string; platform: string };
  ws: WebSocket;
  connectedAt: Date;
  lastSeenAt: Date;
  activeAt: Date;
  alive: boolean;
  pending: Map<string, PendingCall>;
}

export class DeviceBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 409
  ) {
    super(message);
  }
}

function text(value: unknown, max = 120): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function parseFrame(raw: RawData): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw.toString());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Verifies the app's JWT — the user is already signed in; no pairing code. */
function resolveJwt(token: string): string | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId?: unknown };
    return typeof decoded.userId === 'string' ? decoded.userId : null;
  } catch {
    return null;
  }
}

export class DeviceBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024 * 1024 });
  private readonly connections = new Map<string, Connection>();
  private pingTimer: NodeJS.Timeout | null = null;

  attach(httpServer: import('node:http').Server): void {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = (req.url || '').split('?')[0];
      if (pathname !== DEVICE_BRIDGE_PATH) return;
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
    this.pingTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const conn of this.connections.values()) conn.ws.close(1001, 'server shutdown');
    this.wss.close();
  }

  listDevices(userId: string): DeviceConnectionSummary[] {
    return [...this.connections.values()]
      .filter((conn) => conn.userId === userId)
      .sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime())
      .map((conn) => ({
        id: conn.id,
        label: conn.device.label,
        model: conn.device.model,
        version: conn.device.version,
        connectedAt: conn.connectedAt.toISOString(),
        lastSeenAt: conn.lastSeenAt.toISOString(),
        activeAt: conn.activeAt.toISOString(),
      }));
  }

  /** The device a session should use: the most recently active one. */
  private pickConnection(userId: string): Connection | undefined {
    return [...this.connections.values()]
      .filter((conn) => conn.userId === userId && conn.ws.readyState === WebSocket.OPEN)
      .sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime())[0];
  }

  async call(
    userId: string,
    session: DeviceCallSession,
    tool: string,
    args: Record<string, unknown>,
    opts: { connectionId?: string; timeoutMs?: number } = {}
  ): Promise<DeviceCallResult> {
    const open = [...this.connections.values()].filter(
      (conn) => conn.userId === userId && conn.ws.readyState === WebSocket.OPEN
    );
    const conn = opts.connectionId
      ? open.find((candidate) => candidate.id === opts.connectionId)
      : this.pickConnection(userId);
    if (!conn) {
      throw new DeviceBridgeError(
        'No Android device is connected. In the Plum app: Settings → Browser → Device control, enable the accessibility service; the phone pairs itself.',
        'DEVICE_NOT_CONNECTED',
        404
      );
    }

    const id = nanoid();
    const timeoutMs = Math.min(
      Math.max(opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, 1_000),
      MAX_CALL_TIMEOUT_MS
    );
    return new Promise<DeviceCallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(
          new DeviceBridgeError(
            `${conn.device.label} did not answer "${tool}" within ${Math.round(timeoutMs / 1000)}s`,
            'DEVICE_TIMEOUT',
            504
          )
        );
      }, timeoutMs);
      conn.pending.set(id, { resolve, reject, timer });
      conn.activeAt = new Date();
      conn.ws.send(JSON.stringify({ type: 'call', id, tool, args, session }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        conn.pending.delete(id);
        reject(
          new DeviceBridgeError(
            `Could not reach ${conn.device.label}: ${error.message}`,
            'DEVICE_SEND',
            502
          )
        );
      });
    });
  }

  private accept(ws: WebSocket): void {
    let conn: Connection | null = null;
    const helloTimer = setTimeout(() => ws.close(4408, 'hello timeout'), HELLO_TIMEOUT_MS);

    ws.on('message', (raw) => {
      const frame = parseFrame(raw);
      if (!frame) return;
      if (!conn) {
        if (frame.type !== 'hello') {
          ws.close(4400, 'expected hello');
          return;
        }
        clearTimeout(helloTimer);
        conn = this.establish(ws, frame);
        return;
      }
      conn.lastSeenAt = new Date();
      this.handleFrame(conn, frame);
    });
    ws.on('pong', () => {
      if (conn) {
        conn.alive = true;
        conn.lastSeenAt = new Date();
      }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!conn) return;
      this.connections.delete(conn.id);
      for (const pending of conn.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new DeviceBridgeError('The Android device disconnected during the call', 'DEVICE_DISCONNECTED')
        );
      }
      conn.pending.clear();
      console.log(`[DEVICE] Android disconnected (${conn.device.label}) user=${conn.userId}`);
    });
    ws.on('error', () => {
      /* close follows */
    });
  }

  private establish(ws: WebSocket, frame: Record<string, unknown>): Connection | null {
    const userId = resolveJwt(text(frame.token, 2048));
    if (!userId) {
      ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Invalid token' }));
      ws.close(4401, 'invalid token');
      return null;
    }
    if (ws.readyState !== WebSocket.OPEN) return null;
    const client = (frame.client && typeof frame.client === 'object' ? frame.client : {}) as Record<
      string,
      unknown
    >;
    const now = new Date();
    const conn: Connection = {
      id: nanoid(10),
      userId,
      device: {
        label: text(client.label, 80) || text(client.model, 80) || 'Android device',
        model: text(client.model, 80),
        version: text(client.version, 40),
        platform: text(client.platform, 40) || 'android',
      },
      ws,
      connectedAt: now,
      lastSeenAt: now,
      activeAt: now,
      alive: true,
      pending: new Map(),
    };
    this.connections.set(conn.id, conn);
    ws.send(JSON.stringify({ type: 'welcome', connectionId: conn.id }));
    console.log(
      `[DEVICE] Android connected (${conn.device.label}, ${conn.device.model}) user=${userId}`
    );
    return conn;
  }

  private handleFrame(conn: Connection, frame: Record<string, unknown>): void {
    if (frame.type === 'state' && frame.active === true) {
      conn.activeAt = new Date();
      return;
    }
    if (frame.type !== 'result' || typeof frame.id !== 'string') return;
    const pending = conn.pending.get(frame.id);
    if (!pending) return;
    conn.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.ok === false) {
      pending.resolve({
        content: [{ type: 'text', text: text(frame.error, 4000) || 'Device action failed' }],
        isError: true,
      });
      return;
    }
    const content = Array.isArray(frame.content)
      ? (frame.content.filter(
          (item) => item && typeof item === 'object' && typeof item.type === 'string'
        ) as DeviceToolContent[])
      : [];
    pending.resolve({ content: content.length ? content : [{ type: 'text', text: 'OK' }] });
  }

  private heartbeat(): void {
    for (const conn of this.connections.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }
}

export const deviceBridge = new DeviceBridge();
