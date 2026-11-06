import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { ChatRelay } from './chatRelay.js';
import { latestDesktopCompanion, latestExtensionVersion, versionNewer } from './package.js';
import { getDesktopRules } from './desktop.js';
import { handleBridgeRpc } from './rpc.js';
import {
  isBrowserTokenActive,
  resolveBrowserToken,
  type BrowserTokenScope,
  type ResolvedBrowserToken,
} from './tokens.js';

/**
 * Relay between agent MCP calls and the user's Plum Browser extension
 * (Firefox or Chrome).
 *
 * The extension dials out (it sits behind the user's NAT; Plum cannot reach
 * it), authenticates with a `plum_ff_` pairing token in its first frame — never
 * in the URL, which would land in proxy access logs — and then executes tool
 * calls the backend forwards from the `firefox` MCP server. Each call carries
 * the WebUI session so the extension can keep every session inside its own
 * tab group.
 */

export const BROWSER_BRIDGE_PATH = '/api/browser-bridge/ws';
const HELLO_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 25_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const MAX_CALL_TIMEOUT_MS = 5 * 60_000;
const TOKEN_RECHECK_MS = 60_000;
/** A session leaves its browser once the user has been away from it this long and is active elsewhere. */
const SWITCH_AFTER_IDLE_MS = 10 * 60_000;

/**
 * A browser extension, the desktop companion that shows marks over native
 * apps, or the Wear OS app. A watch only reads usage/approvals/sessions and
 * answers them (rpc.ts); it never receives tool calls or desktop frames.
 */
export type BridgeClientKind = 'browser' | 'desktop' | 'watch';

/**
 * The kind a connection gets. A watch-scope token is always a watch, whatever
 * its hello says, so a token handed to a watch can never drive a browser or a
 * desktop. A browser-scope token may announce any kind.
 */
export function resolveClientKind(scope: BrowserTokenScope, requested: unknown): BridgeClientKind {
  if (scope === 'watch') return 'watch';
  if (requested === 'desktop' || requested === 'watch') return requested;
  return 'browser';
}

export const desktopActivitySchema = z.object({
  sessionId: z.string().max(64).default(''),
  sessionName: z.string().max(100).default('Plum'),
  status: z.string().max(40).default('Bereit'),
  action: z.string().max(240).default(''),
  progress: z.string().max(240).default(''),
  history: z.array(z.string().max(300)).max(12).default([]),
  result: z.string().max(2000).default(''),
  resultTarget: z.string().max(2000).default(''),
  chat: z.string().max(4000).default(''),
  screens: z
    .array(
      z.object({
        name: z.string().max(120),
        width: z.number(),
        height: z.number(),
        primary: z.boolean(),
      })
    )
    .max(16)
    .default([]),
  layout: z
    .object({
      chatScreen: z.string().max(120),
      chatPlacement: z.enum(['floating', 'left', 'right', 'full']),
      chatVisible: z.boolean(),
      chatZoom: z.number().int().min(100).max(250).default(100),
      chatInsetTop: z.number().int().min(0).max(200).default(0),
    })
    .optional(),
});
export type DesktopActivity = z.infer<typeof desktopActivitySchema>;

export interface BrowserClientInfo {
  kind: BridgeClientKind;
  name: string;
  version: string;
  extensionVersion: string;
  platform: string;
  label: string;
}

export interface BrowserConnectionSummary {
  id: string;
  tokenName: string;
  client: BrowserClientInfo;
  paused: boolean;
  /** Desktop companion only: control, guide (show only) or paused. */
  mode: string | null;
  /** Desktop companion only: a demonstration is being recorded. */
  recording: boolean;
  tabGroups: boolean;
  connectedAt: string;
  lastSeenAt: string;
  /** Last time the user (not an agent) focused this browser. */
  activeAt: string;
  desktopActivity: DesktopActivity | null;
}

export interface BrowserCallSession {
  id: string;
  name: string;
  /** Desktop only: the agent's latest status line, shown next to its cursor. */
  note?: string;
}

