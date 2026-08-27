import { ChildProcess, spawn as cpSpawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { URL } from 'url';
import { nanoid } from 'nanoid';
import type { SessionMode } from '@plum-code-webui/shared';
import { buildOpenCodePermissionRules, CLI_PROVIDERS } from '../cli-providers.js';
import { config } from '../../config.js';
import { buildIntegrationEnv } from '../../utils/integrationEnv.js';
import { buildOpenCodeCommandEnv } from '../../utils/opencodeCatalog.js';
import {
  buildOpenCodeProviderCredentialEnv,
  getOpenCodeProviderCredentialFingerprint,
} from '../../utils/opencodeProviderKeys.js';
import { syncProviderLinks } from '../../utils/providerLinks.js';
import { buildOpenCodePromptText, getOpenCodePrimaryAgent } from './sessionContext.js';
import {
  ensureOpenCodeTenantDirectories,
  resolveOpenCodeTenantPaths,
  type OpenCodeTenantPaths,
} from './tenantPaths.js';

const DEBUG_LOG = '/app/packages/backend/data/oc-debug.log';
function ocDbg(line: string): void {
  try {
    fs.appendFileSync(DEBUG_LOG, new Date().toISOString() + ' ' + line + '\n');
  } catch (e) {
    console.error('[OC-DBG-ERR]', e);
  }
}

export function shouldDetachOpenCodeServer(platform: NodeJS.Platform): boolean {
  return platform !== 'win32';
}

function signalOpenCodeProcess(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (shouldDetachOpenCodeServer(process.platform) && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      console.warn(
        `[OPENCODE-SERVER] failed to signal process group ${child.pid} with ${signal}:`,
        error
      );
    }
  }

  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

// One OpencodeServer instance owns one WebUI user's OpenCode process, config,
// credentials, data store and SSE stream. It multiplexes that user's sessions
// internally, but never shares mutable process state with another user.

export type OpencodeEvent = Record<string, unknown> & {
  type: string;
  properties?: Record<string, unknown>;
};

export function permissionRequestBelongsToSession(
  boundSessionId: string | undefined,
  expectedSessionId: string | undefined
): boolean {
  return Boolean(boundSessionId && expectedSessionId && boundSessionId === expectedSessionId);
}

type Handler = (event: OpencodeEvent) => void;

type OpenCodeMessageSnapshot = {
  info?: Record<string, unknown>;
  parts?: Array<Record<string, unknown>>;
};

export type OpenCodeUsageCounters = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export const EMPTY_OPENCODE_USAGE: OpenCodeUsageCounters = {
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export function collectOpenCodeMessageUsage(
  messages: OpenCodeMessageSnapshot[],
  seenMessageIds: Set<string> = new Set()
): OpenCodeUsageCounters {
  const total = { ...EMPTY_OPENCODE_USAGE };
  for (const message of messages) {
    const info = message.info;
    if (!info || info.role !== 'assistant') continue;
    const messageId = typeof info.id === 'string' ? info.id : '';
    if (!messageId || seenMessageIds.has(messageId)) continue;
    seenMessageIds.add(messageId);

    const tokens = info.tokens as Record<string, unknown> | undefined;
    const cache = tokens?.cache as Record<string, unknown> | undefined;
    total.input += Number(tokens?.input) || 0;
    total.output += Number(tokens?.output) || 0;
    total.reasoning += Number(tokens?.reasoning) || 0;
    total.cacheRead += Number(cache?.read) || 0;
    total.cacheWrite += Number(cache?.write) || 0;
  }
  return total;
}

export function subtractOpenCodeUsage(
  total: OpenCodeUsageCounters,
  baseline: OpenCodeUsageCounters
): OpenCodeUsageCounters | null {
  const keys = Object.keys(total) as Array<keyof OpenCodeUsageCounters>;
  if (keys.some((key) => total[key] < baseline[key])) return null;
  return {
    input: total.input - baseline.input,
    output: total.output - baseline.output,
    reasoning: total.reasoning - baseline.reasoning,
    cacheRead: total.cacheRead - baseline.cacheRead,
    cacheWrite: total.cacheWrite - baseline.cacheWrite,
  };
}

function addOpenCodeUsage(target: OpenCodeUsageCounters, addition: OpenCodeUsageCounters): void {
  target.input += addition.input;
  target.output += addition.output;
  target.reasoning += addition.reasoning;
  target.cacheRead += addition.cacheRead;
  target.cacheWrite += addition.cacheWrite;
}

type OpenCodePollState = {
  // OpenCode assigns every assistant step in a turn the initiating user
  // message as parentID. Filtering on this ID keeps polling scoped to one turn.
  turnMessageId: string;
  // partID → length of text/output already surfaced, so we only re-emit growth
  textLens: Map<string, number>;
  // partID → last observed tool state.status, so we don't re-emit unchanged states
  toolStatus: Map<string, string>;
  // Last observed tool part from the current turn, used for actionable stall diagnostics.
  lastToolActivity: OpenCodeToolActivitySummary | null;
  // messageIDs we've already flushed as finished
  finishedMessages: Set<string>;
  // idle flag: once we emit session.idle we stop polling
  idled: boolean;
  observedChange: boolean;
  // Last time polling observed assistant text, reasoning, tool state, or step progress.
  lastObservedAt: number | null;
  // Timestamp when the last assistant message landed in a terminal state.
  idleCandidateAt: number | null;
  // When polling started — safety cap so a stuck session doesn't poll forever.
  startedAt: number;
  // Soft cap for no first observable assistant output. 0 disables this cap.
  noProgressTimeoutMs: number;
};

export type OpenCodeToolActivitySummary = {
  messageId?: string;
  partId: string;
  callId?: string;
  tool: string;
  status: string;
  preview?: string;
};

const DIAGNOSTIC_PREVIEW_MAX = 180;
const SENSITIVE_ASSIGNMENT_RE =
  /\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTH)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s]+)/gi;
const SENSITIVE_HEADER_RE =
  /\b(authorization|cookie|x-[a-z0-9-]*(?:token|key|secret|auth)[a-z0-9-]*):\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi;
