import { spawn, spawnSync, type ChildProcessByStdio } from 'child_process';
import { existsSync } from 'fs';
import { lstat, mkdir, readFile, readlink, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Readable } from 'stream';
import { setTimeout as delay } from 'timers/promises';
import { WebSocket, type RawData } from 'ws';
import type { OracleBrowserMode } from '@plum-code-webui/shared';
import {
  DEFAULT_ORACLE_CHATGPT_URL,
  getOracleRuntimeConfigForSession,
} from '../utils/oracleSettings.js';

const DEFAULT_BROWSER_BIN =
  process.env.CHROME_BIN ||
  process.env.CHROMIUM_PATH ||
  process.env.BROWSER ||
  '/usr/local/bin/plum-chromium';
const DEFAULT_ORACLE_HOME_DIR =
  process.env.ORACLE_HOME_DIR || path.join(os.homedir(), '.codex', 'oracle');
const DEFAULT_PROFILE_DIR = path.join(DEFAULT_ORACLE_HOME_DIR, 'browser-profile');
const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 1024,
  deviceScaleFactor: 1,
  mobile: false,
};
const DETECTED_CHROMIUM_VERSION =
  process.env.ORACLE_BROWSER_CHROME_FULL_VERSION ||
  detectChromiumVersion(DEFAULT_BROWSER_BIN) ||
  '148.0.7778.167';
const DETECTED_CHROMIUM_MAJOR = DETECTED_CHROMIUM_VERSION.split('.')[0] || '148';
const DEFAULT_USER_AGENT =
  process.env.ORACLE_BROWSER_USER_AGENT ||
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${DETECTED_CHROMIUM_VERSION} Safari/537.36`;
const DEFAULT_NAVIGATOR_PLATFORM = process.env.ORACLE_BROWSER_NAVIGATOR_PLATFORM || 'Win32';
const DEFAULT_UA_PLATFORM = process.env.ORACLE_BROWSER_UA_PLATFORM || 'Windows';
const DEFAULT_ACCEPT_LANGUAGE = process.env.ORACLE_BROWSER_ACCEPT_LANGUAGE || 'en-US,en;q=0.9';
const FORCE_HEADLESS_BROWSER = parseEnvBoolean(process.env.ORACLE_BROWSER_HEADLESS);
const DISABLE_XVFB_BROWSER = parseEnvBoolean(process.env.ORACLE_BROWSER_DISABLE_XVFB);
const XVFB_BIN = process.env.XVFB_BIN || '/usr/bin/Xvfb';

export type OracleEmbeddedBrowserStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopped';

export interface OracleEmbeddedBrowserState {
  sessionId: string;
  status: OracleEmbeddedBrowserStatus;
  running: boolean;
  mode: OracleBrowserMode;
  chatgptUrl: string;
  currentUrl: string | null;
  title: string | null;
  profileDir: string;
  debugPort: number | null;
  remoteChromeTarget: string | null;
  oracleWillAttachToEmbeddedBrowser: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  lastFrameAt: string | null;
  viewport: typeof DEFAULT_VIEWPORT;
  message: string;
  error: string | null;
  outputTail: string;
}

interface DevToolsEndpoint {
  port: number;
  browserWebSocketPath: string;
}

interface DevToolsTarget {
  id: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface BrowserInstance {
  key: string;
  userId: string;
  profileDir: string;
  mode: OracleBrowserMode;
  chatgptUrl: string;
  sessionIds: Set<string>;
  process: ChildProcessByStdio<null, Readable, Readable> | null;
  displayProcess: ChildProcessByStdio<null, Readable, Readable> | null;
  display: string | null;
  browserClient: CdpClient | null;
  client: CdpClient | null;
  debugPort: number | null;
  remoteChromeTarget: string | null;
  status: Exclude<OracleEmbeddedBrowserStatus, 'idle'>;
  currentUrl: string | null;
  title: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastFrameAt: number | null;
  lastFrame: Buffer | null;
  error: string | null;
  outputTail: string;
  startPromise: Promise<void> | null;
}

interface KeyboardPayload {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

interface WaitForPageTargetOptions {
  shouldAbort?: () => boolean;
  getAbortError?: () => Error;
  preferredUrl?: string | null;
}

class CdpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        ws.off('error', onError);
        ws.off('open', onOpen);
      };

      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('message', (data: RawData) => this.handleMessage(data));
      ws.on('close', () => {
        const error = new Error('DevTools connection closed');
        for (const [, pending] of this.pending) {
          pending.reject(error);
        }
        this.pending.clear();
      });
    });
  }

  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    const existing = this.listeners.get(method) || new Set();
    existing.add(handler);
    this.listeners.set(method, existing);
  }

  async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('DevTools connection is not open');
    }

    const id = this.nextId++;
    const payload = JSON.stringify(
      sessionId ? { id, method, params, sessionId } : { id, method, params }
    );

    return await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.ws!.send(payload, (error?: Error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      // Ignore close errors.
    }
  }

  private handleMessage(data: RawData): void {
    try {
      const parsed = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message?: string };
      };

      if (typeof parsed.id === 'number') {
        const pending = this.pending.get(parsed.id);
        if (!pending) return;
        this.pending.delete(parsed.id);
        if (parsed.error?.message) {
          pending.reject(new Error(parsed.error.message));
        } else {
          pending.resolve(parsed.result);
        }
        return;
      }

      if (!parsed.method) return;
      const listeners = this.listeners.get(parsed.method);
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          listener(parsed.params || {});
        } catch {
          // Ignore listener failures so one bad listener does not break CDP dispatch.
        }
      }
    } catch {
      // Ignore malformed events from the browser.
    }
  }
}

function instanceKey(userId: string, profileDir: string): string {
  return `${userId}\u0000${profileDir}`;
}

function sanitizeUrl(input: string | null | undefined, fallback: string): string {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return fallback;
  if (value === 'about:blank') return value;

  let normalized = value;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  const url = new URL(normalized);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  return url.toString();
}

function normalizeProfileDir(input: string | null | undefined): string {
  const value = typeof input === 'string' ? input.trim() : '';
  return value || DEFAULT_PROFILE_DIR;
}

function outputTail(current: string, chunk: Buffer | string): string {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
  return `${current}${text}`.slice(-12_000);
}

function parseEnvBoolean(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value || '').trim());
}

function detectChromiumVersion(browserBin: string): string | null {
  try {
    const result = spawnSync(browserBin, ['--version'], {
      encoding: 'utf8',
      timeout: 2_500,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    return text.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function userAgentMetadata(): Record<string, unknown> {
  const brandVersion = DETECTED_CHROMIUM_MAJOR;
  return {
    brands: [
      { brand: 'Chromium', version: brandVersion },
      { brand: 'Google Chrome', version: brandVersion },
      { brand: 'Not=A?Brand', version: '99' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: DETECTED_CHROMIUM_VERSION },
      { brand: 'Google Chrome', version: DETECTED_CHROMIUM_VERSION },
      { brand: 'Not=A?Brand', version: '99.0.0.0' },
    ],
    platform: DEFAULT_UA_PLATFORM,
    platformVersion: '10.0.0',
    architecture: 'x86',
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false,
  };
}

function buildAutomationEvasionScript(): string {
  return `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'platform', { get: () => '${DEFAULT_NAVIGATOR_PLATFORM}' });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