export interface BrowserToolContent {
  type: string;
  [key: string]: unknown;
}

export interface BrowserCallResult {
  content: BrowserToolContent[];
  isError?: boolean;
}

interface PendingCall {
  resolve: (value: BrowserCallResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Connection {
  id: string;
  userId: string;
  tokenId: string;
  tokenName: string;
  ws: WebSocket;
  client: BrowserClientInfo;
  paused: boolean;
  mode: string | null;
  recording: boolean;
  tabGroups: boolean;
  connectedAt: Date;
  lastSeenAt: Date;
  activeAt: Date;
  alive: boolean;
  pending: Map<string, PendingCall>;
  chat: ChatRelay | null;
  desktopActivity: DesktopActivity | null;
}

export class BrowserBridgeError extends Error {
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

export class BrowserBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 48 * 1024 * 1024 });
  private readonly connections = new Map<string, Connection>();
  /**
   * Session → browser it works in, so its window and tabs stay in one place.
   * `pinned` is an explicit choice (select_browser) that automatic switching
   * never overrides.
   */
  private readonly sessionBrowser = new Map<
    string,
    { connectionId: string; pinned: boolean; lastCallAt: number }
  >();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly resolveToken: (
      token: string
    ) => Promise<ResolvedBrowserToken | null> = resolveBrowserToken
  ) {}

  attach(httpServer: HttpServer): void {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = (req.url || '').split('?')[0];
      if (pathname !== BROWSER_BRIDGE_PATH) return;
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

  listConnections(userId: string): BrowserConnectionSummary[] {
    return [...this.connections.values()]
      .filter((conn) => conn.userId === userId)
      .sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime())
      .map((conn) => ({
        id: conn.id,
        tokenName: conn.tokenName,
        client: conn.client,
        paused: conn.paused,
        mode: conn.mode,
        recording: conn.recording,
        tabGroups: conn.tabGroups,
        connectedAt: conn.connectedAt.toISOString(),
        lastSeenAt: conn.lastSeenAt.toISOString(),
        activeAt: conn.activeAt.toISOString(),
        desktopActivity: conn.desktopActivity,
      }));
  }

  /** Browsers of the user plus the one this session currently works in. */
  describeForSession(userId: string, sessionId: string) {
    const sticky = this.sessionBrowser.get(sessionId);
    const current = this.pickConnection(userId, sessionId);
    return {
      mode: sticky?.pinned ? 'pinned' : 'auto',
      // A watch is no target for an agent, so it is not offered as one.
      connections: this.listConnections(userId)
        .filter((conn) => conn.client.kind !== 'watch')
        .map((conn) => ({
          ...conn,
          usedByThisSession: conn.id === current?.id,
        })),
    };
  }

  /**
   * Pin a session to one browser, matched by connection id or by a
   * case-insensitive part of its name/label ("chrome", "Arbeit"); "auto"
   * returns to picking the browser the user used last.
   */
  selectBrowser(userId: string, sessionId: string, query: string) {
    const wanted = query.trim().toLowerCase();
    if (!wanted || wanted === 'auto') {
      this.sessionBrowser.delete(sessionId);
      return this.describeForSession(userId, sessionId);
    }
    const open = this.openConnections(userId);
    const match =
      open.find((conn) => conn.id.toLowerCase() === wanted) ??
      open.find((conn) =>
        [conn.client.name, conn.client.label, conn.tokenName, conn.client.platform].some((value) =>
          value.toLowerCase().includes(wanted)
        )
      );
    if (!match) {
      const names = open.map((conn) => `${conn.client.name} "${conn.client.label}"`).join(', ');
      throw new BrowserBridgeError(
        `No connected browser matches "${query}". Connected: ${names || 'none'}.`,
        'BROWSER_NOT_FOUND',
        404
      );
    }
    this.sessionBrowser.set(sessionId, { connectionId: match.id, pinned: true, lastCallAt: 0 });
    return this.describeForSession(userId, sessionId);
  }

  private openConnections(userId: string, kind: BridgeClientKind = 'browser'): Connection[] {
    return [...this.connections.values()]
      .filter(
        (conn) =>
          conn.userId === userId &&
          conn.client.kind === kind &&
          conn.ws.readyState === WebSocket.OPEN
      )
      .sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime());
  }

  /**
   * The browser a session should use: its pinned one, else the one it already
   * works in, unless the user has left that browser and is active in another
   * (Firefox at home idle, Chrome at work in use), else the most recently used.
   */
  private pickConnection(userId: string, sessionId: string): Connection | undefined {
    const candidates = this.openConnections(userId);
    const recent = candidates[0];
    const sticky = this.sessionBrowser.get(sessionId);
    const current = sticky && candidates.find((conn) => conn.id === sticky.connectionId);
    if (!current || !recent) return recent;
    if (sticky.pinned || current === recent) return current;
    const leftIt = Date.now() - current.activeAt.getTime() > SWITCH_AFTER_IDLE_MS;
    const activeElsewhere = recent.activeAt.getTime() > sticky.lastCallAt;
    return leftIt && activeElsewhere ? recent : current;
  }

  /** Pause or resume browser control everywhere (the live view's pause button). */
  setPaused(userId: string, paused: boolean): number {
    let reached = 0;
    for (const conn of this.openConnections(userId)) {
      conn.ws.send(JSON.stringify({ type: 'control', paused }));
      conn.paused = paused;
      reached += 1;
    }
    return reached;
  }

  /** Send a frame to the user's desktop companions (one, or all); returns how many got it. */
  sendDesktop(userId: string, frame: Record<string, unknown>, connectionId?: string): number {
    let reached = 0;
    for (const conn of this.openConnections(userId, 'desktop')) {
      if (connectionId && conn.id !== connectionId) continue;
      conn.ws.send(JSON.stringify(frame));
      reached += 1;
    }
    return reached;
  }

  /** Send a frame to every open bridge client of the user (desktop, browsers and watches). */
  sendAll(userId: string, frame: Record<string, unknown>): number {
    const data = JSON.stringify(frame);
    let reached = 0;
    for (const conn of this.connections.values()) {
      if (conn.userId !== userId || conn.ws.readyState !== WebSocket.OPEN) continue;
      conn.ws.send(data);
      reached += 1;
    }
    return reached;
  }

  /** Users with at least one open bridge client. */
  connectedUserIds(): string[] {
    return [
      ...new Set(
        [...this.connections.values()]
          .filter((conn) => conn.ws.readyState === WebSocket.OPEN)
          .map((conn) => conn.userId)
      ),
    ];
  }

  /** Drop live sockets opened with a token that was just revoked. */
  disconnectToken(tokenId: string): void {
    for (const conn of this.connections.values()) {
      if (conn.tokenId === tokenId) conn.ws.close(4401, 'token revoked');
    }
  }

  async call(
    userId: string,
    session: BrowserCallSession,
    tool: string,
    args: Record<string, unknown>,
    // A watch takes no tool calls, so it cannot be asked for one.
    opts: {
      connectionId?: string;
      timeoutMs?: number;
      kind?: Exclude<BridgeClientKind, 'watch'>;
    } = {}
  ): Promise<BrowserCallResult> {
    const kind = opts.kind ?? 'browser';
    const conn = opts.connectionId
      ? this.openConnections(userId, kind).find((candidate) => candidate.id === opts.connectionId)
      : kind === 'desktop'
        ? this.openConnections(userId, 'desktop')[0]
        : this.pickConnection(userId, session.id);
    if (!conn && kind === 'desktop') {
      throw new BrowserBridgeError(
        'The Plum desktop companion is not running. Start it on the computer (plum-desktop) to see and operate desktop apps.',
        'DESKTOP_NOT_CONNECTED'
      );
    }
    if (!conn) {
      throw new BrowserBridgeError(
        'No browser is connected. Open the Plum Browser extension in Firefox or Chrome and connect it (Plum → Settings → Browser control).',
        'BROWSER_NOT_CONNECTED'
      );
    }
    if (
      conn.paused &&
      !['status', 'peek', 'desktop_status', 'desktop_task', 'desktop_layout'].includes(tool)
    ) {
      throw new BrowserBridgeError(
        kind === 'desktop'
          ? 'Plum Desktop is paused (tray icon). Ask the user to resume it.'
          : `Browser control is paused in the ${conn.client.name} extension. Ask the user to resume it.`,
        'BROWSER_PAUSED'
      );
    }

    const sticky = this.sessionBrowser.get(session.id);
    if (kind === 'browser')
      this.sessionBrowser.set(session.id, {
        connectionId: conn.id,
        pinned: !!sticky?.pinned && sticky.connectionId === conn.id,
        lastCallAt: Date.now(),
      });
    const id = nanoid();
    if (kind === 'desktop') this.chatFor(conn).watch(session.id);
    const timeoutMs = Math.min(
      Math.max(opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, 1_000),
      MAX_CALL_TIMEOUT_MS
    );
    return new Promise<BrowserCallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(
          new BrowserBridgeError(
            `${conn.client.name} did not answer "${tool}" within ${Math.round(timeoutMs / 1000)}s`,
            'BROWSER_TIMEOUT',
            504
          )
        );
      }, timeoutMs);
      conn.pending.set(id, { resolve, reject, timer });
      conn.ws.send(JSON.stringify({ type: 'call', id, tool, args, session }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        conn.pending.delete(id);
        reject(
          new BrowserBridgeError(
            `Could not reach ${conn.client.name}: ${error.message}`,
            'BROWSER_SEND'
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
        void this.authenticate(ws, frame).then((established) => {
          conn = established;
        });
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
          new BrowserBridgeError('Firefox disconnected during the call', 'BROWSER_DISCONNECTED')
        );
      }
      conn.pending.clear();
      conn.chat?.close();
      console.log(`[BROWSER] Firefox disconnected (${conn.client.label}) user=${conn.userId}`);
    });
    ws.on('error', () => {
      /* close follows */
    });
  }

  private async authenticate(
    ws: WebSocket,
    frame: Record<string, unknown>
  ): Promise<Connection | null> {
    const resolved = await this.resolveToken(text(frame.token, 200)).catch(() => null);
    if (!resolved) {
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
    const kind = resolveClientKind(resolved.scope, client.kind);
    const conn: Connection = {
      id: nanoid(10),
      userId: resolved.userId,
      tokenId: resolved.tokenId,
      tokenName: resolved.name,
      ws,
      client: {
        kind,
        name: text(client.name, 40) || (kind === 'watch' ? 'Uhr' : 'Firefox'),
        version: text(client.version, 40),
        extensionVersion: text(client.extensionVersion, 40),
        platform: text(client.platform, 40),
        label: text(client.label, 80) || resolved.name,
      },
      paused: frame.paused === true,
      mode: null,
      recording: false,
      tabGroups: frame.tabGroups === true,
      connectedAt: now,
      lastSeenAt: now,
      // Extensions that report focus start idle unless focused right now;
      // older ones never report it, so their connect time stands in.
      activeAt: frame.reportsActivity === true && frame.active !== true ? new Date(0) : now,
      alive: true,
      pending: new Map(),
      chat: null,
      desktopActivity: null,
    };
    this.connections.set(conn.id, conn);
    ws.send(
      JSON.stringify({
        type: 'welcome',
        connectionId: conn.id,
        kind,
        // Lets the extension offer an update when Plum ships a newer build.
        ...(kind === 'watch' ? {} : { latestVersion: latestExtensionVersion() }),
      })
    );
    // An older desktop companion gets the shipped one; it checks the digest,
    // replaces itself and restarts.
    if (conn.client.kind === 'desktop') {
      const socket = conn.ws;
      void getDesktopRules(conn.userId)
        .then((rules) => socket.send(JSON.stringify({ type: 'rules', rules })))
        .catch(() => {});
      const companion = latestDesktopCompanion();
      if (
        companion &&
        conn.client.version &&
        versionNewer(companion.version, conn.client.version)
      ) {
        ws.send(JSON.stringify({ type: 'update', ...companion }));
        console.log(
          `[BROWSER] Desktop companion ${conn.client.version} -> ${companion.version} pushed (${conn.client.label})`
        );
      }
    }
    console.log(
      `[BROWSER] ${kind} connected (${conn.client.label}, ${conn.client.name} ${conn.client.version}) user=${conn.userId}`
    );
    return conn;
  }

  private handleFrame(conn: Connection, frame: Record<string, unknown>): void {
    if (frame.type === 'rpc' && typeof frame.id === 'string') {
      void this.answerRpc(conn, frame.id, frame);
      return;
    }
    if (frame.type === 'state') {
      if (typeof frame.paused === 'boolean') conn.paused = frame.paused;
      if (typeof frame.mode === 'string') conn.mode = frame.mode.slice(0, 20);
      if (typeof frame.recording === 'boolean') conn.recording = frame.recording;
      if (typeof frame.tabGroups === 'boolean') conn.tabGroups = frame.tabGroups;
      if (frame.active === true) conn.activeAt = new Date();
      if (conn.client.kind === 'desktop' && frame.desktopActivity) {
        const parsed = desktopActivitySchema.safeParse(frame.desktopActivity);
        if (parsed.success) conn.desktopActivity = parsed.data;
      }
      return;
    }
    if (frame.type !== 'result' || typeof frame.id !== 'string') return;
    const pending = conn.pending.get(frame.id);
    if (!pending) return;
    conn.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.ok === false) {
      pending.resolve({
        content: [{ type: 'text', text: text(frame.error, 4000) || 'Browser action failed' }],
        isError: true,
      });
      return;
    }
    const content = Array.isArray(frame.content)
      ? (frame.content.filter(
          (item) => item && typeof item === 'object' && typeof item.type === 'string'
        ) as BrowserToolContent[])
      : [];
    pending.resolve({ content: content.length ? content : [{ type: 'text', text: 'OK' }] });
  }

  /** Session picker requests from the extension's own UI (see rpc.ts). */
  private chatFor(conn: Connection): ChatRelay {
    return (conn.chat ??= new ChatRelay(conn.userId, (event, payload) => {
      if (conn.ws.readyState === WebSocket.OPEN)
        conn.ws.send(JSON.stringify({ type: 'event', event, payload }));
    }));
  }

  private async answerRpc(
    conn: Connection,
    id: string,
    frame: Record<string, unknown>
  ): Promise<void> {
    const params =
      frame.params && typeof frame.params === 'object' && !Array.isArray(frame.params)
        ? (frame.params as Record<string, unknown>)
        : {};
    let reply: Record<string, unknown>;
    try {
      const data = await handleBridgeRpc(
        {
          userId: conn.userId,
          connectionId: conn.id,
          kind: conn.client.kind,
          pinSession: (sessionId) =>
            this.sessionBrowser.set(sessionId, {
              connectionId: conn.id,
              pinned: true,
              lastCallAt: Date.now(),
            }),
          unpinSession: (sessionId) => {
            if (this.sessionBrowser.get(sessionId)?.connectionId === conn.id) {
              this.sessionBrowser.delete(sessionId);
            }
          },
          chat: () => this.chatFor(conn),
          sessionsOnThisBrowser: () =>
            new Set(
              [...this.sessionBrowser.entries()]
                .filter(([, entry]) => entry.pinned && entry.connectionId === conn.id)
                .map(([sessionId]) => sessionId)
            ),
        },
        text(frame.method, 64),
        params
      );
      reply = { type: 'rpcResult', id, ok: true, data };
    } catch (error) {
      reply = {
        type: 'rpcResult',
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(reply));
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const conn of this.connections.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
      // A revoked token must not keep a socket open until the next reconnect.
      if (now - conn.connectedAt.getTime() > TOKEN_RECHECK_MS) {
        void isBrowserTokenActive(conn.tokenId).then((active) => {
          if (!active) conn.ws.close(4401, 'token revoked');
        });
      }
    }
  }
}

export const browserBridge = new BrowserBridge();