const SENSITIVE_BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function diagnosticPreview(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(SENSITIVE_ASSIGNMENT_RE, '$1=<redacted>')
    .replace(SENSITIVE_BEARER_RE, 'Bearer <redacted>')
    .replace(SENSITIVE_HEADER_RE, '$1: <redacted>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.length > DIAGNOSTIC_PREVIEW_MAX
    ? `${normalized.slice(0, DIAGNOSTIC_PREVIEW_MAX - 1)}…`
    : normalized;
}

function summarizeOpenCodeToolPart(
  part: Record<string, unknown>,
  messageId?: string
): OpenCodeToolActivitySummary | null {
  const partId = typeof part.id === 'string' ? part.id : undefined;
  if (!partId) return null;
  const stateField = part.state as Record<string, unknown> | undefined;
  const tool =
    (typeof part.tool === 'string' && part.tool) ||
    (typeof stateField?.tool === 'string' && stateField.tool) ||
    (typeof stateField?.name === 'string' && stateField.name) ||
    'tool';
  const status =
    (typeof stateField?.status === 'string' && stateField.status) ||
    (typeof part.status === 'string' && part.status) ||
    'unknown';
  const input = stateField?.input as Record<string, unknown> | undefined;
  const preview =
    diagnosticPreview(stateField?.title) ||
    diagnosticPreview(input?.command) ||
    diagnosticPreview(stateField?.command) ||
    diagnosticPreview(part.title);
  const callId =
    (typeof part.callID === 'string' && part.callID) ||
    (typeof part.callId === 'string' && part.callId) ||
    undefined;

  return { messageId, partId, callId, tool, status, preview };
}

export function collectOpenCodePollCursor(data: OpenCodeMessageSnapshot[]): {
  textLens: Map<string, number>;
  toolStatus: Map<string, string>;
  finishedMessages: Set<string>;
  lastToolActivity: OpenCodeToolActivitySummary | null;
} {
  const textLens = new Map<string, number>();
  const toolStatus = new Map<string, string>();
  const finishedMessages = new Set<string>();
  let lastToolActivity: OpenCodeToolActivitySummary | null = null;

  for (const msg of data) {
    const info = msg.info as Record<string, unknown> | undefined;
    if (!info || info.role !== 'assistant') continue;
    const messageId = typeof info.id === 'string' ? info.id : undefined;

    for (const part of msg.parts || []) {
      const partId = typeof part.id === 'string' ? part.id : undefined;
      const partType = typeof part.type === 'string' ? part.type : undefined;
      if (!partId || !partType) continue;

      if (partType === 'text' || partType === 'reasoning') {
        const text = typeof part.text === 'string' ? part.text : '';
        textLens.set(partId, text.length);
        continue;
      }

      if (partType === 'tool') {
        const stateField = part.state as { status?: string } | undefined;
        toolStatus.set(partId, stateField?.status ?? '');
        lastToolActivity = summarizeOpenCodeToolPart(part, messageId);
        continue;
      }

      if (partType === 'step-start' || partType === 'step-finish') {
        textLens.set(partId, 1);
      }
    }

    if (messageId && isTerminalOpenCodeAssistantMessage(msg)) {
      finishedMessages.add(messageId);
    }
  }

  return { textLens, toolStatus, finishedMessages, lastToolActivity };
}

interface PromptOptions {
  text: string;
  /** Stable WebUI turn id used to scope the polling fallback to this prompt. */
  turnId?: string;
  /** `providerID/modelID` slash-form, as stored in cli-providers. */
  model?: string | null;
  agent?: string | null;
  mode?: SessionMode;
  variant?: string | null;
  /** Session working directory, used to sandbox tools. */
  directory?: string;
  /** Plum WebUI session id for MCP bridge attribution. */
  webuiSessionId?: string;
  /** WebUI user id, used to bind the singleton server to the right provider keys. */
  userId?: string;
}

type OpenCodeRunOptions = Omit<PromptOptions, 'text'>;

interface CommandOptions extends OpenCodeRunOptions {
  command: string;
  arguments?: string;
}

interface CreateSessionOptions {
  model?: string | null;
  agent?: string | null;
  mode?: SessionMode;
  variant?: string | null;
  allowedDirectories?: string[];
  userId?: string;
}

const READY_LINE_RE = /opencode server listening on (http:\/\/[^\s]+)/i;
const WEBUI_SESSION_CONTEXT_FILE = path.join(os.tmpdir(), 'plum-opencode-webui-session.json');
const DEFAULT_OPENCODE_NO_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_OPENCODE_NO_PROGRESS_TIMEOUT_MS = 30_000;
const OPENCODE_HARD_SAFETY_TIMEOUT_MS = 30 * 60 * 1000;
export const OPENCODE_POLL_MESSAGE_LIMIT = 64;
const OPENCODE_POLL_INTERVAL_MS = 500;
const OPENCODE_POLL_REQUEST_TIMEOUT_MS = 10_000;

const OPENCODE_PROCESS_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'NPM_CONFIG_PREFIX',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'GODOT_BIN',
  'BLENDER_BIN',
] as const;

export function buildOpenCodeServerProcessEnv(
  source: NodeJS.ProcessEnv = buildOpenCodeCommandEnv()
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of OPENCODE_PROCESS_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function buildOpenCodeTurnMessageId(turnId?: string): string {
  const safeTurnId = turnId?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return `msg_plum_${safeTurnId || nanoid()}`;
}

export function buildOpenCodePollMessagesUrl(
  baseUrl: string,
  opencodeSessionId: string,
  limit = OPENCODE_POLL_MESSAGE_LIMIT
): string {
  const url = new URL(
    `/session/${encodeURIComponent(opencodeSessionId)}/message`,
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  );
  url.searchParams.set('limit', String(Math.max(1, Math.trunc(limit))));
  return url.toString();
}

export function selectOpenCodeTurnMessages(
  data: OpenCodeMessageSnapshot[],
  turnMessageId: string
): OpenCodeMessageSnapshot[] {
  return data.filter((message) => {
    const info = message.info;
    if (!info) return false;
    if (info.id === turnMessageId && info.role === 'user') return true;
    return info.role === 'assistant' && info.parentID === turnMessageId;
  });
}

export function resolveOpenCodeNoProgressTimeoutMs(
  value: string | null | undefined = process.env.OPENCODE_NO_PROGRESS_TIMEOUT_MS
): number {
  if (value === null || value === undefined || value.trim() === '') {
    return DEFAULT_OPENCODE_NO_PROGRESS_TIMEOUT_MS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_OPENCODE_NO_PROGRESS_TIMEOUT_MS;
  }
  if (parsed <= 0) {
    return 0;
  }

  return Math.max(Math.trunc(parsed), MIN_OPENCODE_NO_PROGRESS_TIMEOUT_MS);
}

export function hasOpenCodeHardSafetyTimeoutElapsed(now: number, startedAt: number): boolean {
  return now - startedAt > OPENCODE_HARD_SAFETY_TIMEOUT_MS;
}

export type OpenCodeStallTimeoutReason = 'no-progress' | 'stalled';

export function resolveOpenCodeStallTimeout(opts: {
  now: number;
  startedAt: number;
  lastObservedAt: number | null;
  observedChange: boolean;
  timeoutMs: number;
}): OpenCodeStallTimeoutReason | null {
  if (opts.timeoutMs <= 0) return null;

  if (!opts.observedChange) {
    return opts.now - opts.startedAt > opts.timeoutMs ? 'no-progress' : null;
  }

  const lastObservedAt = opts.lastObservedAt ?? opts.startedAt;
  return opts.now - lastObservedAt > opts.timeoutMs ? 'stalled' : null;
}

export function formatOpenCodeStallErrorMessage(
  reason: OpenCodeStallTimeoutReason,
  timeoutSeconds: number,
  lastToolActivity?: OpenCodeToolActivitySummary | null
): string {
  const base =
    reason === 'no-progress'
      ? `OpenCode did not produce any output within ${timeoutSeconds}s. Slow first-token models can exceed this; check the selected provider/model or raise OPENCODE_NO_PROGRESS_TIMEOUT_MS.`
      : `OpenCode produced output but then had no further activity for ${timeoutSeconds}s, so Plum aborted the turn. This usually means a tool call or provider stream stalled; raise OPENCODE_NO_PROGRESS_TIMEOUT_MS if this workload legitimately runs longer without output.`;

  if (!lastToolActivity) return base;

  const details = [
    `Last observed tool: ${lastToolActivity.tool}`,
    `status: ${lastToolActivity.status}`,
  ];
  if (lastToolActivity.preview) details.push(`preview: ${lastToolActivity.preview}`);
  return `${base} ${details.join('; ')}.`;
}

export function resolveOpenCodeProviderTurnGateKey(
  model: string | null | undefined
): string | null {
  if (!model) return null;
  const parsed = splitModel(model);
  const providerId = parsed?.providerID.trim().toLowerCase();
  return providerId === 'z-ai' || providerId === 'zai' ? 'z-ai' : null;
}

export class OpenCodeProviderTurnGate {
  private active = new Map<string, string>();
  private queued = new Map<
    string,
    Array<{
      sessionId: string;
      resolve: (release: () => void) => void;
      reject: (reason: Error) => void;
    }>
  >();

  async acquire(key: string | null, sessionId: string): Promise<() => void> {
    if (!key) return () => undefined;

    if (!this.active.has(key)) {
      this.active.set(key, sessionId);
      return this.releaseOnce(key, sessionId);
    }

    return new Promise<() => void>((resolve, reject) => {
      const queue = this.queued.get(key) ?? [];
      queue.push({ sessionId, resolve, reject });
      this.queued.set(key, queue);
    });
  }

  releaseForSession(sessionId: string): void {
    for (const [key, queue] of this.queued.entries()) {
      const cancelled = queue.filter((item) => item.sessionId === sessionId);
      const nextQueue = queue.filter((item) => item.sessionId !== sessionId);
      if (nextQueue.length === 0) {
        this.queued.delete(key);
      } else {
        this.queued.set(key, nextQueue);
      }
      for (const item of cancelled) {
        item.reject(new Error(`OpenCode provider turn cancelled for ${sessionId}`));
      }
    }

    for (const [key, activeSessionId] of this.active.entries()) {
      if (activeSessionId === sessionId) {
        this.release(key, sessionId);
      }
    }
  }

  cancelAll(reason = 'OpenCode provider turn gate cancelled'): void {
    const error = new Error(reason);
    for (const queue of this.queued.values()) {
      for (const item of queue) {
        item.reject(error);
      }
    }
    this.queued.clear();
    this.active.clear();
  }

  private releaseOnce(key: string, sessionId: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(key, sessionId);
    };
  }

  private release(key: string, sessionId: string): void {
    if (this.active.get(key) !== sessionId) return;

    const queue = this.queued.get(key) ?? [];
    const next = queue.shift();
    if (queue.length === 0) {
      this.queued.delete(key);
    } else {
      this.queued.set(key, queue);
    }

    if (!next) {
      this.active.delete(key);
      return;
    }

    this.active.set(key, next.sessionId);
    next.resolve(this.releaseOnce(key, next.sessionId));
  }
}