window.chrome = window.chrome || { runtime: {} };
  `.trim();
}

function shouldUseXvfb(): boolean {
  if (FORCE_HEADLESS_BROWSER || DISABLE_XVFB_BROWSER) return false;
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return false;
  return existsSync(XVFB_BIN);
}

function buildChromiumArgs(instance: BrowserInstance, headless: boolean): string[] {
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-infobars',
    '--noerrdialogs',
    '--password-store=basic',
    '--use-mock-keychain',
    '--lang=en-US',
    `--user-agent=${DEFAULT_USER_AGENT}`,
    '--window-size=1440,1024',
    `--user-data-dir=${instance.profileDir}`,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--hide-scrollbars',
    'about:blank',
  ];

  if (headless) {
    args.unshift('--headless=new');
  }

  return args;
}

function modifiersMask(payload: KeyboardPayload): number {
  let modifiers = 0;
  if (payload.altKey) modifiers |= 1;
  if (payload.ctrlKey) modifiers |= 2;
  if (payload.metaKey) modifiers |= 4;
  if (payload.shiftKey) modifiers |= 8;
  return modifiers;
}

function isPrintableKey(payload: KeyboardPayload): boolean {
  return payload.key.length === 1 && !payload.altKey && !payload.ctrlKey && !payload.metaKey;
}

function keyboardCodeFor(key: string): number {
  const special: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Backspace: 8,
    Escape: 27,
    Delete: 46,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    Space: 32,
    ' ': 32,
  };

  if (special[key] !== undefined) return special[key];
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

function buildKeyText(key: string): string | undefined {
  if (key === 'Enter') return '\r';
  if (key === 'Tab' || key === 'Escape') return undefined;
  if (key.length === 1) return key;
  return undefined;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DevTools endpoint ${url} returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function waitForDevToolsEndpoint(
  profileDir: string,
  timeoutMs = 15_000,
  options?: {
    shouldAbort?: () => boolean;
    getAbortError?: () => Error;
  }
): Promise<DevToolsEndpoint> {
  const devToolsFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (options?.shouldAbort?.()) {
      throw options.getAbortError?.() || new Error('Chromium exited before opening DevTools.');
    }
    try {
      const raw = await readFile(devToolsFile, 'utf8');
      const [portLine, browserPathLine] = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const port = Number.parseInt(portLine || '', 10);
      if (Number.isFinite(port) && browserPathLine) {
        return { port, browserWebSocketPath: browserPathLine };
      }
    } catch {
      // File not ready yet.
    }
    await delay(200);
  }

  throw new Error(`Timed out waiting for Chromium DevTools port at ${devToolsFile}`);
}

function pickPageTarget(
  targets: DevToolsTarget[],
  preferredUrl?: string | null
): DevToolsTarget | undefined {
  const pageTargets = targets.filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string'
  );
  if (pageTargets.length === 0) {
    return undefined;
  }

  const normalizedPreferredUrl = preferredUrl?.trim() || '';
  if (normalizedPreferredUrl) {
    const exact = pageTargets.find((target) => target.url === normalizedPreferredUrl);
    if (exact) return exact;
  }

  const nonBlank = pageTargets.find((target) => target.url && target.url !== 'about:blank');
  return nonBlank || pageTargets[0];
}

async function waitForPageTarget(
  port: number,
  timeoutMs = 15_000,
  options?: WaitForPageTargetOptions
): Promise<DevToolsTarget> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (options?.shouldAbort?.()) {
      throw options.getAbortError?.() || new Error('Chromium exited before opening a page target.');
    }
    try {
      const targets = await readJson<DevToolsTarget[]>(`http://127.0.0.1:${port}/json/list`);
      const pageTarget = pickPageTarget(targets, options?.preferredUrl);
      if (pageTarget?.webSocketDebuggerUrl) {
        return pageTarget;
      }
    } catch {
      // Target list not ready yet.
    }
    await delay(200);
  }

  throw new Error(`Timed out waiting for Chromium page target on port ${port}`);
}