export class OpencodeServer {
  private proc: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private startPromise: Promise<string> | null = null;
  private sseController: AbortController | null = null;
  private sseReconnectDelayMs = 500;
  private sseLoopRunning = false;
  private shuttingDown = false;

  // SSE liveness: set true once the /event stream is actually open and
  // streaming. Toggled false on disconnect so sendPrompt can wait for
  // reconnect rather than fire prompts into a silent window (events
  // emitted while disconnected are lost — opencode SSE isn't replayable).
  private sseConnected = false;
  private sseReadyWaiters: Array<() => void> = [];
  private credentialOwnerUserId: string | null = null;
  private credentialFingerprint: string | null = null;

  // sessionID (opencode's, not webui's) → handler
  private handlers = new Map<string, Handler>();
  // Fallback handler for events that arrive before we know the sessionID
  // mapping (e.g. provider errors at connect time). Rarely used.
  private globalHandlers = new Set<Handler>();
  private timeoutAbortedSessions = new Set<string>();
  private providerTurnGate = new OpenCodeProviderTurnGate();
  private providerGateReleases = new Map<string, () => void>();
  private permissionRequestSessions = new Map<string, { sessionId: string; createdAt: number }>();

  // Per-session polling fallback. opencode 1.4.x/1.14.x publishes events to
  // its internal bus but the /event SSE stream only forwards heartbeats —
  // verified across versions 1.4.17, 1.14.17, 1.14.22 on Alpine/musl. We
  // compensate by polling /session/{id}/message after each prompt and
  // synthesising the events the dispatcher would have seen.
  private pollTimers = new Map<string, NodeJS.Timeout>();
  private pollControllers = new Map<string, AbortController>();
  private pollState = new Map<string, OpenCodePollState>();

  private events = new EventEmitter();
  private readonly tenantUserId: string | null;
  private readonly tenantPaths: OpenCodeTenantPaths | null;

  constructor(opts: { userId?: string; paths?: OpenCodeTenantPaths } = {}) {
    this.tenantUserId = opts.userId || null;
    this.tenantPaths = opts.paths || (opts.userId ? resolveOpenCodeTenantPaths(opts.userId) : null);
  }

  private resolveUserId(userId?: string): string | undefined {
    const effectiveUserId = userId || this.tenantUserId || undefined;
    if (this.tenantUserId && effectiveUserId !== this.tenantUserId) {
      throw new Error('OpenCode tenant user mismatch');
    }
    return effectiveUserId;
  }

  /**
   * Ensure the `opencode serve` process is running and the SSE subscription
   * is live. Returns the base URL once ready. Idempotent.
   */
  async ensureStarted(userId?: string): Promise<string> {
    const effectiveUserId = this.resolveUserId(userId);
    if (this.tenantPaths) ensureOpenCodeTenantDirectories(this.tenantPaths);
    const configSync = (
      await syncProviderLinks({
        quiet: true,
        userId: effectiveUserId,
        opencodeConfigPath: this.tenantPaths
          ? path.join(this.tenantPaths.configDir, 'opencode.json')
          : undefined,
        opencodeAgentsDir: this.tenantPaths
          ? path.join(this.tenantPaths.configDir, 'agents')
          : undefined,
      })
    ).opencodeConfig;
    if (this.baseUrl && this.proc && !this.proc.killed) {
      if (configSync.updated && effectiveUserId) {
        await this.restart(effectiveUserId);
        if (this.baseUrl) return this.baseUrl;
      }
      if (effectiveUserId) {
        const nextFingerprint = await getOpenCodeProviderCredentialFingerprint(effectiveUserId);
        if (
          this.credentialOwnerUserId !== effectiveUserId ||
          this.credentialFingerprint !== nextFingerprint
        ) {
          await this.restart(effectiveUserId);
          if (this.baseUrl) return this.baseUrl;
        }
      }
      return this.baseUrl;
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal(effectiveUserId).catch((err) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  private startInternal(userId?: string): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      this.shuttingDown = false;
      this.sseConnected = false;
      this.sseReconnectDelayMs = 500;
      this.credentialOwnerUserId = userId || null;
      this.credentialFingerprint = await getOpenCodeProviderCredentialFingerprint(userId);

      if (this.tenantPaths) ensureOpenCodeTenantDirectories(this.tenantPaths);
      const commandEnv = buildOpenCodeCommandEnv();
      const env = {
        ...buildOpenCodeServerProcessEnv(commandEnv),
        ...(await buildIntegrationEnv()),
        ...(await buildOpenCodeProviderCredentialEnv(userId)),
        OPENCODE_CONFIG_DIR: this.tenantPaths?.configDir || commandEnv.OPENCODE_CONFIG_DIR || '',
        OPENCODE_DATA_DIR: this.tenantPaths?.dataDir || commandEnv.OPENCODE_DATA_DIR || '',
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_HOOK_SECRET: config.hookSecret,
        WEBUI_SESSION_CONTEXT_FILE:
          this.tenantPaths?.sessionContextFile || WEBUI_SESSION_CONTEXT_FILE,
      };

      const proc = cpSpawn(
        CLI_PROVIDERS.opencode.command,
        ['serve', '--port', '0', '--hostname', '127.0.0.1'],
        {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          // Give opencode serve and every tool/MCP child one process group so
          // timeout and shutdown can reap the complete tree.
          detached: shouldDetachOpenCodeServer(process.platform),
        }
      );

      this.proc = proc;
      let ready = false;
      let buf = '';

      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        buf += text;
        // Ready line can land in either stream depending on opencode version.
        const m = buf.match(READY_LINE_RE);
        if (m && m[1] && !ready) {
          ready = true;
          this.baseUrl = m[1].replace(/\/$/, '');
          console.log(`[OPENCODE-SERVER] ready at ${this.baseUrl}`);
          // Kick off the SSE subscription loop (non-blocking).
          void this.startEventLoop();
          resolve(this.baseUrl);
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('exit', (code, signal) => {
        console.log(`[OPENCODE-SERVER] exited code=${code} signal=${signal}`);
        this.proc = null;
        this.baseUrl = null;
        this.startPromise = null;
        if (!ready) {
          reject(new Error(`opencode serve exited before ready (code=${code})`));
        }
        this.events.emit('exit', { code, signal });
      });

      proc.on('error', (err) => {
        console.error('[OPENCODE-SERVER] spawn error:', err);
        if (!ready) reject(err);
      });

      // Hard timeout: if `opencode serve` hangs, fail fast rather than lock up
      // the first session attempt forever.
      setTimeout(() => {
        if (!ready) {
          signalOpenCodeProcess(proc, 'SIGKILL');
          reject(new Error('opencode serve did not announce readiness within 15s'));
        }
      }, 15_000);
    });
  }

  /**
   * Long-running SSE consumer. Auto-reconnects with backoff if the stream
   * drops (e.g. server restart). Exits cleanly on shutdown.
   */
  private async startEventLoop(): Promise<void> {
    if (this.sseLoopRunning) return;
    this.sseLoopRunning = true;

    while (!this.shuttingDown && this.baseUrl) {
      try {
        await this.consumeEventStream();
      } catch (err) {
        if (this.shuttingDown) break;
        console.error('[OPENCODE-SERVER] SSE loop error:', err);
      }
      if (this.shuttingDown) break;
      await sleep(this.sseReconnectDelayMs);
      this.sseReconnectDelayMs = Math.min(this.sseReconnectDelayMs * 2, 10_000);
    }

    this.sseLoopRunning = false;
  }

  private consumeEventStream(): Promise<void> {
    if (!this.baseUrl) return Promise.reject(new Error('no baseUrl'));

    // Using Node's native http.get rather than global fetch: undici's fetch
    // buffers the response body aggressively for SSE, which caused bus
    // events (message.part.delta, etc.) to never surface to our reader while
    // heartbeats did. The low-level `http` module delivers each chunk as it
    // arrives, matching what `curl -N` sees on the same socket.
    return new Promise<void>((resolve, reject) => {
      const url = new URL('/event', this.baseUrl!);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          headers: { Accept: 'text/event-stream' },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            settle(() => reject(new Error(`SSE failed: ${res.statusCode}`)));
            return;
          }

          res.setEncoding('utf8');
          this.sseReconnectDelayMs = 500;
          console.log('[OPENCODE-SERVER] SSE connected');
          ocDbg('[SSE] connected baseUrl=' + this.baseUrl);
          this.sseConnected = true;
          const waiters = this.sseReadyWaiters.splice(0);
          for (const w of waiters) {
            try {
              w();
            } catch {
              /* noop */
            }
          }

          // Cap the reassembly buffer: a frame that never terminates with
          // "\n\n" (misbehaving server, proxy mangling) would otherwise grow
          // memory without bound. 8 MB is far above any legitimate SSE frame.
          const MAX_SSE_BUFFER_BYTES = 8 * 1024 * 1024;
          let buffer = '';
          res.on('data', (chunk: string) => {
            buffer += chunk;
            if (buffer.length > MAX_SSE_BUFFER_BYTES) {
              console.warn(
                `[OPENCODE-SERVER] SSE buffer exceeded ${MAX_SSE_BUFFER_BYTES} bytes without a frame delimiter; discarding buffered data`
              );
              buffer = '';
              return;
            }
            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const dataLine = frame
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .join('\n');
              if (!dataLine) continue;
              try {
                const evt = JSON.parse(dataLine) as OpencodeEvent;
                this.dispatch(evt);
              } catch (err) {
                console.warn('[OPENCODE-SERVER] bad SSE frame:', err);
              }
            }
          });

          res.on('end', () => {
            this.sseConnected = false;
            console.log('[OPENCODE-SERVER] SSE disconnected (end)');
            settle(() => resolve());
          });

          res.on('error', (err) => {
            this.sseConnected = false;
            console.log('[OPENCODE-SERVER] SSE disconnected (error)');
            settle(() => reject(err));
          });
        }
      );

      // Wire the abort controller to destroy the request. Swap out the field
      // so shutdown()/reconnect can tear it down.
      const controller = new AbortController();
      this.sseController = controller;
      controller.signal.addEventListener(
        'abort',
        () => {
          try {
            req.destroy();
          } catch {
            /* noop */
          }
        },
        { once: true }
      );

      req.on('error', (err) => {
        this.sseConnected = false;
        settle(() => reject(err));
      });
    });
  }

  /**
   * Resolve once the SSE stream is open and streaming. If already connected
   * this returns immediately; otherwise it queues a waiter that is released
   * by the event-loop on the next successful connect. Times out after
   * `timeoutMs` so a permanently-dead opencode doesn't deadlock the caller.
   */
  private waitForSseReady(timeoutMs = 10_000): Promise<void> {
    if (this.sseConnected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.sseReadyWaiters.indexOf(done);
        if (i >= 0) this.sseReadyWaiters.splice(i, 1);
        reject(new Error(`SSE did not reconnect within ${timeoutMs}ms`));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.sseReadyWaiters.push(done);
    });
  }

  private dispatch(evt: OpencodeEvent): void {
    const sid = extractSessionId(evt);
    if (sid && (evt.type === 'permission.asked' || evt.type === 'permission.v2.asked')) {
      const requestId =
        typeof evt.properties?.id === 'string' ? (evt.properties.id as string) : undefined;
      if (requestId) {
        const cutoff = Date.now() - 5 * 60 * 1000;
        for (const [id, binding] of this.permissionRequestSessions) {
          if (binding.createdAt < cutoff) this.permissionRequestSessions.delete(id);
        }
        this.permissionRequestSessions.set(requestId, { sessionId: sid, createdAt: Date.now() });
      }
    }
    if (
      sid &&
      this.timeoutAbortedSessions.has(sid) &&
      evt.type === 'session.error' &&
      extractEventErrorMessage(evt) === 'Aborted'
    ) {
      ocDbg(`[OC-DISPATCH] suppress timeout abort sid=${sid}`);
      return;
    }
    if (evt.type !== 'server.heartbeat') {
      const routed = sid && this.handlers.has(sid);
      ocDbg(
        `[OC-DISPATCH] type=${evt.type} sid=${sid ?? 'NONE'} routed=${routed} handlers=${Array.from(
          this.handlers.keys()
        )
          .map((k) => k.slice(-10))
          .join(',')}`
      );
    }
    if (process.env.OPENCODE_DEBUG_EVENTS === '1') {
      const routed = sid && this.handlers.has(sid);
      const preview = JSON.stringify(evt).slice(0, 240);
      console.log(
        `[OPENCODE-SSE] type=${evt.type} sid=${sid ?? 'NONE'} routed=${routed} ${preview}`
      );
    }
    if (sid && (evt.type === 'session.idle' || evt.type === 'session.error')) {
      this.releaseProviderTurnGate(sid);
    }
    if (sid && this.handlers.has(sid)) {
      try {
        this.handlers.get(sid)!(evt);
      } catch (err) {
        console.error('[OPENCODE-SERVER] handler threw:', err);
      }
    }
    // Always fan out to global handlers (e.g. for logging).
    for (const h of this.globalHandlers) {
      try {
        h(evt);
      } catch {
        /* noop */
      }
    }
  }

  /**
   * Register a handler that receives every event for a given opencode session.
   */
  subscribe(opencodeSessionId: string, handler: Handler): void {
    this.handlers.set(opencodeSessionId, handler);
    ocDbg(`[SUB] register sid=${opencodeSessionId} total=${this.handlers.size}`);
  }

  unsubscribe(opencodeSessionId: string): void {
    this.handlers.delete(opencodeSessionId);
    this.releaseProviderTurnGate(opencodeSessionId);
    this.providerTurnGate.releaseForSession(opencodeSessionId);
    this.stopPolling(opencodeSessionId);
    this.pollState.delete(opencodeSessionId);
    for (const [requestId, binding] of this.permissionRequestSessions) {
      if (binding.sessionId === opencodeSessionId) {
        this.permissionRequestSessions.delete(requestId);
      }
    }
  }

  private releaseProviderTurnGate(opencodeSessionId: string): void {
    const release = this.providerGateReleases.get(opencodeSessionId);
    if (!release) return;
    this.providerGateReleases.delete(opencodeSessionId);
    release();
    ocDbg(`[OC-GATE] released sid=${opencodeSessionId}`);
  }

  /** Create a new opencode session, returns the session ID. */
  async createSession(cwd: string, opts: CreateSessionOptions = {}): Promise<string> {
    await this.ensureStarted(opts.userId);
    await this.waitForSseReady();
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(cwd)}`;
    const body: Record<string, unknown> = {};
    const model = opts.model ? splitModel(opts.model) : null;
    if (model) {
      body.model = {
        id: model.modelID,
        providerID: model.providerID,
        ...(opts.variant ? { variant: normalizeVariant(opts.variant) } : {}),
      };
    }
    const agent = opts.agent || getOpenCodePrimaryAgent();
    if (agent) body.agent = agent;
    body.permission = buildOpenCodePermissionRules(opts.mode, {
      workingDirectory: cwd,
      allowedDirectories: opts.allowedDirectories,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  /**
   * Send a prompt to a session. Returns immediately — the actual response
   * streams over SSE. Uses /prompt_async to avoid blocking the HTTP
   * connection while the model runs.
   */
  async sendPrompt(opencodeSessionId: string, opts: PromptOptions): Promise<void> {
    await this.ensureStarted(opts.userId);
    // SSE events emitted while the stream is disconnected are not buffered
    // or replayed by opencode — they're just dropped. Block here until the
    // stream is open so the model's output doesn't land in a dead window.
    await this.waitForSseReady();
    this.writeWebuiSessionContext(opencodeSessionId, opts);
    const gateKey = resolveOpenCodeProviderTurnGateKey(opts.model);
    const releaseGate = await this.providerTurnGate.acquire(gateKey, opencodeSessionId);
    if (gateKey) {
      this.providerGateReleases.set(opencodeSessionId, releaseGate);
      ocDbg(`[OC-GATE] acquired key=${gateKey} sid=${opencodeSessionId}`);
    }
    const turnMessageId = buildOpenCodeTurnMessageId(opts.turnId);
    const body: Record<string, unknown> = {
      messageID: turnMessageId,
      parts: [
        {
          type: 'text',
          text: buildOpenCodePromptText(opts.text, {
            webuiSessionId: opts.webuiSessionId,
            mode: opts.mode,
            reasoningLevel: opts.variant,
          }),
        },
      ],
    };
    if (opts.model) {
      const model = splitModel(opts.model);
      if (model) body.model = model;
    }
    const agent = opts.agent || getOpenCodePrimaryAgent();
    if (agent) body.agent = agent;
    if (opts.variant) body.variant = normalizeVariant(opts.variant);

    // NOTE: Do not pass a `tools` map here. When `tools` is present in the
    // /prompt_async body, opencode silently suppresses ALL bus events
    // (message.updated, message.part.delta, etc.) while still persisting
    // the assistant response — so the UI never sees a reply. Permission
    // policy has to be configured via session/agent config instead.
    const qs = opts.directory ? `?directory=${encodeURIComponent(opts.directory)}` : '';
    const url = `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/prompt_async${qs}`;
    ocDbg(
      `[OC-SEND] sid=${opencodeSessionId} subscribed=${this.handlers.has(opencodeSessionId)} handlerCount=${this.handlers.size} sseConnected=${this.sseConnected} body=${JSON.stringify(body).slice(0, 200)}`
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      ocDbg(`[OC-SEND] response status=${res.status}`);
      if (!res.ok) {
        this.releaseProviderTurnGate(opencodeSessionId);
        throw new Error(`sendPrompt failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.releaseProviderTurnGate(opencodeSessionId);
      throw err;
    }
    this.startPolling(opencodeSessionId, turnMessageId);
  }

  /**
   * Execute an OpenCode-native slash command through the server command API.
   * This preserves command semantics for /init, /review, /security-review, etc.
   * instead of sending the slash command as plain chat text.
   */
  async sendCommand(opencodeSessionId: string, opts: CommandOptions): Promise<void> {
    await this.ensureStarted(opts.userId);
    await this.waitForSseReady();
    this.writeWebuiSessionContext(opencodeSessionId, opts);
    const gateKey = resolveOpenCodeProviderTurnGateKey(opts.model);
    const releaseGate = await this.providerTurnGate.acquire(gateKey, opencodeSessionId);
    if (gateKey) {
      this.providerGateReleases.set(opencodeSessionId, releaseGate);
      ocDbg(`[OC-GATE] acquired key=${gateKey} sid=${opencodeSessionId}`);
    }

    const turnMessageId = buildOpenCodeTurnMessageId(opts.turnId);
    const body: Record<string, unknown> = {
      messageID: turnMessageId,
      command: opts.command,
      arguments: opts.arguments ?? '',
    };
    if (opts.model) body.model = opts.model;
    const agent = opts.agent || getOpenCodePrimaryAgent();
    if (agent) body.agent = agent;
    if (opts.variant) body.variant = normalizeVariant(opts.variant);

    const qs = opts.directory ? `?directory=${encodeURIComponent(opts.directory)}` : '';
    const url = `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/command${qs}`;
    ocDbg(
      `[OC-COMMAND] sid=${opencodeSessionId} command=${opts.command} args=${JSON.stringify(opts.arguments ?? '').slice(0, 120)}`
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      ocDbg(`[OC-COMMAND] response status=${res.status}`);
      if (!res.ok) {
        this.releaseProviderTurnGate(opencodeSessionId);
        throw new Error(`sendCommand failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.releaseProviderTurnGate(opencodeSessionId);
      throw err;
    }
    this.startPolling(opencodeSessionId, turnMessageId);
  }

  async compactSession(opencodeSessionId: string, opts: OpenCodeRunOptions = {}): Promise<boolean> {
    await this.ensureStarted(opts.userId);
    await this.waitForSseReady();
    const url = `${this.baseUrl}/api/session/${encodeURIComponent(opencodeSessionId)}/compact`;
    const res = await fetch(url, { method: 'POST' });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`compactSession failed: ${res.status} ${await res.text()}`);
    }
    return true;
  }

  /**
   * Read cumulative billed usage for a root OpenCode session and every nested
   * child session. OpenCode runs subagents as separate sessions, so listening
   * only to the root session's step-finish events silently misses their usage.
   */
  async getUsageSnapshot(
    opencodeSessionId: string,
    userId?: string
  ): Promise<OpenCodeUsageCounters | null> {
    await this.ensureStarted(userId);
    if (!this.baseUrl) return null;

    const total = { ...EMPTY_OPENCODE_USAGE };
    const seenSessions = new Set<string>();
    const seenMessages = new Set<string>();
    const pending = [opencodeSessionId];

    try {
      while (pending.length > 0) {
        const sessionId = pending.pop() as string;
        if (seenSessions.has(sessionId)) continue;
        seenSessions.add(sessionId);

        const encodedId = encodeURIComponent(sessionId);
        const [messagesResponse, childrenResponse] = await Promise.all([
          fetch(`${this.baseUrl}/session/${encodedId}/message?limit=100000`),
          fetch(`${this.baseUrl}/session/${encodedId}/children`),
        ]);
        if (!messagesResponse.ok || !childrenResponse.ok) {
          throw new Error(
            `usage snapshot failed for ${sessionId}: messages=${messagesResponse.status}, children=${childrenResponse.status}`
          );
        }

        const messages = (await messagesResponse.json()) as OpenCodeMessageSnapshot[];
        addOpenCodeUsage(total, collectOpenCodeMessageUsage(messages, seenMessages));

        const children = (await childrenResponse.json()) as Array<{ id?: unknown }>;
        for (const child of children) {
          if (typeof child?.id === 'string') pending.push(child.id);
        }
      }
      return total;
    } catch (error) {
      console.warn('[OPENCODE-SERVER] Failed to read usage snapshot:', error);
      return null;
    }
  }

  async replyQuestion(
    requestId: string,
    answers: unknown,
    opencodeSessionId?: string
  ): Promise<boolean> {
    await this.ensureStarted();
    if (opencodeSessionId) {
      const sessionUrl = `${this.baseUrl}/api/session/${encodeURIComponent(
        opencodeSessionId
      )}/question/request/${encodeURIComponent(requestId)}/reply`;
      const sessionRes = await fetch(sessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (sessionRes.ok) return true;
      if (sessionRes.status !== 404) {
        throw new Error(
          `question v2 reply failed: ${sessionRes.status} ${await sessionRes.text()}`
        );
      }
    }

    const url = `${this.baseUrl}/question/${encodeURIComponent(requestId)}/reply`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`question reply failed: ${res.status} ${await res.text()}`);
    }
    return true;
  }

  async rejectQuestion(requestId: string, opencodeSessionId?: string): Promise<boolean> {
    await this.ensureStarted();
    if (opencodeSessionId) {
      const sessionUrl = `${this.baseUrl}/api/session/${encodeURIComponent(
        opencodeSessionId
      )}/question/request/${encodeURIComponent(requestId)}/reject`;
      const sessionRes = await fetch(sessionUrl, { method: 'POST' });
      if (sessionRes.ok) return true;
      if (sessionRes.status !== 404) {
        throw new Error(
          `question v2 reject failed: ${sessionRes.status} ${await sessionRes.text()}`
        );
      }
    }

    const url = `${this.baseUrl}/question/${encodeURIComponent(requestId)}/reject`;
    const res = await fetch(url, { method: 'POST' });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`question reject failed: ${res.status} ${await res.text()}`);
    }
    return true;
  }

  private writeWebuiSessionContext(
    opencodeSessionId: string,
    opts: Pick<PromptOptions, 'webuiSessionId' | 'directory'>
  ): void {
    if (!opts.webuiSessionId) return;
    try {
      const contextFile = this.tenantPaths?.sessionContextFile || WEBUI_SESSION_CONTEXT_FILE;
      fs.mkdirSync(path.dirname(contextFile), { recursive: true, mode: 0o700 });
      const temporaryFile = `${contextFile}.${process.pid}.tmp`;
      fs.writeFileSync(
        temporaryFile,
        JSON.stringify({
          webuiSessionId: opts.webuiSessionId,
          opencodeSessionId,
          directory: opts.directory || null,
          updatedAt: Date.now(),
        }),
        { mode: 0o600 }
      );
      fs.renameSync(temporaryFile, contextFile);
    } catch (err) {
      console.warn('[OPENCODE-SERVER] failed to write WebUI session context:', err);
    }
  }

  /**
   * Start polling /session/{id}/message for the given session. Synthesises
   * message.part.updated / session.idle events from the diffs so the existing
   * dispatcher path (→ ClaudeProcessManager.translateOpencodeServerEvent)
   * delivers streaming output to the UI.
   */
  private startPolling(opencodeSessionId: string, turnMessageId: string): void {
    // A session can have only one active OpenCode turn. Abort any stale request
    // before installing the new turn state so late responses cannot leak into it.
    this.stopPolling(opencodeSessionId);
    const state: OpenCodePollState = {
      turnMessageId,
      textLens: new Map(),
      toolStatus: new Map(),
      lastToolActivity: null,
      finishedMessages: new Set(),
      idled: false,
      observedChange: false,
      lastObservedAt: null,
      idleCandidateAt: null,
      startedAt: Date.now(),
      noProgressTimeoutMs: resolveOpenCodeNoProgressTimeoutMs(),
    };
    this.pollState.set(opencodeSessionId, state);

    // Recursive timeout, rather than setInterval: the next poll is scheduled
    // only after the current HTTP request settles, guaranteeing one in-flight
    // history request per session.
    const tick = async () => {
      if (this.pollState.get(opencodeSessionId) !== state || state.idled) return;
      try {
        await this.pollOnce(opencodeSessionId, state);
      } catch (err) {
        const wasAborted = err instanceof Error && err.name === 'AbortError';
        if (this.pollState.get(opencodeSessionId) === state && !state.idled) {
          ocDbg(
            `[OC-POLL] ${wasAborted ? 'request timeout' : 'error'} sid=${opencodeSessionId} ${String(err).slice(0, 200)}`
          );
        }
      }

      if (this.pollState.get(opencodeSessionId) !== state || state.idled) return;
      const timer = setTimeout(() => {
        if (this.pollTimers.get(opencodeSessionId) === timer) {
          this.pollTimers.delete(opencodeSessionId);
        }
        void tick();
      }, OPENCODE_POLL_INTERVAL_MS);
      this.pollTimers.set(opencodeSessionId, timer);
    };
    ocDbg(`[OC-POLL] started sid=${opencodeSessionId} turn=${turnMessageId}`);
    void tick();
  }

  private stopPolling(opencodeSessionId: string): void {
    const t = this.pollTimers.get(opencodeSessionId);
    if (t) clearTimeout(t);
    this.pollTimers.delete(opencodeSessionId);
    const controller = this.pollControllers.get(opencodeSessionId);
    if (controller) controller.abort();
    this.pollControllers.delete(opencodeSessionId);
    this.pollState.delete(opencodeSessionId);
    ocDbg(`[OC-POLL] stopped sid=${opencodeSessionId}`);
  }

  private async pollOnce(opencodeSessionId: string, state: OpenCodePollState): Promise<void> {
    if (!this.baseUrl) return;
    if (this.pollState.get(opencodeSessionId) !== state || state.idled) return;

    // Safety cap: 30 minutes. opencode turns can run long (tool loops, large
    // generations), but something is wrong if we've been polling half an hour.
    if (hasOpenCodeHardSafetyTimeoutElapsed(Date.now(), state.startedAt)) {
      ocDbg(`[OC-POLL] safety-cap sid=${opencodeSessionId}`);
      state.idled = true;
      this.timeoutAbortedSessions.add(opencodeSessionId);
      const clearAbortSuppressor = setTimeout(() => {
        this.timeoutAbortedSessions.delete(opencodeSessionId);
      }, 30_000);
      clearAbortSuppressor.unref?.();
      void this.abort(opencodeSessionId);
      this.dispatch({
        type: 'session.error',
        properties: {
          sessionID: opencodeSessionId,
          error: {
            message:
              'OpenCode exceeded the 30-minute safety limit, so Plum aborted the turn. Check for a stalled provider or tool call before retrying.',
          },
        },
      });
      this.dispatch({ type: 'session.idle', properties: { sessionID: opencodeSessionId } });
      this.stopPolling(opencodeSessionId);
      return;
    }

    const now = Date.now();
    const stallTimeout = resolveOpenCodeStallTimeout({
      now,
      startedAt: state.startedAt,
      lastObservedAt: state.lastObservedAt,
      observedChange: state.observedChange,
      timeoutMs: state.noProgressTimeoutMs,
    });
    if (stallTimeout) {
      const timeoutSeconds = Math.round(state.noProgressTimeoutMs / 1000);
      ocDbg(
        `[OC-POLL] ${stallTimeout} sid=${opencodeSessionId} timeoutMs=${state.noProgressTimeoutMs}`
      );
      state.idled = true;
      this.timeoutAbortedSessions.add(opencodeSessionId);
      const clearAbortSuppressor = setTimeout(() => {
        this.timeoutAbortedSessions.delete(opencodeSessionId);
      }, 30_000);
      clearAbortSuppressor.unref?.();
      void this.abort(opencodeSessionId);
      this.dispatch({
        type: 'session.error',
        properties: {
          sessionID: opencodeSessionId,
          error: {
            message: formatOpenCodeStallErrorMessage(
              stallTimeout,
              timeoutSeconds,
              state.lastToolActivity
            ),
          },
        },
      });
      this.dispatch({ type: 'session.idle', properties: { sessionID: opencodeSessionId } });
      this.stopPolling(opencodeSessionId);
      return;
    }

    const controller = new AbortController();
    this.pollControllers.set(opencodeSessionId, controller);
    const requestTimeout = setTimeout(() => controller.abort(), OPENCODE_POLL_REQUEST_TIMEOUT_MS);
    requestTimeout.unref?.();

    let response: Response;
    let history: OpenCodeMessageSnapshot[];
    try {
      response = await fetch(buildOpenCodePollMessagesUrl(this.baseUrl, opencodeSessionId), {
        signal: controller.signal,
      });
      if (!response.ok) return;
      history = (await response.json()) as OpenCodeMessageSnapshot[];
    } finally {
      clearTimeout(requestTimeout);
      if (this.pollControllers.get(opencodeSessionId) === controller) {
        this.pollControllers.delete(opencodeSessionId);
      }
    }

    // Ignore a response that settled after a new turn replaced this state.
    if (this.pollState.get(opencodeSessionId) !== state || state.idled) return;
    const data = selectOpenCodeTurnMessages(history, state.turnMessageId);

    let sawChange = false;

    for (const msg of data) {
      const info = msg.info as Record<string, unknown> | undefined;
      if (!info || info.role !== 'assistant') continue;
      const messageId = info.id as string;

      const assistantError = extractOpenCodeAssistantErrorMessage(msg);
      if (assistantError && messageId && !state.finishedMessages.has(messageId)) {
        state.finishedMessages.add(messageId);
        state.idled = true;
        this.dispatch({
          type: 'session.error',
          properties: {
            sessionID: opencodeSessionId,
            error: {
              message: assistantError,
            },
          },
        });
        this.dispatch({ type: 'session.idle', properties: { sessionID: opencodeSessionId } });
        this.stopPolling(opencodeSessionId);
        return;
      }

      // We still iterate parts of already-finished messages in case opencode
      // back-fills anything; diffs against textLens/toolStatus make this cheap.
      for (const part of msg.parts || []) {
        const partId = part.id as string;
        const partType = part.type as string;
        if (!partId || !partType) continue;

        if (partType === 'text' || partType === 'reasoning') {
          const text = typeof part.text === 'string' ? (part.text as string) : '';
          const prev = state.textLens.get(partId) ?? 0;
          if (text.length > prev) {
            state.textLens.set(partId, text.length);
            sawChange = true;
            state.observedChange = true;
            this.dispatch({
              type: 'message.part.updated',
              properties: {
                part: { ...part, sessionID: opencodeSessionId, messageID: messageId },
              },
            });
          }
          continue;
        }

        if (partType === 'tool') {
          const stateField = part.state as { status?: string } | undefined;
          const status = stateField?.status ?? '';
          const prev = state.toolStatus.get(partId) ?? '';
          if (status !== prev) {
            state.toolStatus.set(partId, status);
            state.lastToolActivity = summarizeOpenCodeToolPart(part, messageId);
            sawChange = true;
            state.observedChange = true;
            this.dispatch({
              type: 'message.part.updated',
              properties: {
                part: { ...part, sessionID: opencodeSessionId, messageID: messageId },
              },
            });
          }
          continue;
        }

        if (partType === 'step-start' || partType === 'step-finish') {
          // Emit once per part (use textLens as a sentinel keyed by partId).
          if (!state.textLens.has(partId)) {
            state.textLens.set(partId, 1);
            sawChange = true;
            state.observedChange = true;
            this.dispatch({
              type: 'message.part.updated',
              properties: {
                part: { ...part, sessionID: opencodeSessionId, messageID: messageId },
              },
            });
          }
          continue;
        }
      }
    }

    // Determine run-completion from the LAST message. opencode creates a new
    // assistant message per step, so only the final one carries the terminal
    // finish reason. finish=stop (or error) = the loop exited; finish=
    // tool-calls/length = step ended, loop will continue with another message.
    const assistantMessages = data.filter((message) => message.info?.role === 'assistant');
    const last = assistantMessages[assistantMessages.length - 1];
    const isTerminal = isTerminalOpenCodeAssistantMessage(last);

    if (sawChange) {
      // Any observable progress resets the idle grace period.
      state.idleCandidateAt = null;
      state.lastObservedAt = Date.now();
    }

    if (isTerminal && !sawChange) {
      if (state.idleCandidateAt === null) {
        state.idleCandidateAt = Date.now();
      } else if (Date.now() - state.idleCandidateAt >= 2000) {
        // 2s of quiet with a terminal finish — the run really is over.
        state.idled = true;
        const lastId = last?.info?.id as string | undefined;
        if (lastId) state.finishedMessages.add(lastId);
        this.dispatch({
          type: 'session.idle',
          properties: { sessionID: opencodeSessionId },
        });
        this.stopPolling(opencodeSessionId);
        return;
      }
    } else if (!isTerminal) {
      state.idleCandidateAt = null;
    }
  }

  async abort(opencodeSessionId: string): Promise<void> {
    if (!this.baseUrl) return;
    // Cancel a potentially hung history request immediately. The serialized
    // loop may poll once more after the provider abort to observe final state.
    this.pollControllers.get(opencodeSessionId)?.abort();
    const url = `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/abort`;
    try {
      await fetch(url, { method: 'POST' });
    } catch (err) {
      console.warn('[OPENCODE-SERVER] abort failed:', err);
    }
  }

  async replyPermission(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    message: string | undefined,
    opencodeSessionId: string
  ): Promise<boolean> {
    await this.ensureStarted();
    const binding = this.permissionRequestSessions.get(requestId);
    if (!permissionRequestBelongsToSession(binding?.sessionId, opencodeSessionId)) {
      return false;
    }
    const sessionUrl = `${this.baseUrl}/api/session/${encodeURIComponent(
      opencodeSessionId
    )}/permission/request/${encodeURIComponent(requestId)}/reply`;
    const sessionRes = await fetch(sessionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
    });
    if (sessionRes.ok) {
      this.permissionRequestSessions.delete(requestId);
      return true;
    }
    if (sessionRes.status !== 404) {
      throw new Error(
        `permission v2 reply failed: ${sessionRes.status} ${await sessionRes.text()}`
      );
    }

    const url = `${this.baseUrl}/permission/${encodeURIComponent(requestId)}/reply`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
    });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`permission reply failed: ${res.status} ${await res.text()}`);
    }
    this.permissionRequestSessions.delete(requestId);
    return true;
  }

  /** Confirm the session still exists in the server (e.g. after a server restart). */
  async sessionExists(opencodeSessionId: string): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.providerTurnGate.cancelAll('OpenCode server restarted');
    this.providerGateReleases.clear();
    this.timeoutAbortedSessions.clear();
    this.handlers.clear();
    this.globalHandlers.clear();
    this.permissionRequestSessions.clear();
    for (const t of this.pollTimers.values()) clearTimeout(t);
    this.pollTimers.clear();
    for (const controller of this.pollControllers.values()) controller.abort();
    this.pollControllers.clear();
    this.pollState.clear();
    try {
      this.sseController?.abort();
    } catch {
      /* noop */
    }
    const proc = this.proc;
    if (proc && !proc.killed) {
      signalOpenCodeProcess(proc, 'SIGTERM');
      await new Promise<void>((r) => {
        const t = setTimeout(() => {
          signalOpenCodeProcess(proc, 'SIGKILL');
          r();
        }, 2000);
        proc.once('exit', () => {
          clearTimeout(t);
          r();
        });
      });
    }
    this.proc = null;
    this.baseUrl = null;
    this.startPromise = null;
    this.sseConnected = false;
    this.sseLoopRunning = false;
    this.sseReadyWaiters.splice(0);
    this.credentialOwnerUserId = null;
    this.credentialFingerprint = null;
    if (this.tenantPaths) {
      try {
        fs.rmSync(this.tenantPaths.sessionContextFile, { force: true });
      } catch {
        // Best effort; the runtime directory is not a credential store.
      }
    }
  }

  async restart(userId?: string): Promise<string | null> {
    const shouldRestart = Boolean(this.proc || this.baseUrl || this.startPromise);
    const handlers = [...this.handlers.entries()];
    const globalHandlers = [...this.globalHandlers];
    await this.shutdown();
    this.shuttingDown = false;
    if (!shouldRestart) return null;
    for (const [sessionId, handler] of handlers) this.handlers.set(sessionId, handler);
    for (const handler of globalHandlers) this.globalHandlers.add(handler);
    return this.ensureStarted(userId);
  }
}

function extractSessionId(evt: OpencodeEvent): string | null {
  const p = evt.properties as Record<string, unknown> | undefined;
  if (!p) return null;
  // Flat shape: { sessionID: "..." }
  if (typeof p.sessionID === 'string') return p.sessionID;
  // Part events: { part: { sessionID: "..." } }
  const part = p.part as Record<string, unknown> | undefined;
  if (part && typeof part.sessionID === 'string') return part.sessionID;
  // Message-updated shape: { info: { sessionID: "..." } }
  const info = p.info as Record<string, unknown> | undefined;
  if (info && typeof info.sessionID === 'string') return info.sessionID;
  if (info && typeof info.id === 'string' && evt.type === 'session.updated') {
    // `session.updated.properties.info` has `id` (the session ID itself).
    return info.id;
  }
  return null;
}

function extractEventErrorMessage(evt: OpencodeEvent): string | null {
  const p = evt.properties as Record<string, unknown> | undefined;
  const error = p?.error as Record<string, unknown> | undefined;
  if (!error) return null;
  const data = error.data as Record<string, unknown> | undefined;
  if (typeof data?.message === 'string') return data.message;
  if (typeof error.message === 'string') return error.message;
  return null;
}

function splitModel(slashForm: string): { providerID: string; modelID: string } | null {
  const idx = slashForm.indexOf('/');
  if (idx <= 0) return null;
  return {
    providerID: slashForm.slice(0, idx),
    modelID: slashForm.slice(idx + 1),
  };
}

function normalizeVariant(variant: string): string {
  const normalized = variant
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'extra_high' || normalized === 'xhigh') return 'max';
  return normalized;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class OpencodeServerRegistry {
  private readonly servers = new Map<string, OpencodeServer>();
  private readonly sessionOwners = new Map<string, Set<string>>();

  constructor(
    private readonly serverFactory: (userId: string) => OpencodeServer = (userId) =>
      new OpencodeServer({ userId })
  ) {}

  forUser(userId: string): OpencodeServer {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) throw new Error('OpenCode requires a WebUI user id');
    const existing = this.servers.get(normalizedUserId);
    if (existing) return existing;
    const server = this.serverFactory(normalizedUserId);
    this.servers.set(normalizedUserId, server);
    return server;
  }

  get tenantCount(): number {
    return this.servers.size;
  }

  private bindSession(userId: string, opencodeSessionId: string): void {
    const owners = this.sessionOwners.get(opencodeSessionId) ?? new Set<string>();
    owners.add(userId);
    this.sessionOwners.set(opencodeSessionId, owners);
  }

  private unbindSession(userId: string, opencodeSessionId: string): void {
    const owners = this.sessionOwners.get(opencodeSessionId);
    if (!owners) return;
    owners.delete(userId);
    if (owners.size === 0) this.sessionOwners.delete(opencodeSessionId);
  }

  private resolveSessionTenant(
    opencodeSessionId: string,
    userId?: string
  ): { userId: string; server: OpencodeServer } | null {
    if (userId) {
      const server = this.servers.get(userId);
      return server ? { userId, server } : null;
    }

    const owners = this.sessionOwners.get(opencodeSessionId);
    if (!owners || owners.size !== 1) return null;
    const owner = owners.values().next().value as string | undefined;
    if (!owner) return null;
    const server = this.servers.get(owner);
    return server ? { userId: owner, server } : null;
  }

  async ensureStarted(userId?: string): Promise<string> {
    if (!userId) throw new Error('OpenCode server startup requires a WebUI user id');
    return this.forUser(userId).ensureStarted(userId);
  }

  async sessionExists(opencodeSessionId: string, userId?: string): Promise<boolean> {
    if (!userId) return false;
    const exists = await this.forUser(userId).sessionExists(opencodeSessionId);
    if (exists) this.bindSession(userId, opencodeSessionId);
    return exists;
  }

  async createSession(cwd: string, opts: CreateSessionOptions = {}): Promise<string> {
    if (!opts.userId) throw new Error('OpenCode session creation requires a WebUI user id');
    const opencodeSessionId = await this.forUser(opts.userId).createSession(cwd, opts);
    this.bindSession(opts.userId, opencodeSessionId);
    return opencodeSessionId;
  }

  subscribe(opencodeSessionId: string, handler: Handler, userId?: string): void {
    if (!userId) throw new Error('OpenCode subscription requires a WebUI user id');
    this.bindSession(userId, opencodeSessionId);
    this.forUser(userId).subscribe(opencodeSessionId, handler);
  }

  unsubscribe(opencodeSessionId: string, userId?: string): void {
    const tenant = this.resolveSessionTenant(opencodeSessionId, userId);
    if (!tenant) return;
    tenant.server.unsubscribe(opencodeSessionId);
    this.unbindSession(tenant.userId, opencodeSessionId);
  }

  async sendPrompt(opencodeSessionId: string, opts: PromptOptions): Promise<void> {
    if (!opts.userId) throw new Error('OpenCode prompt requires a WebUI user id');
    this.bindSession(opts.userId, opencodeSessionId);
    await this.forUser(opts.userId).sendPrompt(opencodeSessionId, opts);
  }

  async sendCommand(opencodeSessionId: string, opts: CommandOptions): Promise<void> {
    if (!opts.userId) throw new Error('OpenCode command requires a WebUI user id');
    this.bindSession(opts.userId, opencodeSessionId);
    await this.forUser(opts.userId).sendCommand(opencodeSessionId, opts);
  }

  async compactSession(opencodeSessionId: string, opts: OpenCodeRunOptions = {}): Promise<boolean> {
    if (!opts.userId) throw new Error('OpenCode compact requires a WebUI user id');
    this.bindSession(opts.userId, opencodeSessionId);
    return this.forUser(opts.userId).compactSession(opencodeSessionId, opts);
  }

  async getUsageSnapshot(
    opencodeSessionId: string,
    userId?: string
  ): Promise<OpenCodeUsageCounters | null> {
    const tenant = this.resolveSessionTenant(opencodeSessionId, userId);
    if (!tenant) return null;
    return tenant.server.getUsageSnapshot(opencodeSessionId, tenant.userId);
  }

  async abort(opencodeSessionId: string, userId?: string): Promise<void> {
    const tenant = this.resolveSessionTenant(opencodeSessionId, userId);
    if (!tenant) return;
    await tenant.server.abort(opencodeSessionId);
  }

  async replyPermission(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    message: string | undefined,
    opencodeSessionId: string,
    userId?: string
  ): Promise<boolean> {
    const tenant = this.resolveSessionTenant(opencodeSessionId, userId);
    if (!tenant) return false;
    return tenant.server.replyPermission(requestId, reply, message, opencodeSessionId);
  }

  async replyQuestion(
    requestId: string,
    answers: unknown,
    opencodeSessionId?: string,
    userId?: string
  ): Promise<boolean> {
    if (!opencodeSessionId) return false;
    const tenant = this.resolveSessionTenant(opencodeSessionId, userId);
    if (!tenant) return false;
    return tenant.server.replyQuestion(requestId, answers, opencodeSessionId);
  }

  async rejectQuestion(
    requestId: string,
    opencodeSessionId?: string,
    userId?: string
  ): Promise<boolean> {
    if (!opencodeSessionId) return false;
    const tenant = this.resolveSessionTenant(opencodeSessionId, userId);
    if (!tenant) return false;
    return tenant.server.rejectQuestion(requestId, opencodeSessionId);
  }

  async restart(userId?: string): Promise<string | null> {
    if (!userId) {
      await this.shutdownAll();
      return null;
    }
    const server = this.servers.get(userId);
    return server ? await server.restart(userId) : null;
  }

  async shutdown(userId?: string): Promise<void> {
    if (!userId) {
      await this.shutdownAll();
      return;
    }
    const server = this.servers.get(userId);
    if (!server) return;
    await server.shutdown();
    this.servers.delete(userId);
    for (const [sessionId, owners] of this.sessionOwners) {
      owners.delete(userId);
      if (owners.size === 0) this.sessionOwners.delete(sessionId);
    }
  }

  async shutdownAll(): Promise<void> {
    const servers = [...this.servers.values()];
    this.servers.clear();
    this.sessionOwners.clear();
    const results = await Promise.allSettled(
      servers.map(async (server) => await server.shutdown())
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[OPENCODE-SERVER] tenant shutdown failed:', result.reason);
      }
    }
  }
}

// Stable facade used by routes and ClaudeProcessManager. Internally it owns
// one isolated OpencodeServer instance per WebUI user.
export const opencodeServer = new OpencodeServerRegistry();

export function isTerminalOpenCodeAssistantMessage(
  message:
    | {
        info?: Record<string, unknown>;
        parts?: Array<Record<string, unknown>>;
      }
    | undefined
): boolean {
  const info = message?.info;
  if (!info || info.role !== 'assistant') return false;

  if (extractOpenCodeAssistantErrorMessage(message)) return true;

  const finish = info.finish as string | undefined;
  if (!finish) return false;

  const TERMINAL_FINISHES = new Set(['stop', 'error', 'content-filter']);
  if (TERMINAL_FINISHES.has(finish)) return true;

  const time = info.time as Record<string, unknown> | undefined;
  const completedAt = time?.completed;
  const parts = message.parts || [];
  const hasStepFinish = parts.some((part) => part.type === 'step-finish');
  const hasToolError = parts.some((part) => {
    if (part.type !== 'tool') return false;
    const toolState = part.state as { status?: string } | undefined;
    return toolState?.status === 'error';
  });

  return (
    finish === 'unknown' && (hasToolError || (hasStepFinish && typeof completedAt === 'number'))
  );
}

export function extractOpenCodeAssistantErrorMessage(
  message:
    | {
        info?: Record<string, unknown>;
      }
    | undefined
): string | null {
  const info = message?.info;
  if (!info || info.role !== 'assistant') return null;

  const error = info.error as
    | {
        message?: unknown;
        name?: unknown;
        data?: {
          message?: unknown;
          responseBody?: unknown;
        };
      }
    | undefined;
  if (!error || typeof error !== 'object') return null;

  if (typeof error.data?.message === 'string' && error.data.message.trim()) {
    return error.data.message.trim();
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error.data?.responseBody === 'string' && error.data.responseBody.trim()) {
    try {
      const parsed = JSON.parse(error.data.responseBody) as {
        error?: { message?: unknown };
        message?: unknown;
      };
      const parsedMessage =
        typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : typeof parsed.message === 'string'
            ? parsed.message
            : '';
      if (parsedMessage.trim()) return parsedMessage.trim();
    } catch {
      // Fall through to the generic provider error below.
    }
  }

  if (typeof error.name === 'string' && error.name.trim()) {
    return `OpenCode provider error: ${error.name.trim()}`;
  }

  return 'OpenCode provider error';
}