async function removePathIfExists(targetPath: string): Promise<void> {
  try {
    await rm(targetPath, { force: true, recursive: false });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

function parseSingletonLockTarget(target: string): { host: string | null; pid: number | null } {
  const trimmed = target.trim();
  const match = trimmed.match(/^(.*)-(\d+)$/);
  if (!match) {
    return { host: null, pid: null };
  }

  const pid = Number.parseInt(match[2] || '', 10);
  return {
    host: match[1] || null,
    pid: Number.isFinite(pid) && pid > 0 ? pid : null,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanupStaleProfileArtifacts(profileDir: string): Promise<void> {
  await removePathIfExists(path.join(profileDir, 'DevToolsActivePort'));

  const singletonLockPath = path.join(profileDir, 'SingletonLock');
  let shouldClearSingletonArtifacts = false;

  try {
    const stats = await lstat(singletonLockPath);
    if (!stats.isSymbolicLink()) {
      shouldClearSingletonArtifacts = true;
    } else {
      const target = await readlink(singletonLockPath);
      const { host, pid } = parseSingletonLockTarget(target);
      const sameHost = !host || host === os.hostname();
      shouldClearSingletonArtifacts = !sameHost || !pid || !isProcessAlive(pid);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  if (!shouldClearSingletonArtifacts) {
    return;
  }

  await Promise.all([
    removePathIfExists(singletonLockPath),
    removePathIfExists(path.join(profileDir, 'SingletonCookie')),
    removePathIfExists(path.join(profileDir, 'SingletonSocket')),
  ]);
}

function buildChromiumStartupError(instance: BrowserInstance, fallback: string): Error {
  const stderr = instance.outputTail.trim();
  if (!stderr) {
    return new Error(fallback);
  }

  const lockMatch = stderr.match(/another Chromium process \((\d+)\)/i);
  if (/profile appears to be in use/i.test(stderr)) {
    const pidSuffix = lockMatch?.[1] ? ` (${lockMatch[1]})` : '';
    return new Error(
      `Oracle browser profile is locked by another Chromium process${pidSuffix}. Close that browser or clear the stale profile lock and try again.`
    );
  }

  const relevantLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/Failed to connect to the bus/i.test(line) &&
        !/Unknown address type/i.test(line) &&
        !/vk_renderer\.cpp/i.test(line) &&
        !/Display::initialize error/i.test(line) &&
        !/GLDisplayEGL::Initialize failed/i.test(line) &&
        !/DevTools listening on ws:/i.test(line)
    );

  return new Error(relevantLines.slice(-4).join('\n') || fallback);
}

function isDevToolsConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /DevTools connection (closed|is not open)/i.test(error.message);
}

function topFrameUrlFromEvent(params: Record<string, unknown>): string | null {
  const frame = (params.frame || {}) as { parentId?: string; url?: string };
  if (typeof frame.parentId === 'string' && frame.parentId) return null;
  return typeof frame.url === 'string' ? frame.url : null;
}

export class OracleBrowserManager {
  private instances = new Map<string, BrowserInstance>();

  async getState(sessionId: string, userId: string): Promise<OracleEmbeddedBrowserState> {
    const runtime = (await getOracleRuntimeConfigForSession(sessionId)).config;
    const profileDir = normalizeProfileDir(runtime.manualLoginProfileDir);
    const key = instanceKey(userId, profileDir);
    const instance = this.instances.get(key);

    if (instance?.startPromise) {
      try {
        instance.startPromise;
      } catch {
        // State should still render even if the start failed.
      }
    }

    return this.serializeState(sessionId, runtime.mode, runtime.chatgptUrl, profileDir, instance);
  }

  async getEmbeddedRemoteChromeTargetForSession(sessionId: string): Promise<string | null> {
    const resolved = await getOracleRuntimeConfigForSession(sessionId);
    if (!resolved.userId) return null;

    const profileDir = normalizeProfileDir(resolved.config.manualLoginProfileDir);
    const key = instanceKey(resolved.userId, profileDir);
    const instance = this.instances.get(key);
    if (!instance || instance.status !== 'running' || !instance.remoteChromeTarget) {
      return null;
    }

    return instance.remoteChromeTarget;
  }

  async start(
    sessionId: string,
    userId: string,
    url?: string
  ): Promise<OracleEmbeddedBrowserState> {
    const runtime = (await getOracleRuntimeConfigForSession(sessionId)).config;
    const profileDir = normalizeProfileDir(runtime.manualLoginProfileDir);
    const key = instanceKey(userId, profileDir);
    const startUrl = sanitizeUrl(url, runtime.chatgptUrl || DEFAULT_ORACLE_CHATGPT_URL);

    let instance = this.instances.get(key);
    if (instance) {
      instance.sessionIds.add(sessionId);
      if (instance.startPromise) {
        instance.startPromise;
      }
      if (instance.status === 'running') {
        await this.navigateInstance(instance, startUrl);
      }
      return this.serializeState(sessionId, runtime.mode, runtime.chatgptUrl, profileDir, instance);
    }

    instance = {
      key,
      userId,
      profileDir,
      mode: runtime.mode,
      chatgptUrl: runtime.chatgptUrl,
      sessionIds: new Set([sessionId]),
      process: null,
      displayProcess: null,
      display: null,
      browserClient: null,
      client: null,
      debugPort: null,
      remoteChromeTarget: null,
      status: 'starting',
      currentUrl: null,
      title: null,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      lastFrameAt: null,
      lastFrame: null,
      error: null,
      outputTail: '',
      startPromise: null,
    };
    this.instances.set(key, instance);

    instance.startPromise = this.launchInstance(instance, startUrl);
    try {
      instance.startPromise;
    } finally {
      instance.startPromise = null;
    }

    return this.serializeState(sessionId, runtime.mode, runtime.chatgptUrl, profileDir, instance);
  }

  async stop(sessionId: string, userId: string): Promise<OracleEmbeddedBrowserState> {
    const runtime = (await getOracleRuntimeConfigForSession(sessionId)).config;
    const profileDir = normalizeProfileDir(runtime.manualLoginProfileDir);
    const key = instanceKey(userId, profileDir);
    const instance = this.instances.get(key);

    if (!instance) {
      return this.serializeState(sessionId, runtime.mode, runtime.chatgptUrl, profileDir, null);
    }

    await this.disposeInstance(instance, true);
    return this.serializeState(sessionId, runtime.mode, runtime.chatgptUrl, profileDir, null);
  }

  async reload(sessionId: string, userId: string): Promise<OracleEmbeddedBrowserState> {
    const { runtime, instance } = await this.requireRunningInstance(sessionId, userId);
    await this.sendClientCommand(instance, 'Page.reload', { ignoreCache: false });
    await delay(250);
    await this.syncPageMetadata(instance);
    return this.serializeState(
      sessionId,
      runtime.mode,
      runtime.chatgptUrl,
      normalizeProfileDir(runtime.manualLoginProfileDir),
      instance
    );
  }

  async navigate(
    sessionId: string,
    userId: string,
    url: string
  ): Promise<OracleEmbeddedBrowserState> {
    const { runtime, instance } = await this.requireRunningInstance(sessionId, userId);
    await this.navigateInstance(
      instance,
      sanitizeUrl(url, runtime.chatgptUrl || DEFAULT_ORACLE_CHATGPT_URL)
    );
    return this.serializeState(
      sessionId,
      runtime.mode,
      runtime.chatgptUrl,
      normalizeProfileDir(runtime.manualLoginProfileDir),
      instance
    );
  }

  async click(
    sessionId: string,
    userId: string,
    payload: { xRatio: number; yRatio: number; button?: 'left' | 'middle' | 'right' }
  ): Promise<void> {
    const { instance } = await this.requireRunningInstance(sessionId, userId);
    const x = Math.round(Math.max(0, Math.min(1, payload.xRatio)) * DEFAULT_VIEWPORT.width);
    const y = Math.round(Math.max(0, Math.min(1, payload.yRatio)) * DEFAULT_VIEWPORT.height);
    const button = payload.button || 'left';

    await this.sendClientCommand(instance, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
    });
    await this.sendClientCommand(instance, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4,
      clickCount: 1,
    });
    await this.sendClientCommand(instance, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: 1,
    });
  }

  async wheel(
    sessionId: string,
    userId: string,
    payload: { xRatio: number; yRatio: number; deltaX?: number; deltaY?: number }
  ): Promise<void> {
    const { instance } = await this.requireRunningInstance(sessionId, userId);
    const x = Math.round(Math.max(0, Math.min(1, payload.xRatio)) * DEFAULT_VIEWPORT.width);
    const y = Math.round(Math.max(0, Math.min(1, payload.yRatio)) * DEFAULT_VIEWPORT.height);
    await this.sendClientCommand(instance, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: Number.isFinite(payload.deltaX) ? payload.deltaX : 0,
      deltaY: Number.isFinite(payload.deltaY) ? payload.deltaY : 0,
      button: 'none',
      buttons: 0,
    });
  }

  async key(sessionId: string, userId: string, payload: KeyboardPayload): Promise<void> {
    const { instance } = await this.requireRunningInstance(sessionId, userId);

    if (isPrintableKey(payload)) {
      await this.sendClientCommand(instance, 'Input.insertText', { text: payload.key });
      return;
    }

    const keyCode = keyboardCodeFor(payload.key);
    const text = buildKeyText(payload.key);
    const modifiers = modifiersMask(payload);
    const basePayload = {
      key: payload.key,
      code: payload.code || payload.key,
      modifiers,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      text,
      unmodifiedText: text,
    };

    await this.sendClientCommand(instance, 'Input.dispatchKeyEvent', {
      ...basePayload,
      type: 'keyDown',
    });
    await this.sendClientCommand(instance, 'Input.dispatchKeyEvent', {
      ...basePayload,
      type: 'keyUp',
    });
  }

  async text(sessionId: string, userId: string, text: string): Promise<void> {
    const { instance } = await this.requireRunningInstance(sessionId, userId);
    if (!text) return;
    await this.sendClientCommand(instance, 'Input.insertText', { text });
  }

  async captureFrame(
    sessionId: string,
    userId: string
  ): Promise<{
    contentType: string;
    body: Buffer;
    updatedAt: number;
  }> {
    const { instance } = await this.requireRunningInstance(sessionId, userId);
    const result = (await this.sendClientCommand<{ data?: string }>(
      instance,
      'Page.captureScreenshot',
      {
        format: 'jpeg',
        quality: 72,
        fromSurface: true,
        optimizeForSpeed: true,
      }
    )) as { data?: string };
    const data = result?.data;
    if (!data) {
      throw new Error('Chromium did not return screenshot data');
    }

    const body = Buffer.from(data, 'base64');
    instance.lastFrame = body;
    instance.lastFrameAt = Date.now();
    return {
      contentType: 'image/jpeg',
      body,
      updatedAt: instance.lastFrameAt,
    };
  }

  private async sendOptionalClientCommand(
    client: CdpClient,
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<void> {
    try {
      await client.send(method, params, sessionId);
    } catch {
      // Some DevTools domains are unavailable on worker-like or transient targets.
    }
  }

  private async applyIdentityOverrides(
    client: CdpClient,
    options: { sessionId?: string; includeViewport?: boolean; evaluateNow?: boolean } = {}
  ): Promise<void> {
    const sessionId = options.sessionId;

    await this.sendOptionalClientCommand(client, 'Runtime.enable', {}, sessionId);
    await this.sendOptionalClientCommand(client, 'Network.enable', {}, sessionId);
    await this.sendOptionalClientCommand(
      client,
      'Network.setUserAgentOverride',
      {
        userAgent: DEFAULT_USER_AGENT,
        acceptLanguage: DEFAULT_ACCEPT_LANGUAGE,
        platform: DEFAULT_NAVIGATOR_PLATFORM,
        userAgentMetadata: userAgentMetadata(),
      },
      sessionId
    );

    if (options.includeViewport) {
      await this.sendOptionalClientCommand(
        client,
        'Emulation.setDeviceMetricsOverride',
        DEFAULT_VIEWPORT,
        sessionId
      );
    }

    const source = buildAutomationEvasionScript();
    await this.sendOptionalClientCommand(
      client,
      'Page.addScriptToEvaluateOnNewDocument',
      { source },
      sessionId
    );

    if (options.evaluateNow !== false) {
      await this.sendOptionalClientCommand(
        client,
        'Runtime.evaluate',
        { expression: `(() => { ${source} })();`, returnByValue: false },
        sessionId
      );
    }
  }

  private async configureAttachedTarget(
    browserClient: CdpClient,
    params: Record<string, unknown>
  ): Promise<void> {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
    const targetInfo = (params.targetInfo || {}) as { type?: string };
    if (!sessionId) return;

    try {
      if (targetInfo.type === 'page' || targetInfo.type === 'iframe') {
        await this.applyIdentityOverrides(browserClient, {
          sessionId,
          includeViewport: targetInfo.type === 'page',
        });
      }
    } finally {
      await this.sendOptionalClientCommand(
        browserClient,
        'Runtime.runIfWaitingForDebugger',
        {},
        sessionId
      );
    }
  }

  private async attachBrowserClient(
    instance: BrowserInstance,
    endpoint: DevToolsEndpoint
  ): Promise<void> {
    const browserClient = new CdpClient(
      `ws://127.0.0.1:${endpoint.port}${endpoint.browserWebSocketPath}`
    );
    await browserClient.connect();

    try {
      instance.browserClient?.close();
    } catch {
      // Ignore close errors while swapping clients.
    }

    instance.browserClient = browserClient;
    browserClient.on('Target.attachedToTarget', (params) => {
      void this.configureAttachedTarget(browserClient, params);
    });

    await browserClient.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  }

  private async attachClient(instance: BrowserInstance, wsUrl: string): Promise<CdpClient> {
    const nextClient = new CdpClient(wsUrl);
    await nextClient.connect();

    try {
      instance.client?.close();
    } catch {
      // Ignore close errors while swapping clients.
    }

    instance.client = nextClient;

    nextClient.on('Page.frameNavigated', (params) => {
      const nextUrl = topFrameUrlFromEvent(params);
      if (nextUrl) {
        instance.currentUrl = nextUrl;
      }
    });
    nextClient.on('Page.navigatedWithinDocument', (params) => {
      if (typeof params.url === 'string') {
        instance.currentUrl = params.url;
      }
    });
    nextClient.on('Page.loadEventFired', () => {
      void this.syncPageMetadata(instance);
    });

    await nextClient.send('Page.enable');
    await this.applyIdentityOverrides(nextClient, {
      includeViewport: true,
      evaluateNow: false,
    });
    return nextClient;
  }

  private async reconnectClient(instance: BrowserInstance): Promise<CdpClient> {
    if (!instance.debugPort) {
      throw new Error('Embedded Oracle browser is not exposing a DevTools port.');
    }

    const pageTarget = await waitForPageTarget(instance.debugPort, 5_000, {
      preferredUrl: instance.currentUrl,
    });
    if (!pageTarget.webSocketDebuggerUrl) {
      throw new Error('Chromium page target did not provide a websocket debugger URL');
    }

    const client = await this.attachClient(instance, pageTarget.webSocketDebuggerUrl);
    await this.syncPageMetadata(instance);
    return client;
  }

  private async sendClientCommand<T = Record<string, unknown>>(
    instance: BrowserInstance,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    if (!instance.client) {
      await this.reconnectClient(instance);
    }

    try {
      return await instance.client!.send<T>(method, params);
    } catch (error) {
      if (!isDevToolsConnectionError(error)) {
        throw error;
      }

      await this.reconnectClient(instance);
      return await instance.client!.send<T>(method, params);
    }
  }

  private async requireRunningInstance(
    sessionId: string,
    userId: string
  ): Promise<{
    runtime: Awaited<ReturnType<typeof getOracleRuntimeConfigForSession>>['config'];
    instance: BrowserInstance;
  }> {
    const runtime = (await getOracleRuntimeConfigForSession(sessionId)).config;
    const profileDir = normalizeProfileDir(runtime.manualLoginProfileDir);
    const key = instanceKey(userId, profileDir);
    const instance = this.instances.get(key);

    if (!instance) {
      throw new Error(
        'Embedded Oracle browser is not running. Start it from the Browser tab first.'
      );
    }
    if (instance.startPromise) {
      instance.startPromise;
    }
    if (instance.status !== 'running') {
      throw new Error(instance.error || 'Embedded Oracle browser is not ready.');
    }

    instance.sessionIds.add(sessionId);
    return { runtime, instance };
  }

  private async launchInstance(instance: BrowserInstance, initialUrl: string): Promise<void> {
    await mkdir(instance.profileDir, { recursive: true });
    await cleanupStaleProfileArtifacts(instance.profileDir);

    if (!existsSync(DEFAULT_BROWSER_BIN)) {
      throw new Error(`Chromium binary not found at ${DEFAULT_BROWSER_BIN}`);
    }

    const virtualDisplay = await this.startVirtualDisplay(instance);
    const hasDisplay = !!virtualDisplay || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
    const launchHeadless = FORCE_HEADLESS_BROWSER || !hasDisplay;
    if (virtualDisplay) {
      instance.display = virtualDisplay;
    }

    const child = spawn(DEFAULT_BROWSER_BIN, buildChromiumArgs(instance, launchHeadless), {
      env: {
        ...process.env,
        CHROMIUM_USER_DATA_DIR: instance.profileDir,
        ...(virtualDisplay ? { DISPLAY: virtualDisplay } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    instance.process = child;
    child.stdout.on('data', (chunk) => {
      instance.outputTail = outputTail(instance.outputTail, chunk);
    });
    child.stderr.on('data', (chunk) => {
      instance.outputTail = outputTail(instance.outputTail, chunk);
    });
    child.on('exit', (_code, _signal) => {
      instance.process = null;
      instance.browserClient?.close();
      instance.browserClient = null;
      instance.client?.close();
      instance.client = null;
      instance.remoteChromeTarget = null;
      void this.stopVirtualDisplay(instance);
      instance.status = instance.status === 'error' ? 'error' : 'stopped';
      instance.stoppedAt = new Date().toISOString();
      if (!instance.error && instance.status === 'stopped') {
        instance.error = 'Chromium exited.';
      }
      this.instances.delete(instance.key);
    });

    try {
      const startupAbort = {
        shouldAbort: () => child.exitCode !== null || instance.process === null,
        getAbortError: () =>
          buildChromiumStartupError(
            instance,
            'Chromium exited before it exposed a DevTools connection.'
          ),
      };

      const endpoint = await waitForDevToolsEndpoint(instance.profileDir, 15_000, startupAbort);
      instance.debugPort = endpoint.port;
      instance.remoteChromeTarget = `127.0.0.1:${endpoint.port}`;
      await this.attachBrowserClient(instance, endpoint);

      const pageTarget = await waitForPageTarget(endpoint.port, 15_000, startupAbort);
      if (!pageTarget.webSocketDebuggerUrl) {
        throw new Error('Chromium page target did not provide a websocket debugger URL');
      }

      await this.attachClient(instance, pageTarget.webSocketDebuggerUrl);
      await this.navigateInstance(instance, initialUrl);
      await delay(500);
      await this.syncPageMetadata(instance);
      instance.status = 'running';
      instance.error = null;
    } catch (error) {
      instance.status = 'error';
      instance.error = error instanceof Error ? error.message : String(error);
      await this.disposeInstance(instance, false);
      throw error;
    }
  }

  private async navigateInstance(instance: BrowserInstance, url: string): Promise<void> {
    await this.sendClientCommand(instance, 'Page.navigate', { url });
    instance.currentUrl = url;
  }

  private async startVirtualDisplay(instance: BrowserInstance): Promise<string | null> {
    if (!shouldUseXvfb()) {
      return null;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const displayNumber = 100 + Math.floor(Math.random() * 40_000);
      const display = `:${displayNumber}`;
      const proc = spawn(
        XVFB_BIN,
        [
          display,
          '-screen',
          '0',
          `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}x24`,
          '-nolisten',
          'tcp',
          '-ac',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      instance.displayProcess = proc;
      proc.stdout.on('data', (chunk) => {
        instance.outputTail = outputTail(instance.outputTail, chunk);
      });
      proc.stderr.on('data', (chunk) => {
        instance.outputTail = outputTail(instance.outputTail, chunk);
      });
      proc.on('exit', () => {
        if (instance.displayProcess === proc) {
          instance.displayProcess = null;
          instance.display = null;
        }
      });

      await delay(250);
      if (proc.exitCode === null) {
        return display;
      }
    }

    instance.outputTail = outputTail(
      instance.outputTail,
      `\nXvfb could not start; falling back to Chromium headless mode.\n`
    );
    return null;
  }

  private async syncPageMetadata(instance: BrowserInstance): Promise<void> {
    try {
      const evaluation = (await this.sendClientCommand<{
        result?: { value?: { url?: string; title?: string } };
      }>(instance, 'Runtime.evaluate', {
        expression: '({ url: window.location.href, title: document.title })',
        returnByValue: true,
      })) as { result?: { value?: { url?: string; title?: string } } };

      const value = evaluation?.result?.value;
      if (value?.url) instance.currentUrl = value.url;
      if (typeof value?.title === 'string') instance.title = value.title;
    } catch {
      // Ignore transient metadata failures.
    }
  }

  private async disposeInstance(instance: BrowserInstance, removeFromMap: boolean): Promise<void> {
    try {
      instance.browserClient?.close();
    } catch {
      // Ignore close errors.
    }
    instance.browserClient = null;

    try {
      instance.client?.close();
    } catch {
      // Ignore close errors.
    }
    instance.client = null;
    instance.remoteChromeTarget = null;

    const proc = instance.process;
    instance.process = null;
    if (proc && !proc.killed) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Ignore kill errors.
      }
      await delay(150);
      if (proc.exitCode == null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Ignore hard kill errors.
        }
      }
    }

    await this.stopVirtualDisplay(instance);

    instance.status = instance.status === 'error' ? 'error' : 'stopped';
    instance.stoppedAt = new Date().toISOString();
    if (removeFromMap) {
      this.instances.delete(instance.key);
    }
  }

  private serializeState(
    sessionId: string,
    mode: OracleBrowserMode,
    chatgptUrl: string,
    profileDir: string,
    instance: BrowserInstance | null | undefined
  ): OracleEmbeddedBrowserState {
    const currentUrl = instance?.currentUrl || null;
    const remoteChromeTarget = instance?.remoteChromeTarget || null;
    const oracleWillAttachToEmbeddedBrowser = mode === 'manual' && !!remoteChromeTarget;

    let message = 'Start the embedded browser to log into ChatGPT inside Plum.';
    if (mode === 'remote') {
      message =
        'Oracle is set to remote Chrome. The embedded browser can still be used for preview/control, but Oracle itself will follow the external remote target.';
    } else if (mode === 'profile') {
      message =
        'Oracle is set to legacy profile-cookie mode. Switch to Embedded Browser mode if you want Oracle to attach directly to this in-WebUI browser.';
    } else if (oracleWillAttachToEmbeddedBrowser) {
      message =
        'Oracle can attach directly to this embedded browser for ChatGPT-based second opinions.';
    } else if (instance?.status === 'running') {
      message =
        'Embedded browser is running. Oracle will attach here automatically once the session is set to Embedded Browser mode.';
    } else if (instance?.status === 'starting') {
      message = 'Starting embedded browser...';
    } else if (instance?.status === 'error') {
      message = instance.error || 'Embedded browser failed to start.';
    }

    return {
      sessionId,
      status: instance?.status || 'idle',
      running: instance?.status === 'running',
      mode,
      chatgptUrl,
      currentUrl,
      title: instance?.title || null,
      profileDir,
      debugPort: instance?.debugPort || null,
      remoteChromeTarget,
      oracleWillAttachToEmbeddedBrowser,
      startedAt: instance?.startedAt || null,
      stoppedAt: instance?.stoppedAt || null,
      lastFrameAt: instance?.lastFrameAt ? new Date(instance.lastFrameAt).toISOString() : null,
      viewport: DEFAULT_VIEWPORT,
      message,
      error: instance?.error || null,
      outputTail: instance?.outputTail || '',
    };
  }

  private async stopVirtualDisplay(instance: BrowserInstance): Promise<void> {
    const displayProc = instance.displayProcess;
    instance.displayProcess = null;
    instance.display = null;

    if (!displayProc || displayProc.killed) {
      return;
    }

    try {
      displayProc.kill('SIGTERM');
    } catch {
      // Ignore display shutdown errors.
    }
    await delay(100);
    if (displayProc.exitCode == null) {
      try {
        displayProc.kill('SIGKILL');
      } catch {
        // Ignore hard-kill errors.
      }
    }
  }
}

let manager: OracleBrowserManager | null = null;

export function getOracleBrowserManager(): OracleBrowserManager {
  if (!manager) {
    manager = new OracleBrowserManager();
  }
  return manager;
}
