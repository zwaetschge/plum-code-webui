import {
  get as pgGet,
  all as pgAll,
  run as pgRun,
  transaction as pgTransaction,
} from '../../db/pg.js';
import { modelRouter } from '../modelRouterInstance.js';
import type { Server } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  BufferedMessage,
  SessionMode,
  ActiveFollowupMode,
  SubagentRun,
  SubagentRunStatus,
  TodoItem,
  ToolActionSummary,
  SessionSendDisposition,
  DiscordAlertEventType,
  DiscordAlertSeverity,
  PendingPermission,
  PermissionRequestData,
} from '@plum-code-webui/shared';
import { estimateModelCost } from '@plum-code-webui/shared';
import {
  insertUsageHistoryTurn,
  insertUsageSubagentTurns,
  usageHistoryTurnExists,
} from '../../db/index.js';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  PROTOCOL_VERSION as ACP_PROTOCOL_VERSION,
  ndJsonStream,
  type Client as AcpClient,
  type PromptResponse as AcpPromptResponse,
  type RequestPermissionRequest as AcpRequestPermissionRequest,
  type RequestPermissionResponse as AcpRequestPermissionResponse,
  type SessionConfigOption as AcpSessionConfigOption,
  type SessionNotification as AcpSessionNotification,
  type SessionUpdate as AcpSessionUpdate,
} from '@agentclientprotocol/sdk';
import SQLiteDatabase from 'better-sqlite3';
import { config } from '../../config.js';
import {
  CLI_PROVIDERS,
  getCLIArgs,
  formatInputMessage,
  resolveCliProviderSelectedModel,
  type CLIProvider,
} from '../cli-providers.js';
import type { CodexWebSearchMode } from '@plum-code-webui/shared';
import {
  opencodeServer,
  subtractOpenCodeUsage,
  type OpencodeEvent,
  type OpenCodeUsageCounters,
} from '../opencode/OpencodeServer.js';
import { resolveConfigHome } from '../../utils/configPaths.js';
import { listSkillLibrary, readSkillLibraryItem } from '../../utils/skillLibrary.js';
import { scanProject, formatProjectContext } from '../../utils/projectScanner.js';
import { safeJsonParse } from '../../utils/json.js';
import {
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow as contextWindowFor,
} from '../../utils/contextWindow.js';
import {
  buildClaudeApiEnv,
  getEnabledCliProvidersForUser,
  getZaiApiConfigForUser,
} from '../../routes/settings.js';
import { buildIntegrationEnv } from '../../utils/integrationEnv.js';
import { syncProviderLinks } from '../../utils/providerLinks.js';
import { getPiModelsForUser, syncPiConfig } from '../../utils/piConfig.js';
import {
  CLAUDE_PROVIDER_OVERRIDE_ENV_KEYS,
  sanitizeClaudeSettingsProviderEnv,
} from '../../utils/mcpDefaults.js';
import { sanitizeClaudeResumeTranscript } from '../../utils/claudeResumeTranscript.js';
import { buildOpenCodeProviderCredentialEnv } from '../../utils/opencodeProviderKeys.js';
import { assertRunnerAccess } from '../../utils/runnerAccess.js';
import { buildSessionExecutionPrompt } from '../sessionExecutionContext.js';
import { materializeAttachments, type FileAttachmentData } from '../attachments.js';
import { onSessionCompacted } from '../memoryOptimizer.js';
import { persistMessageMedia, type PendingChatMedia } from '../chatMedia.js';
import { recordAudit } from '../../utils/auditLog.js';
import { getFallbackToolActionSummary } from '../tool-action-summarizer.js';
import { discordIntegrationService, discordNotifier } from '../discord/index.js';
import {
  homeAssistantStatusForSessionEvent,
  homeAssistantStatusLights,
} from '../home-assistant/index.js';
import {
  signalManagedProcess,
  spawnManagedProcess,
  terminateManagedProcess,
} from './processLifecycle.js';
import { captureKimiUsageCursor, readKimiUsageSince } from '../../utils/kimiTurnUsage.js';
import {
  getSessionSyncState,
  nextSessionEventSequence,
  resolveSessionSendChatId,
} from '../sessionSync.js';
import { markChatUploadsConsumed } from '../chatUploads.js';

export interface SendMessageResult {
  messageId?: string;
  chatId: string | null;
  disposition: SessionSendDisposition;
  highWatermark: number;
}

function isClaudeTransportProvider(provider: string): provider is 'claude' | 'zai' {
  return provider === 'claude' || provider === 'zai';
}

export function buildClaudeTransportProcessEnv(
  provider: 'claude' | 'zai',
  configHome: string,
  zaiConfig: Parameters<typeof buildClaudeApiEnv>[0],
  inheritedEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...inheritedEnv };
  for (const key of CLAUDE_PROVIDER_OVERRIDE_ENV_KEYS) {
    delete env[key];
  }
  env.CLAUDE_CONFIG_HOME = configHome;
  if (provider === 'zai') {
    Object.assign(env, buildClaudeApiEnv(zaiConfig));
  }
  return env;
}

async function buildClaudeTransportEnv(
  provider: 'claude' | 'zai',
  userId: string,
  configHome: string,
  sessionId?: string
): Promise<NodeJS.ProcessEnv> {
  const env = buildClaudeTransportProcessEnv(
    provider,
    configHome,
    provider === 'zai' ? await getZaiApiConfigForUser(userId) : null
  );

  // Mixed subagents: a claude session gets its base URL pointed at the model
  // router, so a subagent whose definition names a glm-* model runs on the
  // user's Z.AI subscription while the main agent stays on the Claude one.
  // Only when Z.AI is actually configured — without it the indirection would
  // buy nothing — and never for zai sessions, whose base URL already is Z.AI.
  // MODEL_ROUTER_DISABLED=1 is the kill switch if the passthrough ever
  // misbehaves against a new CLI version.
  if (
    provider === 'claude' &&
    sessionId &&
    process.env.MODEL_ROUTER_DISABLED !== '1' &&
    (await getZaiApiConfigForUser(userId))
  ) {
    const token = modelRouter.registerSession(sessionId, userId);
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${config.port}/model-router/${token}`;
  }
  return env;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Circular buffer for storing messages for reconnection
const BUFFER_SIZE = 5000;
const HANDOFF_CONTEXT_MAX_CHARS = 60000;
const HANDOFF_CONTEXT_MAX_MESSAGES = 80;
// Guards against the historical cumulative-counter bug, where a lost delta
// baseline booked a whole session's counters (hundreds of millions) as one
// turn. Cache reads legitimately re-send the cached prefix on every model
// call inside an agentic turn, so their per-turn ceiling sits far above
// fresh input/output — the old shared 1M cap clamped ~37% of real turns.
const CODEX_TURN_TOKEN_FIELD_CAP = 5_000_000;
const CODEX_TURN_CACHE_READ_CAP = 50_000_000;
// Cap for a single accumulating stream-json line. Legitimate lines reach a few
// megabytes; a newline-free stream past this point would otherwise grow the
// per-session buffer without bound.
const MAX_STREAM_LINE_BUFFER_BYTES = 8 * 1024 * 1024;

// Pi events that prove the turn is still moving. Used to cancel the scheduled
// post-compaction nudge so we never inject a duplicate prompt.
const PI_TURN_PROGRESS_EVENTS = new Set([
  'agent_start',
  'turn_start',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_end',
  'turn_end',
  'agent_end',
]);
// Grace period after `compaction_end` before we assume Pi stalled. Pi resumes on
// its own in the overflow-retry path, so only a real stall should be nudged.
const PI_COMPACT_RESUME_DELAY_MS = 6_000;
// Bound the nudge so a compaction loop cannot spin forever on its own output.
const PI_MAX_COMPACT_CONTINUATIONS = 3;
/** One subagent's share of a turn, pending a turn id. */
interface PendingSubagentUsage {
  agentId: string;
  parentAgentId: string | null;
  agentType: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number;
}

type PiCompactionReason = 'manual' | 'threshold' | 'overflow';

function piCompactionReason(value: unknown): PiCompactionReason {
  return value === 'manual' || value === 'overflow' || value === 'threshold' ? value : 'threshold';
}

const PI_COMPACT_CONTINUE_PROMPT =
  'Context was just compacted. Continue the task from the compaction summary ' +
  'without repeating work that is already done. If the task is already ' +
  'complete, say so briefly instead of starting new work.';
const WEBUI_MANAGED_MARKER = '<!-- webui-managed: shared-config -->';
const WEBUI_MANAGED_BLOCK_START = '<!-- webui-managed: shared-config:start -->';
const WEBUI_MANAGED_BLOCK_END = '<!-- webui-managed: shared-config:end -->';
const PROJECT_CONTEXT_BLOCK_START = '<!-- webui-managed: project-context:start -->';
const PROJECT_CONTEXT_BLOCK_END = '<!-- webui-managed: project-context:end -->';
const STYLE_TEMPLATE_MAX_CHARS = 12000;

interface SharedAgent {
  name: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

// Streaming filter for Gemma's thought-channel markers. Gemma 4 emits
// `<|channel>thought ... <channel|>` around its internal reasoning when
// llama-server runs with `--reasoning-format none`. The markers appear inline
// in the content stream and must be stripped before the UI sees them.
interface ThoughtStripState {
  inside: boolean;
  pending: string;
}

interface OpenCodePartStreamEntry {
  type: 'text' | 'reasoning';
  messageId: string;
  text: string;
  cleaned?: string;
  thoughtState?: ThoughtStripState;
  savedCleanedLength?: number;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function piUsageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function piMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!isRecordValue(block)) return '';
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter(Boolean)
    .join('');
}

function piToolResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!isRecordValue(result)) return '';
  const content = result.content;
  const text = piMessageText(content);
  if (text) return text;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

const EXPLICIT_LOCAL_IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif)$/i;
const MARKDOWN_IMAGE_OR_LINK = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\n]+)\s*\)/g;

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pendingMediaFromAllowedFile(input: {
  filePath: string;
  allowedRoot: string;
  filename?: string;
  altText?: string;
  source: 'provider' | 'workspace';
  sourceId?: string;
}): PendingChatMedia | null {
  try {
    const root = fsSync.realpathSync(input.allowedRoot);
    const filePath = fsSync.realpathSync(input.filePath);
    if (!isPathInside(root, filePath) || !fsSync.statSync(filePath).isFile()) return null;
    return {
      kind: 'file',
      filePath,
      allowedRoots: [root],
      filename: input.filename || path.basename(filePath),
      altText: input.altText,
      source: input.source,
      sourceId: input.sourceId,
    };
  } catch {
    return null;
  }
}

function markdownDestination(raw: string): string | null {
  const trimmed = raw.trim();
  let destination: string;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    destination = trimmed.slice(1, -1).trim();
  } else {
    // An unescaped space starts Markdown's optional title. Paths containing
    // spaces must use the standard `<...>` destination form.
    destination = trimmed.split(/\s+["']/u, 1)[0]?.trim() || '';
  }
  if (!destination || !path.isAbsolute(destination)) return null;
  try {
    return decodeURIComponent(destination);
  } catch {
    return destination;
  }
}

function visibleMediaLabel(label: string): string {
  const cleaned = label
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `[Image attached${cleaned ? `: ${cleaned.slice(0, 160)}` : ''}]`;
}

/**
 * Convert explicit local-image Markdown into managed pending media while
 * removing the host path from user-visible/persisted assistant prose.
 */
export function extractExplicitWorkspaceChatMedia(
  content: string,
  workingDirectory: string
): { content: string; media: PendingChatMedia[] } {
  const media: PendingChatMedia[] = [];
  const seenPaths = new Set<string>();
  const sanitized = content.replace(
    MARKDOWN_IMAGE_OR_LINK,
    (full, _imageMarker: string, label: string, rawDestination: string) => {
      const candidate = markdownDestination(rawDestination);
      if (!candidate || !EXPLICIT_LOCAL_IMAGE_EXTENSION.test(candidate)) return full;

      const pending = pendingMediaFromAllowedFile({
        filePath: candidate,
        allowedRoot: workingDirectory,
        filename: path.basename(candidate),
        altText: label || undefined,
        source: 'workspace',
      });
      if (pending?.kind === 'file' && !seenPaths.has(pending.filePath)) {
        seenPaths.add(pending.filePath);
        media.push(pending);
      }

      // Strip every absolute local raster path, including rejected/out-of-root
      // references, so host paths never reach the message DB or API.
      return pending ? visibleMediaLabel(label) : '[Local image could not be attached]';
    }
  );
  return { content: sanitized, media };
}

function appendPendingChatMedia(proc: ClaudeProcess, pending: PendingChatMedia): void {
  const duplicate = proc.pendingChatMedia.some((existing) => {
    if (pending.sourceId && existing.sourceId) {
      return pending.source === existing.source && pending.sourceId === existing.sourceId;
    }
    return (
      pending.kind === 'file' &&
      existing.kind === 'file' &&
      pending.source === existing.source &&
      pending.filePath === existing.filePath
    );
  });
  if (!duplicate) proc.pendingChatMedia.push(pending);
}

const THOUGHT_OPEN = '<|channel>thought';
const THOUGHT_CLOSE = '<channel|>';

function longestBoundarySuffix(haystack: string, marker: string): number {
  const max = Math.min(haystack.length, marker.length - 1);
  for (let len = max; len > 0; len--) {
    if (marker.startsWith(haystack.slice(haystack.length - len))) return len;
  }
  return 0;
}

function stripThoughtChunk(
  state: ThoughtStripState,
  chunk: string
): { state: ThoughtStripState; emit: string } {
  let buf = state.pending + chunk;
  let out = '';
  let inside = state.inside;

  while (buf.length > 0) {
    if (inside) {
      const idx = buf.indexOf(THOUGHT_CLOSE);
      if (idx >= 0) {
        buf = buf.slice(idx + THOUGHT_CLOSE.length);
        inside = false;
        continue;
      }
      const keep = longestBoundarySuffix(buf, THOUGHT_CLOSE);
      buf = buf.slice(buf.length - keep);
      break;
    }

    const openIdx = buf.indexOf(THOUGHT_OPEN);
    const closeIdx = buf.indexOf(THOUGHT_CLOSE);

    // Orphan close marker (no preceding open): Gemma retries emit the closing
    // `thought\n<channel|>` without the matching `<|channel>thought` in some
    // continuation parts. Treat the text before the orphan as discarded
    // thought content and drop it along with the marker itself.
    if (closeIdx >= 0 && (openIdx < 0 || closeIdx < openIdx)) {
      buf = buf.slice(closeIdx + THOUGHT_CLOSE.length);
      continue;
    }

    if (openIdx >= 0) {
      out += buf.slice(0, openIdx);
      buf = buf.slice(openIdx + THOUGHT_OPEN.length);
      inside = true;
      continue;
    }

    const keepOpen = longestBoundarySuffix(buf, THOUGHT_OPEN);
    const keepClose = longestBoundarySuffix(buf, THOUGHT_CLOSE);
    const keep = Math.max(keepOpen, keepClose);
    out += buf.slice(0, buf.length - keep);
    buf = buf.slice(buf.length - keep);
    break;
  }

  return { state: { inside, pending: buf }, emit: out };
}

interface SharedSkill {
  name: string;
  content: string;
  allowedTools?: string[];
  model?: string;
}

interface SharedPlugin {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  content?: string;
  source: 'user' | 'marketplace';
  marketplace?: string;
}

async function getCliModelForSession(
  userId: string,
  provider: CLIProvider,
  sessionId?: string
): Promise<string | null> {
  let sessionSelectedModel: string | null = null;
  if (sessionId) {
    const sessionRow = (await pgGet(
      'SELECT cli_model FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    )) as unknown as { cli_model?: string | null } | undefined;
    sessionSelectedModel =
      typeof sessionRow?.cli_model === 'string' && sessionRow.cli_model.trim()
        ? sessionRow.cli_model.trim()
        : null;
  }

  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json?: string | null } | undefined;
  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const modelLists =
    settingsJson.cliProviderModelLists && typeof settingsJson.cliProviderModelLists === 'object'
      ? (settingsJson.cliProviderModelLists as Record<string, unknown>)
      : {};
  const configuredModelList =
    provider === 'pi' ? modelLists.pi : provider === 'opencode' ? modelLists.opencode : undefined;
  let configuredModels = Array.isArray(configuredModelList)
    ? configuredModelList
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
    : [];
  if (provider === 'pi' && configuredModels.length === 0) {
    configuredModels = await getPiModelsForUser(userId);
  }

  return resolveCliProviderSelectedModel(provider, null, configuredModels, sessionSelectedModel);
}

const REASONING_LEVELS_BY_PROVIDER: Record<CLIProvider, Set<string>> = {
  claude: new Set(['low', 'medium', 'high', 'max']),
  zai: new Set(['low', 'medium', 'high', 'max']),
  codex: new Set([
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'extra_high',
    'max',
    'ultra',
  ]),
  opencode: new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'extra_high', 'max']),
  pi: new Set(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'extra_high', 'max']),
  kimi: new Set(['minimal', 'low', 'medium', 'high']),
};

function normalizeReasoningLevel(provider: CLIProvider, value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) {
    return null;
  }
  return REASONING_LEVELS_BY_PROVIDER[provider].has(normalized) ? normalized : null;
}

async function getCliReasoningForSession(
  userId: string,
  provider: CLIProvider,
  sessionId?: string
): Promise<string | null> {
  if (!sessionId) {
    return null;
  }
  const row = (await pgGet(
    'SELECT cli_reasoning FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  )) as unknown as { cli_reasoning?: string | null } | undefined;

  return normalizeReasoningLevel(provider, row?.cli_reasoning);
}

function normalizeCodexServiceTier(value: unknown): 'fast' | null {
  return typeof value === 'string' && value.trim().toLowerCase() === 'fast' ? 'fast' : null;
}

async function getCliServiceTierForSession(
  userId: string,
  provider: CLIProvider,
  sessionId?: string
): Promise<'fast' | null> {
  if (provider !== 'codex' || !sessionId) {
    return null;
  }
  const row = (await pgGet(
    'SELECT cli_service_tier, cli_reasoning FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  )) as unknown as { cli_service_tier?: string | null; cli_reasoning?: string | null } | undefined;

  return (
    normalizeCodexServiceTier(row?.cli_service_tier) ??
    normalizeCodexServiceTier(row?.cli_reasoning)
  );
}

async function getCodexWebSearchForUser(userId: string): Promise<CodexWebSearchMode> {
  const row = (await pgGet(
    'SELECT settings_json FROM user_settings WHERE user_id = ?',
    userId
  )) as unknown as { settings_json?: string | null } | undefined;

  const settingsJson = safeJsonParse<Record<string, unknown>>(row?.settings_json, {});
  const value = settingsJson.codexWebSearch;
  return value === 'cached' || value === 'live' || value === 'disabled' || value === 'auto'
    ? value
    : 'auto';
}

type CodexUsageCounters = { input: number; cached: number; output: number };
type CodexThreadState = {
  id: string;
  tokensUsed: number;
  rolloutPath?: string;
  updatedAt?: number;
  updatedAtMs?: number;
  model?: string;
  match?: 'thread-id' | 'prompt' | 'cwd';
};
export type CodexContextSnapshot = {
  counters: CodexUsageCounters;
  contextWindow: number;
  model?: string;
  recordedAt?: string;
  recordedAtMs?: number;
  threadId?: string;
  rolloutPath?: string;
};

// Rollout files may grow into the hundreds of megabytes. Context snapshots are
// best-effort and the newest token_count is written near the end, so never load
// an entire rollout just to find it. Sixteen MiB leaves ample room for large
// tool events while keeping synchronous I/O and transient memory strictly
// bounded.
export const CODEX_ROLLOUT_TAIL_MAX_BYTES = 16 * 1024 * 1024;

export type CodexRolloutTail = {
  lines: string[];
  bytesRead: number;
  truncated: boolean;
};

export function readCodexRolloutTail(
  rolloutPath: string,
  maxBytes = CODEX_ROLLOUT_TAIL_MAX_BYTES
): CodexRolloutTail | null {
  let fd: number | null = null;
  try {
    const stat = fsSync.statSync(rolloutPath);
    const boundedMaxBytes =
      Number.isFinite(maxBytes) && maxBytes > 0
        ? Math.max(1, Math.trunc(maxBytes))
        : CODEX_ROLLOUT_TAIL_MAX_BYTES;
    const start = Math.max(0, stat.size - boundedMaxBytes);
    const requestedBytes = Math.min(stat.size, boundedMaxBytes);
    const buffer = Buffer.allocUnsafe(requestedBytes);
    fd = fsSync.openSync(rolloutPath, 'r');

    let bytesRead = 0;
    while (bytesRead < requestedBytes) {
      const count = fsSync.readSync(
        fd,
        buffer,
        bytesRead,
        requestedBytes - bytesRead,
        start + bytesRead
      );
      if (count <= 0) break;
      bytesRead += count;
    }

    const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\n/);
    // The first bytes of a bounded tail may be the middle of a JSON record.
    // Discard that fragment rather than attempting to parse corrupted UTF-8.
    if (start > 0) lines.shift();
    return { lines, bytesRead, truncated: start > 0 };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fsSync.closeSync(fd);
      } catch {
        // Ignore close failures on a best-effort context snapshot.
      }
    }
  }
}

function normalizeCodexUsageCounters(value: unknown): CodexUsageCounters | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const firstFiniteNumber = (...values: unknown[]): number | undefined => {
    for (const raw of values) {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    return undefined;
  };
  const input = firstFiniteNumber(
    candidate.input,
    candidate.input_tokens,
    candidate.total_tokens,
    candidate.tokens_used,
    candidate.tokensUsed,
    candidate.context_tokens,
    candidate.retained_tokens,
    candidate.compacted_tokens
  );
  const cached = firstFiniteNumber(candidate.cached, candidate.cached_input_tokens) ?? 0;
  const output =
    firstFiniteNumber(
      candidate.output,
      candidate.output_tokens,
      candidate.reasoning_output_tokens
    ) ?? 0;
  if (!Number.isFinite(input) || !Number.isFinite(cached) || !Number.isFinite(output)) {
    return undefined;
  }
  const inputValue = input as number;
  if (inputValue < 0 || cached < 0 || output < 0) return undefined;
  if (inputValue <= 0 && cached <= 0 && output <= 0) return undefined;
  return { input: inputValue, cached, output };
}

function extractCodexContextUsageCounters(value: unknown): CodexUsageCounters | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const info =
    data.info && typeof data.info === 'object' ? (data.info as Record<string, unknown>) : null;
  const candidates = [
    info?.last_token_usage,
    data.last_token_usage,
    data.context_usage,
    data.context,
    data.compacted_context,
    data.compacted,
    data.usage,
    data,
  ];

  for (const candidate of candidates) {
    const counters = normalizeCodexUsageCounters(candidate);
    if (counters) return counters;
  }
  return undefined;
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function findLatestCodexStateDatabase(codexHome: string): string | null {
  try {
    const candidates = fsSync
      .readdirSync(codexHome, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
      .map((entry) => {
        const filePath = path.join(codexHome, entry.name);
        const stat = fsSync.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.filePath || null;
  } catch {
    return null;
  }
}

function normalizeCodexThreadStateRow(value: unknown): CodexThreadState | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const tokensUsed = Number(row.tokensUsed);
  if (!id || !Number.isFinite(tokensUsed) || tokensUsed <= 0) return null;

  const updatedAt = Number(row.updatedAt);
  const updatedAtMs = Number(row.updatedAtMs);
  const rolloutPath = typeof row.rolloutPath === 'string' ? row.rolloutPath : undefined;
  const model = typeof row.model === 'string' ? row.model : undefined;

  return {
    id,
    tokensUsed,
    rolloutPath,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : undefined,
    model,
  };
}

// One long-lived readonly handle per state DB. Opening better-sqlite3 per call
// showed up on every session PATCH; readonly WAL readers are safe to keep.
const codexStateDbHandles = new Map<string, SQLiteDatabase.Database>();

function getCodexStateDatabase(dbPath: string): SQLiteDatabase.Database {
  const cached = codexStateDbHandles.get(dbPath);
  if (cached) return cached;
  const db = new SQLiteDatabase(dbPath, { readonly: true, fileMustExist: true });
  codexStateDbHandles.set(dbPath, db);
  return db;
}

function dropCodexStateDatabase(dbPath: string): void {
  const cached = codexStateDbHandles.get(dbPath);
  if (!cached) return;
  codexStateDbHandles.delete(dbPath);
  try {
    cached.close();
  } catch {
    // ignore close failures
  }
}

export async function readCodexThreadState(
  codexHome: string,
  opts: {
    threadId?: string | null;
    cwd?: string | null;
    sinceMs?: number | null;
    promptPrefix?: string | null;
  }
): Promise<CodexThreadState | null> {
  const dbPath = findLatestCodexStateDatabase(codexHome);
  if (!dbPath) return null;

  let db: SQLiteDatabase.Database | null = null;
  try {
    db = getCodexStateDatabase(dbPath);
    const hasThreads = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'threads'")
      .get();
    if (!hasThreads) return null;

    const selectThread = `
      SELECT
        id,
        tokens_used as tokensUsed,
        rollout_path as rolloutPath,
        updated_at as updatedAt,
        updated_at_ms as updatedAtMs,
        model
      FROM threads
    `;

    const threadId = opts.threadId?.trim();
    if (threadId) {
      const row = db.prepare(`${selectThread} WHERE id = ? LIMIT 1`).get(threadId);
      const state = normalizeCodexThreadStateRow(row);
      if (state) return { ...state, match: 'thread-id' };
    }

    const cwd = opts.cwd?.trim();
    if (!cwd) return null;

    const sinceMs = Number(opts.sinceMs);
    const lowerBoundMs = Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs - 120_000 : 0;
    const lowerBoundSec = lowerBoundMs > 0 ? Math.floor(lowerBoundMs / 1000) : 0;
    const promptPrefix = opts.promptPrefix?.trim();
    const promptPattern =
      promptPrefix && promptPrefix.length >= 16
        ? `${escapeSqlLike(promptPrefix.slice(0, 180))}%`
        : null;

    const queryLatest = async (requirePromptMatch: boolean): Promise<CodexThreadState | null> => {
      const params: unknown[] = [cwd];
      let sql = `
        ${selectThread}
        WHERE cwd = ?
          AND tokens_used > 0
      `;

      if (lowerBoundSec > 0) {
        sql += `
          AND (
            updated_at >= ?
            OR COALESCE(updated_at_ms, 0) >= ?
            OR created_at >= ?
            OR COALESCE(created_at_ms, 0) >= ?
          )
        `;
        params.push(lowerBoundSec, lowerBoundMs, lowerBoundSec, lowerBoundMs);
      }

      if (requirePromptMatch && promptPattern) {
        sql += `
          AND (
            title LIKE ? ESCAPE '\\'
            OR first_user_message LIKE ? ESCAPE '\\'
            OR preview LIKE ? ESCAPE '\\'
          )
        `;
        params.push(promptPattern, promptPattern, promptPattern);
      }

      sql += `
        ORDER BY
          COALESCE(updated_at_ms, updated_at * 1000, 0) DESC,
          updated_at DESC
        LIMIT 1
      `;

      const state = normalizeCodexThreadStateRow(db!.prepare(sql).get(...params));
      return state ? { ...state, match: requirePromptMatch ? 'prompt' : 'cwd' } : null;
    };

    return (promptPattern ? await queryLatest(true) : null) || (await queryLatest(false));
  } catch (error) {
    console.warn('[CODEX] Failed to read Codex thread state:', error);
    // A stale handle (rotated/replaced state file) should not poison every
    // later call; reopen lazily on the next one.
    dropCodexStateDatabase(dbPath);
    return null;
  }
}

function readLatestCodexRolloutTotalUsage(rolloutPath: string): CodexUsageCounters | null {
  let fd: number | null = null;
  try {
    const stat = fsSync.statSync(rolloutPath);
    fd = fsSync.openSync(rolloutPath, 'r');
    const chunkSize = 1024 * 1024;
    const maxBytes = 16 * chunkSize;
    let position = stat.size;
    let scanned = 0;
    let carry = '';

    while (position > 0 && scanned < maxBytes) {
      const bytesToRead = Math.min(chunkSize, position, maxBytes - scanned);
      position -= bytesToRead;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      fsSync.readSync(fd, buffer, 0, bytesToRead, position);
      scanned += bytesToRead;

      const parts = `${buffer.toString('utf8')}${carry}`.split(/\n/);
      carry = parts.shift() || '';
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const line = parts[index]?.trim();
        if (!line) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const event = normalizeCodexRolloutEvent(parsed);
        const eventType =
          typeof event?.type === 'string' ? event.type.replace(/\//g, '.').toLowerCase() : '';
        if (eventType !== 'token_count') continue;
        const info =
          event?.info && typeof event.info === 'object'
            ? (event.info as Record<string, unknown>)
            : null;
        const usage = normalizeCodexTokenCountUsage(info?.total_token_usage);
        if (usage) return usage;
      }
    }

    if (position === 0 && carry.trim()) {
      try {
        const event = normalizeCodexRolloutEvent(JSON.parse(carry));
        const eventType =
          typeof event?.type === 'string' ? event.type.replace(/\//g, '.').toLowerCase() : '';
        if (eventType === 'token_count') {
          const info =
            event?.info && typeof event.info === 'object'
              ? (event.info as Record<string, unknown>)
              : null;
          const usage = normalizeCodexTokenCountUsage(info?.total_token_usage);
          if (usage) return usage;
        }
      } catch {
        // The file started before our scan window or the first line was incomplete.
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fsSync.closeSync(fd);
      } catch {
        // Ignore close failures on a best-effort analytics snapshot.
      }
    }
  }
  return null;
}

export async function readCodexThreadCumulativeUsage(
  codexHome: string,
  threadId: string | null | undefined
): Promise<CodexUsageCounters | undefined> {
  if (!threadId) return undefined;
  const thread = await readCodexThreadState(codexHome, { threadId });
  if (!thread?.rolloutPath) return undefined;
  return readLatestCodexRolloutTotalUsage(thread.rolloutPath) || undefined;
}

const codexRolloutInheritedUsageCache = new Map<string, CodexUsageCounters | null>();

function readCodexRolloutInheritedUsage(
  rolloutPath: string,
  threadCreatedAtMs: number | undefined
): CodexUsageCounters | null {
  if (!Number.isFinite(threadCreatedAtMs) || !threadCreatedAtMs || threadCreatedAtMs <= 0) {
    return null;
  }

  const cacheKey = `${rolloutPath}:${threadCreatedAtMs}`;
  if (codexRolloutInheritedUsageCache.has(cacheKey)) {
    return codexRolloutInheritedUsageCache.get(cacheKey) ?? null;
  }

  let fd: number | null = null;
  let inheritedUsage: CodexUsageCounters | null = null;
  try {
    const stat = fsSync.statSync(rolloutPath);
    fd = fsSync.openSync(rolloutPath, 'r');
    const chunkSize = 1024 * 1024;
    const maxBytes = 64 * chunkSize;
    const replayCutoffMs = threadCreatedAtMs + 1_000;
    let position = 0;
    let scanned = 0;
    let carry = '';
    let reachedLiveEvents = false;

    while (position < stat.size && scanned < maxBytes && !reachedLiveEvents) {
      const bytesToRead = Math.min(chunkSize, stat.size - position, maxBytes - scanned);
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const bytesRead = fsSync.readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      scanned += bytesRead;

      const parts = `${carry}${buffer.subarray(0, bytesRead).toString('utf8')}`.split(/\n/);
      carry = parts.pop() || '';
      for (const rawLine of parts) {
        const line = rawLine.trim();
        if (!line) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const envelope = parsed as Record<string, unknown>;
        const event = normalizeCodexRolloutEvent(parsed);
        const timestampRaw = envelope.timestamp ?? event?.timestamp;
        const timestampMs =
          typeof timestampRaw === 'string' || typeof timestampRaw === 'number'
            ? new Date(timestampRaw).getTime()
            : Number.NaN;
        if (Number.isFinite(timestampMs) && timestampMs > replayCutoffMs) {
          reachedLiveEvents = true;
          break;
        }

        const eventType =
          typeof event?.type === 'string' ? event.type.replace(/\//g, '.').toLowerCase() : '';
        if (eventType !== 'token_count') continue;
        const info =
          event?.info && typeof event.info === 'object'
            ? (event.info as Record<string, unknown>)
            : null;
        const usage = normalizeCodexTokenCountUsage(info?.total_token_usage);
        if (usage) inheritedUsage = usage;
      }
    }
  } catch {
    inheritedUsage = null;
  } finally {
    if (fd !== null) {
      try {
        fsSync.closeSync(fd);
      } catch {
        // Ignore close failures on a best-effort analytics snapshot.
      }
    }
  }

  codexRolloutInheritedUsageCache.set(cacheKey, inheritedUsage);
  return inheritedUsage;
}

function subtractCodexUsageCounters(
  total: CodexUsageCounters,
  baseline: CodexUsageCounters | null
): CodexUsageCounters {
  if (!baseline) return total;
  return {
    input: Math.max(total.input - baseline.input, 0),
    cached: Math.max(total.cached - baseline.cached, 0),
    output: Math.max(total.output - baseline.output, 0),
  };
}

export interface CodexDescendantThreadUsage {
  threadId: string;
  parentThreadId: string | null;
  /** Nickname/role/title Codex recorded for the spawned agent, if any. */
  agentType: string | null;
  model: string | null;
  usage: CodexUsageCounters;
}

/**
 * Per-thread usage for every subagent below `rootThreadId`.
 *
 * Codex replays the parent conversation into each spawned thread and lets the
 * child's counter continue from the parent's value at fork time, so the raw
 * rollout total is NOT the child's own spend. `readCodexRolloutInheritedUsage`
 * strips that replayed prefix — without it a deep tree multiplies the parent's
 * tokens by its number of children.
 */
export async function readCodexDescendantUsageDetail(
  codexHome: string,
  rootThreadId: string
): Promise<CodexDescendantThreadUsage[]> {
  const dbPath = findLatestCodexStateDatabase(codexHome);
  if (!dbPath || !rootThreadId.trim()) return [];

  let db: SQLiteDatabase.Database | null = null;
  try {
    db = new SQLiteDatabase(dbPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT id, source, rollout_path as rolloutPath,
                created_at as createdAt, created_at_ms as createdAtMs,
                model, title, agent_nickname as agentNickname, agent_role as agentRole
         FROM threads`
      )
      .all() as Array<{
      id: string;
      source?: string | null;
      rolloutPath?: string | null;
      createdAt?: number | null;
      createdAtMs?: number | null;
      model?: string | null;
      title?: string | null;
      agentNickname?: string | null;
      agentRole?: string | null;
    }>;
    const children = new Map<string, string[]>();
    const parents = new Map<string, string>();
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const row of rows) {
      // `source` is either a bare tag ('exec', 'cli', …) or a JSON blob; only
      // the latter can name a spawn parent.
      if (!row.source?.startsWith('{')) continue;
      const source = safeJsonParse<Record<string, unknown>>(row.source, {});
      const subagent = source.subagent as Record<string, unknown> | undefined;
      const spawn = subagent?.thread_spawn as Record<string, unknown> | undefined;
      const parentId = typeof spawn?.parent_thread_id === 'string' ? spawn.parent_thread_id : '';
      if (!parentId) continue;
      const existing = children.get(parentId) || [];
      existing.push(row.id);
      children.set(parentId, existing);
      parents.set(row.id, parentId);
    }

    const result: CodexDescendantThreadUsage[] = [];
    const pending = [...(children.get(rootThreadId) || [])];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const threadId = pending.pop() as string;
      if (visited.has(threadId)) continue;
      visited.add(threadId);
      pending.push(...(children.get(threadId) || []));

      const thread = byId.get(threadId);
      const rolloutPath = thread?.rolloutPath;
      if (!rolloutPath) continue;
      const totalUsage = readLatestCodexRolloutTotalUsage(rolloutPath);
      if (!totalUsage) continue;
      const createdAtMs =
        Number(thread?.createdAtMs) ||
        (Number(thread?.createdAt) > 0 ? Number(thread?.createdAt) * 1000 : undefined);
      const inheritedUsage = readCodexRolloutInheritedUsage(rolloutPath, createdAtMs);
      result.push({
        threadId,
        parentThreadId: parents.get(threadId) ?? null,
        agentType:
          thread?.agentNickname?.trim() ||
          thread?.agentRole?.trim() ||
          thread?.title?.trim() ||
          null,
        model: thread?.model?.trim() || null,
        usage: subtractCodexUsageCounters(totalUsage, inheritedUsage),
      });
    }
    return result;
  } catch (error) {
    console.warn('[CODEX] Failed to read descendant usage:', error);
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close failures on a best-effort analytics snapshot.
    }
  }
}

export async function readCodexDescendantUsage(
  codexHome: string,
  rootThreadId: string
): Promise<CodexUsageCounters> {
  const totals = { input: 0, cached: 0, output: 0 };
  for (const thread of await readCodexDescendantUsageDetail(codexHome, rootThreadId)) {
    totals.input += thread.usage.input;
    totals.cached += thread.usage.cached;
    totals.output += thread.usage.output;
  }
  return totals;
}

/**
 * Newest Codex exec-root thread for a working directory.
 *
 * Descendant accounting has to anchor on the *root* of the spawn tree. Subagent
 * threads share the parent's cwd, so a plain "newest thread in this cwd" lookup
 * can land on a leaf and then find no children — which silently drops the entire
 * subagent bill. Skip anything carrying a `thread_spawn.parent_thread_id`.
 */
export async function findCodexExecRootThreadId(
  codexHome: string,
  opts: { cwd?: string | null; sinceMs?: number | null }
): Promise<string | null> {
  const cwd = opts.cwd?.trim();
  if (!cwd) return null;
  const dbPath = findLatestCodexStateDatabase(codexHome);
  if (!dbPath) return null;

  let db: SQLiteDatabase.Database | null = null;
  try {
    db = new SQLiteDatabase(dbPath, { readonly: true, fileMustExist: true });
    const sinceMs = Number(opts.sinceMs);
    // 2s of slack absorbs second-granularity created_at rounding. Order ASC and
    // take the FIRST root at or after the bound: that is the exec this turn
    // spawned. Picking the newest instead would steal another WebUI session's
    // exec whenever two sessions share a working directory.
    const lowerBoundMs = Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs - 2_000 : 0;
    const rows = db
      .prepare(
        `SELECT id, source
           FROM threads
          WHERE cwd = ?
            AND COALESCE(created_at_ms, created_at * 1000, 0) >= ?
          ORDER BY COALESCE(created_at_ms, created_at * 1000, 0) ASC
          LIMIT 50`
      )
      .all(cwd, lowerBoundMs) as Array<{ id: string; source?: string | null }>;

    for (const row of rows) {
      if (!row.id) continue;
      // `source` is either a bare tag ('exec', 'cli', …) or a JSON blob.
      if (!row.source?.startsWith('{')) return row.id;
      const parsed = safeJsonParse<Record<string, unknown>>(row.source, {});
      const subagent = parsed.subagent as Record<string, unknown> | undefined;
      const spawn = subagent?.thread_spawn as Record<string, unknown> | undefined;
      const parentId = typeof spawn?.parent_thread_id === 'string' ? spawn.parent_thread_id : '';
      if (parentId) continue;
      return row.id;
    }
    return null;
  } catch (error) {
    console.warn('[CODEX] Failed to resolve exec root thread:', error);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close failures on a best-effort analytics snapshot.
    }
  }
}

function normalizeCodexRolloutEvent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Record<string, unknown>;
  const payload =
    envelope.payload && typeof envelope.payload === 'object'
      ? (envelope.payload as Record<string, unknown>)
      : null;
  if (!payload) return envelope;

  const envelopeType = typeof envelope.type === 'string' ? envelope.type : '';
  if (envelopeType === 'event_msg' || envelopeType === 'response_item') {
    return payload;
  }
  return { ...payload, type: envelopeType || payload.type };
}

function normalizeCodexTokenCountUsage(value: unknown): CodexUsageCounters | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const input = Number(candidate.input_tokens ?? candidate.input ?? 0);
  const cached = Number(candidate.cached_input_tokens ?? candidate.cached ?? 0);
  const output = Number(candidate.output_tokens ?? candidate.output ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(cached) || !Number.isFinite(output)) {
    return undefined;
  }
  if (input < 0 || cached < 0 || output < 0) return undefined;
  return { input, cached, output };
}

// token_count events sit near the end of a rollout, so a small tail finds one
// almost always; the 16 MiB bound stays as the rare fallback. Snapshots are
// cached per rollout file version — a session PATCH on an idle session must
// not re-read and re-parse megabytes it already parsed.
const CODEX_ROLLOUT_SNAPSHOT_TAIL_BYTES = 512 * 1024;
const codexContextSnapshotCache = new Map<
  string,
  { mtimeMs: number; size: number; snapshot: CodexContextSnapshot | null }
>();

export async function readLatestCodexContextSnapshot(
  codexHome: string,
  opts: {
    threadId?: string | null;
    cwd?: string | null;
    sinceMs?: number | null;
    promptPrefix?: string | null;
  }
): Promise<CodexContextSnapshot | null> {
  const threadState = await readCodexThreadState(codexHome, opts);
  if (!threadState?.rolloutPath) return null;

  let stat: fsSync.Stats | null = null;
  try {
    stat = fsSync.statSync(threadState.rolloutPath);
  } catch {
    stat = null;
  }
  if (stat) {
    const cached = codexContextSnapshotCache.get(threadState.rolloutPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.snapshot;
    }
  }

  const snapshot =
    scanCodexContextSnapshotTail(threadState, CODEX_ROLLOUT_SNAPSHOT_TAIL_BYTES) ??
    scanCodexContextSnapshotTail(threadState, CODEX_ROLLOUT_TAIL_MAX_BYTES, true);

  if (stat) {
    if (codexContextSnapshotCache.size > 256) codexContextSnapshotCache.clear();
    codexContextSnapshotCache.set(threadState.rolloutPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      snapshot,
    });
  }
  return snapshot;
}

function scanCodexContextSnapshotTail(
  threadState: CodexThreadState,
  maxBytes: number,
  isFallback = false
): CodexContextSnapshot | null {
  if (!threadState.rolloutPath) return null;
  const tail = readCodexRolloutTail(threadState.rolloutPath, maxBytes);
  if (!tail) return null;
  // The small first pass only fails when no token_count landed in its window;
  // skip the expensive fallback when the file was fully covered already.
  if (isFallback && tail.bytesRead <= CODEX_ROLLOUT_SNAPSHOT_TAIL_BYTES) return null;

  // Scan newest-first and stop at the first valid token_count. This avoids
  // parsing unrelated tool output in the rest of the bounded tail.
  for (let index = tail.lines.length - 1; index >= 0; index -= 1) {
    const line = tail.lines[index];
    if (!line?.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const event = normalizeCodexRolloutEvent(parsed);
    const eventType =
      typeof event?.type === 'string' ? event.type.replace(/\//g, '.').toLowerCase() : '';
    if (eventType !== 'token_count') continue;
    if (!event) continue;

    const envelope = parsed as Record<string, unknown>;
    const timestamp = typeof envelope.timestamp === 'string' ? envelope.timestamp : undefined;
    const recordedAtMs = timestamp ? Date.parse(timestamp) : undefined;
    const info =
      event.info && typeof event.info === 'object' ? (event.info as Record<string, unknown>) : null;
    const counters = normalizeCodexTokenCountUsage(info?.last_token_usage);
    if (!counters) continue;

    const reportedWindow = Number(info?.model_context_window ?? event.model_context_window);
    const contextWindow =
      contextWindowFor(threadState.model) !== DEFAULT_CONTEXT_WINDOW
        ? contextWindowFor(threadState.model)
        : Number.isFinite(reportedWindow) && reportedWindow > 0
          ? reportedWindow
          : DEFAULT_CONTEXT_WINDOW;

    return {
      counters,
      contextWindow,
      model: threadState.model,
      recordedAt: timestamp,
      recordedAtMs: Number.isFinite(recordedAtMs) ? recordedAtMs : undefined,
      threadId: threadState.id,
      rolloutPath: threadState.rolloutPath,
    };
  }

  return null;
}

async function getCodexUsageBaselineFromDatabase(
  sessionId: string
): Promise<CodexUsageCounters | undefined> {
  const latestSnapshot = (await pgGet(
    `
      SELECT metadata_json as metadataJson
      FROM session_events
      WHERE session_id = ?
        AND event_type = 'context_snapshot'
        AND provider = 'codex'
      ORDER BY created_at DESC, seq DESC
      LIMIT 1
    `,
    sessionId
  )) as unknown as { metadataJson?: string | null } | undefined;

  const metadata = safeJsonParse<Record<string, unknown>>(latestSnapshot?.metadataJson, {});
  const persistedBaseline = normalizeCodexUsageCounters(metadata.codexUsageBaseline);
  if (persistedBaseline) {
    return persistedBaseline;
  }

  const row = (await pgGet(
    `
      SELECT
        COALESCE(SUM(input_tokens + cache_read_tokens), 0) as input,
        COALESCE(SUM(cache_read_tokens), 0) as cached,
        COALESCE(SUM(output_tokens), 0) as output
      FROM usage_history
      WHERE session_id = ?
        AND (
          provider = 'codex'
          OR (provider IN ('', 'unknown') AND (model LIKE 'gpt-%' OR lower(model) LIKE '%codex%'))
        )
    `,
    sessionId
  )) as unknown as { input: number; cached: number; output: number } | undefined;

  if (!row) return undefined;
  const input = Number(row.input) || 0;
  const cached = Number(row.cached) || 0;
  const output = Number(row.output) || 0;
  if (input <= 0 && cached <= 0 && output <= 0) {
    return undefined;
  }

  const latestContext = (await pgGet(
    `
      SELECT total_tokens as totalTokens, context_window as contextWindow
      FROM session_events
      WHERE session_id = ?
        AND event_type = 'context_snapshot'
        AND provider = 'codex'
      ORDER BY created_at DESC, seq DESC
      LIMIT 1
    `,
    sessionId
  )) as unknown as { totalTokens?: number; contextWindow?: number } | undefined;
  const contextWindow = Number(latestContext?.contextWindow) || DEFAULT_CONTEXT_WINDOW;
  const contextTokens = Number(latestContext?.totalTokens) || 0;
  const reconstructedTotal = input + output;

  // Old builds wrote clamped/polluted rows into usage_history. Do not let those
  // rows become a fake Codex cumulative baseline after a backend restart.
  if (contextTokens > 0 && reconstructedTotal > Math.max(contextWindow * 4, contextTokens * 20)) {
    return undefined;
  }

  return { input, cached, output };
}

async function getAndroidDeviceSerialForSession(
  sessionId: string,
  userId?: string
): Promise<string | null> {
  try {
    const row = userId
      ? ((await pgGet(
          'SELECT android_device_serial as serial FROM sessions WHERE id = ? AND user_id = ?',
          sessionId,
          userId
        )) as unknown as { serial?: string | null } | undefined)
      : ((await pgGet(
          'SELECT android_device_serial as serial FROM sessions WHERE id = ?',
          sessionId
        )) as unknown as { serial?: string | null } | undefined);
    return row?.serial?.trim() || null;
  } catch {
    // Older test schemas and first-boot migrations may not have this column yet.
    return null;
  }
}

async function buildAndroidDeviceEnvForSession(
  sessionId: string,
  userId?: string
): Promise<Record<string, string>> {
  const serial = await getAndroidDeviceSerialForSession(sessionId, userId);
  return serial
    ? {
        WEBUI_ANDROID_DEVICE_SERIAL: serial,
        ANDROID_SERIAL: serial,
      }
    : {};
}

async function buildAndroidDeviceContext(
  sessionId: string,
  userId: string
): Promise<string | null> {
  const serial = await getAndroidDeviceSerialForSession(sessionId, userId);
  if (!serial) return null;
  return `<system-reminder>
Android test device selected for this Plum session: ${serial}
Use the android-builder MCP tools for Android app build/install/launch/testing. Do not run raw adb or gradle from Bash. When an MCP tool accepts a serial, pass this selected serial unless the user explicitly chooses another device.
</system-reminder>`;
}

/**
 * Fixed-size FIFO buffer used to replay recent session events to a reconnecting client.
 *
 * Thread safety: All methods are synchronous and contain no `await`, so the Node.js event
 * loop itself serializes access — no external mutex is needed. Readers get defensive copies
 * (`slice` / spread), so a reader's returned array is stable even if a subsequent tick writes.
 * If any method is later changed to be `async`, revisit this invariant.
 */
class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;
  /** True once a push has evicted an item — used to detect buffer rollover for reconnects. */
  private hasEvicted = false;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
      this.hasEvicted = true;
    }
    this.buffer.push(item);
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  /**
   * Returns items matching the predicate and everything after, plus a flag indicating
   * whether the buffer has rolled over since the caller last saw data.
   * If predicate doesn't match and the buffer has evicted items, caller should full-resync.
   */
  getSinceWithStatus(predicate: (item: T) => boolean): { items: T[]; needsFullResync: boolean } {
    const startIndex = this.buffer.findIndex(predicate);
    if (startIndex !== -1) {
      return { items: this.buffer.slice(startIndex), needsFullResync: false };
    }
    return { items: [], needsFullResync: this.hasEvicted };
  }

  getSince(predicate: (item: T) => boolean): T[] {
    return this.getSinceWithStatus(predicate).items;
  }

  getSize(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
    this.hasEvicted = false;
  }
}

function parseMarkdownFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const frontmatter: Record<string, string> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const yamlContent = content.substring(3, endIndex).trim();
      body = content.substring(endIndex + 3).trim();

      yamlContent.split('\n').forEach((line) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          frontmatter[key] = value;
        }
      });
    }
  }

  return { frontmatter, body };
}

async function readSharedAgents(configHome: string): Promise<SharedAgent[]> {
  const agentsDir = path.join(configHome, 'agents');
  const agents: SharedAgent[] = [];
  let files: string[] = [];

  try {
    files = await fs.readdir(agentsDir);
  } catch {
    return agents;
  }

  for (const file of files) {
    const isDisabled = file.endsWith('.md.disabled');
    const isEnabled = file.endsWith('.md') && !isDisabled;
    if (!isEnabled) continue;

    const filePath = path.join(agentsDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { frontmatter, body } = parseMarkdownFrontmatter(content);
      const baseName = file.replace('.md', '');
      agents.push({
        name: frontmatter.name || baseName,
        prompt: body,
        tools: frontmatter.tools?.split(',').map((tool) => tool.trim()),
        model: frontmatter.model,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return agents;
}

async function readSharedSkills(configHome: string): Promise<SharedSkill[]> {
  const skills = await listSkillLibrary(configHome, { kind: 'skill', enabledOnly: true });
  return skills.map((skill) => ({
    name: skill.name,
    content: `---\ndescription: ${skill.description}\n---`,
    allowedTools: skill.allowedTools,
    model: skill.model,
  }));
}

async function readSharedPlugins(configHome: string): Promise<SharedPlugin[]> {
  const plugins: SharedPlugin[] = [];
  const userPluginsDir = path.join(configHome, 'plugins', 'user');
  const installedPluginsFile = path.join(configHome, 'plugins', 'installed_plugins.json');

  try {
    const entries = await fs.readdir(userPluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith('.disabled')) continue;

      const pluginDir = path.join(userPluginsDir, entry.name);
      const pluginFile = path.join(pluginDir, 'PLUGIN.md');
      try {
        const content = await fs.readFile(pluginFile, 'utf-8');
        const { frontmatter, body } = parseMarkdownFrontmatter(content);
        plugins.push({
          name: frontmatter.name || entry.name,
          description: frontmatter.description,
          version: frontmatter.version,
          author: frontmatter.author,
          category: frontmatter.category,
          content: body.trim() || undefined,
          source: 'user',
        });
      } catch {
        // Skip unreadable plugins
      }
    }
  } catch {
    // No user plugins
  }

  try {
    const content = await fs.readFile(installedPluginsFile, 'utf-8');
    const data = JSON.parse(content) as {
      plugins?: Record<string, Array<{ installPath: string; version?: string }>>;
    };
    const entries = Object.entries(data.plugins || {});
    for (const [pluginId, installs] of entries) {
      const install = installs?.[0];
      if (!install?.installPath) continue;

      const pluginFile = path.join(install.installPath, 'PLUGIN.md');
      try {
        const pluginContent = await fs.readFile(pluginFile, 'utf-8');
        const { frontmatter, body } = parseMarkdownFrontmatter(pluginContent);
        const [name, marketplace] = pluginId.split('@');
        plugins.push({
          name: frontmatter.name || name || pluginId,
          description: frontmatter.description,
          version: frontmatter.version || install.version,
          author: frontmatter.author,
          category: frontmatter.category,
          content: body.trim() || undefined,
          source: 'marketplace',
          marketplace,
        });
      } catch {
        // Skip marketplace plugin without PLUGIN.md
      }
    }
  } catch {
    // No installed plugins
  }

  return plugins;
}

type CodexSharedContextResource = { name: string };

function formatCodexSharedContext(
  agents: ReadonlyArray<CodexSharedContextResource>,
  skills: ReadonlyArray<CodexSharedContextResource>,
  plugins: ReadonlyArray<CodexSharedContextResource>
): string | null {
  if (!agents.length && !skills.length && !plugins.length) {
    return null;
  }

  const lines: string[] = [];
  lines.push('[Shared Plum Config]');
  lines.push(
    'Keep the default context lean. Active core skills are native; uncommon skills and agents stay searchable on demand.'
  );
  lines.push(
    'Project-level persistent instructions and handoff notes belong in workspace `AGENTS.md`; `CLAUDE.md` is legacy compatibility only.'
  );
  lines.push('');
  lines.push('Runtime tools:');
  lines.push(
    '- System Chromium is available at /usr/local/bin/plum-chromium; browser env vars CHROME_BIN, BROWSER, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, and PUPPETEER_EXECUTABLE_PATH point there.'
  );
  lines.push(
    '- The Chromium wrapper adds Docker-safe flags such as --no-sandbox and --disable-dev-shm-usage, so do not apk add Chromium inside a session.'
  );

  if (skills.length > 0) {
    lines.push('');
    lines.push(
      `Active core skills (${skills.length}): ${skills.map((skill) => skill.name).join(', ')}`
    );
  }

  lines.push('');
  lines.push(
    '- Search on-demand skills and agents only when needed: `node /app/scripts/capability-catalog.mjs search "<task>"`.'
  );
  lines.push(
    '- Load one result with `node /app/scripts/capability-catalog.mjs show <name>`; avoid overlapping workflow/style skills.'
  );
  lines.push(
    '- MCP servers and plugins remain discoverable through Plum Settings and their authenticated APIs.'
  );

  lines.push('');
  lines.push('[End Shared Plum Config]');

  return lines.join('\n');
}

export function formatCodexSharedContextForTest(resources: {
  agents?: ReadonlyArray<CodexSharedContextResource>;
  skills?: ReadonlyArray<CodexSharedContextResource>;
  plugins?: ReadonlyArray<CodexSharedContextResource>;
}): string | null {
  return formatCodexSharedContext(
    resources.agents || [],
    resources.skills || [],
    resources.plugins || []
  );
}

function formatSharedInstructionFile(
  agents: SharedAgent[],
  skills: SharedSkill[],
  plugins: SharedPlugin[]
): string {
  const lines: string[] = [];
  lines.push(WEBUI_MANAGED_BLOCK_START);
  lines.push('# Shared Provider Context');
  lines.push(
    'Plum keeps the automatic provider context small while retaining a searchable capability catalog.'
  );
  lines.push('');
  lines.push(
    `- Active core skills: ${skills.length > 0 ? skills.map((skill) => `\`${skill.name}\``).join(', ') : 'none'}.`
  );
  lines.push(
    '- Search additional skills and agents: `node /app/scripts/capability-catalog.mjs search "<task>"`.'
  );
  lines.push('- Load one match: `node /app/scripts/capability-catalog.mjs show <name>`.');
  lines.push(
    '- MCP servers and plugins remain discoverable through Plum Settings and their authenticated APIs.'
  );
  lines.push(
    '- Project instructions: prefer workspace `AGENTS.md`; `CLAUDE.md` is legacy/provider compatibility only.'
  );
  lines.push(
    '- System Chromium is available at `/usr/local/bin/plum-chromium`; browser env vars are preconfigured for Playwright/Puppeteer-style tests.'
  );
  lines.push(
    `- Catalog status: ${agents.length} agents and ${plugins.length} plugins remain indexed.`
  );
  lines.push('- Remove this block to opt out of automatic updates.');

  lines.push(WEBUI_MANAGED_BLOCK_END);
  return lines.join('\n');
}

function replaceManagedBlock(
  existing: string,
  startMarker: string,
  endMarker: string,
  newBlock: string
): string | null {
  const pattern = new RegExp(`${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`, 'm');
  if (!pattern.test(existing)) {
    return null;
  }
  return existing.replace(pattern, newBlock);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve parent dir via realpath and ensure the final file path stays inside it.
 * Blocks symlink-based escapes: /foo/bar/AGENTS.md where bar -> /etc would otherwise land in /etc/AGENTS.md.
 */
async function resolveSafeFilePath(filePath: string): Promise<string> {
  const absolute = path.resolve(filePath);
  const parentDir = path.dirname(absolute);
  const baseName = path.basename(absolute);
  let realParent: string;
  try {
    realParent = await fs.realpath(parentDir);
  } catch {
    realParent = parentDir;
  }
  const resolved = path.join(realParent, baseName);
  if (!resolved.startsWith(realParent + path.sep) && resolved !== path.join(realParent, baseName)) {
    throw new Error(`Refusing to write outside resolved parent directory: ${filePath}`);
  }
  return resolved;
}

/**
 * Write managed block to a file, handling create/replace/append.
 * Errors are logged but never thrown — managed instruction writes are best-effort and
 * must not break session startup (e.g. read-only mounts, permission issues).
 */
async function writeManagedBlock(
  filePath: string,
  content: string,
  startMarker: string,
  endMarker: string,
  legacyMarker?: string
): Promise<void> {
  let safePath: string;
  try {
    safePath = await resolveSafeFilePath(filePath);
  } catch (err) {
    console.warn(
      `[writeManagedBlock] Skipping unsafe path ${filePath}:`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  let existing: string | null = null;
  try {
    existing = await fs.readFile(safePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.warn(
        `[writeManagedBlock] Failed to read ${safePath}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  try {
    if (existing !== null) {
      const replaced = replaceManagedBlock(existing, startMarker, endMarker, content);
      if (replaced) {
        if (replaced.trim() !== existing.trim()) {
          await fs.writeFile(safePath, replaced, 'utf-8');
        }
        return;
      }

      if (legacyMarker && existing.includes(legacyMarker)) {
        await fs.writeFile(safePath, content, 'utf-8');
        return;
      }

      const appended = `${existing.trimEnd()}\n\n${content}\n`;
      await fs.writeFile(safePath, appended, 'utf-8');
      return;
    }

    await fs.writeFile(safePath, content, 'utf-8');
  } catch (err) {
    console.warn(
      `[writeManagedBlock] Failed to write ${safePath}:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Remove a managed block from a file while preserving user-authored content.
 */
async function removeManagedBlock(
  filePath: string,
  startMarker: string,
  endMarker: string
): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    const pattern = new RegExp(
      `${escapeRegex(startMarker)}[\\s\\S]*?${escapeRegex(endMarker)}`,
      'm'
    );
    if (pattern.test(existing)) {
      const cleaned = existing
        .replace(pattern, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      await fs.writeFile(filePath, cleaned + '\n', 'utf-8');
    }
  } catch {
    // File doesn't exist or can't be read — nothing to clean
  }
}

/**
 * Remove old shared-config block from a file (migration from old format).
 */
async function removeOldSharedConfigBlock(filePath: string): Promise<void> {
  await removeManagedBlock(filePath, WEBUI_MANAGED_BLOCK_START, WEBUI_MANAGED_BLOCK_END);
}

/**
 * Write skills/agents/plugins to the global ~/.claude/CLAUDE.md.
 * Claude CLI loads this automatically for all sessions.
 */
async function ensureGlobalInstructions(configHome: string): Promise<void> {
  const [agents, skills, plugins] = await Promise.all([
    readSharedAgents(configHome),
    readSharedSkills(configHome),
    readSharedPlugins(configHome),
  ]);
  const content = formatSharedInstructionFile(agents, skills, plugins);

  const globalClaudeMd = path.join(os.homedir(), '.claude', 'CLAUDE.md');

  // Ensure directory exists
  const globalDir = path.dirname(globalClaudeMd);
  try {
    await fs.mkdir(globalDir, { recursive: true });
  } catch {
    // Already exists
  }

  await writeManagedBlock(
    globalClaudeMd,
    content,
    WEBUI_MANAGED_BLOCK_START,
    WEBUI_MANAGED_BLOCK_END,
    WEBUI_MANAGED_MARKER
  );
}

/**
 * Build a short skills summary line (names only, no instructions).
 * Used for non-Claude providers that don't read ~/.claude/CLAUDE.md.
 */
function formatSkillsSummary(skills: SharedSkill[], agents: SharedAgent[]): string {
  const active = skills.length > 0 ? skills.map((skill) => skill.name).join(', ') : 'none';
  return [
    `Active Core Skills: ${active}`,
    `On-demand capabilities (${agents.length} agents plus the full skill catalog): node /app/scripts/capability-catalog.mjs search "<task>"`,
  ].join('\n');
}

function truncateStyleTemplate(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= STYLE_TEMPLATE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, STYLE_TEMPLATE_MAX_CHARS).trimEnd()}\n\n[Template truncated by WebUI: continue following the visible guidance and load the skill file if more detail is needed.]`;
}

async function buildSessionStyleContextFromSelection(
  selection: { designStyleSkill?: string | null; writingStyleSkill?: string | null },
  configHome: string
): Promise<string | null> {
  if (!selection.designStyleSkill && !selection.writingStyleSkill) {
    return null;
  }

  const lines: string[] = [];
  lines.push('<session-style-library>');
  lines.push(
    'The following templates are active for this WebUI session. They override generic style defaults but do not override explicit user instructions in the current prompt.'
  );

  if (selection.designStyleSkill) {
    const style = await readSkillLibraryItem(configHome, selection.designStyleSkill);
    if (style?.libraryKind === 'design') {
      lines.push('');
      lines.push(`## Active UI Style Template: ${style.name}`);
      lines.push(`Source: ~/.claude/skills/${style.baseName}/SKILL.md`);
      if (style.description) lines.push(`Description: ${style.description}`);
      lines.push(
        'Apply this template whenever the user asks for frontend, WebUI, interface, visual design, layout, component, page, app, or styling work.'
      );
      lines.push('');
      lines.push(truncateStyleTemplate(style.content));

      if (style.designMd) {
        lines.push('');
        lines.push(`## Active DESIGN.md: ${style.designMd.name}`);
        lines.push(`Source: ~/.claude/skills/${style.baseName}/DESIGN.md`);
        lines.push(
          'Treat this DESIGN.md as the structured source of truth for visual identity tokens and rationale. Use token values when they conflict with generic style preferences.'
        );
        lines.push('');
        lines.push('```markdown');
        lines.push(truncateStyleTemplate(style.designMd.raw));
        lines.push('```');
      }
    }
  }

  if (selection.writingStyleSkill) {
    const style = await readSkillLibraryItem(configHome, selection.writingStyleSkill);
    if (style?.libraryKind === 'writing') {
      const styleType = style.writingStyleType || 'persona';
      lines.push('');
      lines.push(
        `## Active ${
          styleType === 'author'
            ? 'Author Style'
            : styleType === 'prose'
              ? 'Writing Style'
              : 'Persona'
        } Template: ${style.name}`
      );
      lines.push(`Source: ~/.claude/skills/${style.baseName}/SKILL.md`);
      if (style.description) lines.push(`Description: ${style.description}`);
      if (styleType === 'author') {
        lines.push(
          'Apply this template as an authorial prose influence for narrative, copy, and longer explanations. Do not claim to be the author, do not quote or recreate existing passages, and keep code, commands, filenames, and technical facts precise.'
        );
      } else if (styleType === 'prose') {
        lines.push(
          'Apply this template to prose quality, tone, copy, emails, explanations, and narrative text. Keep code, commands, filenames, and technical facts precise.'
        );
      } else {
        lines.push(
          'Apply this template as the assistant persona or voice for prose, explanations, copy, and narrative text. Keep code, commands, filenames, and technical facts precise.'
        );
      }
      lines.push('');
      lines.push(truncateStyleTemplate(style.content));
    }
  }

  lines.push('</session-style-library>');
  return lines.length > 3 ? lines.join('\n') : null;
}

export async function buildSessionStyleContextForTest(
  selection: { designStyleSkill?: string | null; writingStyleSkill?: string | null },
  configHome: string
): Promise<string | null> {
  return buildSessionStyleContextFromSelection(selection, configHome);
}

async function buildSessionStyleContext(
  sessionId: string,
  userId: string,
  cliProvider: CLIProvider
): Promise<string | null> {
  const selection = (await pgGet(
    `SELECT design_style_skill as designStyleSkill,
              writing_style_skill as writingStyleSkill
       FROM sessions
       WHERE id = ? AND user_id = ?`,
    sessionId,
    userId
  )) as unknown as
    | { designStyleSkill: string | null; writingStyleSkill: string | null }
    | undefined;

  if (!selection?.designStyleSkill && !selection?.writingStyleSkill) {
    return null;
  }

  const configHome = resolveConfigHome(cliProvider);
  return buildSessionStyleContextFromSelection(selection, configHome);
}

/**
 * Write lightweight project context to the project's AGENTS.md.
 * For Claude provider: just project info (skills are in global CLAUDE.md).
 * For other providers: project info + skills summary (names only).
 */
export async function ensureProjectInstructions(
  workingDir: string,
  configHome: string,
  cliProvider: string
): Promise<void> {
  // Scan project for auto-detected context
  let projectContext: string;
  try {
    const info = await scanProject(workingDir);
    projectContext = formatProjectContext(info);
  } catch {
    projectContext = `# Project: ${path.basename(workingDir)}`;
  }

  const lines: string[] = [PROJECT_CONTEXT_BLOCK_START];
  lines.push(projectContext);

  // For non-Claude providers, include skills/agents names as a reference
  if (!isClaudeTransportProvider(cliProvider)) {
    const [agents, skills] = await Promise.all([
      readSharedAgents(configHome),
      readSharedSkills(configHome),
    ]);
    const summary = formatSkillsSummary(skills, agents);
    if (summary) {
      lines.push('');
      lines.push(summary);
    }
  }

  lines.push(PROJECT_CONTEXT_BLOCK_END);
  const content = lines.join('\n');

  const agentsMdPath = path.join(workingDir, 'AGENTS.md');
  const claudeMdPath = path.join(workingDir, 'CLAUDE.md');

  // First: remove old shared-config block if it exists (migration)
  await removeOldSharedConfigBlock(agentsMdPath);

  // Then: write/update the new project-context block
  await writeManagedBlock(
    agentsMdPath,
    content,
    PROJECT_CONTEXT_BLOCK_START,
    PROJECT_CONTEXT_BLOCK_END
  );

  // Migrate stale generated context out of legacy CLAUDE.md without deleting human notes.
  await removeManagedBlock(claudeMdPath, PROJECT_CONTEXT_BLOCK_START, PROJECT_CONTEXT_BLOCK_END);
  await removeOldSharedConfigBlock(claudeMdPath);
}

function extractCodexText(output: string): string {
  const deltas: string[] = [];
  const completed: string[] = [];
  const fallback: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        delta?: string;
        text?: string;
        item?: { type?: string; text?: string; content?: string; delta?: string };
      };
      const eventType = (event.type || '').replace(/\//g, '.').replace(/_/g, '').toLowerCase();
      const delta =
        (typeof event.delta === 'string' && event.delta) ||
        (typeof event.text === 'string' && event.text) ||
        (typeof event.item?.delta === 'string' && event.item.delta) ||
        '';
      if (
        delta &&
        (eventType.includes('delta') || eventType === 'agentmessage' || eventType === 'text')
      ) {
        deltas.push(delta);
      }
      const itemType = (event.item?.type || '').replace(/_/g, '').toLowerCase();
      if (eventType === 'item.completed' && itemType === 'agentmessage') {
        const text = event.item?.text || event.item?.content || '';
        if (text) completed.push(text);
      }
    } catch {
      if (!trimmed.startsWith('WARNING:')) fallback.push(trimmed);
    }
  }

  const deltaText = deltas.join('').trim();
  const completedText = completed.join('\n').trim();
  if (completedText.length >= deltaText.length * 0.5) return completedText;
  if (deltaText) return deltaText;
  return fallback.join('\n').trim();
}

async function maybeCodexChatGptAuthArg(codexHome: string): Promise<string[]> {
  try {
    const authPath = path.join(codexHome, 'auth.json');
    const auth = safeJsonParse<Record<string, unknown>>(await fs.readFile(authPath, 'utf-8'), {});
    const hasTokens =
      typeof auth.tokens === 'object' && !!(auth.tokens as { access_token?: string }).access_token;
    const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
    if (hasTokens && !hasApiKey) return ['--config', 'auth_mode="chatgpt"'];
  } catch {
    // No auth hint needed.
  }
  return [];
}

type CodexSessionIdentityEvent = {
  type?: string;
  id?: string;
  sessionId?: string;
  session_id?: string;
  threadId?: string;
  thread?: { id?: string };
  payload?: {
    id?: string;
    sessionId?: string;
    session_id?: string;
    threadId?: string;
    thread?: { id?: string };
  };
};

export function extractCodexSessionId(event: CodexSessionIdentityEvent): string | null {
  const eventType = (event.type || '').replace(/\//g, '.').toLowerCase();
  const pickSessionId = (...values: Array<string | undefined>): string | null => {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
    return null;
  };

  if (eventType === 'session_meta') {
    return pickSessionId(
      event.id,
      event.sessionId,
      event.session_id,
      event.thread?.id,
      event.threadId,
      event.payload?.id,
      event.payload?.sessionId,
      event.payload?.session_id,
      event.payload?.thread?.id,
      event.payload?.threadId
    );
  }

  if (eventType === 'thread.started') {
    return pickSessionId(
      event.thread?.id,
      event.threadId,
      event.sessionId,
      event.session_id,
      event.payload?.thread?.id,
      event.payload?.threadId,
      event.payload?.sessionId,
      event.payload?.session_id
    );
  }

  return null;
}

/**
 * A native Codex thread retains its initial messages across `exec resume` and
 * backend restarts. Repeating the static Plum bootstrap in that same thread
 * needlessly grows the context and is then inherited by every child thread.
 */
export function shouldInjectCodexStaticBootstrap(
  nativeThreadId: string | null | undefined
): boolean {
  return !nativeThreadId?.trim();
}

export function shouldInjectSessionStyleContext(
  previousContext: string | null | undefined,
  nextContext: string | null
): boolean {
  return previousContext !== nextContext;
}

async function describeImagesWithCodex(opts: {
  imagePaths: string[];
  userPrompt: string;
  cwd: string;
  sessionId: string;
}): Promise<string | null> {
  if (opts.imagePaths.length === 0) return null;
  const providerConfig = CLI_PROVIDERS.codex;
  const codexHome = providerConfig.credentialsPath.replace('~', os.homedir());
  const prompt = [
    'Describe the attached image(s) for a downstream coding agent that cannot see images.',
    'Focus on concrete visual facts: UI text, errors, diagrams, layout, code snippets, filenames, charts, and relevant details.',
    'Do not solve the user task. Return concise structured notes that can be prepended to the downstream prompt.',
    '',
    `Original user prompt:\n${opts.userPrompt || '(no text prompt)'}`,
  ].join('\n');
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
    ...(await maybeCodexChatGptAuthArg(codexHome)),
    '--image',
    opts.imagePaths.join(','),
    prompt,
  ];

  const integrationEnv = await buildIntegrationEnv();

  return await new Promise<string | null>((resolve) => {
    const child = spawnManagedProcess(providerConfig.command, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...integrationEnv,
        CODEX_HOME: codexHome,
        WEBUI_SESSION_ID: opts.sessionId,
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_PROJECT_PATH: opts.cwd,
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        terminateManagedProcess(child);
      } catch {
        // ignore
      }
      resolve(null);
    }, 120_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[IMAGE-BRIDGE] Codex failed to spawn [${opts.sessionId}]:`, err);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = extractCodexText(stdout).trim();
      if (code !== 0 && !text) {
        console.warn(
          `[IMAGE-BRIDGE] Codex failed [${opts.sessionId}] code=${code}: ${stderr.slice(0, 500)}`
        );
        resolve(null);
        return;
      }
      resolve(text || null);
    });
  });
}

interface CodexReviewCommand {
  args: string[];
  prompt?: string;
}

function splitSlashArgs(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function parseCodexReviewCommand(message: string): CodexReviewCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/review')) return null;
  const first = trimmed.split(/\s+/, 1)[0];
  if (first !== '/review') return null;

  const tokens = splitSlashArgs(trimmed.slice('/review'.length).trim());
  const args: string[] = [];
  const promptParts: string[] = [];
  let hasTarget = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token === '--uncommitted') {
      args.push('--uncommitted');
      hasTarget = true;
      continue;
    }
    if ((token === '--base' || token === '--commit' || token === '--title') && tokens[i + 1]) {
      args.push(token, tokens[i + 1]!);
      if (token === '--base' || token === '--commit') {
        hasTarget = true;
      }
      i += 1;
      continue;
    }
    promptParts.push(token);
  }

  const prompt = promptParts.join(' ').trim();

  if (!hasTarget) {
    args.unshift('--uncommitted');
  }

  return prompt ? { args, prompt } : { args };
}

export function isCodexNativeSlashCommand(message: string): boolean {
  return /^(?:\/(?:goal|compact)|\$imagegen)(?:\s|$)/i.test(message.trim());
}

function isSilentCodexNativeSlashCommand(message: string): boolean {
  return /^\/goal(?:\s|$)/i.test(message.trim());
}

export function shouldRecordProviderUserMessage(provider: CLIProvider, message: string): boolean {
  return !(provider === 'codex' && isSilentCodexNativeSlashCommand(message));
}

export function appliesModeOnNextTurnWithoutRestart(provider: CLIProvider): boolean {
  return provider === 'codex' || provider === 'kimi';
}

export function kimiAcpModeForSessionMode(mode: SessionMode): string {
  if (mode === 'planning') return 'plan';
  if (mode === 'danger') return 'yolo';
  if (mode === 'manual') return 'default';
  return 'auto';
}

export function resolveSessionStartMode(
  explicitMode?: SessionMode,
  pendingMode?: SessionMode,
  persistedMode?: SessionMode | null
): SessionMode {
  return explicitMode ?? pendingMode ?? persistedMode ?? 'auto-accept';
}

export function shouldRecoverInterruptedKimiTurn(
  provider: CLIProvider | null,
  status: string | null,
  latestRole?: string
): boolean {
  return provider === 'kimi' && status === 'stopped' && latestRole === 'user';
}

function kimiAcpConfigSupports(
  options: AcpSessionConfigOption[] | null | undefined,
  configId: string,
  value: string
): boolean {
  const option = options?.find((candidate) => candidate.id === configId);
  if (!option || option.type !== 'select') return false;
  return option.options.some((candidate) => {
    if ('value' in candidate) return candidate.value === value;
    return candidate.options.some((nested) => nested.value === value);
  });
}

function kimiAcpToolResultText(
  update: Extract<AcpSessionUpdate, { sessionUpdate: 'tool_call_update' }>
): string {
  if (typeof update.rawOutput === 'string') return update.rawOutput;
  if (update.rawOutput !== undefined && update.rawOutput !== null) {
    try {
      return JSON.stringify(update.rawOutput);
    } catch {
      return String(update.rawOutput);
    }
  }
  return (update.content || [])
    .map((entry) => {
      if (entry.type !== 'content' || entry.content.type !== 'text') return '';
      return entry.content.text;
    })
    .filter(Boolean)
    .join('\n');
}

export function isKimiSessionNotFoundError(stderr: string): boolean {
  return (
    /session\s+["'][^"']+["']\s+not found/i.test(stderr) ||
    /session[^\r\n]{0,200}(?:not found|does not exist|unknown)/i.test(stderr)
  );
}

export function formatKimiExitMessage(exitCode: number | null, stderr: string): string {
  const detail = stderr
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const needsLogin =
    /not logged in|unauthenticated|authentication|credentials?|login required/i.test(detail);

  if (needsLogin) {
    return `\n⚠️ Kimi authentication failed. Reconnect via Settings → Kimi → Connect.\n`;
  }
  if (detail) {
    return `\n⚠️ Kimi exited (code ${exitCode ?? 'unknown'}): ${detail}\n`;
  }
  return `\n⚠️ Kimi exited (code ${exitCode ?? 'unknown'}). Check the server logs for details.\n`;
}

type OpenCodeSlashCommand =
  | { type: 'command'; command: 'init' | 'review' | 'security-review'; args: string }
  | { type: 'plan'; args: string }
  | { type: 'compact' };

function parseOpenCodeSlashCommand(message: string): OpenCodeSlashCommand | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  const name = match[1]?.toLowerCase();
  const args = (match[2] ?? '').trim();
  if (name === 'init' || name === 'review' || name === 'security-review') {
    return { type: 'command', command: name, args };
  }
  if (name === 'plan') {
    return { type: 'plan', args };
  }
  if (name === 'compact') {
    return { type: 'compact' };
  }
  return null;
}

function normalizeOpenCodeTodoStatus(status: unknown): 'pending' | 'in_progress' | 'completed' {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'completed' || status === 'cancelled' || status === 'canceled') return 'completed';
  return 'pending';
}

function summarizeOpenCodeDiff(diff: unknown): string {
  if (!Array.isArray(diff) || diff.length === 0) return 'No file changes reported.';
  const files = diff
    .map((item) => {
      const entry = item as {
        file?: unknown;
        status?: unknown;
        additions?: unknown;
        deletions?: unknown;
      };
      const file = typeof entry.file === 'string' ? entry.file : 'unknown';
      const status = typeof entry.status === 'string' ? entry.status : 'modified';
      const additions = typeof entry.additions === 'number' ? entry.additions : 0;
      const deletions = typeof entry.deletions === 'number' ? entry.deletions : 0;
      return `${file} (${status}, +${additions}/-${deletions})`;
    })
    .slice(0, 12);
  const suffix = diff.length > files.length ? `\n...and ${diff.length - files.length} more` : '';
  return `OpenCode diff updated:\n${files.map((file) => `- ${file}`).join('\n')}${suffix}`;
}

interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface StreamEventMessage {
  type: string;
  message?: {
    id?: string;
    model?: string;
    usage?: UsageInfo;
  };
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  usage?: UsageInfo;
  context_management?: unknown;
  index?: number;
}

interface ModelUsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  contextWindow: number;
  costUSD: number;
}

// Permission denial from Claude CLI
interface PermissionDenial {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
}

interface StreamJsonMessage {
  type: string;
  content?: string;
  message?:
    | string
    | {
        role: string;
        model?: string;
        content: string | { type: string; text?: string }[];
        usage?: UsageInfo;
      };
  tool_use?: {
    name: string;
    id: string;
  };
  result?: string;
  session_id?: string;
  subtype?: string;
  // For partial message streaming
  content_block?: {
    type: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
  };
  index?: number;
  // For stream_event wrapper
  event?: StreamEventMessage;
  // For result message
  total_cost_usd?: number;
  usage?: UsageInfo;
  modelUsage?: Record<string, ModelUsageInfo>;
  // Permission denials
  permission_denials?: PermissionDenial[];
}

// Build a no-op ChildProcess stub for server-backed sessions (opencode HTTP/SSE).
// The manager expects every ClaudeProcess to carry a ChildProcess, but when the
// CLI is driven over HTTP there is no local child to own. stdin is null so the
// existing `proc.process.stdin?.write/end` chains become no-ops; kill() is a
// noop whose real equivalent runs via opencodeServer.abort()/shutdown().
function createVirtualChildProcess(): ChildProcess {
  const em = new EventEmitter() as unknown as ChildProcess;
  Object.assign(em, {
    stdin: null,
    stdout: null,
    stderr: null,
    pid: undefined,
    killed: false,
    exitCode: null,
    kill: () => true,
    ref: () => em,
    unref: () => em,
    disconnect: () => undefined,
  });
  return em;
}

interface ClaudeProcess {
  process: ChildProcess;
  sessionId: string;
  /** Thread whose provider-native context this process was started for. */
  providerChatId: string | null;
  /** Thread owning the currently dispatched provider turn/output. */
  currentChatId: string | null;
  // CLI provider for this session
  cliProvider: CLIProvider;
  // Per-turn token usage (for context display)
  turnInputTokens: number;
  turnCacheReadTokens: number;
  turnCacheCreationTokens: number;
  turnOutputTokens: number;
  // Stable WebUI turn/message id used as the usage ledger idempotency key.
  currentUsageTurnId?: string;
  // Attribute analytics to when the user submitted the turn, not when a long
  // provider/tool loop happened to finish across a day or week boundary.
  currentUsageTurnStartedAt?: string;
  // Current model-call context usage. Some providers, notably Codex, report
  // both per-call context usage and summed turn billing usage; keep those
  // separate so the context bar does not display cumulative/cache-billing totals.
  contextInputTokens?: number;
  contextCacheReadTokens?: number;
  contextCacheCreationTokens?: number;
  contextOutputTokens?: number;
  userId: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  buffer: string;
  streamingText: string; // Accumulates text during streaming
  isStreaming: boolean;
  // Permission mode
  mode: SessionMode;
  // Tool tracking
  currentToolName: string | null;
  currentToolId: string | null; // Tool use ID from Claude
  currentToolInput: string; // Accumulates JSON input during tool use
  currentActivitySummary: string | null;
  pendingToolResults: Map<string, { toolName: string; input: unknown }>; // Track tools awaiting results
  // Agent tracking
  currentAgentType: string | null;
  currentAgentDescription: string | null;
  subagentRuns: Map<string, SubagentRun>;
  // Usage tracking
  model: string;
  contextWindow: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  previousTotalCostUsd: number; // For calculating per-turn cost
  turnCostUsd?: number;
  lastContextSnapshot?: {
    totalTokens: number;
    contextWindow: number;
    contextUsedPercentRaw: number;
    model: string;
    recordedAt: number;
  };
  // Context reminder flag for resumed sessions
  needsWorkingDirReminder: boolean;
  contextReminder: {
    summary: string;
    reason: 'mode-change' | 'provider-switch' | 'context-limit';
  } | null;
  // Reconnect buffer
  outputBuffer: CircularBuffer<BufferedMessage>;
  lastActivityAt: number;
  disconnectedAt: number | null;
  // Permission approval tracking
  lastUserMessage: string | null;
  lastAttachments: FileAttachmentData[] | null;
  pendingPermissionDenials: PermissionDenial[] | null;
  pendingChatMedia: PendingChatMedia[];
  sharedContextInjected: boolean;
  sessionStyleContextInjected?: string | null;
  modePromptInjected: SessionMode | null;
  androidDeviceSerialInjected?: string | null;
  discordGatewayContextInjected?: string | null;
  lastContextLimitAt?: number;
  codexIdle?: boolean; // True when codex process exited after turn.completed, awaiting respawn
  // Codex CLI 0.130+ persists sessions at ~/.codex/sessions/<uuid>.jsonl. Once captured
  // from the first `session_meta` (or older `thread.started`) event, we use
  // `codex exec resume <id>` on respawn for native context continuity instead
  // of transcript replay.
  codexSessionId?: string;
  // Image paths to attach via `--image` on the next codex respawn. Populated by
  // sendMessage when codex is the provider, consumed (and cleared) by respawnCodexProcess.
  codexPendingImages?: string[];
  // Dedicated Codex exec workflow to use for the next respawn instead of the
  // normal chat prompt, e.g. `codex exec review`.
  codexPendingExecCommand?: { type: 'review'; args: string[]; prompt?: string };
  // Codex `exec` cannot accept another stdin prompt after the first EOF. Keep
  // accepted follow-ups in memory until the active child exits. Queue-mode
  // turns remain FIFO; an explicit steering turn moves to the front without
  // discarding turns that were already accepted.
  codexQueuedTurns?: CodexPreparedTurn[];
  codexSteerDraining?: boolean;
  codexPreemptingForSteer?: boolean;
  codexPreemptKillTimer?: ReturnType<typeof setTimeout>;
  // Pi runs a persistent JSONL RPC, so a turn is "in flight" from the moment we
  // write a prompt until `turn_end`. Compaction can land in that window.
  piTurnInFlight?: boolean;
  piCompactContinuations?: number;
  piCompactResumeTimer?: ReturnType<typeof setTimeout>;
  // Per-subagent-thread cumulative snapshot, so a resumed exec books only the
  // delta each spawned agent added during the current turn.
  codexSubagentBaseline?: Map<string, CodexUsageCounters>;
  // Subagent split staged by applyCodexTurnUsage, flushed once the turn id is
  // final in saveUsageToDatabase.
  pendingSubagentUsage?: PendingSubagentUsage[];
  // Track tool callIDs we've already emitted 'started' for during a codex turn, mirroring
  // the opencode emittedTools pattern. Reset at the start of each turn.
  codexEmittedTools?: Set<string>;
  // Last cumulative-token snapshot Codex reported for this session. We use it to
  // compute per-turn deltas because `turn.completed.usage` in resume mode reports
  // CUMULATIVE counts (input + cached + output grow monotonically across the
  // session). Without deltas, analytics gets multi-million-token rows for what
  // should be ~50k-per-turn API calls.
  codexLastReportedTokens?: { input: number; cached: number; output: number };
  codexLastPromptEstimateTokens?: number;
  codexLastPromptPrefix?: string;
  codexExecStartedAtMs?: number;
  codexSawTokenCountThisTurn?: boolean;
  codexLastCompactAtMs?: number;
  codexLastContextSummary?: string | null;
  codexCurrentExecUsedResume?: boolean;
  codexLastTokenUsage?: CodexUsageCounters;
  codexLastObservedContextUsage?: CodexUsageCounters;
  codexLastObservedContextWindow?: number;
  codexTotalTokenUsage?: CodexUsageCounters;
  codexDescendantUsageBaseline?: CodexUsageCounters;
  // Kimi runs as a persistent ACP agent. Unlike `kimi -p`, ACP emits token
  // chunks and tool lifecycle updates while keeping one native chat session
  // alive across WebUI turns.
  kimiAcpConnection?: ClientSideConnection;
  kimiAcpSessionId?: string;
  kimiAcpConfigOptions?: AcpSessionConfigOption[];
  kimiIdle?: boolean;
  kimiQueuedTurns?: CodexPreparedTurn[];
  kimiQueueDraining?: boolean;
  kimiCompletedTools?: Set<string>;
  kimiThinkingText?: string;
  // Server-backed providers (opencode in HTTP/SSE mode) have no child process.
  // `process` is a no-op stub; all lifecycle goes through HTTP + SSE subscription.
  serverBacked?: boolean;
  opencodeIdle?: boolean;
  opencodeQueuedTurns?: OpenCodePreparedTurn[];
  opencodeQueueDraining?: boolean;
  claudeIdle?: boolean;
  claudeQueuedTurns?: ClaudePreparedTurn[];
  /** Settings reload parked until the running turn (and its queue) finishes. */
  deferredRestart?: {
    userId: string;
    options: { preserveNativeContext?: boolean };
  };
  /** Mode change parked until the running turn (and its queue) finishes. */
  claudeDeferredModeRestart?: {
    mode: SessionMode;
    userId: string;
    previousMode: SessionMode;
  };
  claudeQueueDraining?: boolean;
  // Accumulates content per opencode part.id so we can emit streaming deltas
  // and flush each opencode assistant message as a separate WebUI message.
  partStreams?: Map<string, OpenCodePartStreamEntry>;
  opencodeActiveMessageId?: string | null;
  opencodeMessageOrder?: string[];
  opencodeLastManualCompactAt?: number;
  opencodeCompactionText?: string;
  opencodeUsageBaseline?: OpenCodeUsageCounters | null;
  opencodeUsageFinalizing?: boolean;
  claudeCurrentResponseId?: string;
  claudeCurrentResponseOutputTokens?: number;
  // Track tool callIDs we've already emitted 'started' for, so we don't
  // re-emit on every status transition (pending → running → completed).
  emittedTools?: Set<string>;
  lastSavedAssistantContent?: string;
  lastSavedAssistantAt?: number;
}

type ClaudeResponseUsageTarget = Pick<
  ClaudeProcess,
  | 'turnInputTokens'
  | 'turnOutputTokens'
  | 'turnCacheReadTokens'
  | 'turnCacheCreationTokens'
  | 'contextInputTokens'
  | 'contextOutputTokens'
  | 'contextCacheReadTokens'
  | 'contextCacheCreationTokens'
  | 'claudeCurrentResponseId'
  | 'claudeCurrentResponseOutputTokens'
>;

export function accumulateClaudeMessageStartUsage(
  target: ClaudeResponseUsageTarget,
  responseId: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }
): void {
  if (target.claudeCurrentResponseId === responseId) return;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  target.turnInputTokens += input;
  target.turnOutputTokens += output;
  target.turnCacheReadTokens += cacheRead;
  target.turnCacheCreationTokens += cacheWrite;
  target.contextInputTokens = input;
  target.contextOutputTokens = output;
  target.contextCacheReadTokens = cacheRead;
  target.contextCacheCreationTokens = cacheWrite;
  target.claudeCurrentResponseId = responseId;
  target.claudeCurrentResponseOutputTokens = output;
}

export function accumulateClaudeMessageDeltaUsage(
  target: ClaudeResponseUsageTarget,
  usage: { output_tokens?: number }
): void {
  const output = usage.output_tokens || 0;
  const previousOutput = target.claudeCurrentResponseOutputTokens || 0;
  target.turnOutputTokens += Math.max(output - previousOutput, 0);
  target.claudeCurrentResponseOutputTokens = output;
  target.contextOutputTokens = output;
}

type ClaudeTurnUsageTarget = Pick<
  ClaudeProcess,
  'turnInputTokens' | 'turnOutputTokens' | 'turnCacheReadTokens' | 'turnCacheCreationTokens'
>;

/**
 * Claude Code's final result event is the authoritative aggregate for the
 * completed user turn. Some Anthropic-compatible endpoints (notably Z.AI)
 * omit input/cache counters from partial message_start events while still
 * returning them here. Keep any richer streamed aggregate, but fill or raise
 * each billed bucket to the final value before persisting the ledger row.
 */
export function applyClaudeResultUsage(
  target: ClaudeTurnUsageTarget,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  }
): void {
  target.turnInputTokens = Math.max(target.turnInputTokens, usage.input_tokens || 0);
  target.turnOutputTokens = Math.max(target.turnOutputTokens, usage.output_tokens || 0);
  target.turnCacheReadTokens = Math.max(
    target.turnCacheReadTokens,
    usage.cache_read_input_tokens || 0
  );
  target.turnCacheCreationTokens = Math.max(
    target.turnCacheCreationTokens,
    usage.cache_creation_input_tokens || 0
  );
}

interface CodexPreparedTurn {
  queueId: string;
  chatId: string | null;
  queuedAt: string;
  originalMessage: string;
  messageForClaude: string;
  attachments?: FileAttachmentData[];
  updateLastMessage: boolean;
  codexImagePaths: string[];
  codexExecCommand?: { type: 'review'; args: string[]; prompt?: string };
  codexNativeSlashCommand: boolean;
}

interface OpenCodePreparedTurn {
  queueId: string;
  chatId: string | null;
  queuedAt: string;
  originalMessage: string;
  messageForClaude: string;
  attachments?: FileAttachmentData[];
  updateLastMessage: boolean;
  opencodeSlashCommand: OpenCodeSlashCommand | null;
}

interface ClaudePreparedTurn {
  queueId: string;
  chatId: string | null;
  queuedAt: string;
  originalMessage: string;
  messageForClaude: string;
  attachments?: FileAttachmentData[];
  updateLastMessage: boolean;
}

export interface SessionRuntimeSnapshot {
  running: boolean;
  provider: CLIProvider | null;
  mode: SessionMode | null;
  model: string | null;
  workingDirectory: string | null;
  claudeSessionId: string | null;
  busy: boolean;
  streaming: boolean;
  currentToolName: string | null;
  currentAgentType: string | null;
  currentAgentDescription: string | null;
  subagents: SubagentRun[];
  activitySummary: string | null;
  queueDepth: number;
  queueItems: Array<{
    id: string;
    preview: string;
    createdAt: string;
    attachments?: number;
  }>;
  lastActivityAt: string | null;
  disconnectedAt: string | null;
  usage: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    contextWindow: number;
    contextUsedPercent: number;
    contextUsedPercentRaw: number;
    contextExceeded: boolean;
    totalCostUsd: number;
    model: string;
    recordedAt: string;
  } | null;
}

export class ClaudeProcessManager {
  private processes: Map<string, ClaudeProcess> = new Map();
  private pendingModes: Map<string, SessionMode> = new Map(); // Store modes for sessions not yet started
  private pendingContextReminders: Map<
    string,
    { summary: string; reason: 'mode-change' | 'provider-switch' | 'context-limit' }
  > = new Map();
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private readonly allocateEventSequence: (sessionId: string) => Promise<number>;

  /** Public event emitter for external consumers */
  // Gateway SSE clients add three listeners each; the default cap of 10 warns
  // at the fourth supervisor.
  public events = new EventEmitter().setMaxListeners(0);

  constructor(
    io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    allocateEventSequence: (sessionId: string) => Promise<number> = nextSessionEventSequence
  ) {
    this.io = io;
    this.allocateEventSequence = allocateEventSequence;
  }

  // Map UI modes to Claude CLI permission flags (legacy flow)
  private getPermissionFlags(mode: SessionMode): string[] {
    switch (mode) {
      case 'planning':
        return ['--permission-mode', 'plan'];
      case 'auto-accept':
        return ['--permission-mode', 'acceptEdits'];
      case 'manual':
        return ['--permission-mode', 'default'];
      case 'danger':
        return ['--dangerously-skip-permissions'];
      default:
        return ['--permission-mode', 'acceptEdits'];
    }
  }

  // Get the path to the permission prompt wrapper script (hooks-based flow)
  private getPermissionPromptScriptPath(): string {
    // The shell script is always in the source directory (packages/backend/src/cli/)
    // We need to find it relative to the current file location
    // In dev (tsx): __dirname = packages/backend/src/services/claude
    // In prod (compiled): __dirname = packages/backend/dist/services/claude

    // First, try relative to source (development)
    const devPath = path.resolve(__dirname, '../cli/permission-prompt-wrapper.sh');
    if (fsSync.existsSync(devPath)) {
      return devPath;
    }

    // If running from dist, the script is in src (parallel to dist)
    // __dirname = packages/backend/dist/services/claude
    // We want: packages/backend/src/cli/permission-prompt-wrapper.sh
    const prodPath = path.resolve(__dirname, '../../../src/cli/permission-prompt-wrapper.sh');
    if (fsSync.existsSync(prodPath)) {
      return prodPath;
    }

    // Fallback: try to find it from the package root
    const packageRoot = path.resolve(__dirname, '../../../../');
    const fallbackPath = path.join(packageRoot, 'src/cli/permission-prompt-wrapper.sh');
    if (fsSync.existsSync(fallbackPath)) {
      return fallbackPath;
    }

    console.warn(
      `[HOOKS] Could not find permission-prompt-wrapper.sh, tried: ${devPath}, ${prodPath}, ${fallbackPath}`
    );
    return devPath; // Return dev path as default
  }

  // Generate settings JSON with PermissionRequest hook configured (hooks-based flow)
  private getHookSettings(): string {
    const scriptPath = this.getPermissionPromptScriptPath();
    console.log(`[HOOKS] Using permission hook script: ${scriptPath}`);

    // New hook format with matchers
    // PreToolUse hooks run before every tool execution
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: '*', // Match all tools
            hooks: [
              {
                type: 'command',
                command: scriptPath,
              },
            ],
          },
        ],
      },
    };

    const json = JSON.stringify(settings);
    console.log(`[HOOKS] Settings JSON: ${json}`);
    return json;
  }

  private getPlanningPrompt(): string {
    return `
## PLANNING MODE ACTIVE

You are in Planning Mode. Do not execute tools other than TodoWrite or ExitPlanMode.

### Planning Rules:
1. Provide a concise, step-by-step plan before any execution.
2. Capture actionable steps with TodoWrite.
3. Ask clarifying questions in plain text if needed.
4. When the plan is approved, call ExitPlanMode to proceed.
`;
  }

  private getModePrompt(mode: SessionMode): string | null {
    return buildSessionExecutionPrompt(mode);
  }

  // Helper method to buffer a message
  private async bufferMessage<T extends object>(
    sessionId: string,
    type: BufferedMessage['type'],
    data: T,
    existingSequence?: number
  ): Promise<
    | {
        data: T & { eventSequence: number };
        sequence: number;
        timestamp: number;
      }
    | undefined
  > {
    const proc = this.processes.get(sessionId);
    if (!proc) return undefined;

    const sequence = existingSequence ?? (await this.allocateEventSequence(sessionId));
    const sequencedData = { ...data, eventSequence: sequence } as T & {
      eventSequence: number;
    };

    const bufferedMsg: BufferedMessage = {
      type,
      data: sequencedData,
      timestamp: Date.now(),
      sequence,
    };
    proc.outputBuffer.push(bufferedMsg);
    proc.lastActivityAt = Date.now();
    return {
      data: sequencedData,
      sequence,
      timestamp: bufferedMsg.timestamp,
    };
  }

  /**
   * Socket.IO preserves packet order. Emit the sequenced live event first and
   * only then publish its cursor, so a client can never persist a cursor for
   * state it has not received/applied yet.
   */
  private async emitBufferedEvent<T extends object>(
    sessionId: string,
    type: BufferedMessage['type'],
    data: T,
    emitLive: (sequencedData: T & { eventSequence?: number }) => void,
    existingSequence?: number
  ): Promise<number | undefined> {
    const buffered = await this.bufferMessage(sessionId, type, data, existingSequence);
    emitLive(buffered?.data ?? data);
    if (!buffered) return undefined;
    this.io.to(`session:${sessionId}`).emit('session:cursor', {
      sessionId,
      sequence: buffered.sequence,
      timestamp: buffered.timestamp,
    });
    return buffered.sequence;
  }

  private compactActivityText(value: string | null | undefined, maxLength = 120): string | null {
    const normalized = value?.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
  }

  private serializeResult(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return this.compactActivityText(value, 6000) || undefined;
    try {
      return this.compactActivityText(JSON.stringify(value, null, 2), 6000) || undefined;
    } catch {
      return String(value);
    }
  }

  private getStringField(source: unknown, keys: string[]): string | undefined {
    if (!source || typeof source !== 'object') return undefined;
    const record = source as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private getStringListField(source: unknown, keys: string[]): string[] {
    if (!source || typeof source !== 'object') return [];
    const record = source as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return [value.trim()];
      if (Array.isArray(value)) {
        return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
      }
    }
    return [];
  }

  private syncCurrentAgentState(proc: ClaudeProcess): void {
    const active = Array.from(proc.subagentRuns.values())
      .filter((run) => run.status === 'started')
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    proc.currentAgentType = active?.agentType ?? null;
    proc.currentAgentDescription = active?.description ?? null;
    if (!active && !proc.currentToolName && !proc.isStreaming) {
      proc.currentActivitySummary = null;
    }
  }

  private emitSubagentRun(sessionId: string, run: SubagentRun): void {
    const event = {
      sessionId,
      agentId: run.id,
      agentType: run.agentType,
      description: run.description,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      result: run.result,
      error: run.error,
      toolId: run.toolId,
      externalAgentId: run.externalAgentId,
      timestamp: run.completedAt ?? run.startedAt,
    };
    this.emitBufferedEvent(sessionId, 'agent', event, (sequenced) => {
      this.io.to(`session:${sessionId}`).emit('session:agent', sequenced);
    });
  }

  private trimSubagentRuns(proc: ClaudeProcess, keep = 30): void {
    if (proc.subagentRuns.size <= keep) return;
    const runs = Array.from(proc.subagentRuns.values()).sort((a, b) => {
      if (a.status === 'started' && b.status !== 'started') return -1;
      if (a.status !== 'started' && b.status === 'started') return 1;
      return (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt);
    });
    const keepIds = new Set(runs.slice(0, keep).map((run) => run.id));
    for (const id of proc.subagentRuns.keys()) {
      if (!keepIds.has(id)) proc.subagentRuns.delete(id);
    }
  }

  private startSubagentRun(
    sessionId: string,
    proc: ClaudeProcess,
    input: {
      agentId?: string;
      agentType: string;
      description?: string;
      toolId?: string | null;
      externalAgentId?: string;
      startedAt?: number;
      background?: boolean;
    }
  ): SubagentRun {
    const now = input.startedAt ?? Date.now();
    const id = input.agentId || input.toolId || `${input.agentType}-${nanoid(8)}`;
    const existing = proc.subagentRuns.get(id);
    const run: SubagentRun = {
      ...existing,
      id,
      agentType: input.agentType,
      description: input.description || existing?.description,
      status: 'started',
      startedAt: existing?.startedAt ?? now,
      toolId: input.toolId || existing?.toolId,
      externalAgentId: input.externalAgentId || existing?.externalAgentId,
      provider: proc.cliProvider,
      background: input.background ?? existing?.background,
    };
    proc.subagentRuns.set(id, run);
    proc.currentAgentType = run.agentType;
    proc.currentAgentDescription = run.description ?? null;
    proc.currentActivitySummary = run.description || `Running ${run.agentType} agent`;
    this.trimSubagentRuns(proc);
    this.emitSubagentRun(sessionId, run);
    return run;
  }

  private completeBackgroundRunsFromNotifications(
    sessionId: string,
    proc: ClaudeProcess,
    msg: { message?: unknown }
  ): void {
    if (proc.subagentRuns.size === 0) return;
    const message = msg.message;
    const content =
      message && typeof message === 'object'
        ? (message as { content?: Array<{ type: string; text?: string }> | string }).content
        : undefined;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((block) => block.type === 'text' && block.text)
              .map((block) => block.text)
              .join('\n')
          : '';
    if (!text.includes('<task-notification>')) return;

    const notifications = text.matchAll(
      /<task-id>([A-Za-z0-9_-]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/g
    );
    for (const match of notifications) {
      const [, taskId, status] = match;
      if (!taskId) continue;
      this.completeSubagentRun(
        sessionId,
        proc,
        { externalAgentId: taskId },
        { status: status === 'failed' ? 'error' : 'completed' }
      );
    }
  }

  private findSubagentRun(
    proc: ClaudeProcess,
    match?: { agentId?: string; toolId?: string; externalAgentId?: string; agentType?: string }
  ): SubagentRun | undefined {
    const runs = Array.from(proc.subagentRuns.values());
    if (match?.agentId) {
      const byId = proc.subagentRuns.get(match.agentId);
      if (byId) return byId;
    }
    if (match?.toolId) {
      const byTool = runs.find((run) => run.toolId === match.toolId);
      if (byTool) return byTool;
    }
    if (match?.externalAgentId) {
      const byExternal = runs.find((run) => run.externalAgentId === match.externalAgentId);
      if (byExternal) return byExternal;
    }
    return runs
      .filter(
        (run) =>
          run.status === 'started' && (!match?.agentType || run.agentType === match.agentType)
      )
      .sort((a, b) => b.startedAt - a.startedAt)[0];
  }

  private completeSubagentRun(
    sessionId: string,
    proc: ClaudeProcess,
    match: { agentId?: string; toolId?: string; externalAgentId?: string; agentType?: string },
    update: {
      status?: SubagentRunStatus;
      result?: unknown;
      error?: unknown;
      completedAt?: number;
    } = {}
  ): void {
    const existing = this.findSubagentRun(proc, match);
    if (!existing) return;
    const status = update.status ?? (update.error ? 'error' : 'completed');
    const run: SubagentRun = {
      ...existing,
      status,
      completedAt: update.completedAt ?? Date.now(),
      result: this.serializeResult(update.result) ?? existing.result,
      error: this.serializeResult(update.error) ?? existing.error,
    };
    proc.subagentRuns.set(run.id, run);
    this.emitSubagentRun(sessionId, run);
    this.syncCurrentAgentState(proc);
  }

  private completeActiveSubagents(
    sessionId: string,
    proc: ClaudeProcess,
    update: {
      status?: SubagentRunStatus;
      result?: unknown;
      error?: unknown;
      /** Only process teardown finalises detached runs — they outlive turns. */
      includeBackground?: boolean;
    } = {}
  ): void {
    const activeRuns = Array.from(proc.subagentRuns.values()).filter(
      (run) => run.status === 'started' && (!run.background || update.includeBackground === true)
    );
    for (const run of activeRuns) {
      this.completeSubagentRun(sessionId, proc, { agentId: run.id }, update);
    }
  }

  private snapshotSubagentRuns(proc: ClaudeProcess): SubagentRun[] {
    return Array.from(proc.subagentRuns.values())
      .sort((a, b) => {
        if (a.status === 'started' && b.status !== 'started') return -1;
        if (a.status !== 'started' && b.status === 'started') return 1;
        return (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt);
      })
      .slice(0, 30);
  }

  private describeToolActivity(toolName: string, input?: unknown): string {
    const rawName = toolName || 'tool';
    const normalized = rawName.replace(/[_\s-]/g, '').toLowerCase();
    const inputObject =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : null;
    const command =
      typeof inputObject?.command === 'string'
        ? this.compactActivityText(inputObject.command, 72)
        : null;
    const path =
      typeof inputObject?.file_path === 'string'
        ? this.compactActivityText(inputObject.file_path.split('/').pop(), 48)
        : typeof inputObject?.path === 'string'
          ? this.compactActivityText(inputObject.path.split('/').pop(), 48)
          : null;
    const query =
      typeof inputObject?.query === 'string'
        ? this.compactActivityText(inputObject.query, 64)
        : null;

    if (
      normalized.includes('bash') ||
      normalized.includes('shell') ||
      normalized.includes('command')
    ) {
      return command ? `Running command: ${command}` : 'Running command';
    }
    if (
      normalized.includes('grep') ||
      normalized.includes('search') ||
      normalized.includes('glob')
    ) {
      return query ? `Searching: ${query}` : 'Searching the workspace';
    }
    if (normalized.includes('read')) {
      return path ? `Reading ${path}` : 'Reading files';
    }
    if (
      normalized.includes('write') ||
      normalized.includes('edit') ||
      normalized.includes('patch') ||
      normalized.includes('filechange')
    ) {
      return path ? `Editing ${path}` : 'Editing files';
    }
    if (normalized.includes('todo')) {
      return 'Updating tasks';
    }
    if (normalized.includes('web')) {
      return query ? `Searching the web: ${query}` : 'Searching the web';
    }
    if (normalized.includes('mcp')) {
      return `Using ${rawName}`;
    }
    return `Using ${rawName}`;
  }

  private getActivitySummary(
    proc: ClaudeProcess,
    busy: boolean,
    queueDepth: number
  ): string | null {
    if (proc.currentToolName) {
      return this.compactActivityText(
        proc.currentActivitySummary || this.describeToolActivity(proc.currentToolName)
      );
    }
    const activeSubagents = Array.from(proc.subagentRuns.values()).filter(
      (run) => run.status === 'started'
    );
    if (activeSubagents.length > 1) {
      return `${activeSubagents.length} subagents running`;
    }
    if (proc.currentAgentDescription) {
      return this.compactActivityText(proc.currentAgentDescription);
    }
    if (proc.currentAgentType) {
      return this.compactActivityText(`Running ${proc.currentAgentType} agent`);
    }
    if (proc.isStreaming) {
      return 'Writing response';
    }
    if (proc.currentActivitySummary && busy) {
      return this.compactActivityText(proc.currentActivitySummary);
    }
    if (queueDepth > 0) {
      return `${queueDepth} turn${queueDepth === 1 ? '' : 's'} queued`;
    }
    if (busy) {
      return proc.cliProvider === 'codex' ? 'Thinking through the turn' : 'Agent working';
    }
    return null;
  }

  /**
   * Side effects that belong to a finished turn: capture the working-tree diff
   * and file the reply in the notification centre. Deliberately fire-and-forget
   * so nothing here can delay or break message delivery.
   */
  private async recordTurnOutcome(
    sessionId: string,
    content: string,
    turnId: string
  ): Promise<void> {
    try {
      const row = (await pgGet(
        'SELECT user_id as userId, name, working_directory as workingDirectory FROM sessions WHERE id = ?',
        sessionId
      )) as unknown as { userId: string; name: string; workingDirectory: string } | undefined;
      if (!row) return;

      const { captureTurnDiff } = await import('../git/turnDiff.js');
      await captureTurnDiff(sessionId, row.userId, row.workingDirectory, turnId);

      const trimmed = content.trim();
      if (trimmed) {
        const { notify } = await import('../notifications/notificationCenter.js');
        const isGoal = /^goal complete/i.test(trimmed);
        await notify({
          userId: row.userId,
          sessionId,
          kind: isGoal ? 'goal' : 'reply',
          title: isGoal ? `Goal complete — ${row.name}` : `Reply ready — ${row.name}`,
          body: trimmed.slice(0, 300),
        });
      }
    } catch (error) {
      console.warn('[TurnOutcome] skipped:', error);
    }
  }

  // Wrapper to emit and buffer status
  private emitStatus(
    sessionId: string,
    data: { sessionId: string; status: 'running' | 'stopped' | 'error' }
  ): void {
    this.emitBufferedEvent(sessionId, 'status', data, (sequenced) => {
      this.io.to(`session:${sessionId}`).emit('session:status', sequenced);
    });
  }

  private async notifyDiscordSessionEvent(
    sessionId: string,
    input: {
      eventType: DiscordAlertEventType;
      severity: DiscordAlertSeverity;
      title: string;
      summary: string;
      fields?: Array<{ name: string; value: unknown; inline?: boolean }>;
    }
  ): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc?.userId) return;
    const homeAssistantStatus = homeAssistantStatusForSessionEvent(input.eventType, input.severity);
    if (homeAssistantStatus)
      await homeAssistantStatusLights.notifySession(sessionId, homeAssistantStatus);
    try {
      const session = (await pgGet(
        'SELECT name FROM sessions WHERE id = ? AND user_id = ?',
        sessionId,
        proc.userId
      )) as unknown as { name: string } | undefined;
      await discordNotifier.queueAlert({
        eventType: input.eventType,
        severity: input.severity,
        title: input.title,
        summary: input.summary,
        userId: proc.userId,
        sessionId,
        fields: [
          { name: 'Session', value: session?.name || sessionId, inline: true },
          { name: 'Provider', value: proc.cliProvider, inline: true },
          ...(input.fields || []),
        ],
      });
    } catch (err) {
      console.warn('[DISCORD] Failed to queue session notification:', err);
    }
  }

  private async buildDiscordGatewayContext(
    sessionId: string,
    proc: ClaudeProcess
  ): Promise<string | null> {
    const settings = await discordIntegrationService.getSettings();
    if (!settings.enabled || !settings.configured) return null;

    const modeLabel =
      settings.gatewayMode === 'autonomous'
        ? 'autonomous supervisor gateway'
        : settings.gatewayMode === 'supervisor'
          ? 'supervisor gateway'
          : 'alerts-only gateway';
    const maintenanceLabel =
      settings.maintenancePolicy === 'autonomous_allowed'
        ? 'autonomous maintenance is allowed when the task and active session/container policy permit it'
        : settings.maintenancePolicy === 'approval_required'
          ? 'maintenance actions require explicit user approval before destructive or state-changing work'
          : `maintenance follows the active Plum session permission mode (${proc.mode}) and any container/watchdog policy`;
    const inboundLabel = settings.inboundJobsEnabled
      ? 'Discord-originated jobs may be accepted through the automation gateway when authorized.'
      : 'Discord-originated jobs are not accepted automatically yet; treat Discord as supervision/coordination only.';
    const channelLabel =
      settings.channelLabel || settings.channelId || 'configured Discord channel';

    return `<system-reminder>
Discord Main Gateway:
- Plum Discord is enabled as the ${modeLabel} for this session.
- Channel: ${channelLabel}
- Provider: ${proc.cliProvider}
- Session: ${sessionId}
- Use Discord as the main escalation/completion path for important blockers, permission needs, watchdog incidents, and goal/milestone completion. Plum mirrors supported events there automatically.
- When a goal, /goal, or user-requested milestone is complete, make the final answer explicit: start with "Goal complete:" and include the concrete result, verification, and any remaining risk. Other Discord bots use that summary to coordinate follow-up testing.
- ${maintenanceLabel}.
- ${inboundLabel}
- Never send secrets, raw tokens, cookies, private keys, or full credentials to Discord. Summarize sensitive values as redacted.
</system-reminder>`;
  }

  // Wrapper to emit and buffer tool_use events
  private emitToolUse(
    sessionId: string,
    data: {
      sessionId: string;
      toolName: string;
      status: 'started' | 'completed' | 'error';
      toolId?: string;
      input?: unknown;
      result?: string;
      error?: string;
      actionSummary?: ToolActionSummary;
    }
  ): void {
    // Stamp with the backend clock so the frontend can sort tools against
    // assistant messages (which already use the backend clock via
    // saveAssistantMessage's `createdAt`). Mixing FE Date.now() with BE
    // ISO timestamps caused the timeline to pile tools at the bottom
    // whenever the browser clock drifted ahead of the server.
    const proc = this.processes.get(sessionId);
    const actionSummary =
      data.actionSummary ??
      (data.status === 'started'
        ? getFallbackToolActionSummary(data.toolName, data.input)
        : undefined);
    const stamped = {
      ...data,
      ...(actionSummary ? { actionSummary } : {}),
      timestamp: Date.now(),
    };

    if (proc) {
      if (data.status === 'started') {
        proc.currentToolName = data.toolName;
        proc.currentToolId = data.toolId || proc.currentToolId;
        proc.currentActivitySummary = this.describeToolActivity(data.toolName, data.input);
      } else if (data.status === 'error') {
        proc.currentActivitySummary = `${data.toolName} failed`;
        if (!proc.currentAgentType && proc.currentToolName === data.toolName) {
          proc.currentToolName = null;
          proc.currentToolId = null;
        }
      } else if (data.status === 'completed') {
        proc.currentActivitySummary = this.describeToolActivity(data.toolName, data.input);
      }
    }
    this.emitBufferedEvent(sessionId, 'tool_use', stamped, (sequenced) => {
      this.io.to(`session:${sessionId}`).emit('session:tool_use', sequenced);
    });
  }

  private emitModeChange(sessionId: string, mode: SessionMode): void {
    const data = { sessionId, mode };
    this.emitBufferedEvent(sessionId, 'mode', data, (sequenced) => {
      this.io.to(`session:${sessionId}`).emit('session:mode', sequenced);
    });
  }

  private async emitCompact(
    sessionId: string,
    data: {
      id?: string;
      sessionId: string;
      message: string;
      summary?: string;
      clear?: boolean;
      reason?: 'auto-compact' | 'provider-switch' | 'context-limit' | 'settings-deferred';
      error?: string;
      createdAt?: string;
    }
  ): Promise<void> {
    const event = {
      ...data,
      id: data.id || `compact-${nanoid()}`,
      createdAt: data.createdAt || new Date().toISOString(),
    };
    await this.persistCompactEvent(sessionId, event);
    this.emitBufferedEvent(sessionId, 'compact', event, (sequenced) => {
      this.io.to(`session:${sessionId}`).emit('session:compact', sequenced);
    });

    // Self-maintaining memory: every compaction triggers a debounced cleanup
    // of the workspace memory dir plus CLAUDE.md / AGENTS.md (see
    // services/memoryOptimizer.ts). Fire-and-forget — never blocks the turn.
    const workdir = this.processes.get(sessionId)?.workingDirectory;
    if (workdir) {
      void onSessionCompacted(sessionId, workdir).catch((error) =>
        console.error(`[MEMORY-OPT] Unhandled failure [${sessionId}]:`, error)
      );
    }
  }

  private toSqliteTimestamp(iso: string): string {
    // Preserve millisecond precision so same-second events remain sortable.
    return new Date(iso).toISOString().slice(0, 23).replace('T', ' ');
  }

  private async persistCompactEvent(
    sessionId: string,
    event: {
      id: string;
      sessionId: string;
      message: string;
      summary?: string;
      clear?: boolean;
      reason?: 'auto-compact' | 'provider-switch' | 'context-limit' | 'settings-deferred';
      error?: string;
      createdAt: string;
    }
  ): Promise<void> {
    const proc = this.processes.get(sessionId);
    const session =
      proc ||
      ((await pgGet(
        'SELECT user_id as userId, cli_provider as cliProvider FROM sessions WHERE id = ?',
        sessionId
      )) as unknown as { userId: string; cliProvider: CLIProvider | null } | undefined);
    if (!session) return;

    const userId = 'userId' in session ? session.userId : proc?.userId;
    if (!userId) return;

    const provider = proc?.cliProvider || ('cliProvider' in session ? session.cliProvider : null);
    const model = proc?.model || null;
    const content = `${event.message}${event.summary ? `\n\n${event.summary}` : ''}`;
    const createdAt = this.toSqliteTimestamp(event.createdAt);

    try {
      await pgTransaction(async (tx) => {
        await tx.run(
          `INSERT INTO session_events (
             id, user_id, session_id, event_type, provider, model, reason, message,
             summary, metadata_json, created_at
           )
           VALUES (?, ?, ?, 'compact', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
          event.id,
          userId,
          sessionId,
          provider,
          model,
          event.reason || null,
          event.message,
          event.summary || null,
          JSON.stringify({
            clear: !!event.clear,
            error: event.error || null,
          }),
          createdAt
        );
        await tx.run(
          `INSERT INTO messages (id, session_id, role, content, created_at)
           VALUES (?, ?, 'system', ?, ?)
           ON CONFLICT (id) DO NOTHING`,
          event.id,
          sessionId,
          content,
          createdAt
        );
        await tx.run(
          'UPDATE sessions SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          event.message.substring(0, 200),
          sessionId
        );
      });
    } catch (error) {
      console.error('[EVENTS] Failed to persist compact event:', error);
    }
  }

  private async recordContextSnapshot(
    sessionId: string,
    proc: ClaudeProcess,
    usageData: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      totalTokens: number;
      contextWindow: number;
      contextUsedPercent: number;
      contextUsedPercentRaw?: number;
      contextExceeded?: boolean;
      totalCostUsd: number;
      model: string;
    }
  ): Promise<void> {
    if (usageData.contextWindow <= 0) return;

    const now = Date.now();
    const rawPercent = usageData.contextUsedPercentRaw ?? usageData.contextUsedPercent;
    const last = proc.lastContextSnapshot;
    const shouldRecord =
      !last ||
      usageData.model !== last.model ||
      usageData.contextWindow !== last.contextWindow ||
      (usageData.totalTokens === 0 && last.totalTokens > 0) ||
      Math.abs(usageData.totalTokens - last.totalTokens) >= 1000 ||
      Math.abs(rawPercent - last.contextUsedPercentRaw) >= 1 ||
      (usageData.totalTokens !== last.totalTokens && now - last.recordedAt >= 30_000);

    if (!shouldRecord) return;

    const eventId = `ctx-${nanoid()}`;
    const createdAt = this.toSqliteTimestamp(new Date(now).toISOString());

    try {
      await pgRun(
        `
        INSERT INTO session_events (
          id, user_id, session_id, event_type, provider, model,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          total_tokens, context_window, context_used_percent, context_exceeded,
          metadata_json, created_at
        )
        VALUES (?, ?, ?, 'context_snapshot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        eventId,
        proc.userId,
        sessionId,
        proc.cliProvider,
        usageData.model,
        usageData.inputTokens,
        usageData.outputTokens,
        usageData.cacheReadTokens,
        usageData.cacheCreationTokens,
        usageData.totalTokens,
        usageData.contextWindow,
        rawPercent,
        usageData.contextExceeded ? 1 : 0,
        JSON.stringify({
          cappedPercent: usageData.contextUsedPercent,
          totalCostUsd: usageData.totalCostUsd,
          codexUsageBaseline:
            proc.cliProvider === 'codex' ? proc.codexLastReportedTokens || null : undefined,
          codexLastTokenUsage:
            proc.cliProvider === 'codex' ? proc.codexLastTokenUsage || null : undefined,
          codexTotalTokenUsage:
            proc.cliProvider === 'codex' ? proc.codexTotalTokenUsage || null : undefined,
          codexUsageMode:
            proc.cliProvider === 'codex'
              ? proc.codexCurrentExecUsedResume
                ? 'resume'
                : 'fresh-exec'
              : undefined,
        }),
        createdAt
      );
      proc.lastContextSnapshot = {
        totalTokens: usageData.totalTokens,
        contextWindow: usageData.contextWindow,
        contextUsedPercentRaw: rawPercent,
        model: usageData.model,
        recordedAt: now,
      };
    } catch (error) {
      console.error('[EVENTS] Failed to record context snapshot:', error);
    }
  }

  private resolveObservedContextWindow(
    model: string | null | undefined,
    reportedWindow?: number | null
  ): number {
    const resolvedWindow = contextWindowFor(model);
    if (resolvedWindow !== DEFAULT_CONTEXT_WINDOW) {
      return resolvedWindow;
    }
    return typeof reportedWindow === 'number' && reportedWindow > 0
      ? reportedWindow
      : resolvedWindow;
  }

  private async readCodexDescendantUsage(
    rootThreadId: string | null | undefined
  ): Promise<CodexUsageCounters> {
    if (!rootThreadId) return { input: 0, cached: 0, output: 0 };
    const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
    return readCodexDescendantUsage(codexHome, rootThreadId);
  }

  /**
   * Stage the per-subagent split of the turn that is about to be booked.
   *
   * The tokens are already inside the turn's usage_history row; this only
   * records which spawned agent spent which share. Flushed in
   * saveUsageToDatabase once the turn id is final.
   */
  private async captureCodexSubagentBreakdown(
    proc: ClaudeProcess,
    rootThreadId: string | null | undefined
  ): Promise<void> {
    proc.pendingSubagentUsage = undefined;
    if (!rootThreadId) return;
    const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
    const detail = await readCodexDescendantUsageDetail(codexHome, rootThreadId);
    if (detail.length === 0) {
      proc.codexSubagentBaseline = new Map();
      return;
    }

    const baseline = proc.codexSubagentBaseline;
    const nextBaseline = new Map<string, CodexUsageCounters>();
    const rows: PendingSubagentUsage[] = [];
    for (const thread of detail) {
      nextBaseline.set(thread.threadId, thread.usage);
      const previous = baseline?.get(thread.threadId) ?? null;
      const delta = subtractCodexUsageCounters(thread.usage, previous);
      if (delta.input <= 0 && delta.output <= 0) continue;
      const nonCachedInput = Math.max(delta.input - delta.cached, 0);
      const model = thread.model || proc.model;
      rows.push({
        agentId: thread.threadId,
        parentAgentId: thread.parentThreadId,
        agentType: thread.agentType,
        model,
        inputTokens: nonCachedInput,
        outputTokens: delta.output,
        cacheReadTokens: delta.cached,
        cacheCreationTokens: 0,
        totalTokens: nonCachedInput + delta.output + delta.cached,
        costUsd: estimateModelCost(
          model,
          {
            inputTokens: nonCachedInput,
            outputTokens: delta.output,
            cacheReadTokens: delta.cached,
            cacheCreationTokens: 0,
          },
          null
        ).cost,
      });
    }
    proc.codexSubagentBaseline = nextBaseline;
    if (rows.length > 0) proc.pendingSubagentUsage = rows;
  }

  /**
   * Thread id of the Codex exec this turn is running in.
   *
   * Must be resolved BEFORE descendant usage is read: `session_meta`/`thread.started`
   * does not always carry an id, and the late fallback used to run after the
   * descendant lookup — so subagent tokens were charged against `null` and dropped.
   * A plain `codex exec` starts a fresh root per turn, so only resume mode may
   * keep the previously captured id.
   */
  private async resolveCodexRootThreadId(
    sessionId: string,
    proc: ClaudeProcess
  ): Promise<string | null> {
    const existing = proc.codexSessionId || proc.claudeSessionId || null;
    if (proc.codexCurrentExecUsedResume && existing) return existing;

    const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
    const resolved = await findCodexExecRootThreadId(codexHome, {
      cwd: proc.workingDirectory,
      sinceMs: proc.codexExecStartedAtMs,
    });
    if (!resolved) return existing;

    if (proc.codexSessionId !== resolved) {
      proc.codexSessionId = resolved;
      proc.claudeSessionId = resolved;
      try {
        await pgRun('UPDATE sessions SET claude_session_id = ? WHERE id = ?', resolved, sessionId);
        console.log(`[CODEX] Resolved exec root thread ${resolved} for ${sessionId}`);
      } catch (error) {
        console.warn('[CODEX] Failed to persist resolved exec root thread:', error);
      }
    }
    return resolved;
  }

  /**
   * Cumulative billing counters for a Codex thread, read from its rollout.
   *
   * Used when no `usage` payload reaches us — `turn.failed` omits it, and an
   * interrupted exec never emits a turn event at all. Semantics match
   * `turn.completed.usage`, so the same delta machinery applies.
   */
  private async readCodexUsageFromThreadState(
    rootThreadId: string | null | undefined
  ): Promise<CodexUsageCounters | null> {
    if (!rootThreadId) return null;
    const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
    const usage = await readCodexThreadCumulativeUsage(codexHome, rootThreadId);
    if (!usage) return null;
    if (usage.input <= 0 && usage.output <= 0) return null;
    return usage;
  }

  /**
   * Fold a turn's Codex billing counters (root + subagent threads) into the
   * process's per-turn token fields. Returns the disjoint Claude-shaped split.
   */
  private async applyCodexTurnUsage(
    sessionId: string,
    proc: ClaudeProcess,
    counters: CodexUsageCounters
  ): Promise<{ nonCachedInput: number; cached: number; output: number }> {
    // Codex's cumulative counters grow across turns in resume mode (each respawn
    // reloads the full session JSONL). Sending raw values to usage_history
    // multiplied analytics tokens 10-100x, so compute per-turn deltas there.
    // Plain `codex exec` starts a fresh Codex session — its usage is already
    // scoped to this exec turn and must not be delta-adjusted.
    const prev = proc.codexLastReportedTokens;
    const useResumeDelta = !!proc.codexCurrentExecUsedResume;
    let deltaInput: number;
    let deltaCached: number;
    let deltaOutput: number;
    if (
      !useResumeDelta ||
      !prev ||
      counters.input < prev.input ||
      counters.cached < prev.cached ||
      counters.output < prev.output
    ) {
      // Fresh exec, first call, or a counter reset → take the values as-is
      // rather than writing a negative delta.
      deltaInput = counters.input;
      deltaCached = counters.cached;
      deltaOutput = counters.output;
    } else {
      deltaInput = counters.input - prev.input;
      deltaCached = counters.cached - prev.cached;
      deltaOutput = counters.output - prev.output;
    }
    proc.codexLastReportedTokens = {
      input: counters.input,
      cached: counters.cached,
      output: counters.output,
    };

    const rootThreadId = await this.resolveCodexRootThreadId(sessionId, proc);
    await this.captureCodexSubagentBreakdown(proc, rootThreadId);
    const descendantUsage = await this.readCodexDescendantUsage(rootThreadId);
    const descendantBaseline = proc.codexDescendantUsageBaseline;
    if (descendantBaseline) {
      const countersReset =
        descendantUsage.input < descendantBaseline.input ||
        descendantUsage.cached < descendantBaseline.cached ||
        descendantUsage.output < descendantBaseline.output;
      deltaInput += countersReset
        ? descendantUsage.input
        : descendantUsage.input - descendantBaseline.input;
      deltaCached += countersReset
        ? descendantUsage.cached
        : descendantUsage.cached - descendantBaseline.cached;
      deltaOutput += countersReset
        ? descendantUsage.output
        : descendantUsage.output - descendantBaseline.output;
    } else {
      deltaInput += descendantUsage.input;
      deltaCached += descendantUsage.cached;
      deltaOutput += descendantUsage.output;
    }
    proc.codexDescendantUsageBaseline = descendantUsage;

    // Schema difference vs Claude:
    //   Codex:  input_tokens INCLUDES cached_input_tokens (overlapping)
    //   Claude: input_tokens and cache_read_input_tokens are disjoint
    const nonCachedRaw = Math.max(deltaInput - deltaCached, 0);
    const cachedRaw = Math.max(deltaCached, 0);
    const outputRaw = Math.max(deltaOutput, 0);
    const nonCachedInput = Math.min(nonCachedRaw, CODEX_TURN_TOKEN_FIELD_CAP);
    const cached = Math.min(cachedRaw, CODEX_TURN_CACHE_READ_CAP);
    const output = Math.min(outputRaw, CODEX_TURN_TOKEN_FIELD_CAP);
    if (nonCachedInput !== nonCachedRaw || cached !== cachedRaw || output !== outputRaw) {
      // A clamped field means the delta logic saw counter values no real turn
      // produces — surface it instead of silently truncating analytics.
      console.warn(
        `[CODEX] Per-turn usage clamped [${sessionId}]: input=${nonCachedRaw} cached=${cachedRaw} output=${outputRaw}`
      );
    }

    proc.turnInputTokens = nonCachedInput;
    proc.turnOutputTokens = output;
    proc.turnCacheReadTokens = cached;
    proc.turnCacheCreationTokens = 0; // Codex doesn't surface cache writes.

    return { nonCachedInput, cached, output };
  }

  /**
   * Last-resort usage flush for a Codex exec that died without a turn event
   * (SIGINT steer, crash, rate-limit abort). `saveUsageToDatabase` is keyed by
   * turn id, so a turn already booked by `turn.completed` is a no-op here.
   */
  private async flushCodexUsageOnExit(sessionId: string, proc: ClaudeProcess): Promise<void> {
    if (proc.cliProvider !== 'codex') return;
    try {
      // Bail before touching the delta baselines: re-applying them for an
      // already-booked turn would double-count proc.totalCostUsd even though the
      // INSERT itself is a no-op.
      const turnId = proc.currentUsageTurnId;
      if (turnId && (await usageHistoryTurnExists(sessionId, proc.cliProvider, turnId))) {
        return;
      }
      const rootThreadId = await this.resolveCodexRootThreadId(sessionId, proc);
      const counters = await this.readCodexUsageFromThreadState(rootThreadId);
      if (!counters) return;
      await this.applyCodexTurnUsage(sessionId, proc, counters);
      const turnCostUsd = this.calculateTurnCost(proc);
      proc.previousTotalCostUsd = proc.totalCostUsd;
      proc.totalCostUsd += turnCostUsd;
      await this.emitUsage(sessionId, proc);
      this.saveUsageToDatabase(sessionId, proc);
    } catch (error) {
      console.warn('[CODEX] Failed to flush usage after process exit:', error);
    }
  }

  // Get buffered messages since a timestamp for reconnection
  async getSessionBuffer(sessionId: string, sinceTimestamp?: number): Promise<BufferedMessage[]> {
    return (await this.getSessionBufferStatus(sessionId, sinceTimestamp)).items;
  }

  /** Emit and replay-buffer a blocking permission request from the hook route. */
  emitPermissionRequest(sessionId: string, data: PendingPermission | PermissionRequestData): void {
    this.emitBufferedEvent(sessionId, 'permission_request', data, (sequenced) => {
      this.io.to(`session:${sessionId}`).emit('session:permission_request', sequenced);
    });
  }

  /**
   * Returns buffered items plus a rollover flag. needsFullResync=true means the buffer
   * evicted data older than sinceTimestamp — client cannot reconstruct state from the buffer alone.
   */
  async getSessionBufferStatus(
    sessionId: string,
    sinceTimestamp?: number,
    sinceSequence?: number
  ): Promise<{ items: BufferedMessage[]; needsFullResync: boolean }> {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      if (sinceSequence !== undefined) {
        const highWatermark = (await getSessionSyncState(sessionId)).highWatermark;
        return { items: [], needsFullResync: sinceSequence < highWatermark };
      }
      return { items: [], needsFullResync: false };
    }

    if (sinceSequence !== undefined) {
      const all = proc.outputBuffer.getAll();
      const items = all.filter((message) => (message.sequence ?? 0) > sinceSequence);
      const highWatermark = (await getSessionSyncState(sessionId)).highWatermark;
      const earliest = items[0]?.sequence;
      return {
        items,
        needsFullResync:
          (earliest !== undefined && earliest > sinceSequence + 1) ||
          (items.length === 0 && sinceSequence < highWatermark),
      };
    }

    if (sinceTimestamp) {
      return proc.outputBuffer.getSinceWithStatus((msg) => msg.timestamp >= sinceTimestamp);
    }
    return { items: proc.outputBuffer.getAll(), needsFullResync: false };
  }

  // Check if a session is running (for reconnection)
  isSessionRunning(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  // Empty the replay buffer so a rewound session doesn't replay messages that were
  // just deleted from the DB. Safe to call whether the session is running or not.
  clearSessionBuffer(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    proc?.outputBuffer.clear();
  }

  // Mark session as disconnected (client disconnected but process keeps running)
  markSessionDisconnected(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc && !proc.disconnectedAt) {
      proc.disconnectedAt = Date.now();
      console.log(`Session ${sessionId} marked as disconnected`);
    }
  }

  // Mark session as reconnected
  markSessionReconnected(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc) {
      proc.disconnectedAt = null;
      console.log(`Session ${sessionId} marked as reconnected`);
    }
  }

  /**
   * A container restart cannot keep the in-flight ACP request alive. When a Kimi
   * chat is opened again and its persisted transcript ends with a user turn,
   * resume the native ACP session and continue that interrupted turn once. The
   * recovery hint is transport-only and must not create a duplicate chat row.
   */
  async recoverInterruptedKimiTurn(sessionId: string, userId: string): Promise<boolean> {
    if (this.processes.has(sessionId)) return false;

    const session = (await pgGet(
      `SELECT cli_provider, status
           FROM sessions
          WHERE id = ? AND user_id = ?`,
      sessionId,
      userId
    )) as unknown as { cli_provider: CLIProvider | null; status: string | null } | undefined;
    if (!session) return false;

    const latest = (await pgGet(
      `SELECT role
           FROM messages
          WHERE session_id = ?
            AND chat_id IS (SELECT active_chat_id FROM sessions WHERE id = ?)
          ORDER BY created_at DESC, seq DESC
          LIMIT 1`,
      sessionId,
      sessionId
    )) as unknown as { role: string } | undefined;
    if (!shouldRecoverInterruptedKimiTurn(session.cli_provider, session.status, latest?.role)) {
      return false;
    }

    await this.startSession(sessionId, userId);
    console.log(`[KIMI ACP] Recovering interrupted user turn [${sessionId}]`);
    void this.sendMessage(
      sessionId,
      userId,
      'Continue the interrupted previous user request. Complete it and respond normally in the chat.',
      undefined,
      { recordMessage: false, updateLastMessage: false }
    ).catch((error) => {
      console.error(`[KIMI ACP] Interrupted-turn recovery failed [${sessionId}]:`, error);
      this.io.to(`session:${sessionId}`).emit('session:error', {
        sessionId,
        error: `Kimi recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    return true;
  }

  /** One spawn at a time per session: the awaits between the has() guard and
   * processes.set() let a concurrent send start a second CLI whose loser is
   * never registered, never killed, and keeps running unmanaged. */
  private readonly startingSessions = new Map<string, Promise<void>>();

  async startSession(sessionId: string, userId: string, mode?: SessionMode): Promise<void> {
    const inflight = this.startingSessions.get(sessionId);
    if (inflight) return inflight;
    const run = this.doStartSession(sessionId, userId, mode).finally(() => {
      this.startingSessions.delete(sessionId);
    });
    this.startingSessions.set(sessionId, run);
    return run;
  }

  private async doStartSession(
    sessionId: string,
    userId: string,
    mode?: SessionMode
  ): Promise<void> {
    const session = (await pgGet(
      'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    )) as unknown as
      | {
          working_directory: string;
          claude_session_id: string | null;
          allowed_directories: string | null;
          active_chat_id: string | null;
          cli_provider: CLIProvider | null;
          mode: SessionMode | null;
        }
      | undefined;

    if (!session) {
      throw new Error('Session not found');
    }
    await assertRunnerAccess(userId);

    if (this.processes.has(sessionId)) {
      return;
    }

    // Preserve the session's persisted permission mode across process/container
    // restarts. A pending live UI change still takes precedence.
    const effectiveMode = resolveSessionStartMode(
      mode,
      this.pendingModes.get(sessionId),
      session.mode
    );
    this.pendingModes.delete(sessionId); // Clear pending mode once used
    // Codex is the primary provider. Only very old rows can have NULL here.
    const cliProvider: CLIProvider = session.cli_provider || 'codex';
    const providerConfig = CLI_PROVIDERS[cliProvider];
    if (!(await getEnabledCliProvidersForUser(userId)).includes(cliProvider)) {
      throw new Error(`${providerConfig.name} is disabled in Settings`);
    }
    if (cliProvider === 'zai' && !(await getZaiApiConfigForUser(userId))) {
      throw new Error('Configure Z.AI in Settings before starting this session');
    }
    const configHome = resolveConfigHome(cliProvider);
    if (isClaudeTransportProvider(cliProvider)) {
      await sanitizeClaudeSettingsProviderEnv({
        settingsPath: path.join(configHome, 'settings.json'),
      });
    }
    const selectedModel = await getCliModelForSession(userId, cliProvider, sessionId);
    const selectedReasoning = await getCliReasoningForSession(userId, cliProvider, sessionId);
    const selectedServiceTier = await getCliServiceTierForSession(userId, cliProvider, sessionId);

    console.log(
      `[MODE] Starting session ${sessionId} with mode ${effectiveMode}, provider ${cliProvider}`
    );

    // Parse allowed directories
    const allowedDirs: string[] = safeJsonParse<string[]>(session.allowed_directories, []);

    const isResuming = !!session.claude_session_id;
    if (cliProvider === 'claude' && session.claude_session_id) {
      const transcript = await sanitizeClaudeResumeTranscript(
        configHome,
        session.working_directory,
        session.claude_session_id
      );
      if (transcript.updated) {
        console.log(
          `[provider-isolation] Replaced ${transcript.replacements} incompatible Z.AI server tool block(s) before Claude resume`
        );
      }
    }
    let args: string[] = [];
    let piAgentDir: string | null = null;

    // Write skills/agents to global ~/.claude/CLAUDE.md + lightweight project AGENTS.md context
    await ensureGlobalInstructions(configHome);
    await ensureProjectInstructions(session.working_directory, configHome, cliProvider);
    // Shared links are provider-neutral. OpenCode's user-specific provider
    // blocks are written later into that user's isolated tenant config.
    await syncProviderLinks({ quiet: true });
    if (cliProvider === 'pi') {
      const piSync = await syncPiConfig(userId);
      if (piSync.providerCount === 0 || piSync.modelCount === 0) {
        throw new Error(
          'Pi requires at least one enabled OpenCode API connection with available models. Configure it under Settings → General → OpenCode.'
        );
      }
      if (piSync.extensions.length < 3) {
        throw new Error('Pi shared MCP/subagent extensions are not installed in this container.');
      }
      piAgentDir = piSync.agentDir;
      console.log(
        `[PI] Synced ${piSync.providerCount} providers, ${piSync.modelCount} models, ` +
          `${piSync.mcpCount} MCP servers, ${piSync.agentCount} agents`
      );
    }

    if (cliProvider === 'opencode') {
      // Server-backed path: OpenCode HTTP/SSE via one isolated server per WebUI user.
      // Unlike claude/codex, there is no per-session child process to own; events
      // arrive over the shared SSE subscription and are demultiplexed by sessionID.
      await opencodeServer.ensureStarted(userId);

      let remoteId = isResuming && session.claude_session_id ? session.claude_session_id : null;
      if (remoteId && !(await opencodeServer.sessionExists(remoteId, userId))) {
        console.log(`[OPENCODE-SERVER] Prior session ${remoteId} not found on server; recreating`);
        remoteId = null;
      }
      if (!remoteId) {
        remoteId = await opencodeServer.createSession(session.working_directory, {
          model: selectedModel,
          mode: effectiveMode,
          variant: selectedReasoning,
          allowedDirectories: allowedDirs,
          userId,
        });
        await pgRun('UPDATE sessions SET claude_session_id = ? WHERE id = ?', remoteId, sessionId);
      }

      console.log(`[SESSION] ========== Starting Session (opencode server) ==========`);
      console.log(`[SESSION] Session ID: ${sessionId}`);
      console.log(`[SESSION] OpenCode sessionID: ${remoteId}`);
      console.log(`[SESSION] Working directory: ${session.working_directory}`);
      console.log(`[SESSION] Mode: ${effectiveMode}`);
      console.log(`[SESSION] Model: ${selectedModel ?? '(default)'}`);
      console.log(`[SESSION] Resuming: ${isResuming}`);
      console.log(`[SESSION] ==============================================`);

      const virtualProc = createVirtualChildProcess();
      const claudeProcess: ClaudeProcess = {
        process: virtualProc,
        sessionId,
        providerChatId: session.active_chat_id,
        currentChatId: session.active_chat_id,
        cliProvider,
        userId,
        workingDirectory: session.working_directory,
        claudeSessionId: remoteId,
        buffer: '',
        streamingText: '',
        isStreaming: false,
        mode: effectiveMode,
        currentToolName: null,
        currentToolId: null,
        currentToolInput: '',
        currentActivitySummary: null,
        pendingToolResults: new Map(),
        currentAgentType: null,
        currentAgentDescription: null,
        subagentRuns: new Map(),
        model: selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel || 'unknown',
        contextWindow: contextWindowFor(selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel),
        turnInputTokens: 0,
        turnCacheReadTokens: 0,
        turnCacheCreationTokens: 0,
        turnOutputTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
        previousTotalCostUsd: 0,
        needsWorkingDirReminder: isResuming,
        contextReminder: this.pendingContextReminders.get(sessionId) || null,
        outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
        lastActivityAt: Date.now(),
        disconnectedAt: null,
        lastUserMessage: null,
        lastAttachments: null,
        pendingPermissionDenials: null,
        pendingChatMedia: [],
        sharedContextInjected: false,
        modePromptInjected: null,
        lastContextLimitAt: undefined,
        serverBacked: true,
        opencodeIdle: true,
        partStreams: new Map(),
        opencodeActiveMessageId: null,
        opencodeMessageOrder: [],
        emittedTools: new Set(),
      };

      this.pendingContextReminders.delete(sessionId);
      this.processes.set(sessionId, claudeProcess);

      opencodeServer.subscribe(
        remoteId,
        async (evt) => {
          await this.translateOpencodeServerEvent(sessionId, evt);
        },
        userId
      );

      await pgRun(
        'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        'running',
        sessionId
      );
      this.emitStatus(sessionId, { sessionId, status: 'running' });
      return;
    }

    if (cliProvider === 'kimi') {
      const providerConfig = CLI_PROVIDERS.kimi;
      const persistedSessionId = session.claude_session_id || undefined;
      const shouldInjectStaticBootstrap = shouldInjectCodexStaticBootstrap(persistedSessionId);
      const extraEnv: Record<string, string> = {
        ...(await buildIntegrationEnv()),
        ...(await buildAndroidDeviceEnvForSession(sessionId, userId)),
      };
      const child = spawnManagedProcess(providerConfig.command, ['acp'], {
        cwd: session.working_directory,
        env: {
          ...process.env,
          ...extraEnv,
          WEBUI_SESSION_ID: sessionId,
          WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
          WEBUI_PROJECT_PATH: session.working_directory,
          WEBUI_HOOK_SECRET: config.hookSecret,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!child.stdin || !child.stdout) {
        terminateManagedProcess(child);
        throw new Error('Kimi ACP process did not expose stdin/stdout');
      }

      const claudeProcess: ClaudeProcess = {
        process: child,
        sessionId,
        providerChatId: session.active_chat_id,
        currentChatId: session.active_chat_id,
        cliProvider,
        userId,
        workingDirectory: session.working_directory,
        claudeSessionId: session.claude_session_id,
        buffer: '',
        streamingText: '',
        isStreaming: false,
        mode: effectiveMode,
        currentToolName: null,
        currentToolId: null,
        currentToolInput: '',
        currentActivitySummary: null,
        pendingToolResults: new Map(),
        currentAgentType: null,
        currentAgentDescription: null,
        subagentRuns: new Map(),
        model: selectedModel || providerConfig.defaultModel || 'unknown',
        contextWindow: contextWindowFor(selectedModel || providerConfig.defaultModel),
        turnInputTokens: 0,
        turnCacheReadTokens: 0,
        turnCacheCreationTokens: 0,
        turnOutputTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
        previousTotalCostUsd: 0,
        needsWorkingDirReminder: isResuming,
        contextReminder: this.pendingContextReminders.get(sessionId) || null,
        outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
        lastActivityAt: Date.now(),
        disconnectedAt: null,
        lastUserMessage: null,
        lastAttachments: null,
        pendingPermissionDenials: null,
        pendingChatMedia: [],
        sharedContextInjected: !shouldInjectStaticBootstrap,
        modePromptInjected: null,
        lastContextLimitAt: undefined,
        kimiIdle: true,
        kimiQueuedTurns: [],
        kimiQueueDraining: false,
        kimiCompletedTools: new Set(),
        emittedTools: new Set(),
      };

      this.pendingContextReminders.delete(sessionId);
      this.processes.set(sessionId, claudeProcess);

      child.stderr?.on('data', (data: Buffer) => {
        console.error(`Kimi ACP stderr [${sessionId}]:`, data.toString());
      });
      child.on('exit', async (exitCode) => {
        console.log(`[KIMI ACP] Process for session ${sessionId} exited with code ${exitCode}`);
        const managedProc = this.processes.get(sessionId);
        if (managedProc !== claudeProcess) return;
        if (managedProc.streamingText.trim()) {
          await this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          managedProc.streamingText = '';
        }
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
        if (exitCode !== 0 && exitCode !== null) {
          this.io.to(`session:${sessionId}`).emit('session:error', {
            sessionId,
            error: `Kimi ACP exited unexpectedly (code ${exitCode}).`,
          });
        }
        await this.cleanupProcess(sessionId, claudeProcess);
      });
      child.on('error', async (error) => {
        console.error(`[KIMI ACP] Process error [${sessionId}]:`, error);
        if (this.processes.get(sessionId) !== claudeProcess) return;
        this.io.to(`session:${sessionId}`).emit('session:error', {
          sessionId,
          error: `Kimi ACP failed: ${error.message}`,
        });
        await this.cleanupProcess(sessionId, claudeProcess);
      });

      const acpClient: AcpClient = {
        requestPermission: async (params) =>
          await this.handleKimiAcpPermission(claudeProcess, params),
        sessionUpdate: async (params) =>
          await this.handleKimiAcpUpdate(sessionId, claudeProcess, params),
      };
      const connection = new ClientSideConnection(
        () => acpClient,
        ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
      );
      claudeProcess.kimiAcpConnection = connection;

      try {
        const initialized = await connection.initialize({
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientInfo: { name: 'Plum Code WebUI', version: '1' },
          clientCapabilities: {},
        });
        console.log(
          `[KIMI ACP] Connected [${sessionId}] agent=${initialized.agentInfo?.name || 'Kimi'} version=${initialized.agentInfo?.version || 'unknown'}`
        );

        let nativeSessionId = persistedSessionId;
        let configOptions: AcpSessionConfigOption[] | null | undefined;
        if (nativeSessionId) {
          try {
            const resumed = await connection.resumeSession({
              sessionId: nativeSessionId,
              cwd: session.working_directory,
              additionalDirectories: allowedDirs,
              mcpServers: [],
            });
            configOptions = resumed.configOptions;
          } catch (error) {
            if (!isKimiSessionNotFoundError(String(error))) throw error;
            console.warn(
              `[KIMI ACP] Native session ${nativeSessionId} is missing; creating a fresh session [${sessionId}]`
            );
            nativeSessionId = undefined;
          }
        }

        if (!nativeSessionId) {
          const created = await connection.newSession({
            cwd: session.working_directory,
            additionalDirectories: allowedDirs,
            mcpServers: [],
          });
          nativeSessionId = created.sessionId;
          configOptions = created.configOptions;
        }

        claudeProcess.kimiAcpSessionId = nativeSessionId;
        claudeProcess.claudeSessionId = nativeSessionId;
        claudeProcess.kimiAcpConfigOptions = configOptions || [];
        await this.configureKimiAcpSession(claudeProcess);

        await pgRun(
          'UPDATE sessions SET claude_session_id = ? WHERE id = ?',
          nativeSessionId,
          sessionId
        );
        await pgRun(
          'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          'running',
          sessionId
        );
        this.emitStatus(sessionId, { sessionId, status: 'running' });

        console.log(`[SESSION] ========== Starting Session (kimi ACP) ==========`);
        console.log(`[SESSION] Session ID: ${sessionId}`);
        console.log(`[SESSION] Kimi session ID: ${nativeSessionId}`);
        console.log(`[SESSION] Working directory: ${session.working_directory}`);
        console.log(`[SESSION] Mode: ${effectiveMode}`);
        console.log(`[SESSION] Model: ${claudeProcess.model}`);
        console.log(`[SESSION] Resuming: ${Boolean(persistedSessionId)}`);
        console.log(`[SESSION] ==============================================`);
        return;
      } catch (error) {
        terminateManagedProcess(child);
        await this.cleanupProcess(sessionId, claudeProcess);
        throw error;
      }
    }

    if (cliProvider === 'codex') {
      // Codex `exec` is single-shot per turn. Register the WebUI session as
      // running, but delay the actual child process until sendMessage() has the
      // user prompt.
      const persistedCodexSessionId = session.claude_session_id || undefined;
      const shouldInjectStaticBootstrap = shouldInjectCodexStaticBootstrap(persistedCodexSessionId);
      const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
      const codexTokenBaseline = persistedCodexSessionId
        ? (await readCodexThreadCumulativeUsage(codexHome, persistedCodexSessionId)) ||
          (await getCodexUsageBaselineFromDatabase(sessionId))
        : undefined;

      console.log(`[SESSION] ========== Starting Session (codex idle) ==========`);
      console.log(`[SESSION] Session ID: ${sessionId}`);
      console.log(`[SESSION] Codex session ID: ${persistedCodexSessionId || '(new)'}`);
      console.log(`[SESSION] Working directory: ${session.working_directory}`);
      console.log(`[SESSION] Mode: ${effectiveMode}`);
      console.log(`[SESSION] Model: ${selectedModel ?? '(default)'}`);
      console.log(`[SESSION] Resuming: ${isResuming}`);
      console.log(`[SESSION] ==============================================`);

      const virtualProc = createVirtualChildProcess();
      const claudeProcess: ClaudeProcess = {
        process: virtualProc,
        sessionId,
        providerChatId: session.active_chat_id,
        currentChatId: session.active_chat_id,
        cliProvider,
        userId,
        workingDirectory: session.working_directory,
        claudeSessionId: session.claude_session_id,
        buffer: '',
        streamingText: '',
        isStreaming: false,
        mode: effectiveMode,
        currentToolName: null,
        currentToolId: null,
        currentToolInput: '',
        currentActivitySummary: null,
        pendingToolResults: new Map(),
        currentAgentType: null,
        currentAgentDescription: null,
        subagentRuns: new Map(),
        model: selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel || 'unknown',
        contextWindow: contextWindowFor(selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel),
        turnInputTokens: 0,
        turnCacheReadTokens: 0,
        turnCacheCreationTokens: 0,
        turnOutputTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
        previousTotalCostUsd: 0,
        needsWorkingDirReminder: isResuming,
        contextReminder: this.pendingContextReminders.get(sessionId) || null,
        outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
        lastActivityAt: Date.now(),
        disconnectedAt: null,
        lastUserMessage: null,
        lastAttachments: null,
        pendingPermissionDenials: null,
        pendingChatMedia: [],
        sharedContextInjected: !shouldInjectStaticBootstrap,
        modePromptInjected: null,
        lastContextLimitAt: undefined,
        codexIdle: true,
        codexSessionId: persistedCodexSessionId,
        codexQueuedTurns: [],
        codexPendingImages: [],
        codexPendingExecCommand: undefined,
        codexEmittedTools: new Set(),
        codexLastReportedTokens: codexTokenBaseline,
      };

      this.pendingContextReminders.delete(sessionId);
      this.processes.set(sessionId, claudeProcess);

      await pgRun(
        'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        'running',
        sessionId
      );
      this.emitStatus(sessionId, { sessionId, status: 'running' });
      return;
    }

    if (isClaudeTransportProvider(cliProvider)) {
      // Build command args for stream-json mode (hooks-based permissions)
      // IMPORTANT: Always use --dangerously-skip-permissions so our hook is the ONLY permission layer
      // Without this, Claude's internal permission system would still prompt after our hook approves
      args = [
        '--print',
        '--verbose',
        '--debug',
        'hooks',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--include-partial-messages',
        '--dangerously-skip-permissions',
      ];

      if (selectedModel) {
        args.push('--model', selectedModel);
      }

      if (selectedReasoning) {
        args.push('--effort', selectedReasoning);
      }

      for (const dir of allowedDirs) {
        args.push('--add-dir', dir);
      }

      // Add permission hook settings for all modes except 'danger'
      // In danger mode, skip hooks entirely (tools run without any checks)
      // In other modes, our hook surfaces permission requests to the UI
      if (effectiveMode !== 'danger') {
        const hookSettings = this.getHookSettings();
        args.push('--settings', hookSettings);
      }

      // The CLI does NOT auto-load mcpServers from ~/.claude/settings.json —
      // only claude.ai-managed MCPs and project-local .mcp.json get picked
      // up by default. Point it at our config so stdio servers (comfyui,
      // android-builder, …) actually register on every spawn.
      const mcpConfigPath = `${process.env.HOME || '/home/node'}/.claude/settings.json`;
      try {
        if (fsSync.existsSync(mcpConfigPath)) {
          args.push('--mcp-config', mcpConfigPath);
        }
      } catch {
        // best-effort — missing file just means no extra stdio MCPs
      }

      if (isResuming && session.claude_session_id) {
        args.push('--resume', session.claude_session_id);
      }

      if (effectiveMode === 'planning') {
        args.push('--append-system-prompt', this.getPlanningPrompt());
      }
    } else {
      const resumeId = isResuming ? (session.claude_session_id ?? undefined) : undefined;

      // Build command args using CLI provider abstraction
      args = getCLIArgs(cliProvider, {
        mode: effectiveMode,
        resumeSessionId: resumeId,
        allowedDirectories: allowedDirs,
        workingDirectory: session.working_directory,
        model: selectedModel ?? undefined,
        reasoningLevel: selectedReasoning ?? undefined,
        serviceTier: selectedServiceTier ?? undefined,
      });
    }

    console.log(`[SESSION] ========== Starting Session ==========`);
    console.log(`[SESSION] Provider: ${providerConfig.name} (${cliProvider})`);
    console.log(`[SESSION] Session ID: ${sessionId}`);
    console.log(`[SESSION] Working directory: ${session.working_directory}`);
    console.log(`[SESSION] Mode: ${effectiveMode}`);
    console.log(`[SESSION] Allowed directories: ${allowedDirs.join(', ') || 'none'}`);
    console.log(`[SESSION] Resuming: ${isResuming}`);
    console.log(`[SESSION] Args: ${args.join(' ')}`);
    console.log(`[SESSION] Env WEBUI_SESSION_ID: ${sessionId}`);
    console.log(`[SESSION] Env WEBUI_BACKEND_URL: http://localhost:${config.port}`);
    console.log(`[SESSION] Env WEBUI_PROJECT_PATH: ${session.working_directory}`);
    console.log(`[SESSION] ==============================================`);

    const extraEnv: Record<string, string> = {};
    if (cliProvider === 'pi' && piAgentDir) {
      extraEnv.PI_CODING_AGENT_DIR = piAgentDir;
      extraEnv.PI_TELEMETRY = '0';
      extraEnv.PI_SKIP_VERSION_CHECK = '1';
      Object.assign(extraEnv, await buildOpenCodeProviderCredentialEnv(userId));
    }
    extraEnv.WEBUI_SESSION_MODE = effectiveMode;
    extraEnv.WEBUI_CONFIG_HOME = configHome;
    Object.assign(extraEnv, await buildIntegrationEnv());
    Object.assign(extraEnv, await buildAndroidDeviceEnvForSession(sessionId, userId));
    // Use regular spawn for CLI providers
    const proc: ChildProcess = spawnManagedProcess(providerConfig.command, args, {
      cwd: session.working_directory,
      env: {
        ...(isClaudeTransportProvider(cliProvider)
          ? await buildClaudeTransportEnv(cliProvider, userId, configHome, sessionId)
          : process.env),
        ...extraEnv,
        // Pass session ID so provider integrations can attribute image generation and permissions.
        WEBUI_SESSION_ID: sessionId,
        // Pass backend URL for permission-prompt script
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        // Pass project path for loading project-specific settings
        WEBUI_PROJECT_PATH: session.working_directory,
        // Shared secret the permission-prompt script sends back in a header so
        // the backend can distinguish real hook calls from forged requests.
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const claudeProcess: ClaudeProcess = {
      process: proc,
      sessionId,
      providerChatId: session.active_chat_id,
      currentChatId: session.active_chat_id,
      cliProvider,
      userId,
      workingDirectory: session.working_directory,
      claudeSessionId: session.claude_session_id,
      buffer: '',
      streamingText: '',
      isStreaming: false,
      // Permission mode
      mode: effectiveMode,
      // Tool tracking
      currentToolName: null,
      currentToolId: null,
      currentToolInput: '',
      currentActivitySummary: null,
      pendingToolResults: new Map(),
      // Agent tracking
      currentAgentType: null,
      currentAgentDescription: null,
      subagentRuns: new Map(),
      // Usage tracking defaults
      model: selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel || 'unknown',
      contextWindow: contextWindowFor(selectedModel || CLI_PROVIDERS[cliProvider]?.defaultModel),
      // Per-turn usage (for context display)
      turnInputTokens: 0,
      turnCacheReadTokens: 0,
      turnCacheCreationTokens: 0,
      turnOutputTokens: 0,
      // Cumulative session usage (for cost tracking)
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCostUsd: 0,
      previousTotalCostUsd: 0,
      // Only need reminder for resumed sessions
      needsWorkingDirReminder: isResuming,
      contextReminder: this.pendingContextReminders.get(sessionId) || null,
      // Reconnect buffer
      outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
      lastActivityAt: Date.now(),
      disconnectedAt: null,
      // Permission approval tracking
      lastUserMessage: null,
      lastAttachments: null,
      pendingPermissionDenials: null,
      pendingChatMedia: [],
      sharedContextInjected: false,
      modePromptInjected: null,
      lastContextLimitAt: undefined,
    };

    this.pendingContextReminders.delete(sessionId);

    this.processes.set(sessionId, claudeProcess);

    await pgRun(
      'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      'running',
      sessionId
    );

    this.emitStatus(sessionId, {
      sessionId,
      status: 'running',
    });

    // Handle stdout - JSON messages
    proc.stdout?.on('data', async (data: Buffer) => {
      await this.handleJsonOutput(sessionId, data.toString());
    });

    if (cliProvider === 'pi') {
      // Capture Pi's native session id/model after RPC initialization. The
      // response is handled by translatePiMessage and persisted for resume.
      setTimeout(() => {
        const managed = this.processes.get(sessionId);
        if (managed === claudeProcess && managed.process.stdin?.writable) {
          managed.process.stdin.write(
            `${JSON.stringify({ id: 'webui-init', type: 'get_state' })}\n`
          );
        }
      }, 150);
    }

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`${providerConfig.name} stderr [${sessionId}]:`, data.toString());
    });

    proc.on('exit', async (exitCode) => {
      console.log(
        `${providerConfig.name} process for session ${sessionId} exited with code ${exitCode}`
      );
      const managedProc = this.processes.get(sessionId);
      // A detached child's late exit must not act on its replacement: it would
      // persist the new process's half-streamed text as a truncated message
      // and book its usage against the wrong turn.
      if (managedProc && managedProc.process === proc) {
        // A Codex exec killed mid-turn never emits turn.completed, so book what
        // it already spent before the process state is torn down.
        await this.flushCodexUsageOnExit(sessionId, managedProc);
        // For providers that don't send a result message,
        // save any remaining streaming text and stop thinking indicator
        if (managedProc.streamingText?.trim().length) {
          await this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
        }
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
      }
      await this.cleanupProcess(sessionId, claudeProcess);
    });

    proc.on('error', async (err) => {
      console.error(`${providerConfig.name} process error [${sessionId}]:`, err);
      await this.notifyDiscordSessionEvent(sessionId, {
        eventType: 'session.error',
        severity: 'error',
        title: 'Session process error',
        summary: err.message,
      });

      await this.cleanupProcess(sessionId, claudeProcess);
    });
  }

  private async handleJsonOutput(sessionId: string, data: string): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    proc.buffer += data;

    // A multi-megabyte stream-json line arrives in ~64KB chunks; splitting the
    // whole accumulated buffer per chunk is quadratic in the line size. Only
    // split once this chunk actually completed a line.
    if (!data.includes('\n')) {
      if (proc.buffer.length > MAX_STREAM_LINE_BUFFER_BYTES) {
        console.warn(
          `[STREAM] Dropping ${proc.buffer.length}-byte partial line without newline [${sessionId}] (${proc.cliProvider}); exceeds ${MAX_STREAM_LINE_BUFFER_BYTES}-byte cap`
        );
        proc.buffer = '';
      }
      return;
    }

    // Process complete JSON lines
    const lines = proc.buffer.split('\n');
    proc.buffer = lines.pop() || ''; // Keep incomplete line in buffer
    if (proc.buffer.length > MAX_STREAM_LINE_BUFFER_BYTES) {
      console.warn(
        `[STREAM] Dropping ${proc.buffer.length}-byte partial line without newline [${sessionId}] (${proc.cliProvider}); exceeds ${MAX_STREAM_LINE_BUFFER_BYTES}-byte cap`
      );
      proc.buffer = '';
    }

    for (const line of lines) {
      if (!line.trim()) continue;

      let raw: unknown;
      try {
        raw = JSON.parse(line) as unknown;
      } catch {
        // Not valid JSON, emit as raw output for debugging (skip noisy Codex/OpenCode output)
        console.log(`Non-JSON output [${sessionId}]:`, line);
        if (
          proc.cliProvider !== 'codex' &&
          proc.cliProvider !== 'opencode' &&
          proc.cliProvider !== 'pi' &&
          proc.cliProvider !== 'kimi'
        ) {
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            chatId: this.processes.get(sessionId)?.currentChatId,
            content: line + '\n',
            isComplete: false,
          });
        }
        continue;
      }

      // The line parsed; any failure past this point is a real processing bug
      // and must never be misreported (or re-emitted to the chat) as raw
      // non-JSON provider noise.
      try {
        if (proc.cliProvider === 'pi') {
          const translated = await this.translatePiMessage(sessionId, raw);
          if (Array.isArray(translated)) {
            for (const msg of translated) await this.processStreamMessage(sessionId, msg);
          } else if (translated) {
            await this.processStreamMessage(sessionId, translated);
          }
          continue;
        }
        if (proc.cliProvider === 'codex') {
          const translated = await this.translateCodexMessage(sessionId, raw);
          if (Array.isArray(translated)) {
            for (const msg of translated) {
              await this.processStreamMessage(sessionId, msg);
            }
          } else if (translated) {
            await this.processStreamMessage(sessionId, translated);
          }
          continue;
        }
        if (proc.cliProvider === 'kimi') {
          await this.processKimiLine(sessionId, proc, raw);
          continue;
        }
        await this.processStreamMessage(sessionId, raw as StreamJsonMessage);
      } catch (err) {
        console.error(
          `[STREAM] Failed to process ${proc.cliProvider} message [${sessionId}]:`,
          err
        );
      }
    }
  }

  /** Translate Pi RPC events into the WebUI's existing streaming vocabulary. */
  private async translatePiMessage(
    sessionId: string,
    raw: unknown
  ): Promise<StreamJsonMessage | StreamJsonMessage[] | null> {
    if (!raw || typeof raw !== 'object') return null;
    const event = raw as Record<string, unknown>;
    const proc = this.processes.get(sessionId);
    if (!proc || proc.cliProvider !== 'pi') return null;

    const type = typeof event.type === 'string' ? event.type : '';
    const message = isRecordValue(event.message) ? event.message : null;

    // Any turn-progress event means Pi picked the work back up on its own, so a
    // pending post-compaction nudge would only duplicate work.
    if (PI_TURN_PROGRESS_EVENTS.has(type)) this.clearPiCompactResumeTimer(proc);

    if (type === 'response') {
      const success = event.success !== false;
      const command = typeof event.command === 'string' ? event.command : '';
      const data = isRecordValue(event.data) ? event.data : null;
      if (!success) {
        const error =
          typeof event.error === 'string'
            ? event.error
            : isRecordValue(event.error) && typeof event.error.message === 'string'
              ? event.error.message
              : `Pi RPC command ${command || 'unknown'} failed`;
        this.io.to(`session:${sessionId}`).emit('session:error', { sessionId, error });
        return null;
      }
      if (command === 'get_state' && data) {
        const nativeSessionId =
          typeof data.sessionId === 'string'
            ? data.sessionId
            : typeof data.sessionFile === 'string'
              ? path.basename(data.sessionFile, path.extname(data.sessionFile))
              : null;
        if (nativeSessionId && nativeSessionId !== proc.claudeSessionId) {
          proc.claudeSessionId = nativeSessionId;
          await pgRun(
            'UPDATE sessions SET claude_session_id = ? WHERE id = ?',
            nativeSessionId,
            sessionId
          );
        }
        const stateModel = isRecordValue(data.model) ? data.model : null;
        if (stateModel) {
          const provider = typeof stateModel.provider === 'string' ? stateModel.provider : '';
          const modelId = typeof stateModel.id === 'string' ? stateModel.id : '';
          const fullModel = provider && modelId ? `${provider}/${modelId}` : modelId;
          if (fullModel) proc.model = fullModel;
          if (typeof stateModel.contextWindow === 'number' && stateModel.contextWindow > 0) {
            proc.contextWindow = stateModel.contextWindow;
          }
        }
      }
      return null;
    }

    if (type === 'agent_start') {
      proc.isStreaming = true;
      proc.currentActivitySummary = 'Agent working';
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });
      return null;
    }

    if (type === 'message_start' && message?.role === 'assistant') {
      proc.isStreaming = true;
      proc.streamingText = '';
      proc.currentActivitySummary = 'Writing response';
      return { type: 'content_block_start' };
    }

    if (type === 'message_update') {
      const update = isRecordValue(event.assistantMessageEvent)
        ? event.assistantMessageEvent
        : null;
      if (update?.type === 'text_delta' && typeof update.delta === 'string' && update.delta) {
        return { type: 'content_block_delta', delta: { type: 'text_delta', text: update.delta } };
      }
      return null;
    }

    if (type === 'message_end' && message?.role === 'assistant') {
      this.capturePiUsage(proc, message);
      if (proc.streamingText.trim()) return { type: 'content_block_stop' };
      const content = piMessageText(message.content);
      return content
        ? {
            type: 'assistant',
            message: { role: 'assistant', content },
          }
        : null;
    }

    if (type === 'tool_execution_start') {
      const toolCallId =
        typeof event.toolCallId === 'string' ? event.toolCallId : `pi-tool-${nanoid()}`;
      const toolName = typeof event.toolName === 'string' ? event.toolName : 'unknown';
      const args = event.args;
      proc.currentToolId = toolCallId;
      proc.currentToolName = toolName;
      proc.pendingToolResults.set(toolCallId, { toolName, input: args });

      if (toolName.toLowerCase() === 'subagent' && isRecordValue(args)) {
        const firstTask =
          Array.isArray(args.tasks) && isRecordValue(args.tasks[0]) ? args.tasks[0] : null;
        const agentType =
          typeof args.agent === 'string'
            ? args.agent
            : firstTask && typeof firstTask.agent === 'string'
              ? firstTask.agent
              : 'subagent';
        const description =
          typeof args.task === 'string'
            ? args.task
            : firstTask && typeof firstTask.task === 'string'
              ? firstTask.task
              : undefined;
        this.startSubagentRun(sessionId, proc, {
          agentId: toolCallId,
          agentType,
          description,
          toolId: toolCallId,
        });
      }

      return { type: 'tool_use', tool_use: { id: toolCallId, name: toolName } };
    }

    if (type === 'tool_execution_end') {
      const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
      const pending = toolCallId ? proc.pendingToolResults.get(toolCallId) : undefined;
      const result = piToolResultText(event.result);
      const isError = event.isError === true;
      this.emitToolUse(sessionId, {
        sessionId,
        toolId: toolCallId || undefined,
        toolName:
          pending?.toolName || (typeof event.toolName === 'string' ? event.toolName : 'unknown'),
        status: isError ? 'error' : 'completed',
        input: pending?.input,
        result: result || undefined,
      });
      if (pending?.toolName.toLowerCase() === 'subagent') {
        this.completeSubagentRun(
          sessionId,
          proc,
          { toolId: toolCallId },
          isError ? { error: result || 'Pi subagent failed' } : { result }
        );
      }
      if (toolCallId) proc.pendingToolResults.delete(toolCallId);
      proc.currentToolId = null;
      proc.currentToolName = null;
      return null;
    }

    if (type === 'turn_end') {
      if (message) this.capturePiUsage(proc, message);
      proc.totalInputTokens += proc.turnInputTokens;
      proc.totalOutputTokens += proc.turnOutputTokens;
      proc.cacheReadTokens += proc.turnCacheReadTokens;
      proc.cacheCreationTokens += proc.turnCacheCreationTokens;
      const usage = message && isRecordValue(message.usage) ? message.usage : null;
      const cost = usage && isRecordValue(usage.cost) ? usage.cost : null;
      if (cost && typeof cost.total === 'number' && Number.isFinite(cost.total)) {
        proc.totalCostUsd += Math.max(0, cost.total);
      }
      proc.isStreaming = false;
      proc.piTurnInFlight = false;
      proc.piCompactContinuations = 0;
      return { type: 'result' };
    }

    if (type === 'compaction_start') {
      const reason = piCompactionReason(event.reason);
      await this.emitCompact(sessionId, {
        sessionId,
        message:
          reason === 'manual'
            ? 'Pi is compacting session context.'
            : `Pi is compacting session context (${reason}).`,
        reason: reason === 'overflow' ? 'context-limit' : 'auto-compact',
      });
      return null;
    }

    if (type === 'compaction_end') {
      return this.handlePiCompactionEnd(sessionId, proc, event);
    }

    if (type === 'agent_end') {
      proc.isStreaming = false;
      return null;
    }

    return null;
  }

  private clearPiCompactResumeTimer(proc: ClaudeProcess): void {
    if (!proc.piCompactResumeTimer) return;
    clearTimeout(proc.piCompactResumeTimer);
    proc.piCompactResumeTimer = undefined;
  }

  /**
   * Decide whether Pi needs a nudge after compaction.
   *
   * Pi resumes by itself in the overflow-recovery path (`willRetry`), and a
   * manual `/compact` has no turn to resume. Everything else used to leave the
   * turn dead with the thinking indicator stuck on: the compaction consumed the
   * turn, and the user's actual request was never finished. Schedule a nudge and
   * cancel it the moment Pi shows any sign of progress on its own.
   */
  private async handlePiCompactionEnd(
    sessionId: string,
    proc: ClaudeProcess,
    event: Record<string, unknown>
  ): Promise<StreamJsonMessage | null> {
    const reason = piCompactionReason(event.reason);
    const emitReason = reason === 'overflow' ? 'context-limit' : 'auto-compact';
    const stopThinking = () =>
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });

    if (event.aborted === true) {
      this.clearPiCompactResumeTimer(proc);
      proc.piTurnInFlight = false;
      proc.piCompactContinuations = 0;
      proc.isStreaming = false;
      await this.emitCompact(sessionId, {
        sessionId,
        message: 'Pi compaction was aborted; the turn did not continue.',
        reason: emitReason,
        error: typeof event.errorMessage === 'string' ? event.errorMessage : undefined,
      });
      stopThinking();
      return null;
    }

    this.resetCurrentContextUsage(proc);

    // Overflow recovery: Pi retries the aborted turn itself.
    if (event.willRetry === true) return null;

    if (!proc.piTurnInFlight) {
      // Manual `/compact` between turns. Nothing to resume, but the thinking
      // indicator was switched on when the command was written to stdin.
      stopThinking();
      return null;
    }

    const attempted = proc.piCompactContinuations ?? 0;
    if (attempted >= PI_MAX_COMPACT_CONTINUATIONS) {
      console.warn(
        `[PI] Compaction continue limit reached after ${attempted} attempts [${sessionId}]`
      );
      proc.piTurnInFlight = false;
      proc.isStreaming = false;
      await this.emitCompact(sessionId, {
        sessionId,
        message: `Pi compacted ${attempted} times without finishing the turn. Stopped auto-continuing — send a follow-up to resume.`,
        reason: emitReason,
      });
      stopThinking();
      return null;
    }

    this.clearPiCompactResumeTimer(proc);
    proc.piCompactResumeTimer = setTimeout(() => {
      const current = this.processes.get(sessionId);
      if (!current || current !== proc || current.cliProvider !== 'pi') return;
      current.piCompactResumeTimer = undefined;
      if (!current.piTurnInFlight) return;
      current.piCompactContinuations = (current.piCompactContinuations ?? 0) + 1;
      console.log(
        `[PI] Resuming turn after ${reason} compaction (attempt ${current.piCompactContinuations}) [${sessionId}]`
      );
      if (!current.process.stdin?.writable) return;
      current.process.stdin.write(formatInputMessage('pi', PI_COMPACT_CONTINUE_PROMPT));
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });
    }, PI_COMPACT_RESUME_DELAY_MS);

    return null;
  }

  private capturePiUsage(proc: ClaudeProcess, message: Record<string, unknown>): void {
    const usage = isRecordValue(message.usage) ? message.usage : null;
    if (!usage) return;
    proc.turnInputTokens = piUsageNumber(usage.input);
    proc.turnOutputTokens = piUsageNumber(usage.output);
    proc.turnCacheReadTokens = piUsageNumber(usage.cacheRead);
    proc.turnCacheCreationTokens = piUsageNumber(usage.cacheWrite);
    const provider = typeof message.provider === 'string' ? message.provider : '';
    const modelId = typeof message.model === 'string' ? message.model : '';
    if (modelId) proc.model = provider ? `${provider}/${modelId}` : modelId;
  }

  /**
   * Translate a Codex CLI JSON event (`codex exec --json` / app-server) to our
   * Socket.IO event vocabulary.
   *
   * Codex emits events in two notations depending on version/transport:
   *   - dot notation:   `item.completed`, `agent_message.delta`, `turn.started`
   *   - slash notation: `item/completed`, `item/agentMessage/delta`, `turn/started`
   *
   * Both are normalized to a single canonical form before switching.
   *
   * Event categories handled:
   *   - thread/turn lifecycle (capture sessionId, mark idle)
   *   - agent message deltas + completed (streaming text)
   *   - reasoning deltas + completed (thinking summaries)
   *   - tool events: commandExecution, fileChange, mcpToolCall, webSearch, imageView
   *   - plan updates (turn/plan/updated)
   *   - diff updates (turn/diff/updated) — currently informational, future work
   *   - context compaction, model rerouting, errors
   */
  private async translateCodexMessage(
    sessionId: string,
    raw: unknown
  ): Promise<StreamJsonMessage | null> {
    if (!raw || typeof raw !== 'object') return null;

    const envelope = raw as Record<string, unknown>;
    let normalizedRaw: Record<string, unknown> = envelope;
    if (envelope.payload && typeof envelope.payload === 'object') {
      const payload = envelope.payload as Record<string, unknown>;
      const envelopeType = typeof envelope.type === 'string' ? envelope.type : '';
      if (envelopeType === 'event_msg' || envelopeType === 'response_item') {
        normalizedRaw = payload;
      } else {
        normalizedRaw = { ...payload, type: envelopeType || payload.type };
      }
    }

    const data = normalizedRaw as {
      type?: string;
      // delta payloads
      delta?: string;
      text?: string;
      // shared id / thread context
      threadId?: string;
      turnId?: string;
      agentId?: string;
      agentType?: string;
      subagentType?: string;
      description?: string;
      call_id?: string;
      status?: string;
      saved_path?: string;
      revised_prompt?: string;
      result?: unknown;
      error?: unknown;
      // item payloads
      item?: {
        id?: string;
        type?: string;
        text?: string;
        delta?: string;
        // command execution
        command?: string | string[];
        cwd?: string;
        status?: string;
        aggregatedOutput?: string;
        exitCode?: number;
        durationMs?: number;
        // file change
        changes?: unknown;
        // mcp tool call
        server?: string;
        tool?: string;
        arguments?: unknown;
        result?: unknown;
        error?: unknown;
        // web search
        query?: string;
        action?: unknown;
        // image view
        path?: string;
        // reasoning
        summary?: string;
        content?: string;
      };
      thread?: { id?: string };
      turn?: { id?: string; status?: string };
      // plan update
      plan?: Array<{ step: string; status: string }>;
      explanation?: string;
      // diff
      diff?: string;
      // model reroute
      fromModel?: string;
      toModel?: string;
      reason?: string;
      model?: string;
      summary?: string;
      collaboration_mode?: { settings?: { model?: string } };
      // turn usage — Codex `turn.completed.usage` shape is:
      //   { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens }
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
      model_context_window?: number;
      info?: {
        model_context_window?: number;
        total_token_usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cached_input_tokens?: number;
          reasoning_output_tokens?: number;
          total_tokens?: number;
        };
        last_token_usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cached_input_tokens?: number;
          reasoning_output_tokens?: number;
          total_tokens?: number;
        };
      } | null;
      message?: string;
    };

    // Normalize event type: collapse `item/foo/bar` ↔ `item.foo.bar` to canonical
    // lowercase camelCase so a single switch covers both notations.
    //
    //   item/agentMessage/delta  →  item.agentmessage.delta
    //   item.commandExecution    →  item.commandexecution
    //   turn/plan/updated        →  turn.plan.updated
    const eventType = (data.type || '').replace(/\//g, '.').toLowerCase();

    switch (eventType) {
      // ── Generated image output ─────────────────────────────────────────
      // Codex imagegen writes the final raster under its managed
      // generated_images root and reports that path in this structured event.
      // Do not infer output media from imageView/custom tool output: imageView
      // represents an input the model inspected, not an artifact for the user.
      case 'image_generation_end':
      case 'image.generation.end':
      case 'imagegenerationend': {
        if (data.status !== 'completed' || !data.saved_path) return null;
        const codexProc = this.processes.get(sessionId);
        if (!codexProc || codexProc.cliProvider !== 'codex') return null;
        const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
        const pending = pendingMediaFromAllowedFile({
          filePath: data.saved_path,
          allowedRoot: path.join(codexHome, 'generated_images'),
          filename: path.basename(data.saved_path),
          altText: data.revised_prompt?.slice(0, 1000),
          source: 'provider',
          sourceId: data.call_id,
        });
        if (pending) appendPendingChatMedia(codexProc, pending);
        return null;
      }

      // ── Thread lifecycle ────────────────────────────────────────────────
      case 'session_meta':
      case 'thread.started': {
        const codexSessionId = extractCodexSessionId(data);
        if (codexSessionId) {
          const proc = this.processes.get(sessionId);
          if (proc && proc.cliProvider === 'codex' && !proc.codexSessionId) {
            proc.codexSessionId = codexSessionId;
            proc.claudeSessionId = codexSessionId;
            await pgRun(
              'UPDATE sessions SET claude_session_id = ? WHERE id = ?',
              codexSessionId,
              sessionId
            );
            console.log(`[CODEX] Captured session id ${codexSessionId} for ${sessionId}`);
          }
        }
        return null;
      }

      // ── Turn lifecycle ──────────────────────────────────────────────────
      case 'task.started':
      case 'task_started':
      case 'turn.started':
        {
          const codexProc = this.processes.get(sessionId);
          const reportedWindow = data.model_context_window;
          if (codexProc && typeof reportedWindow === 'number' && reportedWindow > 0) {
            codexProc.contextWindow = this.resolveObservedContextWindow(
              codexProc.model,
              reportedWindow
            );
          }
          if (codexProc) {
            codexProc.currentActivitySummary = 'Thinking through the turn';
          }
        }
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: true,
        });
        return null;

      case 'turn_context': {
        const codexProc = this.processes.get(sessionId);
        if (codexProc && codexProc.cliProvider === 'codex') {
          const model = data.model || data.collaboration_mode?.settings?.model;
          if (model) {
            codexProc.model = model;
            codexProc.contextWindow = contextWindowFor(model);
          }

          const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
          const compactSummary = this.normalizeCodexCompactSummary(summary);
          if (compactSummary && compactSummary !== codexProc.codexLastContextSummary) {
            codexProc.codexLastContextSummary = compactSummary;
            await this.applyCodexCompactContextUsage(sessionId, codexProc, data);
            await this.emitCompact(sessionId, {
              sessionId,
              message: 'Codex compacted prior context and resumed from a summary.',
              summary: compactSummary,
              reason: 'auto-compact',
            });
          } else if (summary) {
            codexProc.codexLastContextSummary = summary;
          }
        }
        return null;
      }

      case 'token_count': {
        const codexProc = this.processes.get(sessionId);
        if (!codexProc || codexProc.cliProvider !== 'codex') {
          return null;
        }

        const reportedWindow = data.info?.model_context_window ?? data.model_context_window;
        if (typeof reportedWindow === 'number' && reportedWindow > 0) {
          codexProc.contextWindow = this.resolveObservedContextWindow(
            codexProc.model,
            reportedWindow
          );
        }

        // `last_token_usage` is the current model-call prompt, which is what a
        // context window meter should show. `total_token_usage` is summed across
        // all model calls in the Codex exec turn and can legitimately exceed the
        // model context window; that belongs in analytics/cost, not the context bar.
        const totalUsage = data.info?.total_token_usage;
        if (totalUsage) {
          codexProc.codexTotalTokenUsage = {
            input: totalUsage.input_tokens ?? 0,
            cached: totalUsage.cached_input_tokens ?? 0,
            output: (totalUsage.output_tokens ?? 0) + (totalUsage.reasoning_output_tokens ?? 0),
          };
        }
        const lastUsage = data.info?.last_token_usage;
        if (lastUsage) {
          const contextInputTotal = lastUsage.input_tokens ?? 0;
          const contextCached = Math.min(lastUsage.cached_input_tokens ?? 0, contextInputTotal);
          const contextOutput = lastUsage.output_tokens ?? 0;
          const nextContextUsage = {
            input: contextInputTotal,
            cached: contextCached,
            output: contextOutput,
          };
          await this.maybeDetectCodexImplicitCompaction(sessionId, codexProc, nextContextUsage);
          this.applyCodexContextUsage(codexProc, {
            input: contextInputTotal,
            cached: contextCached,
            output: contextOutput,
          });
          codexProc.codexLastTokenUsage = nextContextUsage;
          codexProc.codexLastObservedContextUsage = nextContextUsage;
          codexProc.codexLastObservedContextWindow = this.resolveObservedContextWindow(
            codexProc.model,
            codexProc.contextWindow
          );
          codexProc.codexSawTokenCountThisTurn = true;
          await this.emitUsage(sessionId, codexProc);
        }
        return null;
      }

      case 'agent.started':
      case 'subagent.started': {
        const codexProc = this.processes.get(sessionId);
        if (!codexProc) return null;
        this.startSubagentRun(sessionId, codexProc, {
          agentId: data.agentId,
          agentType: data.agentType || data.subagentType || 'subagent',
          description: data.description || data.message,
          externalAgentId: data.agentId,
        });
        return null;
      }

      case 'agent.completed':
      case 'subagent.completed':
      case 'agent.failed':
      case 'subagent.failed': {
        const codexProc = this.processes.get(sessionId);
        if (!codexProc) return null;
        const failed = eventType.endsWith('.failed');
        this.completeSubagentRun(
          sessionId,
          codexProc,
          {
            agentId: data.agentId,
            externalAgentId: data.agentId,
            agentType: data.agentType || data.subagentType,
          },
          {
            status: failed ? 'error' : 'completed',
            result: data.result || data.message,
            error: failed ? data.error || data.message || 'Subagent failed' : undefined,
          }
        );
        return null;
      }

      case 'turn.completed':
      case 'turn.failed': {
        const codexProc = this.processes.get(sessionId);
        if (codexProc && codexProc.cliProvider === 'codex') {
          console.log(`[CODEX] ${eventType} received [${sessionId}]`);
          this.completeActiveSubagents(sessionId, codexProc, {
            status: eventType === 'turn.failed' ? 'error' : 'completed',
            error: eventType === 'turn.failed' ? data.message || 'Codex turn failed' : undefined,
          });
          codexProc.currentToolName = null;
          codexProc.currentToolId = null;
          codexProc.currentAgentType = null;
          codexProc.currentAgentDescription = null;
          codexProc.currentActivitySummary = null;
        }
        // `turn.failed` carries no usage payload, so an aborted turn used to
        // book nothing at all while still costing the full context. Recover the
        // counters from Codex's own thread state and record them without
        // synthesizing a `result` — the turn did not succeed.
        if (!data.usage && codexProc) {
          await this.flushCodexUsageOnExit(sessionId, codexProc);
          return null;
        }

        // Reasoning output tokens are billed like regular output upstream, so
        // fold them into output_tokens for cost calculation.
        const turnUsage: CodexUsageCounters | null =
          data.usage && codexProc
            ? {
                input: data.usage.input_tokens ?? 0,
                cached: data.usage.cached_input_tokens ?? 0,
                output: (data.usage.output_tokens ?? 0) + (data.usage.reasoning_output_tokens ?? 0),
              }
            : null;

        if (turnUsage && codexProc) {
          // Delta math, subagent-thread rollup and the Codex→Claude token-shape
          // split all live in applyCodexTurnUsage so the exit-time flush below
          // books an interrupted turn exactly the same way.
          const {
            nonCachedInput,
            cached: deltaCached,
            output: deltaOutput,
          } = await this.applyCodexTurnUsage(sessionId, codexProc, turnUsage);

          // If this Codex version did not emit token_count.last_token_usage, use
          // Codex's own persisted thread meter before falling back to billing
          // counters. The old prompt-length estimate badly under-reported long
          // transcript-prefix exec turns (for example 13K shown while Codex had
          // ~250K tokens in its thread state).
          if (!codexProc.codexSawTokenCountThisTurn) {
            const codexHome = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
            const threadState = await readCodexThreadState(codexHome, {
              threadId: codexProc.codexSessionId || codexProc.claudeSessionId,
              cwd: codexProc.workingDirectory,
              sinceMs: codexProc.codexExecStartedAtMs,
              promptPrefix: codexProc.codexLastPromptPrefix,
            });

            if (threadState) {
              if (!codexProc.codexSessionId && threadState.match !== 'cwd') {
                codexProc.codexSessionId = threadState.id;
                codexProc.claudeSessionId = threadState.id;
                try {
                  await pgRun(
                    'UPDATE sessions SET claude_session_id = ? WHERE id = ?',
                    threadState.id,
                    sessionId
                  );
                  console.log(
                    `[CODEX] Captured session id ${threadState.id} from Codex state for ${sessionId}`
                  );
                } catch (error) {
                  console.warn('[CODEX] Failed to persist Codex session id from state:', error);
                }
              }

              const threadContextUsage = {
                input: threadState.tokensUsed,
                cached: 0,
                output: 0,
              };
              await this.maybeDetectCodexImplicitCompaction(
                sessionId,
                codexProc,
                threadContextUsage
              );
              this.applyCodexContextUsage(codexProc, threadContextUsage);
              codexProc.codexLastObservedContextUsage = threadContextUsage;
              codexProc.codexLastObservedContextWindow = this.resolveObservedContextWindow(
                codexProc.model,
                codexProc.contextWindow
              );
            } else {
              const promptEstimate =
                typeof codexProc.codexLastPromptEstimateTokens === 'number'
                  ? codexProc.codexLastPromptEstimateTokens
                  : 0;
              // Billing deltas sum every model call in the turn and routinely
              // dwarf the real prompt footprint — using them here pinned the
              // context meter at 100% for heavy agentic turns. The last
              // observed context reading is a sound floor instead: absent
              // compaction, a session's context only grows.
              const prevObservedTotal = codexProc.codexLastObservedContextUsage
                ? this.getCodexContextUsageTotal(codexProc.codexLastObservedContextUsage)
                : 0;
              const estimatedInput = Math.max(promptEstimate, prevObservedTotal);
              const boundedContextInput = estimatedInput > 0 ? estimatedInput : deltaOutput;
              const boundedContextCached = Math.min(deltaCached, boundedContextInput);
              const estimatedContextUsage = {
                input: boundedContextInput,
                cached: boundedContextCached,
                output: deltaOutput,
              };
              this.applyCodexContextUsage(codexProc, estimatedContextUsage);
            }
          }

          const turnCostUsd = this.calculateTurnCost(codexProc);
          codexProc.previousTotalCostUsd = codexProc.totalCostUsd;
          codexProc.totalCostUsd += turnCostUsd;
          await this.emitUsage(sessionId, codexProc);

          return {
            type: 'result',
            usage: {
              input_tokens: nonCachedInput,
              output_tokens: deltaOutput,
              cache_read_input_tokens: deltaCached,
              cache_creation_input_tokens: 0,
            },
          };
        }
        return null;
      }

      // ── Agent message deltas (token-by-token streaming) ─────────────────
      // Variants we've seen in the wild across Codex versions:
      //   item.delta, item.text.delta, item.agentmessage.delta,
      //   agent_message.delta, text.delta, response.output_text.delta
      case 'item.delta':
      case 'item.text.delta':
      case 'item.agentmessage.delta':
      case 'agent_message.delta':
      case 'text.delta':
      case 'response.output_text.delta': {
        const chunk =
          (typeof data.delta === 'string' && data.delta) ||
          (typeof data.text === 'string' && data.text) ||
          (data.item && typeof data.item.delta === 'string' && data.item.delta) ||
          (data.item && typeof data.item.text === 'string' && data.item.text) ||
          '';
        if (!chunk) return null;
        const proc = this.processes.get(sessionId);
        if (proc) {
          proc.streamingText = (proc.streamingText || '') + chunk;
          proc.isStreaming = true;
          proc.currentActivitySummary = 'Writing response';
        }
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          chatId: proc?.currentChatId,
          content: chunk,
          isComplete: false,
        });
        return null;
      }

      // ── Reasoning deltas (live thinking) ────────────────────────────────
      case 'item.reasoning.delta':
      case 'reasoning.delta': {
        const chunk =
          (typeof data.delta === 'string' && data.delta) ||
          (data.item && typeof data.item.delta === 'string' && data.item.delta) ||
          '';
        if (!chunk) return null;
        const summary = this.formatCodexReasoning(chunk);
        if (summary) {
          const proc = this.processes.get(sessionId);
          if (proc) {
            proc.currentActivitySummary = summary;
          }
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: summary,
          });
        }
        return null;
      }

      // ── Command execution (shell tool) ──────────────────────────────────
      case 'item.started':
      case 'item.completed':
        return this.translateCodexItem(sessionId, data, eventType === 'item.completed');

      // ── Command output streaming ────────────────────────────────────────
      case 'item.commandexecution.outputdelta':
      case 'command.exec.outputdelta':
      case 'commandexecution.outputdelta': {
        const chunk = typeof data.delta === 'string' ? data.delta : '';
        if (!chunk) return null;
        // We surface command output as inline session:output for now. A future
        // enhancement could pipe to per-tool execution cards using the item.id.
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          chatId: this.processes.get(sessionId)?.currentChatId,
          content: chunk,
          isComplete: false,
        });
        return null;
      }

      // ── Plan updates (matches Claude's TodoWrite UX) ────────────────────
      case 'turn.plan.updated': {
        if (Array.isArray(data.plan)) {
          this.emitToolUse(sessionId, {
            sessionId,
            toolName: 'TodoWrite',
            status: 'completed',
            toolId: `codex-plan-${data.turnId || Date.now()}`,
            input: { todos: data.plan },
            result: data.explanation || '',
          });
        }
        return null;
      }

      // ── Diff updates (whole-turn unified diff snapshot) ─────────────────
      case 'turn.diff.updated':
        // Informational; could render a "files changed" preview. Skipping for now
        // — individual fileChange items already cover the per-edit detail.
        return null;

      // ── Context compaction (auto-summarization at context limits) ───────
      case 'context_compacted':
      case 'context_compaction':
      case 'context.compacted':
      case 'context.compaction':
      case 'contextcompaction':
      case 'contextcompact':
      case 'context.summary':
      case 'conversation.compacted':
      case 'conversation.compaction':
      case 'history.compacted':
      case 'history.compaction':
      case 'auto_compact':
      case 'auto.compact':
      case 'compact':
      case 'precompact':
      case 'pre_compact':
      case 'pre.compact':
      case 'compacted': {
        const codexProc = this.processes.get(sessionId);
        if (codexProc && codexProc.cliProvider === 'codex') {
          await this.applyCodexCompactContextUsage(sessionId, codexProc, data);
        }
        await this.emitCompact(sessionId, {
          sessionId,
          message: 'Context was compacted to reduce token usage',
          summary: typeof data.summary === 'string' ? data.summary : undefined,
          reason: 'auto-compact',
        });
        return null;
      }

      // ── Model rerouting (codex backend switched models on us) ───────────
      case 'model.rerouted': {
        const note = `\n[Codex rerouted ${data.fromModel || ''} → ${data.toModel || ''}${data.reason ? `: ${data.reason}` : ''}]\n`;
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          chatId: this.processes.get(sessionId)?.currentChatId,
          content: note,
          isComplete: false,
        });
        return null;
      }

      case 'error':
      case 'configwarning':
      case 'warning':
        if (data.message) {
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            chatId: this.processes.get(sessionId)?.currentChatId,
            content: `${data.message}\n`,
            isComplete: false,
          });
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * Translate an `item.started` / `item.completed` event into a tool-use lifecycle
   * notification or an assistant message. Covers commandExecution, fileChange,
   * mcpToolCall, webSearch, imageView, agentMessage, and reasoning items.
   */
  private translateCodexItem(
    sessionId: string,
    data: {
      item?: {
        id?: string;
        type?: string;
        text?: string;
        command?: string | string[];
        cwd?: string;
        status?: string;
        aggregatedOutput?: string;
        exitCode?: number;
        durationMs?: number;
        changes?: unknown;
        server?: string;
        tool?: string;
        arguments?: unknown;
        result?: unknown;
        error?: unknown;
        query?: string;
        action?: unknown;
        path?: string;
        summary?: string;
        content?: string;
      };
    },
    isCompleted: boolean
  ): StreamJsonMessage | null {
    const item = data.item;
    if (!item) return null;
    // Codex item types may be camelCase (`commandExecution`) or snake_case
    // (`command_execution`) — normalize for switching.
    const itemType = (item.type || '').replace(/_/g, '').toLowerCase();
    const itemId = item.id || `codex-${itemType}-${Date.now()}`;
    const proc = this.processes.get(sessionId);

    // Skip duplicate started events; track which item ids we've emitted started for.
    if (proc) {
      proc.codexEmittedTools = proc.codexEmittedTools || new Set<string>();
    }

    switch (itemType) {
      case 'agentmessage':
      case 'agent_message': {
        if (!isCompleted || !item.text) return null;
        // If we already streamed the full text via deltas, the streamingText buffer
        // ≈ item.text; persist as the canonical assistant message and clear buffer.
        if (proc?.streamingText && proc.streamingText.length >= item.text.length * 0.5) {
          proc.streamingText = '';
          proc.isStreaming = false;
        }
        return {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: item.text,
          },
        };
      }

      case 'reasoning': {
        if (!isCompleted) return null;
        const text = item.summary || item.text || item.content || '';
        if (!text) return null;
        const summary = this.formatCodexReasoning(text);
        if (summary) {
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: summary,
          });
        }
        return null;
      }

      case 'commandexecution': {
        const command = Array.isArray(item.command) ? item.command.join(' ') : item.command || '';
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: 'Bash',
              status: 'started',
              toolId: itemId,
              input: { command, description: item.cwd },
            });
          }
          return null;
        }
        const success = item.status === 'completed' && (item.exitCode ?? 0) === 0;
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: 'Bash',
          status: success ? 'completed' : 'error',
          toolId: itemId,
          input: { command, description: item.cwd },
          result: item.aggregatedOutput || '',
          error: success ? undefined : `exit ${item.exitCode ?? '?'}`,
        });
        return null;
      }

      case 'filechange': {
        const changes = item.changes;
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: 'Edit',
              status: 'started',
              toolId: itemId,
              input: { changes },
            });
          }
          return null;
        }
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: 'Edit',
          status: item.status === 'completed' ? 'completed' : 'error',
          toolId: itemId,
          input: { changes },
          result: typeof item.result === 'string' ? item.result : JSON.stringify(item.result ?? ''),
          error: item.error ? String(item.error) : undefined,
        });
        return null;
      }

      case 'mcptoolcall':
      case 'mcp_tool_call': {
        const toolName = `${item.server || 'mcp'}.${item.tool || 'tool'}`;
        const normalizedToolName = toolName.replace(/[^a-z0-9]/gi, '').toLowerCase();
        const isSpawnAgentTool = normalizedToolName.includes('spawnagent');
        const isWaitAgentTool = normalizedToolName.includes('waitagent');
        const isCloseAgentTool = normalizedToolName.includes('closeagent');
        if (isSpawnAgentTool && proc) {
          const agentType =
            this.getStringField(item.arguments, [
              'agent_type',
              'agentType',
              'agent',
              'agent_type_name',
              'name',
              'type',
            ]) || 'subagent';
          const description =
            this.getStringField(item.arguments, ['description', 'message', 'prompt', 'task']) ||
            `Running ${agentType} agent`;
          const externalAgentId = isCompleted
            ? this.getStringField(item.result, ['agent_id', 'agentId', 'id', 'target'])
            : undefined;
          this.startSubagentRun(sessionId, proc, {
            agentId: itemId,
            agentType,
            description,
            toolId: itemId,
            externalAgentId,
          });
        }
        if (isCompleted && proc && (isWaitAgentTool || isCloseAgentTool)) {
          const targets = this.getStringListField(item.arguments, [
            'targets',
            'target',
            'ids',
            'id',
          ]);
          if (targets.length > 0) {
            for (const target of targets) {
              this.completeSubagentRun(
                sessionId,
                proc,
                { externalAgentId: target },
                {
                  result: item.result,
                  error: item.error,
                  status: item.error ? 'error' : 'completed',
                }
              );
            }
          } else {
            this.completeActiveSubagents(sessionId, proc, {
              result: item.result,
              error: item.error,
              status: item.error ? 'error' : 'completed',
            });
          }
        }
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName,
              status: 'started',
              toolId: itemId,
              input: item.arguments,
            });
          }
          return null;
        }
        this.emitToolUse(sessionId, {
          sessionId,
          toolName,
          status: item.status === 'completed' ? 'completed' : 'error',
          toolId: itemId,
          input: item.arguments,
          result: typeof item.result === 'string' ? item.result : JSON.stringify(item.result ?? ''),
          error: item.error ? String(item.error) : undefined,
        });
        return null;
      }

      case 'websearch':
      case 'web_search': {
        if (!isCompleted) {
          if (proc && !proc.codexEmittedTools?.has(itemId)) {
            proc.codexEmittedTools?.add(itemId);
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: 'WebSearch',
              status: 'started',
              toolId: itemId,
              input: { query: item.query },
            });
          }
          return null;
        }
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: 'WebSearch',
          status: 'completed',
          toolId: itemId,
          input: { query: item.query, action: item.action },
        });
        return null;
      }

      case 'imageview':
      case 'image_view':
        if (isCompleted && item.path) {
          this.emitToolUse(sessionId, {
            sessionId,
            toolName: 'Read',
            status: 'completed',
            toolId: itemId,
            input: { file_path: item.path },
          });
        }
        return null;

      case 'usermessage':
      case 'user_message':
        // Echo of the user input we just sent — ignore, we already persisted it.
        return null;

      default:
        return null;
    }
  }

  private formatCodexReasoning(text: string): string {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return '';
    const stripMd = (value: string) =>
      value
        .replace(/\*\*/g, '')
        .replace(/^#+\s*/, '')
        .trim();
    const firstLine = lines[0] ?? '';
    let candidate = stripMd(firstLine);
    if (candidate.length < 8 && lines[1]) {
      candidate = stripMd(lines[1]);
    }
    const trimmed = candidate.replace(/\s+/g, ' ').trim();
    if (!trimmed) return '';
    return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
  }

  /**
   * Translate a single opencode SSE event into our Socket.IO event stream.
   *
   * The OpenCode server emits `message.part.updated` many times per turn — once
   * per delta for streaming text/reasoning, once per state transition for tools
   * (pending → running → completed|error), and for step-start/step-finish
   * boundaries. `session.idle` marks the turn's end, at which point we finalize
   * the streaming buffer and persist the assistant message.
   */
  private rememberOpenCodeMessage(proc: ClaudeProcess, messageId: string): void {
    const order = (proc.opencodeMessageOrder ??= []);
    if (!order.includes(messageId)) order.push(messageId);
  }

  private async flushOpenCodeAssistantMessage(
    sessionId: string,
    proc: ClaudeProcess,
    messageId: string
  ): Promise<boolean> {
    const streams = proc.partStreams;
    if (!streams) return false;

    const chunks: string[] = [];
    const flushedEntries: OpenCodePartStreamEntry[] = [];
    for (const entry of streams.values()) {
      if (entry.type !== 'text' || entry.messageId !== messageId) continue;
      const cleaned = entry.cleaned ?? entry.text;
      const previousLength = entry.savedCleanedLength ?? 0;
      if (cleaned.length <= previousLength) continue;
      const unsaved = cleaned.slice(previousLength).trim();
      if (unsaved) chunks.push(unsaved);
      flushedEntries.push(entry);
    }

    for (const entry of flushedEntries) {
      entry.savedCleanedLength = (entry.cleaned ?? entry.text).length;
    }

    const content = chunks.join('\n').trim();
    if (!content) return false;

    this.io.to(`session:${sessionId}`).emit('session:output', {
      sessionId,
      chatId: proc.currentChatId,
      content: '',
      isComplete: true,
    });
    await this.saveAssistantMessage(sessionId, content);
    if (proc.opencodeActiveMessageId === messageId) {
      proc.opencodeActiveMessageId = null;
    }
    return true;
  }

  private async flushAllOpenCodeAssistantMessages(
    sessionId: string,
    proc: ClaudeProcess
  ): Promise<void> {
    const streams = proc.partStreams;
    if (!streams || streams.size === 0) return;

    const ordered = proc.opencodeMessageOrder ?? [];
    const seen = new Set<string>();
    for (const messageId of ordered) {
      seen.add(messageId);
      await this.flushOpenCodeAssistantMessage(sessionId, proc, messageId);
    }
    for (const entry of streams.values()) {
      if (seen.has(entry.messageId)) continue;
      seen.add(entry.messageId);
      await this.flushOpenCodeAssistantMessage(sessionId, proc, entry.messageId);
    }
  }

  private async processOpencodeTextChunk(
    sessionId: string,
    proc: ClaudeProcess,
    partId: string,
    messageId: string,
    rawChunk: string
  ): Promise<void> {
    if (!rawChunk) return;
    this.rememberOpenCodeMessage(proc, messageId);
    if (proc.opencodeActiveMessageId && proc.opencodeActiveMessageId !== messageId) {
      await this.flushOpenCodeAssistantMessage(sessionId, proc, proc.opencodeActiveMessageId);
    }
    proc.opencodeActiveMessageId = messageId;

    const streams = (proc.partStreams ??= new Map());
    const existing = streams.get(partId);
    const entry = existing ?? {
      type: 'text' as const,
      messageId,
      text: '',
      thoughtState: { inside: false, pending: '' },
    };
    entry.messageId = entry.messageId || messageId;
    entry.thoughtState ??= { inside: false, pending: '' };

    entry.text += rawChunk;
    const { state: nextState, emit } = stripThoughtChunk(entry.thoughtState, rawChunk);
    entry.thoughtState = nextState;
    entry.cleaned = (entry.cleaned ?? '') + emit;
    streams.set(partId, entry);

    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: nextState.inside,
    });

    if (emit) {
      proc.isStreaming = true;
      proc.currentActivitySummary = 'Writing response';
      if (process.env.OPENCODE_DEBUG_EVENTS === '1') {
        console.log(
          `[OC-EMIT] session=${sessionId} partId=${partId} chunk=${JSON.stringify(emit).slice(0, 80)} totalCleaned=${entry.cleaned.length}`
        );
      }
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        chatId: proc.currentChatId,
        content: emit,
        isComplete: false,
      });
    }
  }

  private async translateOpencodeServerEvent(
    sessionId: string,
    event: OpencodeEvent
  ): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      if (process.env.OPENCODE_DEBUG_EVENTS === '1') {
        console.log(`[OC-TRANSLATE] no proc for sessionId=${sessionId} type=${event.type}`);
      }
      return;
    }

    const type = event.type;
    const props = (event.properties ?? {}) as Record<string, unknown>;

    switch (type) {
      case 'session.status': {
        const status = props.status as { type?: string } | undefined;
        if (status?.type === 'busy') {
          proc.opencodeIdle = false;
          proc.currentActivitySummary = proc.currentActivitySummary || 'OpenCode is starting';
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: proc.currentActivitySummary,
          });
        } else if (status?.type === 'idle') {
          proc.opencodeIdle = true;
          proc.currentToolName = null;
          proc.currentToolId = null;
          proc.currentActivitySummary = null;
          this.io
            .to(`session:${sessionId}`)
            .emit('session:thinking', { sessionId, isThinking: false });
          this.emitQueueState(sessionId, proc);
        }
        return;
      }

      case 'session.idle': {
        void this.finalizeOpenCodeTurn(sessionId, proc);
        return;
      }

      case 'permission.asked': {
        const requestId = typeof props.id === 'string' ? props.id : undefined;
        const providerSessionId =
          typeof props.sessionID === 'string' ? (props.sessionID as string) : undefined;
        const permission = typeof props.permission === 'string' ? props.permission : 'tool';
        const patterns = Array.isArray(props.patterns)
          ? props.patterns.filter((item): item is string => typeof item === 'string')
          : [];
        const metadata = props.metadata ?? {};
        if (!requestId) return;
        await recordAudit({
          actorUserId: proc.userId,
          action: 'permission.request',
          resourceType: 'session',
          resourceId: sessionId,
          metadata: {
            provider: 'opencode',
            requestId,
            toolName: permission,
            pattern: patterns[0] || null,
          },
        });
        const permissionEvent = {
          sessionId,
          requestId,
          providerSessionId,
          toolName: permission,
          toolInput: metadata,
          description: `OpenCode requests ${permission}${patterns[0] ? `: ${patterns[0]}` : ''}`,
          suggestedPattern: patterns[0] || `${permission}:*`,
        };
        this.emitBufferedEvent(sessionId, 'permission_request', permissionEvent, (sequenced) => {
          this.io.to(`session:${sessionId}`).emit('session:permission_request', sequenced);
        });
        await this.notifyDiscordSessionEvent(sessionId, {
          eventType: 'session.permission_requested',
          severity: 'warning',
          title: 'Session needs permission',
          summary: `OpenCode requests ${permission}${patterns[0] ? `: ${patterns[0]}` : ''}`,
          fields: [{ name: 'Request', value: requestId, inline: true }],
        });
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'permission.v2.asked': {
        const requestId = typeof props.id === 'string' ? props.id : undefined;
        const providerSessionId =
          typeof props.sessionID === 'string' ? (props.sessionID as string) : undefined;
        const action = typeof props.action === 'string' ? props.action : 'permission';
        const resources = Array.isArray(props.resources)
          ? props.resources.filter((item): item is string => typeof item === 'string')
          : [];
        const metadata = props.metadata ?? {};
        if (!requestId) return;
        await recordAudit({
          actorUserId: proc.userId,
          action: 'permission.request',
          resourceType: 'session',
          resourceId: sessionId,
          metadata: {
            provider: 'opencode',
            requestId,
            toolName: action,
            pattern: resources[0] || null,
          },
        });
        const permissionEvent = {
          sessionId,
          requestId,
          providerSessionId,
          toolName: action,
          toolInput: { action, resources, metadata, source: props.source ?? null },
          description: `OpenCode requests ${action}${resources[0] ? `: ${resources[0]}` : ''}`,
          suggestedPattern: resources[0] || `${action}:*`,
        };
        this.emitBufferedEvent(sessionId, 'permission_request', permissionEvent, (sequenced) => {
          this.io.to(`session:${sessionId}`).emit('session:permission_request', sequenced);
        });
        await this.notifyDiscordSessionEvent(sessionId, {
          eventType: 'session.permission_requested',
          severity: 'warning',
          title: 'Session needs permission',
          summary: `OpenCode requests ${action}${resources[0] ? `: ${resources[0]}` : ''}`,
          fields: [{ name: 'Request', value: requestId, inline: true }],
        });
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'question.asked':
      case 'question.v2.asked': {
        const requestId = typeof props.id === 'string' ? props.id : undefined;
        const providerSessionId =
          typeof props.sessionID === 'string' ? (props.sessionID as string) : undefined;
        const rawQuestions = Array.isArray(props.questions) ? props.questions : [];
        if (!requestId || rawQuestions.length === 0) return;
        const questions = rawQuestions.map((item, index) => {
          const question = item as Record<string, unknown>;
          const options = Array.isArray(question.options)
            ? question.options.map((option, optionIndex) => {
                const opt = option as Record<string, unknown>;
                return {
                  label:
                    typeof opt.label === 'string' && opt.label.trim()
                      ? opt.label
                      : `Option ${optionIndex + 1}`,
                  description: typeof opt.description === 'string' ? opt.description : undefined,
                };
              })
            : [];
          return {
            question:
              typeof question.question === 'string' ? question.question : 'OpenCode needs input.',
            header:
              typeof question.header === 'string' && question.header.trim()
                ? question.header
                : `Question ${index + 1}`,
            options,
            multiple: question.multiple === true,
            custom: question.custom === true,
          };
        });
        const questionEvent = {
          sessionId,
          requestId,
          providerSessionId,
          questions,
        };
        this.emitBufferedEvent(sessionId, 'question', questionEvent, (sequenced) => {
          this.io.to(`session:${sessionId}`).emit('session:question_request', sequenced);
        });
        await this.notifyDiscordSessionEvent(sessionId, {
          eventType: 'session.needs_input',
          severity: 'warning',
          title: 'Session needs input',
          summary: questions.map((question) => question.question).join('\n'),
          fields: [{ name: 'Request', value: requestId, inline: true }],
        });
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'todo.updated': {
        const todos = Array.isArray(props.todos)
          ? props.todos.reduce<TodoItem[]>((acc, todo) => {
              const item = todo as Record<string, unknown>;
              const content = typeof item.content === 'string' ? item.content : '';
              if (!content.trim()) return acc;
              const next: TodoItem = {
                content,
                status: normalizeOpenCodeTodoStatus(item.status),
              };
              if (typeof item.activeForm === 'string') next.activeForm = item.activeForm;
              acc.push(next);
              return acc;
            }, [])
          : [];
        const todosEvent = { sessionId, todos };
        this.emitBufferedEvent(sessionId, 'todos', todosEvent, (sequenced) => {
          this.io.to(`session:${sessionId}`).emit('session:todos', sequenced);
        });
        return;
      }

      case 'session.diff': {
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: 'OpenCodeDiff',
          status: 'completed',
          toolId: typeof event.id === 'string' ? event.id : `opencode-diff-${Date.now()}`,
          input: { files: Array.isArray(props.diff) ? props.diff.length : 0 },
          result: summarizeOpenCodeDiff(props.diff),
        });
        return;
      }

      case 'session.next.compaction.started': {
        proc.opencodeCompactionText = '';
        proc.currentActivitySummary = 'Compacting context';
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: true,
          message: proc.currentActivitySummary,
        });
        return;
      }

      case 'session.next.compaction.delta': {
        const text = typeof props.text === 'string' ? props.text : '';
        if (text) proc.opencodeCompactionText = `${proc.opencodeCompactionText ?? ''}${text}`;
        return;
      }

      case 'session.next.compaction.ended':
      case 'session.compacted': {
        proc.totalInputTokens = 0;
        proc.totalOutputTokens = 0;
        proc.cacheReadTokens = 0;
        proc.cacheCreationTokens = 0;
        this.resetCurrentContextUsage(proc);
        await this.emitUsage(sessionId, proc);
        const compactText =
          typeof props.text === 'string' && props.text.trim()
            ? props.text
            : proc.opencodeCompactionText;
        proc.opencodeCompactionText = '';
        const justEmittedManual =
          proc.opencodeLastManualCompactAt &&
          Date.now() - proc.opencodeLastManualCompactAt < 10_000;
        if (!justEmittedManual) {
          await this.emitCompact(sessionId, {
            sessionId,
            message: 'OpenCode compacted session context.',
            summary: compactText || undefined,
            reason: 'auto-compact',
          });
        }
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'session.error': {
        const err = props.error as { data?: { message?: string }; message?: string } | undefined;
        const message = err?.data?.message || err?.message || 'OpenCode session error';
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          chatId: proc.currentChatId,
          content: `${message}\n`,
          isComplete: true,
        });
        await this.notifyDiscordSessionEvent(sessionId, {
          eventType: 'session.error',
          severity: 'error',
          title: 'OpenCode session error',
          summary: message,
        });
        this.io
          .to(`session:${sessionId}`)
          .emit('session:thinking', { sessionId, isThinking: false });
        return;
      }

      case 'message.part.updated': {
        const part = props.part as Record<string, unknown> | undefined;
        const delta = typeof props.delta === 'string' ? (props.delta as string) : undefined;
        if (!part) return;
        const partType = part.type as string;
        const partId = part.id as string;
        const messageId =
          (typeof part.messageID === 'string' ? (part.messageID as string) : undefined) ||
          (typeof part.messageId === 'string' ? (part.messageId as string) : undefined) ||
          partId;

        if (partType === 'text') {
          let rawChunk = delta ?? '';
          if (!rawChunk) {
            const fullText = (part.text as string) ?? '';
            const existing = proc.partStreams?.get(partId);
            if (fullText.length > (existing?.text?.length ?? 0)) {
              rawChunk = fullText.slice(existing?.text?.length ?? 0);
            }
          }
          await this.processOpencodeTextChunk(sessionId, proc, partId, messageId, rawChunk);
          return;
        }

        if (partType === 'reasoning') {
          const fullText = (part.text as string) ?? '';
          if (!fullText.trim()) return;
          const summary = this.formatCodexReasoning(fullText);
          proc.currentActivitySummary = summary || 'Thinking through the turn';
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: proc.currentActivitySummary,
          });
          return;
        }

        if (partType === 'tool') {
          const callId = (part.callID as string) || partId;
          const toolName = part.tool as string;
          const state = part.state as
            | { status?: string; input?: unknown; output?: string; error?: string }
            | undefined;
          if (!toolName || !state) return;
          const emittedTools = (proc.emittedTools ??= new Set());

          if (state.status === 'pending' || state.status === 'running') {
            await this.flushOpenCodeAssistantMessage(
              sessionId,
              proc,
              proc.opencodeActiveMessageId || messageId
            );
            if (!emittedTools.has(callId)) {
              emittedTools.add(callId);
              this.emitToolUse(sessionId, {
                sessionId,
                toolName,
                status: 'started',
                toolId: callId,
                input: state.input,
              });
            }
            return;
          }

          if (state.status === 'completed') {
            const output =
              typeof state.output === 'string' ? state.output : JSON.stringify(state.output ?? '');
            this.emitToolUse(sessionId, {
              sessionId,
              toolName,
              status: 'completed',
              toolId: callId,
              input: state.input,
              result: output,
            });
            return;
          }

          if (state.status === 'error') {
            this.emitToolUse(sessionId, {
              sessionId,
              toolName,
              status: 'error',
              toolId: callId,
              input: state.input,
              error: state.error || 'Tool error',
            });
            return;
          }
          return;
        }

        if (partType === 'step-start') {
          this.rememberOpenCodeMessage(proc, messageId);
          proc.currentActivitySummary = 'Working through the next step';
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
            message: proc.currentActivitySummary,
          });
          return;
        }

        if (partType === 'step-finish') {
          const tokens = part.tokens as
            | {
                input?: number;
                output?: number;
                reasoning?: number;
                cache?: { read?: number; write?: number };
              }
            | undefined;
          const cost = typeof part.cost === 'number' ? (part.cost as number) : 0;
          if (tokens) {
            proc.turnInputTokens += tokens.input ?? 0;
            proc.turnOutputTokens += (tokens.output ?? 0) + (tokens.reasoning ?? 0);
            proc.turnCacheReadTokens += tokens.cache?.read ?? 0;
            proc.turnCacheCreationTokens += tokens.cache?.write ?? 0;
            proc.totalInputTokens += tokens.input ?? 0;
            proc.totalOutputTokens += (tokens.output ?? 0) + (tokens.reasoning ?? 0);
            proc.cacheReadTokens += tokens.cache?.read ?? 0;
            proc.cacheCreationTokens += tokens.cache?.write ?? 0;
            // Context is the latest model request, while turn* is billed usage
            // summed across every tool/subagent step.
            proc.contextInputTokens = tokens.input ?? 0;
            proc.contextOutputTokens = (tokens.output ?? 0) + (tokens.reasoning ?? 0);
            proc.contextCacheReadTokens = tokens.cache?.read ?? 0;
            proc.contextCacheCreationTokens = tokens.cache?.write ?? 0;
          }
          if (cost > 0) {
            proc.previousTotalCostUsd = proc.totalCostUsd;
            proc.totalCostUsd += cost;
            proc.turnCostUsd = (proc.turnCostUsd ?? 0) + cost;
          }
          await this.emitUsage(sessionId, proc);
          await this.flushOpenCodeAssistantMessage(
            sessionId,
            proc,
            proc.opencodeActiveMessageId || messageId
          );
          return;
        }
        return;
      }

      case 'message.part.delta': {
        // Streaming text chunk. Shape: { sessionID, messageID, partID, field, delta }.
        // Only text deltas need to reach the UI; other fields are metadata updates.
        const field = typeof props.field === 'string' ? (props.field as string) : undefined;
        if (field !== 'text') return;
        const partId = typeof props.partID === 'string' ? (props.partID as string) : undefined;
        const messageId =
          (typeof props.messageID === 'string' ? (props.messageID as string) : undefined) ||
          (typeof props.messageId === 'string' ? (props.messageId as string) : undefined) ||
          partId;
        const delta = typeof props.delta === 'string' ? (props.delta as string) : undefined;
        if (!partId || !messageId || !delta) return;
        await this.processOpencodeTextChunk(sessionId, proc, partId, messageId, delta);
        return;
      }

      case 'permission.updated': {
        // Forwarded for future UI wiring; no action required for now.
        return;
      }

      default:
        return;
    }
  }

  private async finalizeOpenCodeTurn(sessionId: string, proc: ClaudeProcess): Promise<void> {
    if (proc.opencodeUsageFinalizing) return;
    proc.opencodeUsageFinalizing = true;

    try {
      if (proc.claudeSessionId && proc.opencodeUsageBaseline) {
        const finalSnapshot = await opencodeServer.getUsageSnapshot(
          proc.claudeSessionId,
          proc.userId
        );
        if (finalSnapshot) {
          const delta = subtractOpenCodeUsage(finalSnapshot, proc.opencodeUsageBaseline);
          if (delta) {
            const prior = {
              input: proc.turnInputTokens,
              output: proc.turnOutputTokens,
              cacheRead: proc.turnCacheReadTokens,
              cacheWrite: proc.turnCacheCreationTokens,
            };
            proc.turnInputTokens = delta.input;
            proc.turnOutputTokens = delta.output + delta.reasoning;
            proc.turnCacheReadTokens = delta.cacheRead;
            proc.turnCacheCreationTokens = delta.cacheWrite;
            proc.totalInputTokens += proc.turnInputTokens - prior.input;
            proc.totalOutputTokens += proc.turnOutputTokens - prior.output;
            proc.cacheReadTokens += proc.turnCacheReadTokens - prior.cacheRead;
            proc.cacheCreationTokens += proc.turnCacheCreationTokens - prior.cacheWrite;
            // Streamed cost covers only the subscribed root. Recalculate from
            // the complete root + child usage snapshot at save time.
            proc.turnCostUsd = undefined;
          }
        }
      }

      // Turn complete: flush every unsaved OpenCode assistant message
      // separately, then drop partial streams so the next turn starts clean.
      const streams = proc.partStreams;
      if (streams && streams.size > 0) {
        await this.flushAllOpenCodeAssistantMessages(sessionId, proc);
        streams.clear();
      }
      proc.opencodeActiveMessageId = null;
      proc.opencodeMessageOrder = [];
      await this.emitUsage(sessionId, proc);
      this.saveUsageToDatabase(sessionId, proc);
    } finally {
      proc.opencodeUsageBaseline = null;
      proc.opencodeUsageFinalizing = false;
      proc.streamingText = '';
      proc.isStreaming = false;
      proc.emittedTools?.clear();
      proc.opencodeIdle = true;
      proc.currentToolName = null;
      proc.currentToolId = null;
      proc.currentActivitySummary = null;
      this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
      this.emitQueueState(sessionId, proc);
      void this.drainOpenCodeQueuedTurns(sessionId, proc);
    }
  }

  /**
   * Respawn a codex process for the next turn.
   * Codex CLI is single-shot (stdin EOF → response → exit), so we need a fresh
   * process for each user message.  This reuses the existing ClaudeProcess entry
   * (preserving usage counters, mode, etc.) and only replaces the child process.
   */
  private async respawnCodexProcess(sessionId: string, proc: ClaudeProcess): Promise<void> {
    const providerConfig = CLI_PROVIDERS.codex;
    const selectedModel = await getCliModelForSession(proc.userId, 'codex', sessionId);
    const selectedReasoning = await getCliReasoningForSession(proc.userId, 'codex', sessionId);
    const selectedServiceTier = await getCliServiceTierForSession(proc.userId, 'codex', sessionId);
    const webSearchMode = await getCodexWebSearchForUser(proc.userId);

    const session = (await pgGet(
      'SELECT working_directory, allowed_directories FROM sessions WHERE id = ?',
      sessionId
    )) as unknown as { working_directory: string; allowed_directories: string | null } | undefined;

    if (!session) throw new Error('Session not found for codex respawn');

    const allowedDirs: string[] = safeJsonParse<string[]>(session.allowed_directories, []);

    const resumeSessionId = proc.codexPendingExecCommand ? undefined : proc.codexSessionId;
    const args = getCLIArgs('codex', {
      mode: proc.mode,
      allowedDirectories: allowedDirs,
      workingDirectory: session.working_directory,
      model: selectedModel || undefined,
      reasoningLevel: selectedReasoning ?? undefined,
      serviceTier: selectedServiceTier ?? undefined,
      webSearchMode,
      codexExecCommand: proc.codexPendingExecCommand,
      // Use native codex resume once we've captured a sessionId from Codex session metadata.
      resumeSessionId,
    });
    proc.codexPendingExecCommand = undefined;

    // Attach pending images via Codex's `--image` flag (PNG/JPEG/GIF/WebP, <5MB each).
    // codex exec accepts a single comma-separated path list. We clear after consuming.
    if (proc.codexPendingImages && proc.codexPendingImages.length > 0) {
      args.push('--image', proc.codexPendingImages.join(','));
      proc.codexPendingImages = [];
    }

    // Build env (same as startSession codex block)
    const extraEnv: Record<string, string> = {};
    const codexHome = providerConfig.credentialsPath.replace('~', os.homedir());
    extraEnv.CODEX_HOME = codexHome;
    try {
      const authPath = path.join(codexHome, 'auth.json');
      const auth = safeJsonParse<Record<string, unknown>>(await fs.readFile(authPath, 'utf-8'), {});
      const hasTokens =
        typeof auth.tokens === 'object' &&
        !!(auth.tokens as { access_token?: string }).access_token;
      const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
      if (hasTokens && !hasApiKey) {
        args.push('--config', 'auth_mode="chatgpt"');
      }
    } catch {
      // Ignore
    }
    Object.assign(extraEnv, await buildIntegrationEnv());
    Object.assign(extraEnv, await buildAndroidDeviceEnvForSession(sessionId, proc.userId));

    proc.codexDescendantUsageBaseline = await this.readCodexDescendantUsage(resumeSessionId);
    // Keep the per-thread baseline in step with the aggregate one, otherwise a
    // resumed exec would re-book every subagent's full lifetime each turn.
    proc.codexSubagentBaseline = new Map(
      resumeSessionId
        ? (
            await readCodexDescendantUsageDetail(
              CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir()),
              resumeSessionId
            )
          ).map((thread) => [thread.threadId, thread.usage] as const)
        : []
    );
    const execStartedAtMs = Date.now();
    const newChildProc = spawnManagedProcess(providerConfig.command, args, {
      cwd: session.working_directory,
      env: {
        ...process.env,
        ...extraEnv,
        WEBUI_SESSION_ID: sessionId,
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_PROJECT_PATH: session.working_directory,
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Replace process reference and reset state
    proc.process = newChildProc;
    proc.codexIdle = false;
    proc.codexExecStartedAtMs = execStartedAtMs;
    proc.buffer = '';
    proc.streamingText = '';
    proc.isStreaming = false;
    proc.turnInputTokens = 0;
    proc.turnOutputTokens = 0;
    proc.turnCacheReadTokens = 0;
    proc.turnCacheCreationTokens = 0;
    proc.contextInputTokens = undefined;
    proc.contextCacheReadTokens = undefined;
    proc.contextCacheCreationTokens = undefined;
    proc.contextOutputTokens = undefined;
    proc.codexSawTokenCountThisTurn = false;
    proc.codexCurrentExecUsedResume = !!resumeSessionId;
    proc.codexLastTokenUsage = undefined;
    proc.codexTotalTokenUsage = undefined;

    // Re-attach output handlers
    newChildProc.stdout?.on('data', async (data: Buffer) => {
      await this.handleJsonOutput(sessionId, data.toString());
    });
    newChildProc.stderr?.on('data', (data: Buffer) => {
      console.error(`Claude stderr [${sessionId}]:`, data.toString());
    });
    newChildProc.on('exit', async (exitCode) => {
      console.log(
        `[CODEX] Respawned process for session ${sessionId} exited with code ${exitCode}`
      );
      const managedProc = this.processes.get(sessionId);
      if (managedProc && managedProc.process === newChildProc) {
        if (managedProc.codexPreemptKillTimer) {
          clearTimeout(managedProc.codexPreemptKillTimer);
          managedProc.codexPreemptKillTimer = undefined;
        }

        // Steering kills the exec with SIGINT, so turn.completed never arrives
        // and the turn's tokens (root + subagents) would go unbilled. Runs
        // before the steered follow-up starts and rotates currentUsageTurnId.
        await this.flushCodexUsageOnExit(sessionId, managedProc);

        const hasPendingFollowup = (managedProc.codexQueuedTurns?.length ?? 0) > 0;

        // Clean exit, or an intentional follow-up steering interruption, means
        // the manager should keep the session alive and immediately run the
        // next pending follow-up.
        if (exitCode === 0 || hasPendingFollowup) {
          if (exitCode === 0) {
            console.log(`[CODEX] Respawned process exited cleanly, marking idle [${sessionId}]`);
          } else {
            console.log(
              `[CODEX] Respawned process exited with code ${exitCode}; dispatching steered follow-up [${sessionId}]`
            );
          }
          if (managedProc.streamingText?.trim().length) {
            const suffix = exitCode === 0 ? '' : '\n\n[Steered by newer user message]';
            await this.saveAssistantMessage(
              sessionId,
              `${managedProc.streamingText.trim()}${suffix}`
            );
          }
          managedProc.codexIdle = true;
          managedProc.codexPreemptingForSteer = false;
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
          managedProc.buffer = '';
          if (hasPendingFollowup) {
            console.log(`[CODEX] Dispatching queued follow-up after process exit [${sessionId}]`);
            void this.drainCodexQueuedTurn(sessionId, managedProc);
          } else {
            this.io
              .to(`session:${sessionId}`)
              .emit('session:thinking', { sessionId, isThinking: false });
          }
          return;
        }
        if (managedProc.streamingText?.trim().length) {
          await this.saveAssistantMessage(sessionId, managedProc.streamingText.trim());
          managedProc.streamingText = '';
          managedProc.isStreaming = false;
        }
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', { sessionId, isThinking: false });
      await this.cleanupProcess(sessionId, proc);
    });
    newChildProc.on('error', async (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);
      await this.notifyDiscordSessionEvent(sessionId, {
        eventType: 'session.error',
        severity: 'error',
        title: 'Codex process error',
        summary: err.message,
      });

      await this.cleanupProcess(sessionId, proc);
    });

    console.log(`[CODEX] Respawned process [${sessionId}], args: ${args.join(' ')}`);
  }

  private normalizeCodexCompactSummary(value: string): string | undefined {
    const summary = value.trim();
    if (!summary) return undefined;
    const normalized = summary.toLowerCase();
    if (
      normalized === 'none' ||
      normalized === 'auto' ||
      normalized === 'manual' ||
      normalized === 'disabled'
    ) {
      return undefined;
    }
    return summary;
  }

  private getCodexContextUsageTotal(counters: CodexUsageCounters): number {
    return Math.max(counters.input, 0) + Math.max(counters.output, 0);
  }

  private async maybeDetectCodexImplicitCompaction(
    sessionId: string,
    proc: ClaudeProcess,
    nextUsage: CodexUsageCounters
  ): Promise<boolean> {
    const previousUsage = proc.codexLastObservedContextUsage;
    if (!previousUsage) return false;

    const contextWindow = this.resolveObservedContextWindow(proc.model, proc.contextWindow);
    const previousWindow = proc.codexLastObservedContextWindow || contextWindow;
    if (contextWindow <= 0 || previousWindow <= 0) return false;

    const windowShift = Math.abs(contextWindow - previousWindow);
    if (windowShift > Math.max(1000, contextWindow * 0.1)) return false;

    const previousTotal = this.getCodexContextUsageTotal(previousUsage);
    const nextTotal = this.getCodexContextUsageTotal(nextUsage);
    if (previousTotal <= nextTotal) return false;

    const previousPercent = previousTotal / previousWindow;
    const nextPercent = nextTotal / contextWindow;
    const droppedTokens = previousTotal - nextTotal;
    const minDropTokens = Math.max(16_000, Math.round(contextWindow * 0.15));
    const maxPostCompactPercent = Math.min(0.5, previousPercent - 0.2);
    const recentlyCompacted =
      proc.codexLastCompactAtMs && Date.now() - proc.codexLastCompactAtMs < 30_000;

    if (
      previousPercent >= 0.75 &&
      nextPercent <= maxPostCompactPercent &&
      droppedTokens >= minDropTokens &&
      !recentlyCompacted
    ) {
      proc.codexLastCompactAtMs = Date.now();
      proc.codexLastPromptEstimateTokens = undefined;
      proc.codexLastPromptPrefix = undefined;
      await this.emitCompact(sessionId, {
        sessionId,
        message: 'Codex compacted prior context and resumed from a reduced context window.',
        reason: 'auto-compact',
      });
      return true;
    }

    return false;
  }

  private applyCodexContextUsage(proc: ClaudeProcess, counters: CodexUsageCounters): void {
    const contextWindow = this.resolveObservedContextWindow(proc.model, proc.contextWindow);
    const inputTotalRaw = Math.max(counters.input, 0);
    const outputRaw = Math.max(counters.output, 0);
    const inputTotal = contextWindow > 0 ? Math.min(inputTotalRaw, contextWindow) : inputTotalRaw;
    const remainingForOutput =
      contextWindow > 0 ? Math.max(contextWindow - inputTotal, 0) : outputRaw;
    const output = contextWindow > 0 ? Math.min(outputRaw, remainingForOutput) : outputRaw;
    const cached = Math.min(Math.max(counters.cached, 0), inputTotal);

    proc.contextInputTokens = Math.max(inputTotal - cached, 0);
    proc.contextCacheReadTokens = cached;
    proc.contextCacheCreationTokens = 0;
    proc.contextOutputTokens = output;
  }

  private async applyCodexCompactContextUsage(
    sessionId: string,
    proc: ClaudeProcess,
    data: unknown
  ): Promise<void> {
    const compactCounters = extractCodexContextUsageCounters(data);
    if (compactCounters) {
      this.applyCodexContextUsage(proc, compactCounters);
      proc.codexLastObservedContextUsage = compactCounters;
    } else {
      this.resetCurrentContextUsage(proc);
      proc.codexLastObservedContextUsage = { input: 0, cached: 0, output: 0 };
    }
    proc.codexLastObservedContextWindow = this.resolveObservedContextWindow(
      proc.model,
      proc.contextWindow
    );

    proc.codexSawTokenCountThisTurn = true;
    proc.codexLastCompactAtMs = Date.now();
    proc.codexLastPromptEstimateTokens = undefined;
    proc.codexLastPromptPrefix = undefined;
    await this.emitUsage(sessionId, proc);
  }

  private buildUsageSnapshot(
    sessionId: string,
    proc: ClaudeProcess
  ): {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    contextWindow: number;
    contextUsedPercent: number;
    contextUsedPercentRaw: number;
    contextExceeded: boolean;
    totalCostUsd: number;
    model: string;
    recordedAt: string;
  } {
    const contextWindow = this.resolveObservedContextWindow(proc.model, proc.contextWindow);
    const contextInputTokens = proc.contextInputTokens ?? proc.turnInputTokens;
    const contextCacheReadTokens = proc.contextCacheReadTokens ?? proc.turnCacheReadTokens;
    const contextCacheCreationTokens =
      proc.contextCacheCreationTokens ?? proc.turnCacheCreationTokens;
    const contextOutputTokens = proc.contextOutputTokens ?? proc.turnOutputTokens;

    // The context bar should reflect the full transcript footprint currently
    // carried by the session, so include the assistant output that will be
    // carried forward into the next turn.
    const rawContextTokens =
      contextInputTokens +
      contextCacheReadTokens +
      contextCacheCreationTokens +
      contextOutputTokens;
    const contextTokens =
      contextWindow > 0 ? Math.min(rawContextTokens, contextWindow) : rawContextTokens;
    const contextUsedPercentRaw =
      contextWindow > 0 ? Math.round((contextTokens / contextWindow) * 100) : 0;
    const contextUsedPercent = Math.max(0, Math.min(100, contextUsedPercentRaw));

    return {
      sessionId,
      // Current context values for display
      inputTokens: contextInputTokens,
      outputTokens: contextOutputTokens,
      cacheReadTokens: contextCacheReadTokens,
      cacheCreationTokens: contextCacheCreationTokens,
      totalTokens: contextTokens, // Live session context footprint for display
      contextWindow,
      contextUsedPercent,
      contextUsedPercentRaw,
      contextExceeded: false,
      // Cumulative session cost
      totalCostUsd: proc.totalCostUsd,
      model: proc.model,
      recordedAt: new Date().toISOString(),
    };
  }

  private async emitUsage(sessionId: string, proc: ClaudeProcess): Promise<void> {
    const usageData = this.buildUsageSnapshot(sessionId, proc);
    this.emitBufferedEvent(sessionId, 'usage', usageData, (sequenced) => {
      this.io.to(`session:${sessionId}`).emit('session:usage', sequenced);
    });
    await this.recordContextSnapshot(sessionId, proc, usageData);
    // Note: DB saving moved to saveUsageToDatabase() called only on turn completion
  }

  private resetCurrentContextUsage(proc: ClaudeProcess): void {
    proc.turnInputTokens = 0;
    proc.turnOutputTokens = 0;
    proc.turnCacheReadTokens = 0;
    proc.turnCacheCreationTokens = 0;
    proc.contextInputTokens = 0;
    proc.contextCacheReadTokens = 0;
    proc.contextCacheCreationTokens = 0;
    proc.contextOutputTokens = 0;
    proc.turnCostUsd = undefined;
  }

  private calculateTurnCost(proc: ClaudeProcess): number {
    const estimate = estimateModelCost(
      proc.model,
      {
        inputTokens: proc.turnInputTokens,
        outputTokens: proc.turnOutputTokens,
        cacheReadTokens: proc.turnCacheReadTokens,
        cacheCreationTokens: proc.turnCacheCreationTokens,
      },
      null
    );
    return estimate.cost;
  }

  private async flushSubagentUsage(
    sessionId: string,
    proc: ClaudeProcess,
    turnId: string
  ): Promise<void> {
    const pending = proc.pendingSubagentUsage;
    proc.pendingSubagentUsage = undefined;
    if (!pending || pending.length === 0) return;
    try {
      const written = await insertUsageSubagentTurns(
        pending.map((row) => ({
          userId: proc.userId,
          sessionId,
          provider: proc.cliProvider,
          turnId,
          ...row,
        }))
      );
      if (written > 0) {
        const totalTokens = pending.reduce((sum, row) => sum + row.totalTokens, 0);
        console.log(
          `[USAGE] Saved ${written} subagent split rows for turn ${turnId} (${totalTokens} tokens)`
        );
      }
    } catch (error) {
      // The turn total is already booked; a missing breakdown must not fail it.
      console.warn('[USAGE] Failed to save subagent usage breakdown:', error);
    }
  }

  // Save usage to database - called ONCE per turn when result is received
  private async saveUsageToDatabase(sessionId: string, proc: ClaudeProcess): Promise<void> {
    // Claude Code's final result aggregates the whole turn including its
    // subagents — and a subagent routed to Z.AI was already booked by the
    // model router as its own `zai` row the moment its response completed.
    // Left in, those tokens would be billed twice, the second time priced as
    // whatever the main model is. The router hands them over exactly once.
    if (isClaudeTransportProvider(proc.cliProvider)) {
      const routed = modelRouter.drainRoutedUsage(sessionId);
      if (routed.requests > 0) {
        proc.turnInputTokens = Math.max(0, proc.turnInputTokens - routed.inputTokens);
        proc.turnOutputTokens = Math.max(0, proc.turnOutputTokens - routed.outputTokens);
        proc.turnCacheReadTokens = Math.max(0, proc.turnCacheReadTokens - routed.cacheReadTokens);
        proc.turnCacheCreationTokens = Math.max(
          0,
          proc.turnCacheCreationTokens - routed.cacheCreationTokens
        );
        // The CLI's own cost figure also contains the routed tokens, priced by
        // its idea of the model; recompute from the corrected counters instead.
        proc.turnCostUsd = undefined;
      }
    }

    const turnTotalTokens =
      proc.turnInputTokens +
      proc.turnOutputTokens +
      proc.turnCacheReadTokens +
      proc.turnCacheCreationTokens;

    if (turnTotalTokens <= 0) return;

    // Calculate cost from tokens (not from CLI cumulative value)
    const turnCostUsd = proc.turnCostUsd ?? this.calculateTurnCost(proc);
    const turnId = (proc.currentUsageTurnId ??= nanoid());

    try {
      const inserted = await insertUsageHistoryTurn({
        userId: proc.userId,
        sessionId,
        provider: proc.cliProvider,
        turnId,
        inputTokens: proc.turnInputTokens,
        outputTokens: proc.turnOutputTokens,
        cacheReadTokens: proc.turnCacheReadTokens,
        cacheCreationTokens: proc.turnCacheCreationTokens,
        totalTokens: turnTotalTokens,
        costUsd: turnCostUsd,
        model: proc.model,
        // Book the turn when it finished, not when it was queued. A long agentic
        // turn can run for hours; stamping it with the queue time buried the
        // spend in an earlier bucket and made the analytics timeline look idle
        // exactly while the rate limit was being consumed.
        createdAt: undefined,
      });
      if (inserted) {
        console.log(
          `[USAGE] Saved ${proc.cliProvider} turn ${turnId}: ${turnTotalTokens} tokens, $${turnCostUsd.toFixed(4)}`
        );
      } else {
        console.log(`[USAGE] Skipped duplicate ${proc.cliProvider} turn ${turnId}`);
      }
      this.flushSubagentUsage(sessionId, proc, turnId);
      proc.turnCostUsd = undefined;
    } catch (error) {
      console.error('[USAGE] Failed to save usage to database:', error);
    }
  }

  private extractErrorText(msg: StreamJsonMessage): string | null {
    const msgAny = msg as unknown as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
      text?: unknown;
    };
    if (typeof msgAny?.message === 'string') return msgAny.message;
    if (typeof msgAny?.error === 'string') return msgAny.error;
    if (typeof msgAny?.detail === 'string') return msgAny.detail;
    if (typeof msgAny?.text === 'string') return msgAny.text;
    return null;
  }

  private isContextLimitError(text: string): boolean {
    const normalized = text.toLowerCase();
    return (
      normalized.includes('context window') ||
      normalized.includes('context limit') ||
      normalized.includes('context length') ||
      normalized.includes('maximum context') ||
      normalized.includes('token limit')
    );
  }

  private async handleContextLimit(
    sessionId: string,
    proc: ClaudeProcess,
    errorText: string
  ): Promise<void> {
    const now = Date.now();
    if (proc.lastContextLimitAt && now - proc.lastContextLimitAt < 2000) {
      return;
    }
    proc.lastContextLimitAt = now;

    const summary = await this.buildContextSummary(
      sessionId,
      HANDOFF_CONTEXT_MAX_MESSAGES,
      HANDOFF_CONTEXT_MAX_CHARS,
      proc.currentChatId
    );
    if (summary) {
      this.pendingContextReminders.set(sessionId, { summary, reason: 'context-limit' });
    }

    proc.totalInputTokens = 0;
    proc.totalOutputTokens = 0;
    proc.cacheReadTokens = 0;
    proc.cacheCreationTokens = 0;
    this.resetCurrentContextUsage(proc);
    proc.streamingText = '';
    proc.isStreaming = false;

    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: false,
    });

    await this.emitCompact(sessionId, {
      sessionId,
      message: `Context limit reached. Auto-compacting context to continue.`,
      summary: summary || undefined,
      clear: true,
      reason: 'context-limit',
      error: errorText,
    });
    await this.emitUsage(sessionId, proc);
  }

  private async processStreamMessage(sessionId: string, msg: StreamJsonMessage): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    console.log(
      `[MSG] type=${msg.type} subtype=${msg.subtype || ''} event.type=${msg.event?.type || ''}`
    );

    if (msg.type === 'error' || (msg.type === 'system' && msg.subtype === 'error')) {
      const errorText = this.extractErrorText(msg);
      if (errorText && this.isContextLimitError(errorText)) {
        await this.handleContextLimit(sessionId, proc, errorText);
        return;
      }
    }

    // Debug: Log full message for stream_event
    if (msg.type === 'stream_event') {
      console.log(`[MSG] stream_event details:`, JSON.stringify(msg.event).substring(0, 200));
    }

    // Capture session ID and model from init message
    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) {
        proc.claudeSessionId = msg.session_id;
        await pgRun(
          'UPDATE sessions SET claude_session_id = ? WHERE id = ?',
          msg.session_id,
          sessionId
        );
      }
      // Extract model from init message (it's in the raw JSON)
      const rawMsg = msg as { model?: string };
      if (rawMsg.model) {
        proc.model = rawMsg.model;
        proc.contextWindow = contextWindowFor(rawMsg.model);
      }
    }

    // Handle stream_event wrapper (contains usage info)
    if (msg.type === 'stream_event' && msg.event) {
      const event = msg.event;

      // message_start contains initial usage and model - also means new response is starting
      if (event.type === 'message_start') {
        console.log(`[MSG] message_start - new response beginning`);
        proc.currentActivitySummary = 'Writing response';
        // A new message is starting, Claude is responding
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
        if (event.message) {
          if (event.message.model) {
            proc.model = event.message.model;
            proc.contextWindow = contextWindowFor(event.message.model);
          }
          if (event.message.usage) {
            const responseId =
              typeof event.message.id === 'string' ? event.message.id : `response-${Date.now()}`;
            accumulateClaudeMessageStartUsage(proc, responseId, event.message.usage);
            await this.emitUsage(sessionId, proc);
          }
        }
      }

      // message_delta contains updated usage and stop_reason
      if (event.type === 'message_delta') {
        if (event.usage) {
          // message_delta output usage is cumulative for the current model
          // response. Add only its growth to billed turn usage.
          accumulateClaudeMessageDeltaUsage(proc, event.usage);
          await this.emitUsage(sessionId, proc);
        }
        // If stop_reason is tool_use, Claude is about to use a tool - show thinking
        if (event.delta?.stop_reason === 'tool_use') {
          console.log(`[TOOL] Claude is using a tool, showing thinking indicator`);
          // Save any pending streaming content
          if (proc.streamingText.trim().length > 0) {
            await this.saveAssistantMessage(sessionId, proc.streamingText.trim());
            proc.streamingText = '';
            proc.isStreaming = false;
          }
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
          });
        }
      }

      // Handle content_block_start inside stream_event
      if (event.type === 'content_block_start') {
        // Check if this is a tool_use block or text block
        const contentBlock = (
          event as { content_block?: { type: string; name?: string; id?: string } }
        ).content_block;
        if (contentBlock?.type === 'tool_use' || contentBlock?.type === 'server_tool_use') {
          // Tool is being called - track it and show indicator
          proc.currentToolName = contentBlock.name || null;
          proc.currentToolId = contentBlock.id || nanoid();
          proc.currentToolInput = '';
          console.log(`[TOOL] Tool starting: ${contentBlock.name} (id: ${proc.currentToolId})`);
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
          });
          if (contentBlock.name) {
            this.emitToolUse(sessionId, {
              sessionId,
              toolName: contentBlock.name,
              toolId: proc.currentToolId || undefined,
              status: 'started',
            });
          }
        } else {
          // Text block - start streaming
          proc.isStreaming = true;
          proc.streamingText = '';
          proc.currentActivitySummary = 'Writing response';
          proc.currentToolName = null;
          proc.currentToolId = null;
          proc.currentToolInput = '';
          // Safety net: if a provider did not send a tool_result for an agent,
          // mark outstanding subagent work complete when assistant text resumes.
          this.completeActiveSubagents(sessionId, proc);
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: false,
          });
        }
      }

      // Handle content_block_delta inside stream_event
      if (event.type === 'content_block_delta') {
        const delta = event.delta as
          | { type?: string; text?: string; partial_json?: string }
          | undefined;

        // Handle text streaming
        if (delta?.type === 'text_delta' && delta.text) {
          proc.streamingText += delta.text;
          console.log(
            `[STREAM] Emitting session:output with text: "${delta.text.substring(0, 50)}..."`
          );
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            chatId: proc.currentChatId,
            content: delta.text,
            isComplete: false,
          });
        }

        // Handle tool input JSON streaming
        if (delta?.type === 'input_json_delta' && delta.partial_json) {
          proc.currentToolInput += delta.partial_json;
        }
      }

      // Handle content_block_stop inside stream_event
      if (event.type === 'content_block_stop') {
        // Save any streaming text
        if (proc.streamingText.trim().length > 0) {
          await this.saveAssistantMessage(sessionId, proc.streamingText.trim());
          proc.streamingText = '';
          proc.isStreaming = false;
        }

        // Process completed tool input and emit completion
        if (proc.currentToolName) {
          console.log(
            `[TOOL] ${proc.currentToolName} completed with input length: ${proc.currentToolInput.length}`
          );

          let inputData: unknown = null;
          if (proc.currentToolInput.trim().length > 0) {
            try {
              inputData = JSON.parse(proc.currentToolInput);
            } catch {
              inputData = proc.currentToolInput;
            }
          }

          // Store tool info for matching with result later
          if (proc.currentToolId) {
            proc.pendingToolResults = proc.pendingToolResults || new Map();
            proc.pendingToolResults.set(proc.currentToolId, {
              toolName: proc.currentToolName,
              input: inputData,
            });
          }

          // Note: The actual result will be captured from tool_result message
          // For now, we just show the input was accepted
          this.emitToolUse(sessionId, {
            sessionId,
            toolName: proc.currentToolName,
            toolId: proc.currentToolId || undefined,
            status: 'completed',
            input: inputData ?? undefined,
          });

          const normalizedToolName = (proc.currentToolName || '')
            .replace(/[_-]/g, '')
            .toLowerCase();

          if (normalizedToolName === 'exitplanmode') {
            proc.mode = 'auto-accept';
            this.emitModeChange(sessionId, 'auto-accept');
            // Set context reminder to inform Claude that plan mode has ended
            proc.contextReminder = {
              summary: `## PLAN MODE ENDED - IMPLEMENTATION MODE ACTIVE

The planning phase is complete. You are now in Auto-Accept mode.

**What changed:**
- You can now use ALL tools freely (Read, Write, Edit, Bash, Glob, Grep, etc.)
- The planning restrictions have been lifted
- Proceed with implementing the approved plan step by step

**Next steps:**
1. Start implementing the tasks from your plan
2. Use appropriate tools to make changes
3. Mark todos as completed as you finish each task`,
              reason: 'mode-change',
            };
            console.log(
              `[MODE] Plan mode ended for session ${sessionId}, switching to auto-accept`
            );
          }

          // Handle TodoWrite tool
          if (normalizedToolName === 'todowrite') {
            try {
              const todoInput = JSON.parse(proc.currentToolInput) as {
                todos?: Array<{ content: string; status: string; activeForm?: string }>;
              };
              if (todoInput.todos && Array.isArray(todoInput.todos)) {
                console.log(`[TODOS] Emitting ${todoInput.todos.length} todos`);
                this.io.to(`session:${sessionId}`).emit('session:todos', {
                  sessionId,
                  todos: todoInput.todos.map((t) => ({
                    content: t.content,
                    status: t.status as 'pending' | 'in_progress' | 'completed',
                    activeForm: t.activeForm,
                  })),
                });
              }
            } catch (err) {
              console.error(`[TODOS] Failed to parse TodoWrite input:`, err);
            }
          }

          // Handle Task/Agent tools (subagents). "Agent" is the newer tool and
          // detaches by default: the tool_result only acknowledges the launch,
          // the run itself outlives the turn.
          if (normalizedToolName === 'task' || normalizedToolName === 'agent') {
            try {
              const taskInput = JSON.parse(proc.currentToolInput) as {
                subagent_type?: string;
                description?: string;
                run_in_background?: boolean;
              };
              const agentType = taskInput.subagent_type || 'general-purpose';
              const background =
                normalizedToolName === 'agent' && taskInput.run_in_background !== false;
              console.log(
                `[AGENT] Agent starting: ${agentType}${background ? ' (background)' : ''} - ${taskInput.description || ''}`
              );
              this.startSubagentRun(sessionId, proc, {
                agentId: proc.currentToolId || undefined,
                agentType,
                description: taskInput.description,
                toolId: proc.currentToolId,
                background,
              });
            } catch (err) {
              console.error(`[AGENT] Failed to parse Task input:`, err);
            }
          }
        }

        // Reset state
        proc.isStreaming = false;
        proc.streamingText = '';
        proc.currentToolName = null;
        proc.currentToolId = null;
        proc.currentToolInput = '';
      }
    }

    // Handle result message with final usage
    if (msg.type === 'result') {
      // Check for permission denials
      if (msg.permission_denials && msg.permission_denials.length > 0) {
        console.log(
          `[PERMISSION] Permission denied for tools:`,
          msg.permission_denials.map((d) => d.tool_name).join(', ')
        );
        proc.pendingPermissionDenials = msg.permission_denials;
        await recordAudit({
          actorUserId: proc.userId,
          action: 'permission.request',
          resourceType: 'session',
          resourceId: sessionId,
          metadata: {
            provider: proc.cliProvider,
            flow: 'legacy-denial',
            tools: msg.permission_denials.map((d) => d.tool_name),
          },
        });

        // Permission requests are blocking UI state: replay them after reconnect
        // just like provider questions, with the same sequence/cursor ordering.
        const permissionEvent = {
          sessionId,
          denials: msg.permission_denials,
          originalMessage: proc.lastUserMessage || '',
        };
        this.emitBufferedEvent(sessionId, 'permission_request', permissionEvent, (sequenced) => {
          this.io.to(`session:${sessionId}`).emit('session:permission_request', sequenced);
        });
        await this.notifyDiscordSessionEvent(sessionId, {
          eventType: 'session.permission_requested',
          severity: 'warning',
          title: 'Session needs permission',
          summary: `Permission required for tools: ${msg.permission_denials
            .map((d) => d.tool_name)
            .join(', ')}`,
          fields: [
            {
              name: 'Tools',
              value: msg.permission_denials.map((d) => d.tool_name).join(', '),
              inline: false,
            },
          ],
        });

        // Stop thinking indicator - user needs to approve
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
      }

      // Clear any active agent on result (safety net)
      this.completeActiveSubagents(sessionId, proc);

      if (msg.total_cost_usd !== undefined) {
        proc.totalCostUsd = msg.total_cost_usd;
      }
      if (msg.usage) {
        // Z.AI can omit input/cache counters from streaming message_start
        // events. The final result retains the complete turn aggregate, so use
        // it as a non-decreasing fallback before writing usage_history.
        applyClaudeResultUsage(proc, msg.usage);
        // Keep the latest provider totals for the live session readout.
        proc.totalInputTokens = msg.usage.input_tokens || proc.totalInputTokens;
        proc.totalOutputTokens = msg.usage.output_tokens || proc.totalOutputTokens;
        proc.cacheReadTokens = msg.usage.cache_read_input_tokens || proc.cacheReadTokens;
        proc.cacheCreationTokens =
          msg.usage.cache_creation_input_tokens || proc.cacheCreationTokens;
      }
      // Get context window from modelUsage if available
      if (msg.modelUsage) {
        const primaryModel = Object.entries(msg.modelUsage).find(
          ([key]) => key.includes('opus') || key.includes('sonnet')
        );
        if (primaryModel && primaryModel[1].contextWindow) {
          proc.contextWindow = primaryModel[1].contextWindow;
        }
      }
      await this.emitUsage(sessionId, proc);

      // Save usage to database - ONLY HERE at the end of the turn
      // Cost is calculated from tokens, not from CLI cumulative value
      this.saveUsageToDatabase(sessionId, proc);
    }

    // Handle content_block_start - begin streaming text
    if (msg.type === 'content_block_start') {
      proc.isStreaming = true;
      proc.streamingText = '';
      // Stop thinking, start showing content
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    }

    // Handle content_block_delta - stream text in real-time
    if (msg.type === 'content_block_delta' && msg.delta?.text) {
      proc.streamingText += msg.delta.text;
      // Emit streaming content to frontend
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        chatId: proc.currentChatId,
        content: msg.delta.text,
        isComplete: false,
      });
    }

    // Handle content_block_stop - save complete message
    if (msg.type === 'content_block_stop') {
      if (proc.streamingText.trim().length > 0) {
        await this.saveAssistantMessage(sessionId, proc.streamingText.trim());
      }
      proc.isStreaming = false;
      proc.streamingText = '';
    }

    // Handle complete assistant messages (non-streaming fallback)
    if (
      msg.type === 'assistant' &&
      msg.message &&
      typeof msg.message !== 'string' &&
      !proc.isStreaming
    ) {
      let content = '';
      if (typeof msg.message.content === 'string') {
        content = msg.message.content;
      } else if (Array.isArray(msg.message.content)) {
        content = msg.message.content
          .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
          .map((c: { type: string; text?: string }) => c.text)
          .join('');
      }

      if (content && content.trim().length > 0) {
        // Stop thinking, show the message
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });

        // Save immediately as separate message
        await this.saveAssistantMessage(sessionId, content.trim());
      }
    }

    // Handle tool use - show thinking while tool runs
    if (msg.type === 'tool_use' && msg.tool_use) {
      // Save any pending streaming content before tool use
      if (proc.streamingText.trim().length > 0) {
        await this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        proc.streamingText = '';
        proc.isStreaming = false;
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });
      this.emitToolUse(sessionId, {
        sessionId,
        toolName: msg.tool_use.name,
        toolId: msg.tool_use.id,
        status: 'started',
      });
    }

    // Handle user messages in stream (from subagent interactions) - show thinking
    // Also extract tool_result content to update tool executions
    if (msg.type === 'user') {
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });

      // Background agents report back through harness task-notifications that
      // surface as injected user messages. That is the only completion signal
      // a detached run ever gets.
      this.completeBackgroundRunsFromNotifications(sessionId, proc, msg);

      // Extract tool results from user message content
      const userMsg = msg as {
        message?: {
          content?: Array<{
            type: string;
            tool_use_id?: string;
            content?: string | Array<{ type: string; text?: string }>;
          }>;
        };
      };
      if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
        for (const block of userMsg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const pendingTool = proc.pendingToolResults?.get(block.tool_use_id);
            // Extract result text
            let resultText = '';
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text)
                .join('\n');
            }

            // Emit tool result update
            if (resultText) {
              console.log(
                `[TOOL] Result for ${block.tool_use_id}: ${resultText.substring(0, 100)}...`
              );
              const normalizedPendingTool = (pendingTool?.toolName || '')
                .replace(/[_-]/g, '')
                .toLowerCase();
              if (normalizedPendingTool === 'task' || normalizedPendingTool === 'agent') {
                const run = this.findSubagentRun(proc, { toolId: block.tool_use_id });
                if (run?.background) {
                  // The result only acknowledges the launch; the run is still
                  // going. Capture its id so the completion notification can
                  // find it later.
                  const launchedId = resultText.match(/agentId:\s*([A-Za-z0-9_-]+)/)?.[1];
                  if (launchedId) {
                    this.startSubagentRun(sessionId, proc, {
                      agentId: run.id,
                      agentType: run.agentType,
                      description: run.description,
                      toolId: run.toolId,
                      externalAgentId: launchedId,
                      background: true,
                    });
                  }
                } else {
                  this.completeSubagentRun(
                    sessionId,
                    proc,
                    { toolId: block.tool_use_id },
                    { result: resultText }
                  );
                }
              }
              this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                sessionId,
                toolId: block.tool_use_id,
                toolName: pendingTool?.toolName || 'Unknown',
                status: 'completed',
                result: resultText,
              });
              // Clean up pending
              proc.pendingToolResults?.delete(block.tool_use_id);
            }
          }
        }
      }
    }

    // Handle compact/summarization events
    // Claude sends these when auto-compacting context
    if (
      msg.type === 'system' &&
      (msg.subtype === 'compact' ||
        msg.subtype === 'pre_compact' ||
        (msg.message &&
          typeof msg.message === 'string' &&
          msg.message.toLowerCase().includes('compact')))
    ) {
      console.log(`[COMPACT] Context compaction detected for session ${sessionId}`);
      // Reset token counts since context was compacted
      proc.totalInputTokens = 0;
      proc.totalOutputTokens = 0;
      proc.cacheReadTokens = 0;
      proc.cacheCreationTokens = 0;
      this.resetCurrentContextUsage(proc);
      // Notify frontend about compaction
      await this.emitCompact(sessionId, {
        sessionId,
        message: 'Context was auto-compacted to reduce token usage',
        reason: 'auto-compact',
      });
      await this.emitUsage(sessionId, proc);
    }

    // Handle result/completion
    if (msg.type === 'result' || (msg.type === 'system' && msg.subtype === 'turn_end')) {
      // Save any remaining streaming content
      if (proc.streamingText.trim().length > 0) {
        await this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        proc.streamingText = '';
        proc.isStreaming = false;
      }
      // Stop thinking indicator
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
      proc.currentToolName = null;
      proc.currentToolId = null;
      this.completeActiveSubagents(sessionId, proc);
      proc.currentAgentType = null;
      proc.currentAgentDescription = null;
      proc.currentActivitySummary = null;
      // Emit turnComplete for external consumers
      this.events.emit('turnComplete', sessionId, {
        inputTokens: proc.turnInputTokens,
        outputTokens: proc.turnOutputTokens,
        totalCostUsd: proc.totalCostUsd,
      });
      // Provider-agnostic: a runtime-setting change parked while this turn ran
      // gets applied now that the answer is in.
      queueMicrotask(() => this.applyDeferredRestart(sessionId));
      if (msg.type === 'result' && isClaudeTransportProvider(proc.cliProvider)) {
        proc.claudeIdle = true;
        this.emitQueueState(sessionId, proc);
        queueMicrotask(() => this.drainClaudeQueuedTurns(sessionId, proc));
        queueMicrotask(async () => await this.applyDeferredModeRestart(sessionId, proc));
      }
    }
  }

  private async saveAssistantMessage(sessionId: string, content: string): Promise<void> {
    const proc = this.processes.get(sessionId);
    const explicitWorkspaceMedia = proc
      ? extractExplicitWorkspaceChatMedia(content, proc.workingDirectory)
      : { content, media: [] as PendingChatMedia[] };
    const deliveredContent = explicitWorkspaceMedia.content;
    if (proc) {
      for (const pending of explicitWorkspaceMedia.media) {
        appendPendingChatMedia(proc, pending);
      }
    }
    const hasPendingMedia = (proc?.pendingChatMedia.length ?? 0) > 0;
    const now = Date.now();
    if (
      proc &&
      !hasPendingMedia &&
      proc.lastSavedAssistantContent === deliveredContent &&
      proc.lastSavedAssistantAt !== undefined &&
      now - proc.lastSavedAssistantAt < 2000
    ) {
      console.log(`[SAVE] Skipping duplicate assistant message [${sessionId}]`);
      return;
    }

    const messageId = nanoid();
    const createdAt = new Date().toISOString();
    // The provider turn owns its thread even if another device changes the
    // session-wide active chat before this response finishes.
    const chatId = proc?.currentChatId ?? (await getSessionSyncState(sessionId)).activeChatId;
    const eventSequence = await this.allocateEventSequence(sessionId);

    // This runs from child 'exit' handlers among other places; a throw there
    // becomes an uncaughtException and kills the whole backend. Log and bail
    // instead of emitting a message whose row was never persisted.
    try {
      await pgRun(
        `INSERT INTO messages (
           id, session_id, chat_id, role, content, event_sequence
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        messageId,
        sessionId,
        chatId,
        'assistant',
        deliveredContent,
        eventSequence
      );
      await pgRun(
        'UPDATE sessions SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        deliveredContent.substring(0, 200),
        sessionId
      );
    } catch (error) {
      console.error(`[SAVE] Failed to persist assistant message [${sessionId}]:`, error);
      return;
    }

    if (proc) {
      proc.lastSavedAssistantContent = deliveredContent;
      proc.lastSavedAssistantAt = now;
    }

    // Claim the complete queue synchronously before starting async persistence.
    // A second save during the await must not attach the same provider artifact
    // to another message or collide on its source id.
    const pendingMedia = proc ? proc.pendingChatMedia.splice(0) : [];

    const emitMessage = (media: Awaited<ReturnType<typeof persistMessageMedia>> = []): void => {
      // Keep the existing session/content arguments stable for external consumers;
      // persisted, path-free media is appended as the optional third argument.
      this.events.emit('assistantMessage', sessionId, deliveredContent, media);
      const assistantMessage = {
        id: messageId,
        sessionId,
        chatId,
        role: 'assistant',
        content: deliveredContent,
        createdAt,
        eventSequence,
        ...(media.length > 0 ? { media } : {}),
      } as const;
      this.emitBufferedEvent(
        sessionId,
        'message',
        assistantMessage,
        (sequenced) => {
          this.io.to(`session:${sessionId}`).emit('session:message', sequenced);
        },
        eventSequence
      );

      // End of a turn: record what changed on disk and file the reply in the
      // notification centre. Both are best-effort side channels — a failure
      // here must never affect message delivery.
      void this.recordTurnOutcome(sessionId, deliveredContent, messageId);
    };

    if (proc && pendingMedia.length > 0) {
      // Persist directly after the message row. Validation/copying is async, so
      // a failed artifact must never suppress the text response. Provider
      // events arriving meanwhile remain queued for the next message.
      void (async () => {
        let media: Awaited<ReturnType<typeof persistMessageMedia>> = [];
        try {
          media = await persistMessageMedia({
            messageId,
            sessionId,
            userId: proc.userId,
            media: pendingMedia,
          });
        } catch (error) {
          console.warn(
            `[MEDIA] Failed to persist assistant media [${sessionId}]:`,
            error instanceof Error ? error.message : error
          );
        }
        emitMessage(media);
      })();
    } else {
      emitMessage();
    }

    console.log(`Saved assistant message [${sessionId}]: ${deliveredContent.substring(0, 100)}...`);
  }

  private queueCodexTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: CodexPreparedTurn,
    mode: ActiveFollowupMode
  ): void {
    proc.codexQueuedTurns ??= [];
    if (mode === 'steer') {
      proc.codexQueuedTurns.unshift(turn);
    } else {
      proc.codexQueuedTurns.push(turn);
    }
    console.log(
      `[CODEX] ${mode === 'steer' ? 'Steering' : 'Queued'} follow-up while active turn is running ` +
        `[${sessionId}], depth=${proc.codexQueuedTurns.length}`
    );
    this.emitQueueState(sessionId, proc);
  }

  private queueOpenCodeTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: OpenCodePreparedTurn
  ): void {
    proc.opencodeQueuedTurns ??= [];
    proc.opencodeQueuedTurns.push(turn);
    console.log(
      `[OPENCODE] Queued user turn while current turn is running [${sessionId}], depth=${proc.opencodeQueuedTurns.length}`
    );
    this.emitQueueState(sessionId, proc);
  }

  private queueClaudeTurn(sessionId: string, proc: ClaudeProcess, turn: ClaudePreparedTurn): void {
    proc.claudeQueuedTurns ??= [];
    proc.claudeQueuedTurns.push(turn);
    console.log(
      `[CLAUDE] Queued user turn while current turn is running [${sessionId}], depth=${proc.claudeQueuedTurns.length}`
    );
    this.emitQueueState(sessionId, proc);
  }

  private getQueuedTurnItems(
    proc: ClaudeProcess
  ): Array<CodexPreparedTurn | OpenCodePreparedTurn | ClaudePreparedTurn> {
    if (proc.cliProvider === 'codex') {
      return proc.codexQueuedTurns ?? [];
    }
    if (proc.cliProvider === 'opencode') {
      return proc.opencodeQueuedTurns ?? [];
    }
    if (proc.cliProvider === 'kimi') {
      return proc.kimiQueuedTurns ?? [];
    }
    if (isClaudeTransportProvider(proc.cliProvider)) {
      return proc.claudeQueuedTurns ?? [];
    }
    return [];
  }

  private emitQueueState(sessionId: string, proc: ClaudeProcess): void {
    const items = this.getQueuedTurnItems(proc).map((turn) => ({
      id: turn.queueId,
      preview: turn.originalMessage.slice(0, 240),
      createdAt: turn.queuedAt,
      attachments: turn.attachments?.length,
    }));
    const hasPendingCodexFollowup =
      proc.cliProvider === 'codex' && (proc.codexQueuedTurns?.length ?? 0) > 0;
    this.io.to(`session:${sessionId}`).emit('session:queue', {
      sessionId,
      provider: proc.cliProvider,
      depth: items.length,
      items,
      busy:
        proc.cliProvider === 'codex'
          ? !proc.codexIdle || hasPendingCodexFollowup
          : proc.cliProvider === 'opencode'
            ? !proc.opencodeIdle || items.length > 0
            : isClaudeTransportProvider(proc.cliProvider)
              ? proc.claudeIdle === false || items.length > 0
              : proc.cliProvider === 'kimi'
                ? proc.kimiIdle === false || items.length > 0
                : proc.isStreaming || !!proc.currentToolName,
      preempting: !!proc.codexPreemptingForSteer,
    });
  }

  private dispatchClaudeTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: ClaudePreparedTurn
  ): void {
    proc.currentChatId = turn.chatId;
    proc.claudeIdle = false;
    if (turn.updateLastMessage) {
      proc.lastUserMessage = turn.originalMessage;
      proc.lastAttachments = turn.attachments || null;
    }
    proc.pendingPermissionDenials = null;
    proc.currentUsageTurnId = turn.queueId;
    proc.currentUsageTurnStartedAt = turn.queuedAt;
    this.resetCurrentContextUsage(proc);
    proc.claudeCurrentResponseId = undefined;
    proc.claudeCurrentResponseOutputTokens = undefined;
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });
    if (proc.process.stdin?.writable) {
      proc.process.stdin.write(formatInputMessage(proc.cliProvider, turn.messageForClaude));
      console.log(
        `Sent message [${sessionId}] via ${proc.cliProvider}: ${turn.messageForClaude.substring(0, 100)}...`
      );
    } else {
      console.warn(
        `[SEND] stdin no longer writable for ${proc.cliProvider} [${sessionId}]; dropping dispatched turn`
      );
    }
    this.emitQueueState(sessionId, proc);
  }

  /**
   * Perform a mode change that was deferred because a turn was running. Queued
   * follow-ups win: restarting with turns still waiting would drop them, so the
   * restart waits until the queue has drained too.
   */
  /**
   * Run a settings reload that was parked because a turn was still running.
   * Queued follow-ups win: restarting with turns still waiting would drop them,
   * so this waits for the queue to drain as well.
   */
  private applyDeferredRestart(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    const deferred = proc?.deferredRestart;
    if (!proc || !deferred) return;
    if (this.getSessionRuntimeSnapshot(sessionId).busy) return;

    proc.deferredRestart = undefined;
    console.log(`[SESSION] Applying deferred settings reload for ${sessionId}`);
    void this.restartSession(sessionId, deferred.userId, deferred.options).catch((error) => {
      console.error(`[SESSION] Deferred settings reload failed for ${sessionId}:`, error);
    });
  }

  private async applyDeferredModeRestart(sessionId: string, proc: ClaudeProcess): Promise<void> {
    const deferred = proc.claudeDeferredModeRestart;
    if (!deferred) return;
    if (proc.claudeIdle === false) return;
    if ((proc.claudeQueuedTurns?.length ?? 0) > 0) return;

    proc.claudeDeferredModeRestart = undefined;
    console.log(`[MODE] Applying deferred ${deferred.mode} for ${sessionId}`);
    await this.restartForMode(
      sessionId,
      proc,
      deferred.mode,
      deferred.userId,
      deferred.previousMode
    );
  }

  private drainClaudeQueuedTurns(sessionId: string, proc: ClaudeProcess): void {
    if (
      !isClaudeTransportProvider(proc.cliProvider) ||
      !proc.claudeIdle ||
      proc.claudeQueueDraining
    ) {
      return;
    }
    const nextTurn = proc.claudeQueuedTurns?.shift();
    if (!nextTurn) {
      this.emitQueueState(sessionId, proc);
      return;
    }

    proc.claudeQueueDraining = true;
    try {
      this.dispatchClaudeTurn(sessionId, proc, nextTurn);
    } finally {
      proc.claudeQueueDraining = false;
    }
  }

  private async requestCodexSteeringPreemption(
    sessionId: string,
    proc: ClaudeProcess
  ): Promise<void> {
    if (proc.cliProvider !== 'codex' || proc.codexIdle || proc.codexPreemptingForSteer) {
      return;
    }

    const child = proc.process;
    if (!child || child.stdin === null) {
      return;
    }

    proc.codexPreemptingForSteer = true;
    console.log(`[CODEX] Interrupting active turn for steered follow-up [${sessionId}]`);
    this.emitQueueState(sessionId, proc);

    if (proc.streamingText.trim().length > 0) {
      await this.saveAssistantMessage(
        sessionId,
        `${proc.streamingText.trim()}\n\n[Steered by newer user message]`
      );
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    signalManagedProcess(child, 'SIGINT');

    proc.codexPreemptKillTimer = setTimeout(() => {
      const latest = this.processes.get(sessionId);
      if (latest !== proc || latest.process !== child || !latest.codexPreemptingForSteer) {
        return;
      }

      console.warn(`[CODEX] Steering interrupt did not exit; sending SIGTERM [${sessionId}]`);
      signalManagedProcess(child, 'SIGTERM');

      latest.codexPreemptKillTimer = setTimeout(() => {
        const stillLatest = this.processes.get(sessionId);
        if (
          stillLatest !== proc ||
          stillLatest.process !== child ||
          !stillLatest.codexPreemptingForSteer
        ) {
          return;
        }

        console.warn(`[CODEX] Steering SIGTERM did not exit; sending SIGKILL [${sessionId}]`);
        signalManagedProcess(child, 'SIGKILL');
      }, 5000);
    }, 5000);
  }

  private async configureKimiAcpSession(proc: ClaudeProcess): Promise<void> {
    const connection = proc.kimiAcpConnection;
    const nativeSessionId = proc.kimiAcpSessionId;
    if (!connection || !nativeSessionId) return;

    const options = proc.kimiAcpConfigOptions;
    if (proc.model && kimiAcpConfigSupports(options, 'model', proc.model)) {
      const result = await connection.setSessionConfigOption({
        sessionId: nativeSessionId,
        configId: 'model',
        value: proc.model,
      });
      proc.kimiAcpConfigOptions = result.configOptions;
    }

    const mode = kimiAcpModeForSessionMode(proc.mode);
    if (kimiAcpConfigSupports(proc.kimiAcpConfigOptions || options, 'mode', mode)) {
      const result = await connection.setSessionConfigOption({
        sessionId: nativeSessionId,
        configId: 'mode',
        value: mode,
      });
      proc.kimiAcpConfigOptions = result.configOptions;
    }
  }

  private async handleKimiAcpPermission(
    proc: ClaudeProcess,
    params: AcpRequestPermissionRequest
  ): Promise<AcpRequestPermissionResponse> {
    const preferredKinds =
      proc.mode === 'planning'
        ? ['reject_once', 'reject_always']
        : proc.mode === 'manual'
          ? ['allow_once', 'allow_always']
          : ['allow_always', 'allow_once'];
    const selected = preferredKinds
      .map((kind) => params.options.find((option) => option.kind === kind))
      .find(Boolean);
    if (!selected) return { outcome: { outcome: 'cancelled' } };
    return {
      outcome: {
        outcome: 'selected',
        optionId: selected.optionId,
      },
    };
  }

  private async handleKimiAcpUpdate(
    sessionId: string,
    proc: ClaudeProcess,
    notification: AcpSessionNotification
  ): Promise<void> {
    if (this.processes.get(sessionId) !== proc) return;
    proc.lastActivityAt = Date.now();
    const update = notification.update;

    if (update.sessionUpdate === 'agent_message_chunk') {
      if (update.content.type !== 'text' || !update.content.text) return;
      proc.streamingText += update.content.text;
      proc.isStreaming = true;
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        chatId: proc.currentChatId,
        content: update.content.text,
        isComplete: false,
      });
      return;
    }

    if (update.sessionUpdate === 'agent_thought_chunk') {
      if (update.content.type === 'text' && update.content.text) {
        // ACP sends reasoning as small token chunks. Keep a bounded rolling
        // window so the activity line shows meaningful live progress instead
        // of looking frozen during long K3 tool-planning steps.
        proc.kimiThinkingText = `${proc.kimiThinkingText || ''}${update.content.text}`.slice(-600);
        proc.currentActivitySummary = proc.kimiThinkingText.replace(/\s+/g, ' ').trim();
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
        message: proc.currentActivitySummary || 'Kimi is reasoning…',
      });
      return;
    }

    if (update.sessionUpdate === 'tool_call') {
      proc.pendingToolResults.set(update.toolCallId, {
        toolName: update.title,
        input: update.rawInput,
      });
      if (!proc.emittedTools?.has(update.toolCallId)) {
        proc.emittedTools?.add(update.toolCallId);
        this.emitToolUse(sessionId, {
          sessionId,
          toolName: update.title,
          toolId: update.toolCallId,
          status: 'started',
          input: update.rawInput,
        });
      }
      return;
    }

    if (update.sessionUpdate === 'tool_call_update') {
      const pending = proc.pendingToolResults.get(update.toolCallId);
      const toolName = update.title || pending?.toolName || 'Kimi tool';
      const input = update.rawInput ?? pending?.input;
      if (!proc.emittedTools?.has(update.toolCallId)) {
        proc.emittedTools?.add(update.toolCallId);
        proc.pendingToolResults.set(update.toolCallId, { toolName, input });
        this.emitToolUse(sessionId, {
          sessionId,
          toolName,
          toolId: update.toolCallId,
          status: 'started',
          input,
        });
      }

      if (
        (update.status === 'completed' || update.status === 'failed') &&
        !proc.kimiCompletedTools?.has(update.toolCallId)
      ) {
        proc.kimiCompletedTools?.add(update.toolCallId);
        const result = kimiAcpToolResultText(update).slice(0, 20_000);
        this.emitToolUse(sessionId, {
          sessionId,
          toolName,
          toolId: update.toolCallId,
          status: update.status === 'failed' ? 'error' : 'completed',
          input,
          ...(update.status === 'failed'
            ? { error: result || `${toolName} failed` }
            : { result: result || undefined }),
        });
        proc.pendingToolResults.delete(update.toolCallId);
      }
      return;
    }

    if (update.sessionUpdate === 'usage_update') {
      proc.contextWindow = update.size;
      proc.contextInputTokens = update.used;
      proc.contextOutputTokens = 0;
      proc.contextCacheReadTokens = 0;
      proc.contextCacheCreationTokens = 0;
      await this.emitUsage(sessionId, proc);
      return;
    }

    if (update.sessionUpdate === 'config_option_update') {
      proc.kimiAcpConfigOptions = update.configOptions;
    }
  }

  private queueKimiTurn(sessionId: string, proc: ClaudeProcess, turn: CodexPreparedTurn): void {
    proc.kimiQueuedTurns ??= [];
    proc.kimiQueuedTurns.push(turn);
    console.log(
      `[KIMI ACP] Queued user turn while current turn is running [${sessionId}], depth=${proc.kimiQueuedTurns.length}`
    );
    this.emitQueueState(sessionId, proc);
  }

  private async dispatchKimiAcpTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: CodexPreparedTurn
  ): Promise<void> {
    const connection = proc.kimiAcpConnection;
    const nativeSessionId = proc.kimiAcpSessionId;
    if (!connection || !nativeSessionId) {
      throw new Error('Kimi ACP session is not ready');
    }

    proc.currentChatId = turn.chatId;
    proc.kimiIdle = false;
    proc.currentUsageTurnId = turn.queueId;
    proc.currentUsageTurnStartedAt = turn.queuedAt;
    if (turn.updateLastMessage) {
      proc.lastUserMessage = turn.originalMessage;
      proc.lastAttachments = turn.attachments || null;
    }
    proc.streamingText = '';
    proc.isStreaming = false;
    proc.currentToolName = null;
    proc.currentToolId = null;
    proc.currentActivitySummary = null;
    proc.kimiThinkingText = '';
    proc.pendingToolResults.clear();
    proc.emittedTools = new Set();
    proc.kimiCompletedTools = new Set();
    this.resetCurrentContextUsage(proc);
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
      message: 'Kimi is working…',
    });
    this.emitQueueState(sessionId, proc);

    let response: AcpPromptResponse | null = null;
    const kimiHome = CLI_PROVIDERS.kimi.credentialsPath.replace('~', os.homedir());
    // Kimi 0.31 writes exact per-model-call counters to its native ledger but
    // does not currently attach the optional ACP PromptResponse.usage payload.
    // Snapshot the append-only ledgers while the persistent session is idle so
    // this WebUI turn can book only the records written by the prompt below.
    const usageCursor = captureKimiUsageCursor(kimiHome, nativeSessionId);
    try {
      response = await connection.prompt({
        sessionId: nativeSessionId,
        prompt: [{ type: 'text', text: turn.messageForClaude }],
      });
      const nativeUsage = readKimiUsageSince(usageCursor);
      if (nativeUsage.totalTokens > 0) {
        proc.turnInputTokens = nativeUsage.inputTokens;
        proc.turnOutputTokens = nativeUsage.outputTokens;
        proc.turnCacheReadTokens = nativeUsage.cacheReadTokens;
        proc.turnCacheCreationTokens = nativeUsage.cacheCreationTokens;
        const dominantModel = Object.entries(nativeUsage.models).sort(
          (a, b) => b[1] - a[1]
        )[0]?.[0];
        if (dominantModel) proc.model = dominantModel;
      } else if (response.usage) {
        // Protocol fallback for a future Kimi build that starts returning ACP
        // usage before/without a local native ledger.
        const cacheRead = Math.max(0, response.usage.cachedReadTokens || 0);
        proc.turnInputTokens = Math.max(0, response.usage.inputTokens - cacheRead);
        proc.turnCacheReadTokens = cacheRead;
        proc.turnCacheCreationTokens = Math.max(0, response.usage.cachedWriteTokens || 0);
        proc.turnOutputTokens = Math.max(
          0,
          response.usage.outputTokens + (response.usage.thoughtTokens || 0)
        );
      }
      proc.totalInputTokens += proc.turnInputTokens;
      proc.totalOutputTokens += proc.turnOutputTokens;
      proc.cacheReadTokens += proc.turnCacheReadTokens;
      proc.cacheCreationTokens += proc.turnCacheCreationTokens;
      await this.emitUsage(sessionId, proc);
      const text = proc.streamingText.trim();
      if (text) await this.saveAssistantMessage(sessionId, text);
      this.saveUsageToDatabase(sessionId, proc);
      console.log(`[KIMI ACP] Turn completed [${sessionId}] reason=${response.stopReason}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[KIMI ACP] Prompt failed [${sessionId}]:`, error);
      const partial = proc.streamingText.trim();
      if (partial) await this.saveAssistantMessage(sessionId, `${partial}\n\n[Interrupted]`);
      this.io.to(`session:${sessionId}`).emit('session:error', {
        sessionId,
        error: `Kimi failed: ${message}`,
      });
    } finally {
      proc.streamingText = '';
      proc.isStreaming = false;
      proc.kimiIdle = true;
      proc.currentToolName = null;
      proc.currentToolId = null;
      proc.currentActivitySummary = null;
      proc.kimiThinkingText = '';
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
      this.emitStatus(sessionId, { sessionId, status: 'running' });
      this.emitQueueState(sessionId, proc);
      // A directly dispatched turn owns no drain loop, so kick one off for any
      // follow-ups that arrived while it was running. When a drain loop already
      // owns the turn it will continue synchronously after this promise resolves.
      if (!proc.kimiQueueDraining) {
        queueMicrotask(() => void this.drainKimiQueuedTurns(sessionId, proc));
      }
    }
  }

  private async drainKimiQueuedTurns(sessionId: string, proc: ClaudeProcess): Promise<void> {
    if (proc.cliProvider !== 'kimi' || !proc.kimiIdle || proc.kimiQueueDraining) return;
    proc.kimiQueueDraining = true;
    try {
      while (proc.kimiIdle) {
        const nextTurn = proc.kimiQueuedTurns?.shift();
        if (!nextTurn) break;
        await this.dispatchKimiAcpTurn(sessionId, proc, nextTurn);
      }
    } finally {
      proc.kimiQueueDraining = false;
      this.emitQueueState(sessionId, proc);
    }
  }

  /** Legacy `kimi -p` translator retained for old captured output fixtures. */
  private async dispatchKimiTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: CodexPreparedTurn,
    retriedWithoutResume = false
  ): Promise<void> {
    if (proc.codexIdle === false) {
      throw new Error('Kimi process is still running');
    }
    proc.currentChatId = turn.chatId;
    proc.codexIdle = false;
    proc.currentUsageTurnId = turn.queueId;
    proc.currentUsageTurnStartedAt = turn.queuedAt;
    if (turn.updateLastMessage) {
      proc.lastUserMessage = turn.originalMessage;
      proc.lastAttachments = turn.attachments || null;
    }
    proc.pendingPermissionDenials = null;
    proc.streamingText = '';
    proc.isStreaming = false;
    proc.buffer = '';
    proc.turnInputTokens = 0;
    proc.turnOutputTokens = 0;

    const providerConfig = CLI_PROVIDERS.kimi;
    const session = (await pgGet(
      'SELECT working_directory, allowed_directories FROM sessions WHERE id = ?',
      sessionId
    )) as unknown as { working_directory: string; allowed_directories: string | null } | undefined;
    const workingDirectory = session?.working_directory || proc.workingDirectory || os.homedir();
    let allowedDirectories: string[] = [];
    try {
      allowedDirectories = session?.allowed_directories
        ? JSON.parse(session.allowed_directories)
        : [];
    } catch {
      allowedDirectories = [];
    }

    const attemptedResumeId = proc.codexSessionId || proc.claudeSessionId || undefined;
    const args = getCLIArgs('kimi', {
      mode: proc.mode,
      model: proc.model && proc.model !== 'unknown' ? proc.model : undefined,
      // First turn must omit --session so Kimi creates its own native session.
      // processKimiLine captures and persists the emitted session.resume_hint id.
      resumeSessionId: attemptedResumeId,
      allowedDirectories,
      workingDirectory,
    });
    // kimi reads the prompt from the -p argument, never stdin.
    args.push('-p', turn.messageForClaude);

    const extraEnv: Record<string, string> = {};
    Object.assign(extraEnv, await buildIntegrationEnv());
    Object.assign(extraEnv, await buildAndroidDeviceEnvForSession(sessionId, proc.userId));

    console.log(
      `[KIMI] Respawning process for next message [${sessionId}] args=${args
        .filter((a) => a.length < 200)
        .join(' ')} -p <prompt>`
    );

    const child = spawnManagedProcess(providerConfig.command, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...extraEnv,
        WEBUI_SESSION_ID: sessionId,
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_PROJECT_PATH: workingDirectory,
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.process = child;
    let receivedStructuredOutput = false;
    let stderr = '';
    const quietProgressTimer = setTimeout(() => {
      const managedProc = this.processes.get(sessionId);
      if (managedProc?.process !== child || receivedStructuredOutput) return;
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        chatId: managedProc.currentChatId,
        content:
          '🌙 Kimi is working on the request. Complex first steps can stay quiet for a few minutes.\n\n',
        isComplete: false,
      });
    }, 8000);

    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    child.stdout?.on('data', async (data: Buffer) => {
      receivedStructuredOutput = true;
      clearTimeout(quietProgressTimer);
      await this.handleJsonOutput(sessionId, data.toString());
    });
    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr = `${stderr}${chunk}`.slice(-8_000);
      console.error(`Kimi stderr [${sessionId}]:`, chunk);
    });
    child.on('exit', async (exitCode) => {
      clearTimeout(quietProgressTimer);
      console.log(`[KIMI] Process for session ${sessionId} exited with code ${exitCode}`);
      const managedProc = this.processes.get(sessionId);
      if (!managedProc || managedProc.process !== child) return;

      if (
        exitCode !== 0 &&
        attemptedResumeId &&
        !retriedWithoutResume &&
        isKimiSessionNotFoundError(stderr)
      ) {
        console.warn(
          `[KIMI] Native session ${attemptedResumeId} is missing; retrying once without resume [${sessionId}]`
        );
        managedProc.codexSessionId = undefined;
        managedProc.claudeSessionId = null;
        managedProc.codexIdle = true;
        managedProc.streamingText = '';
        managedProc.isStreaming = false;
        await pgRun('UPDATE sessions SET claude_session_id = NULL WHERE id = ?', sessionId);
        void this.dispatchKimiTurn(sessionId, managedProc, turn, true).catch((error) => {
          console.error(`[KIMI] Fresh-session retry failed [${sessionId}]:`, error);
          managedProc.codexIdle = true;
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: false,
          });
          this.io.to(`session:${sessionId}`).emit('session:error', {
            sessionId,
            error: `Kimi failed to restart: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
        return;
      }

      const text = managedProc.streamingText.trim();
      if (text) {
        await this.saveAssistantMessage(sessionId, text);
      } else if (exitCode !== 0) {
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          chatId: managedProc.currentChatId,
          content: formatKimiExitMessage(exitCode, stderr),
          isComplete: false,
        });
      }
      managedProc.streamingText = '';
      managedProc.isStreaming = false;
      managedProc.codexIdle = true;
      this.saveUsageToDatabase(sessionId, managedProc);
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
      this.emitStatus(sessionId, { sessionId, status: 'running' });
    });
    child.on('error', (error) => {
      clearTimeout(quietProgressTimer);
      console.error(`Kimi process error [${sessionId}]:`, error);
      const managedProc = this.processes.get(sessionId);
      if (managedProc?.process === child) {
        managedProc.codexIdle = true;
        managedProc.streamingText = '';
        managedProc.isStreaming = false;
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
      this.io.to(`session:${sessionId}`).emit('session:error', {
        sessionId,
        error: `Kimi failed to start: ${error.message}`,
      });
    });
  }

  /**
   * Translate one Kimi stream-json NDJSON object into socket events. Kimi emits
   * OpenAI-style chat messages (assistant text / tool_calls, then tool results).
   * Defensive: any text found is streamed; unknown shapes are ignored rather
   * than crashing the turn. Refined against real output post-login.
   */
  private async processKimiLine(
    sessionId: string,
    proc: ClaudeProcess,
    raw: unknown
  ): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const obj = raw as Record<string, unknown>;
    const role = typeof obj.role === 'string' ? obj.role : '';

    const usage = (obj.usage ?? obj.token_usage ?? obj.tokens) as
      | Record<string, unknown>
      | undefined;
    if (usage && typeof usage === 'object') {
      const num = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0;
      if (proc.turnInputTokens === 0) {
        proc.turnInputTokens = num(usage.input_tokens ?? usage.prompt_tokens);
      }
      proc.turnOutputTokens = num(
        usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens
      );
    }

    const sid = obj.session_id ?? obj.sessionId ?? obj.id;
    if (typeof sid === 'string' && sid && !proc.codexSessionId) {
      proc.codexSessionId = sid;
      proc.claudeSessionId = sid;
      try {
        await pgRun('UPDATE sessions SET claude_session_id = ? WHERE id = ?', sid, sessionId);
        console.log(`[KIMI] Captured native session id ${sid} for ${sessionId}`);
      } catch (error) {
        console.warn('[KIMI] Failed to persist native session id:', error);
      }
    }

    let text: string | null = null;
    if (role === 'assistant') {
      const content = obj.content;
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((block) => {
            if (typeof block === 'string') return block;
            if (block && typeof block === 'object') {
              const b = block as Record<string, unknown>;
              if (typeof b.text === 'string') return b.text;
              if (typeof b.content === 'string') return b.content;
            }
            return '';
          })
          .join('');
      }
    } else if (!role && typeof obj.text === 'string') {
      text = obj.text;
    } else if (!role && typeof obj.content === 'string') {
      text = obj.content;
    }

    if (text && text.length > 0) {
      proc.streamingText += text;
      proc.isStreaming = true;
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        chatId: proc.currentChatId,
        content: text,
        isComplete: false,
      });
    }

    const toolCalls = obj.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        if (call && typeof call === 'object') {
          const c = call as Record<string, unknown>;
          const fn = c.function as Record<string, unknown> | undefined;
          const name = (fn?.name ?? c.name) as string | undefined;
          if (name) {
            this.io.to(`session:${sessionId}`).emit('session:output', {
              sessionId,
              chatId: proc.currentChatId,
              content: `\n🔧 ${name}\n`,
              isComplete: false,
            });
          }
        }
      }
    }
  }

  private async dispatchCodexTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: CodexPreparedTurn
  ): Promise<void> {
    if (proc.cliProvider !== 'codex') {
      throw new Error('dispatchCodexTurn called for non-Codex session');
    }
    if (!proc.codexIdle) {
      throw new Error('Codex process is still running');
    }
    proc.currentChatId = turn.chatId;
    proc.currentUsageTurnId = turn.queueId;
    proc.currentUsageTurnStartedAt = turn.queuedAt;
    proc.codexIdle = false;

    if (turn.updateLastMessage) {
      proc.lastUserMessage = turn.originalMessage;
      proc.lastAttachments = turn.attachments || null;
    }
    proc.pendingPermissionDenials = null;

    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    proc.codexPendingExecCommand = turn.codexExecCommand;
    proc.codexPendingImages = [...turn.codexImagePaths];

    console.log(`[CODEX] Respawning process for next message [${sessionId}]`);
    try {
      await this.respawnCodexProcess(sessionId, proc);
    } catch (err) {
      proc.codexIdle = true;
      throw err;
    }

    let payloadForProvider = turn.messageForClaude;
    if (!turn.codexExecCommand && !turn.codexNativeSlashCommand && !proc.codexSessionId) {
      // First turn or session id not yet captured — prepend prior conversation
      // so the fresh codex process has continuity. Once `session_meta` (or older
      // `thread.started`) lands
      // and proc.codexSessionId is set, subsequent respawns use native
      // `codex exec resume <id>` and we skip the manual prefix entirely.
      const contextPrefix = await this.buildCodexContextPrefix(
        sessionId,
        turn.originalMessage,
        turn.chatId
      );
      if (contextPrefix) {
        payloadForProvider = `${contextPrefix}\nUser's new message:\n${turn.messageForClaude}`;
      }
    }

    if (turn.codexExecCommand) {
      proc.process.stdin?.end();
    } else {
      proc.codexLastPromptEstimateTokens = Math.ceil(payloadForProvider.length / 4);
      proc.codexLastPromptPrefix = payloadForProvider.trim().slice(0, 512);
      proc.process.stdin?.end(formatInputMessage(proc.cliProvider, payloadForProvider));
    }

    console.log(
      `Sent message [${sessionId}] via codex: ${turn.messageForClaude.substring(0, 100)}...`
    );
  }

  private async drainCodexQueuedTurn(sessionId: string, proc: ClaudeProcess): Promise<void> {
    if (proc.cliProvider !== 'codex' || proc.codexSteerDraining || !proc.codexIdle) {
      return;
    }

    const nextTurn = proc.codexQueuedTurns?.shift();
    if (!nextTurn) {
      this.emitQueueState(sessionId, proc);
      return;
    }

    proc.codexSteerDraining = true;
    this.emitQueueState(sessionId, proc);
    try {
      await this.dispatchCodexTurn(sessionId, proc, nextTurn);
    } catch (err) {
      proc.codexQueuedTurns ??= [];
      proc.codexQueuedTurns.unshift(nextTurn);
      this.emitQueueState(sessionId, proc);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CODEX] Failed to dispatch queued follow-up [${sessionId}]:`, err);
      this.io.to(`session:${sessionId}`).emit('session:error', {
        sessionId,
        error: `Failed to start queued Codex message: ${message}`,
      });
      await this.notifyDiscordSessionEvent(sessionId, {
        eventType: 'session.error',
        severity: 'error',
        title: 'Codex queued turn failed',
        summary: `Failed to start queued Codex message: ${message}`,
      });
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    } finally {
      proc.codexSteerDraining = false;
    }
  }

  private async dispatchOpenCodeTurn(
    sessionId: string,
    proc: ClaudeProcess,
    turn: OpenCodePreparedTurn
  ): Promise<void> {
    if (proc.cliProvider !== 'opencode' || !proc.serverBacked || !proc.claudeSessionId) {
      throw new Error('OpenCode session is not ready');
    }

    proc.currentChatId = turn.chatId;
    proc.currentUsageTurnId = turn.queueId;
    proc.currentUsageTurnStartedAt = turn.queuedAt;

    if (turn.updateLastMessage) {
      proc.lastUserMessage = turn.originalMessage;
      proc.lastAttachments = turn.attachments || null;
    }
    proc.pendingPermissionDenials = null;
    proc.opencodeIdle = false;
    this.emitQueueState(sessionId, proc);
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    try {
      const selectedReasoning = await getCliReasoningForSession(proc.userId, 'opencode', sessionId);
      this.resetCurrentContextUsage(proc);
      proc.opencodeUsageBaseline = await opencodeServer.getUsageSnapshot(
        proc.claudeSessionId,
        proc.userId
      );

      if (turn.opencodeSlashCommand?.type === 'compact') {
        const compacted = await opencodeServer.compactSession(proc.claudeSessionId, {
          model: proc.model,
          mode: proc.mode,
          variant: selectedReasoning,
          directory: proc.workingDirectory,
          webuiSessionId: sessionId,
          userId: proc.userId,
        });
        if (!compacted) throw new Error('OpenCode compact endpoint is not available');
        proc.opencodeLastManualCompactAt = Date.now();
        proc.totalInputTokens = 0;
        proc.totalOutputTokens = 0;
        proc.cacheReadTokens = 0;
        proc.cacheCreationTokens = 0;
        this.resetCurrentContextUsage(proc);
        await this.emitUsage(sessionId, proc);
        await this.emitCompact(sessionId, {
          sessionId,
          message: 'OpenCode compacted session context.',
        });
        proc.opencodeIdle = true;
        this.emitQueueState(sessionId, proc);
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
        console.log(`Compacted opencode session [${sessionId}] via HTTP`);
        if (!proc.opencodeQueueDraining) {
          void this.drainOpenCodeQueuedTurns(sessionId, proc);
        }
        return;
      }

      if (turn.opencodeSlashCommand?.type === 'command') {
        await opencodeServer.sendCommand(proc.claudeSessionId, {
          turnId: turn.queueId,
          command: turn.opencodeSlashCommand.command,
          arguments: turn.opencodeSlashCommand.args,
          model: proc.model,
          mode: proc.mode,
          variant: selectedReasoning,
          directory: proc.workingDirectory,
          webuiSessionId: sessionId,
          userId: proc.userId,
        });
        console.log(
          `Sent command [${sessionId}] via opencode HTTP: /${turn.opencodeSlashCommand.command}`
        );
        return;
      }

      if (turn.opencodeSlashCommand?.type === 'plan') {
        await opencodeServer.sendPrompt(proc.claudeSessionId, {
          turnId: turn.queueId,
          text:
            turn.opencodeSlashCommand.args ||
            'Create a plan for the next work in this session. Do not edit files until the plan is accepted.',
          model: proc.model,
          agent: 'plan',
          mode: proc.mode,
          variant: selectedReasoning,
          directory: proc.workingDirectory,
          webuiSessionId: sessionId,
          userId: proc.userId,
        });
        console.log(`Sent plan request [${sessionId}] via opencode plan agent`);
        return;
      }

      await opencodeServer.sendPrompt(proc.claudeSessionId, {
        turnId: turn.queueId,
        text: turn.messageForClaude,
        model: proc.model,
        mode: proc.mode,
        variant: selectedReasoning,
        directory: proc.workingDirectory,
        webuiSessionId: sessionId,
        userId: proc.userId,
      });
      console.log(
        `Sent message [${sessionId}] via opencode HTTP: ${turn.messageForClaude.substring(0, 100)}...`
      );
    } catch (err) {
      proc.opencodeIdle = true;
      this.emitQueueState(sessionId, proc);
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
      throw err;
    }
  }

  private async drainOpenCodeQueuedTurns(sessionId: string, proc: ClaudeProcess): Promise<void> {
    if (proc.cliProvider !== 'opencode' || proc.opencodeQueueDraining || !proc.opencodeIdle) {
      return;
    }

    const nextTurn = proc.opencodeQueuedTurns?.shift();
    if (!nextTurn) {
      this.emitQueueState(sessionId, proc);
      return;
    }

    proc.opencodeQueueDraining = true;
    let dispatchedSuccessfully = false;
    this.emitQueueState(sessionId, proc);
    try {
      await this.dispatchOpenCodeTurn(sessionId, proc, nextTurn);
      dispatchedSuccessfully = true;
    } catch (err) {
      proc.opencodeQueuedTurns?.unshift(nextTurn);
      proc.opencodeIdle = true;
      this.emitQueueState(sessionId, proc);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[OPENCODE] Failed to dispatch queued turn [${sessionId}]:`, err);
      this.io.to(`session:${sessionId}`).emit('session:error', {
        sessionId,
        error: `Failed to start queued OpenCode message: ${message}`,
      });
      await this.notifyDiscordSessionEvent(sessionId, {
        eventType: 'session.error',
        severity: 'error',
        title: 'OpenCode queued turn failed',
        summary: `Failed to start queued OpenCode message: ${message}`,
      });
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    } finally {
      proc.opencodeQueueDraining = false;
      if (
        dispatchedSuccessfully &&
        proc.opencodeIdle &&
        (proc.opencodeQueuedTurns?.length ?? 0) > 0
      ) {
        void this.drainOpenCodeQueuedTurns(sessionId, proc);
      }
    }
  }

  async sendMessage(
    sessionId: string,
    userId: string,
    message: string,
    attachments?: FileAttachmentData[],
    options?: {
      chatId?: string | null;
      recordMessage?: boolean;
      updateLastMessage?: boolean;
      activeFollowupMode?: ActiveFollowupMode;
      clientMessageId?: string;
      uploadIds?: string[];
      /** Internal: set when re-dispatching after a mid-send session restart. */
      staleProcRedispatch?: boolean;
    }
  ): Promise<SendMessageResult> {
    await assertRunnerAccess(userId);
    // Resolve once before reading attachments. Later cross-device switches may
    // change sessions.active_chat_id, but this turn remains pinned here.
    const targetChatId = await resolveSessionSendChatId(sessionId, userId, options?.chatId);
    let proc = this.processes.get(sessionId);

    if (!proc) {
      await this.startSession(sessionId, userId);
      proc = this.processes.get(sessionId);
      if (!proc) {
        throw new Error('Failed to start session');
      }
      // Wait for Claude to initialize
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }
    if (proc.providerChatId !== targetChatId) {
      throw new Error('Provider context belongs to a different chat; retry after switching');
    }
    proc.currentChatId = targetChatId;

    const materializedAttachments = await materializeAttachments(
      attachments,
      proc.workingDirectory
    );
    const filePaths = materializedAttachments.files;
    const inlineTextContents = materializedAttachments.inlineText;

    // Build message for Claude (with attachment instructions and/or working dir reminder if needed)
    let messageForClaude = message;
    const codexReviewCommand =
      proc.cliProvider === 'codex' ? parseCodexReviewCommand(message) : null;
    const codexNativeSlashCommand =
      proc.cliProvider === 'codex' && !codexReviewCommand && isCodexNativeSlashCommand(message);
    const opencodeSlashCommand =
      proc.cliProvider === 'opencode' ? parseOpenCodeSlashCommand(message) : null;
    const piNativeSlashCommand = proc.cliProvider === 'pi' && message.trimStart().startsWith('/');
    const piCompactCommand =
      proc.cliProvider === 'pi' && /^\/compact(?:\s|$)/i.test(message.trim());
    const providerNativeSlashCommand =
      codexNativeSlashCommand || Boolean(opencodeSlashCommand) || piNativeSlashCommand;
    let codexExecCommandForTurn: CodexPreparedTurn['codexExecCommand'];
    const codexImagePathsForTurn: string[] = [];
    if (codexReviewCommand) {
      codexExecCommandForTurn = {
        type: 'review',
        args: codexReviewCommand.args,
        prompt: codexReviewCommand.prompt,
      };
      messageForClaude = '';
    }

    // Add working directory reminder for resumed sessions (only once)
    if (proc.needsWorkingDirReminder && !providerNativeSlashCommand) {
      const workingDirReminder = `<system-reminder>
IMPORTANT: Your current working directory is: ${proc.workingDirectory}
This is the project you should be working on. All file operations should be relative to this directory.
</system-reminder>

`;
      messageForClaude = workingDirReminder + messageForClaude;
      proc.needsWorkingDirReminder = false;
      console.log(`Added working directory reminder for resumed session [${sessionId}]`);
    }

    if (proc.contextReminder && !providerNativeSlashCommand) {
      let label = 'Context from previous session';
      if (proc.contextReminder.reason === 'provider-switch') {
        label = 'Provider switch handoff (detailed)';
      } else if (proc.contextReminder.reason === 'context-limit') {
        label = 'Context compacted after limit reached';
      } else {
        label = 'Context from previous session (mode change)';
      }
      const contextReminder = `<system-reminder>
${label}:
${proc.contextReminder.summary}
</system-reminder>

`;
      messageForClaude = contextReminder + messageForClaude;
      proc.contextReminder = null;
      console.log(`Added context reminder after ${label.toLowerCase()} [${sessionId}]`);
    }

    if (!codexReviewCommand && !providerNativeSlashCommand) {
      const discordGatewayContext = await this.buildDiscordGatewayContext(sessionId, proc);
      if (discordGatewayContext && proc.discordGatewayContextInjected !== discordGatewayContext) {
        messageForClaude = `${discordGatewayContext}\n\n${messageForClaude}`;
        proc.discordGatewayContextInjected = discordGatewayContext;
      }
    }

    if (
      proc.cliProvider === 'codex' &&
      !codexReviewCommand &&
      !providerNativeSlashCommand &&
      !proc.sharedContextInjected
    ) {
      const configHome = resolveConfigHome(proc.cliProvider);
      const [agents, skills, plugins] = await Promise.all([
        readSharedAgents(configHome),
        readSharedSkills(configHome),
        readSharedPlugins(configHome),
      ]);
      const sharedContext = formatCodexSharedContext(agents, skills, plugins);
      if (sharedContext) {
        messageForClaude = `${sharedContext}\n\n${messageForClaude}`;
      }
      proc.sharedContextInjected = true;
    }

    if (
      !codexReviewCommand &&
      !providerNativeSlashCommand &&
      proc.cliProvider !== 'opencode' &&
      proc.modePromptInjected !== proc.mode
    ) {
      const modePrompt = this.getModePrompt(proc.mode);
      if (modePrompt) {
        messageForClaude = `${modePrompt}\n\n${messageForClaude}`;
        proc.modePromptInjected = proc.mode;
      }
    }

    if (!codexReviewCommand && !providerNativeSlashCommand) {
      const androidDeviceSerial = await getAndroidDeviceSerialForSession(sessionId, userId);
      if (androidDeviceSerial && proc.androidDeviceSerialInjected !== androidDeviceSerial) {
        const androidContext = await buildAndroidDeviceContext(sessionId, userId);
        if (androidContext) {
          messageForClaude = `${androidContext}\n\n${messageForClaude}`;
          proc.androidDeviceSerialInjected = androidDeviceSerial;
        }
      } else if (!androidDeviceSerial && proc.androidDeviceSerialInjected) {
        messageForClaude = `<system-reminder>\nNo Android test device is currently selected for this Plum session.\n</system-reminder>\n\n${messageForClaude}`;
        proc.androidDeviceSerialInjected = null;
      }
    }

    if (!codexReviewCommand && !providerNativeSlashCommand) {
      const sessionStyleContext = await buildSessionStyleContext(
        sessionId,
        userId,
        proc.cliProvider
      );
      if (shouldInjectSessionStyleContext(proc.sessionStyleContextInjected, sessionStyleContext)) {
        if (sessionStyleContext) {
          messageForClaude = `${sessionStyleContext}\n\n${messageForClaude}`;
        } else if (proc.sessionStyleContextInjected) {
          const styleClearedContext = [
            '<session-style-library>',
            'The active style-library selection was cleared for this session. Do not continue applying its prior style instructions unless the user asks for them.',
            '</session-style-library>',
          ].join('\n');
          messageForClaude = `${styleClearedContext}\n\n${messageForClaude}`;
        }
        proc.sessionStyleContextInjected = sessionStyleContext;
      }
    }

    // Add inline text content directly to the message
    if (inlineTextContents.length > 0) {
      const textParts = inlineTextContents.map(
        (tc) => `<attached-file name="${tc.filename}">\n${tc.content}\n</attached-file>`
      );
      messageForClaude = `${textParts.join('\n\n')}\n\n${messageForClaude}`;
    }

    if (materializedAttachments.rejected.length > 0) {
      const rejected = materializedAttachments.rejected
        .map((item) => `- ${item.filename}: ${item.reason}`)
        .join('\n');
      messageForClaude = `<attachment-warnings>\n${rejected}\n</attachment-warnings>\n\n${messageForClaude}`;
    }

    // Add file references for files that need to be read from disk
    if (filePaths.length > 0) {
      const imageFiles = filePaths.filter((f) => f.type === 'image');
      const pdfFiles = filePaths.filter((f) => f.type === 'pdf');
      const otherFiles = filePaths.filter((f) => f.type !== 'image' && f.type !== 'pdf');

      const instructions: string[] = [];

      if (imageFiles.length > 0) {
        const refs = imageFiles.map((f) => `- ${f.path}`).join('\n');
        if (proc.cliProvider === 'opencode') {
          const names = imageFiles.map((f) => f.filename).join(', ');
          const bridgeDescription = await describeImagesWithCodex({
            imagePaths: imageFiles.map((f) => f.path),
            userPrompt: message,
            cwd: proc.workingDirectory,
            sessionId,
          });
          if (bridgeDescription) {
            instructions.push(
              `The user attached ${imageFiles.length} image file(s) (${names}), saved at:\n${refs}\n\n` +
                `OpenCode is receiving these image attachments through Plum Code WebUI's Codex vision bridge, so Codex pre-read the image(s) and produced these visual notes:\n` +
                `<image-vision-notes provider="codex">\n${bridgeDescription}\n</image-vision-notes>\n\n` +
                `Use these notes as the image content. If you need exact pixels or OCR beyond these notes, say what is missing.`
            );
          } else {
            instructions.push(
              `The user attached ${imageFiles.length} image file(s) (${names}), saved at:\n${refs}\n` +
                `OpenCode did not receive native vision content and the Codex vision bridge failed. Do not pretend to see the image; ` +
                `ask the user for a text description or switch to Codex/Claude for this image-specific turn.`
            );
          }
        } else if (proc.cliProvider === 'codex') {
          // Codex supports native multimodal input via --image. Stage the paths for
          // this turn's respawn instead of asking the model to Read them — that wastes
          // a tool turn and the model can't actually see PNG bytes via fs reads anyway.
          codexImagePathsForTurn.push(...imageFiles.map((f) => f.path));
        } else {
          instructions.push(
            `Please analyze the following image files:\n${refs}\nUse the Read tool on these paths.`
          );
        }
      }

      if (pdfFiles.length > 0) {
        const refs = pdfFiles.map((f) => `- ${f.path}`).join('\n');
        instructions.push(
          `Please read and analyze the following PDF files:\n${refs}\nUse the Read tool on these paths.`
        );
      }

      if (otherFiles.length > 0) {
        const refs = otherFiles.map((f) => `- ${f.path}`).join('\n');
        instructions.push(
          `Please read the following files:\n${refs}\nUse the Read tool on these paths.`
        );
      }

      if (instructions.length > 0) {
        messageForClaude = instructions.join('\n\n') + '\n\n' + messageForClaude;
      }
    }

    // Build attachment metadata for frontend (for backwards compatibility, images go in 'images' field)
    const imageMetadata = filePaths
      .filter((f) => f.type === 'image')
      .map((f) => ({
        path: f.path,
        filename: f.filename,
      }));

    // All attachments metadata (for new attachments field)
    const attachmentMetadata = [
      ...filePaths.map((f) => ({
        path: f.path,
        filename: f.filename,
        mimeType: f.mimeType,
        type: f.type,
      })),
      ...inlineTextContents.map((tc) => ({
        path: '',
        filename: tc.filename,
        mimeType: tc.mimeType,
        type: 'text' as const,
      })),
    ];

    const defaultRecordMessage = shouldRecordProviderUserMessage(proc.cliProvider, message);
    const recordMessage = options?.recordMessage ?? defaultRecordMessage;
    const updateLastMessage = options?.updateLastMessage ?? defaultRecordMessage;
    const recordedMessageId = nanoid();
    const recordedCreatedAt = new Date().toISOString();
    const recordedChatId = targetChatId;
    let recordedEventSequence: number | undefined;

    if (recordMessage) {
      // Save user message and emit to frontend (show original message, images as metadata)
      recordedEventSequence = await this.allocateEventSequence(sessionId);
      await pgRun(
        `INSERT INTO messages (
           id, session_id, chat_id, role, content, client_message_id, event_sequence
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        recordedMessageId,
        sessionId,
        recordedChatId,
        'user',
        message, // Store only the user's original message
        options?.clientMessageId ?? null,
        recordedEventSequence
      );
      // Keep the session list preview in sync with the newest activity — previously
      // only assistant replies touched last_message, so user-only sessions showed
      // a stale preview until Claude responded.
      const preview = message.length > 200 ? message.slice(0, 200) : message;
      await pgRun(
        'UPDATE sessions SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        preview,
        sessionId
      );

      // Persist every accepted upload as durable chat media. Clients render
      // from `media` (served via /api/sessions/:id/media/:mediaId); the raw
      // attachment paths are server-local and the one-shot legacy metadata is
      // not part of REST history.
      let userMedia: Awaited<ReturnType<typeof persistMessageMedia>> = [];
      const uploadedMedia: PendingChatMedia[] = [
        ...filePaths.map((file, index) => ({
          kind: 'file' as const,
          filePath: file.path,
          allowedRoots: [path.join(proc.workingDirectory, '.claude-webui-attachments')],
          filename: file.originalFilename,
          mimeType: file.mimeType,
          source: 'user' as const,
          sourceId: `upload:${recordedMessageId}:file:${index}`,
        })),
        ...inlineTextContents.map((file, index) => ({
          kind: 'buffer' as const,
          buffer: Buffer.from(file.content, 'utf8'),
          filename: file.originalFilename,
          mimeType: file.mimeType,
          source: 'user' as const,
          sourceId: `upload:${recordedMessageId}:inline:${index}`,
        })),
      ];
      if (uploadedMedia.length > 0) {
        try {
          userMedia = await persistMessageMedia({
            messageId: recordedMessageId,
            sessionId,
            userId,
            media: uploadedMedia,
          });
        } catch (error) {
          console.error(`[MEDIA] Failed to persist user media [${sessionId}]:`, error);
          await pgRun('DELETE FROM messages WHERE id = ?', recordedMessageId);
          throw new Error(
            `Failed to persist message attachments: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (options?.uploadIds?.length) {
        try {
          markChatUploadsConsumed(
            userId,
            sessionId,
            options.uploadIds,
            recordedMessageId,
            options.clientMessageId ?? ''
          );
        } catch (error) {
          await pgRun('DELETE FROM messages WHERE id = ?', recordedMessageId);
          throw error;
        }
      }

      // Emit user message to frontend so it appears in chat
      const userMessage = {
        id: recordedMessageId,
        sessionId,
        chatId: recordedChatId,
        role: 'user',
        content: message,
        createdAt: recordedCreatedAt,
        clientMessageId: options?.clientMessageId,
        eventSequence: recordedEventSequence,
        images: imageMetadata.length > 0 ? imageMetadata : undefined,
        attachments: attachmentMetadata.length > 0 ? attachmentMetadata : undefined,
        ...(userMedia.length > 0 ? { media: userMedia } : {}),
      } as const;
      this.emitBufferedEvent(
        sessionId,
        'message',
        userMessage,
        (sequenced) => {
          this.io.to(`session:${sessionId}`).emit('session:message', sequenced);
        },
        recordedEventSequence
      );

      this.events.emit('userMessage', sessionId, message);
    }

    if (proc.cliProvider === 'codex') {
      const codexTurn: CodexPreparedTurn = {
        queueId: recordedMessageId,
        chatId: recordedChatId,
        queuedAt: recordedCreatedAt,
        originalMessage: message,
        messageForClaude,
        attachments,
        updateLastMessage,
        codexImagePaths: codexImagePathsForTurn,
        codexExecCommand: codexExecCommandForTurn,
        codexNativeSlashCommand,
      };

      if (!proc.codexIdle || proc.codexSteerDraining) {
        const activeFollowupMode =
          options?.activeFollowupMode ??
          (process.env.CODEX_PREEMPT_FOLLOWUPS === '1' ? 'steer' : 'queue');
        this.queueCodexTurn(sessionId, proc, codexTurn, activeFollowupMode);
        if (activeFollowupMode === 'steer') {
          await this.requestCodexSteeringPreemption(sessionId, proc);
        }
        return {
          ...(recordMessage ? { messageId: recordedMessageId } : {}),
          chatId: recordedChatId,
          disposition: 'queued',
          highWatermark:
            recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
        };
      }

      await this.dispatchCodexTurn(sessionId, proc, codexTurn);
      return {
        ...(recordMessage ? { messageId: recordedMessageId } : {}),
        chatId: recordedChatId,
        disposition: 'dispatched',
        highWatermark:
          recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
      };
    }

    if (proc.cliProvider === 'opencode' && proc.serverBacked && proc.claudeSessionId) {
      const opencodeTurn: OpenCodePreparedTurn = {
        queueId: recordedMessageId,
        chatId: recordedChatId,
        queuedAt: recordedCreatedAt,
        originalMessage: message,
        messageForClaude,
        attachments,
        updateLastMessage,
        opencodeSlashCommand,
      };

      if (proc.opencodeIdle === false || proc.opencodeQueueDraining) {
        this.queueOpenCodeTurn(sessionId, proc, opencodeTurn);
        return {
          ...(recordMessage ? { messageId: recordedMessageId } : {}),
          chatId: recordedChatId,
          disposition: 'queued',
          highWatermark:
            recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
        };
      }

      await this.dispatchOpenCodeTurn(sessionId, proc, opencodeTurn);
      return {
        ...(recordMessage ? { messageId: recordedMessageId } : {}),
        chatId: recordedChatId,
        disposition: 'dispatched',
        highWatermark:
          recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
      };
    }

    if (isClaudeTransportProvider(proc.cliProvider)) {
      const claudeTurn: ClaudePreparedTurn = {
        queueId: recordedMessageId,
        chatId: recordedChatId,
        queuedAt: recordedCreatedAt,
        originalMessage: message,
        messageForClaude,
        attachments,
        updateLastMessage,
      };

      if (proc.claudeIdle === false || proc.claudeQueueDraining) {
        this.queueClaudeTurn(sessionId, proc, claudeTurn);
        return {
          ...(recordMessage ? { messageId: recordedMessageId } : {}),
          chatId: recordedChatId,
          disposition: 'queued',
          highWatermark:
            recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
        };
      }

      this.dispatchClaudeTurn(sessionId, proc, claudeTurn);
      return {
        ...(recordMessage ? { messageId: recordedMessageId } : {}),
        chatId: recordedChatId,
        disposition: 'dispatched',
        highWatermark:
          recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
      };
    }

    if (proc.cliProvider === 'kimi') {
      const kimiTurn: CodexPreparedTurn = {
        queueId: recordedMessageId,
        chatId: recordedChatId,
        queuedAt: recordedCreatedAt,
        originalMessage: message,
        messageForClaude,
        attachments,
        updateLastMessage,
        codexImagePaths: [],
        codexExecCommand: undefined,
        codexNativeSlashCommand: false,
      };
      if (proc.kimiIdle === false || proc.kimiQueueDraining) {
        this.queueKimiTurn(sessionId, proc, kimiTurn);
        return {
          ...(recordMessage ? { messageId: recordedMessageId } : {}),
          chatId: recordedChatId,
          disposition: 'queued',
          highWatermark:
            recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
        };
      }
      await this.dispatchKimiAcpTurn(sessionId, proc, kimiTurn);
      return {
        ...(recordMessage ? { messageId: recordedMessageId } : {}),
        chatId: recordedChatId,
        disposition: 'dispatched',
        highWatermark:
          recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
      };
    }

    // The context reads above awaited; the session may have been restarted
    // (mode change, permission approval, provider reload) in the meantime.
    // Never write into the stale child — its stdin is dead or belongs to a
    // replaced turn. Re-dispatch once through the current transport instead;
    // the user message is already recorded, so the retry must not re-record.
    if (this.processes.get(sessionId) !== proc) {
      if (options?.staleProcRedispatch) {
        throw new Error('Session restarted repeatedly while sending; message not delivered');
      }
      console.warn(`[SEND] Session ${sessionId} restarted mid-send; re-dispatching message`);
      const redispatched = await this.sendMessage(sessionId, userId, message, attachments, {
        ...options,
        chatId: targetChatId,
        recordMessage: false,
        staleProcRedispatch: true,
      });
      return {
        ...redispatched,
        ...(recordMessage ? { messageId: recordedMessageId } : {}),
      };
    }

    if (updateLastMessage) {
      // Track last message for permission approval resend
      proc.lastUserMessage = message;
      proc.lastAttachments = attachments || null;
    }
    proc.pendingPermissionDenials = null; // Clear any previous denials

    if (piCompactCommand) {
      // Manual compaction is not a turn — leave piTurnInFlight alone so an
      // in-flight turn still gets resumed once compaction finishes.
      if (proc.process.stdin?.writable) {
        proc.process.stdin.write(`${JSON.stringify({ type: 'compact' })}\n`);
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });
      return {
        ...(recordMessage ? { messageId: recordedMessageId } : {}),
        chatId: recordedChatId,
        disposition: 'dispatched',
        highWatermark:
          recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
      };
    }

    if (proc.cliProvider === 'pi') {
      this.clearPiCompactResumeTimer(proc);
      proc.piTurnInFlight = true;
      proc.piCompactContinuations = 0;
    }

    proc.currentUsageTurnId = recordedMessageId;
    proc.currentUsageTurnStartedAt = recordedCreatedAt;

    // Emit thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    const formattedMessage = formatInputMessage(proc.cliProvider, messageForClaude);
    if (proc.process.stdin?.writable) {
      proc.process.stdin.write(formattedMessage);
      console.log(
        `Sent message [${sessionId}] via ${proc.cliProvider}: ${messageForClaude.substring(0, 100)}...`
      );
    } else {
      console.warn(`[SEND] stdin no longer writable for ${proc.cliProvider} [${sessionId}]`);
    }
    return {
      ...(recordMessage ? { messageId: recordedMessageId } : {}),
      chatId: recordedChatId,
      disposition: 'dispatched',
      highWatermark: recordedEventSequence ?? (await getSessionSyncState(sessionId)).highWatermark,
    };
  }

  async interrupt(sessionId: string, userId: string): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      throw new Error('Session not running');
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    console.log(`Interrupting session [${sessionId}]`);

    // An explicit interrupt ends the turn — drop any pending compaction nudge.
    this.clearPiCompactResumeTimer(proc);
    proc.piTurnInFlight = false;
    proc.piCompactContinuations = 0;

    // Clear any pending streaming content
    if (proc.streamingText.trim().length > 0) {
      // Save partial response before interrupt
      await this.saveAssistantMessage(sessionId, proc.streamingText.trim() + '\n\n[Interrupted]');
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    // Stop thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: false,
    });

    // Server-backed opencode: abort the in-flight prompt via HTTP.
    if (proc.serverBacked && proc.cliProvider === 'opencode' && proc.claudeSessionId) {
      void opencodeServer.abort(proc.claudeSessionId, proc.userId);
      return;
    }

    if (proc.cliProvider === 'pi' && proc.process.stdin?.writable) {
      proc.process.stdin.write(`${JSON.stringify({ type: 'abort' })}\n`);
      proc.isStreaming = false;
      proc.currentToolName = null;
      proc.currentToolId = null;
      return;
    }

    if (proc.cliProvider === 'kimi' && proc.kimiAcpConnection && proc.kimiAcpSessionId) {
      void proc.kimiAcpConnection
        .cancel({ sessionId: proc.kimiAcpSessionId })
        .catch((error) => console.error(`[KIMI ACP] Cancel failed [${sessionId}]:`, error));
      return;
    }

    // Send interrupt signal
    signalManagedProcess(proc.process, 'SIGINT');
  }

  async sendRawInput(sessionId: string, userId: string, input: string): Promise<void> {
    // In stream-json mode, raw input is treated as a user message
    await this.sendMessage(sessionId, userId, input);
  }

  async stopSession(sessionId: string, userId: string): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    // The router token dies with the session. A respawn mints a new one, so
    // this is belt-and-braces rather than load-bearing, but a stopped session
    // should not leave a working credential behind.
    modelRouter.unregisterSession(sessionId);

    if (proc.serverBacked && proc.cliProvider === 'opencode') {
      this.detachProcessForRestart(proc);
      await this.cleanupProcess(sessionId, proc);
      return;
    }

    // Close stdin to signal end
    proc.process.stdin?.end();

    setTimeout(async () => {
      if (this.processes.get(sessionId) === proc) {
        terminateManagedProcess(proc.process);
        await this.cleanupProcess(sessionId, proc);
      }
    }, 2000);
  }

  private detachProcessForRestart(proc: ClaudeProcess): void {
    if (proc.serverBacked && proc.cliProvider === 'opencode' && proc.claudeSessionId) {
      void opencodeServer.abort(proc.claudeSessionId, proc.userId);
      opencodeServer.unsubscribe(proc.claudeSessionId, proc.userId);
      return;
    }

    terminateManagedProcess(proc.process);
  }

  // Restart a session. Runtime-setting changes preserve the provider-native
  // conversation so a model/reasoning switch applies without discarding chat
  // context; an explicit user restart still starts fresh.
  async restartSession(
    sessionId: string,
    userId: string,
    options: { preserveNativeContext?: boolean } = {}
  ): Promise<void> {
    console.log(`[SESSION] Restarting session ${sessionId}`);

    const proc = this.processes.get(sessionId);

    // A runtime-setting reload (model, reasoning, provider, service tier) must
    // never kill a turn that is mid-flight: the answer is discarded with no
    // trace, and the queued follow-ups below are cleared with it. Switching the
    // model while a long answer was generating was exactly how a session ended
    // up looking permanently stuck. An explicit restart still stops now — that
    // is what the user asked for.
    if (proc && options.preserveNativeContext && this.getSessionRuntimeSnapshot(sessionId).busy) {
      proc.deferredRestart = { userId, options };
      console.log(
        `[SESSION] Turn in flight for ${sessionId}; reloading settings after it finishes`
      );
      await this.emitCompact(sessionId, {
        sessionId,
        message: 'Setting saved. It takes effect after the current turn finishes.',
        clear: false,
        reason: 'settings-deferred',
      });
      return;
    }

    const sessionRow = (await pgGet(
      'SELECT cli_provider as cliProvider FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    )) as unknown as { cliProvider: CLIProvider | null } | undefined;
    const nextProvider = sessionRow?.cliProvider || proc?.cliProvider || 'codex';
    const providerChanged = !!proc && nextProvider !== proc.cliProvider;

    if (providerChanged) {
      this.pendingContextReminders.delete(sessionId);
      await this.emitCompact(sessionId, {
        sessionId,
        message: 'Provider switched. Fresh CLI context started.',
        clear: true,
        reason: 'provider-switch',
      });
    }
    const currentMode = proc?.mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';

    // Stop if running
    if (proc) {
      if (proc.userId !== userId) {
        throw new Error('Unauthorized');
      }

      proc.codexQueuedTurns = [];
      proc.codexSteerDraining = false;
      proc.codexPreemptingForSteer = false;
      proc.opencodeQueuedTurns = [];
      proc.opencodeQueueDraining = false;
      proc.opencodeIdle = true;
      proc.claudeQueuedTurns = [];
      proc.claudeQueueDraining = false;
      proc.claudeIdle = true;
      proc.kimiQueuedTurns = [];
      proc.kimiQueueDraining = false;
      proc.kimiIdle = true;
      this.emitQueueState(sessionId, proc);
      // Stop the provider transport immediately. Server-backed OpenCode sessions
      // need an HTTP abort plus handler cleanup; their virtual child kill is a no-op.
      this.detachProcessForRestart(proc);
      this.processes.delete(sessionId);
    }

    if (options.preserveNativeContext) {
      await pgRun(
        'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        'stopped',
        sessionId
      );
      console.log(`[SESSION] Preserving provider session context for runtime-setting reload`);
    } else {
      // Explicit restarts intentionally begin a fresh provider conversation.
      await pgRun(
        'UPDATE sessions SET status = ?, claude_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        'stopped',
        sessionId
      );
      console.log(`[SESSION] Cleared claude_session_id for fresh start`);
    }

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Start fresh with the same mode
    await this.startSession(sessionId, userId, currentMode);

    console.log(`[SESSION] Session ${sessionId} restarted`);
  }

  private async buildContextSummary(
    sessionId: string,
    maxMessages: number,
    maxChars: number,
    chatId: string | null
  ): Promise<string | null> {
    const rows = (await pgAll(
      'SELECT role, content FROM messages WHERE session_id = ? AND chat_id IS ? ORDER BY created_at DESC, seq DESC LIMIT ?',
      sessionId,
      chatId,
      maxMessages
    )) as unknown as { role: string; content: string }[];

    if (!rows.length) {
      return null;
    }

    const formatted = rows
      .reverse()
      .map((row) => {
        const role =
          row.role === 'assistant' ? 'Assistant' : row.role === 'user' ? 'User' : row.role;
        return `${role}: ${row.content.trim()}`;
      })
      .join('\n\n');

    if (formatted.length <= maxChars) {
      return formatted;
    }

    return `${formatted.slice(0, maxChars)}...`;
  }

  /**
   * Build a Codex-friendly transcript of prior turns, excluding the just-saved
   * latest user message (which becomes the new prompt).
   *
   * Codex CLI has no native resume — every turn is a fresh process. To simulate
   * continuity, we prepend a structured transcript so the model has context.
   *
   * Returns null if there are no prior turns to replay.
   */
  private async buildCodexContextPrefix(
    sessionId: string,
    latestUserMessage: string,
    chatId: string | null
  ): Promise<string | null> {
    const MAX_MESSAGES = 40;
    const MAX_CHARS = 24_000;

    const rows = (await pgAll(
      'SELECT role, content FROM messages WHERE session_id = ? AND chat_id IS ? ORDER BY created_at DESC, seq DESC LIMIT ?',
      sessionId,
      chatId,
      MAX_MESSAGES + 1
    )) as unknown as { role: string; content: string }[];

    const newest = rows[0];
    if (!newest) return null;

    // Drop the just-saved latest user message if it matches (sendMessage saves
    // before respawn, so it's the newest row when we get here).
    const prior =
      newest.role === 'user' && newest.content.trim() === latestUserMessage.trim()
        ? rows.slice(1)
        : rows;

    if (!prior.length) return null;

    const formatted = prior
      .slice(0, MAX_MESSAGES)
      .reverse()
      .map((row) => {
        const role =
          row.role === 'assistant' ? 'Assistant' : row.role === 'user' ? 'User' : row.role;
        return `${role}: ${row.content.trim()}`;
      })
      .join('\n\n');

    if (!formatted.trim()) return null;

    const truncated =
      formatted.length > MAX_CHARS
        ? '[earlier turns omitted]\n\n' + formatted.slice(formatted.length - MAX_CHARS)
        : formatted;

    return [
      '[Prior conversation context — for your reference only, do not repeat verbatim]',
      truncated,
      '[End of prior context]',
      '',
    ].join('\n');
  }

  // Set permission mode for a session
  async setMode(sessionId: string, userId: string, mode: SessionMode): Promise<void> {
    const proc = this.processes.get(sessionId);

    // If no process running, store the mode for when it starts
    if (!proc) {
      console.log(
        `[MODE] No running process for ${sessionId}, storing mode ${mode} for next start`
      );
      this.pendingModes.set(sessionId, mode);
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    if (proc.mode === mode) {
      console.log(`[MODE] Session ${sessionId} already in mode ${mode}`);
      return;
    }

    console.log(`[MODE] Changing session ${sessionId} from ${proc.mode} to ${mode}`);

    // Store the new mode
    const previousMode = proc.mode;
    proc.mode = mode;
    this.emitModeChange(sessionId, mode);

    if (proc.cliProvider === 'kimi' && proc.kimiAcpConnection && proc.kimiAcpSessionId) {
      const acpMode = kimiAcpModeForSessionMode(mode);
      void proc.kimiAcpConnection
        .setSessionConfigOption({
          sessionId: proc.kimiAcpSessionId,
          configId: 'mode',
          value: acpMode,
        })
        .then((result) => {
          proc.kimiAcpConfigOptions = result.configOptions;
          console.log(`[MODE] Applied ${mode} through Kimi ACP [${sessionId}]`);
        })
        .catch((error) => {
          console.error(`[MODE] Failed to apply Kimi ACP mode [${sessionId}]:`, error);
          proc.mode = previousMode;
          this.emitModeChange(sessionId, previousMode);
          this.io.to(`session:${sessionId}`).emit('session:error', {
            sessionId,
            error: `Kimi mode change failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      return;
    }

    // Codex reads the permission mode when the next child is spawned.
    // Restarting their virtual session here can race with a simultaneous send:
    // the old child keeps running after the process slot is replaced and its
    // output is then discarded. Apply the mode in place instead; an active turn
    // finishes normally and the new mode takes effect on the following turn.
    if (appliesModeOnNextTurnWithoutRestart(proc.cliProvider)) {
      console.log(
        `[MODE] Applied ${mode} in place for per-turn provider ${proc.cliProvider} [${sessionId}]`
      );
      return;
    }

    // Claude takes the permission mode as a spawn flag, so the process really
    // does have to restart — but not on top of a running turn. Killing the
    // child mid-turn discards the answer silently, and a client that re-asserts
    // its mode on every reconnect (two clients disagreeing is enough) can do
    // that on every attempt, leaving the session looking permanently mute.
    if (proc.claudeIdle === false) {
      console.log(`[MODE] Turn in flight for ${sessionId}; applying ${mode} after it completes`);
      proc.claudeDeferredModeRestart = { mode, userId, previousMode };
      return;
    }

    await this.restartForMode(sessionId, proc, mode, userId, previousMode);
  }

  private async restartForMode(
    sessionId: string,
    proc: ClaudeProcess,
    mode: SessionMode,
    userId: string,
    previousMode: SessionMode
  ): Promise<void> {
    // For mode changes on running sessions, we need to restart the process
    // Save any pending streaming content first
    if (proc.streamingText.trim().length > 0) {
      await this.saveAssistantMessage(sessionId, proc.streamingText.trim());
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    // Stop the current provider transport and restart with the new mode.
    this.detachProcessForRestart(proc);

    // Wait a bit for the process to terminate, then restart
    setTimeout(async () => {
      // Only remove the process this timer was armed for. A send arriving
      // within the grace period starts a replacement, and deleting that one
      // orphans a live CLI while the session shows as stopped.
      if (this.processes.get(sessionId) === proc) {
        this.processes.delete(sessionId);
      }
      try {
        await this.startSession(sessionId, userId, mode);
        console.log(`[MODE] Session ${sessionId} restarted with mode ${mode}`);
      } catch (err) {
        console.error(`[MODE] Failed to restart session ${sessionId}:`, err);
        // Revert mode on failure
        const newProc = this.processes.get(sessionId);
        if (newProc) {
          newProc.mode = previousMode;
        }
      }
    }, 1000);
  }

  private async cleanupProcess(sessionId: string, expected?: ClaudeProcess): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) return;
    // An older child's delayed exit/error must never remove a replacement
    // process that already owns the same WebUI session.
    if (expected && proc !== expected) return;

    // Never let a scheduled post-compaction nudge fire into a dead stdin.
    this.clearPiCompactResumeTimer(proc);
    proc.piTurnInFlight = false;

    // Same for the steering-preemption escalation timers.
    if (proc.codexPreemptKillTimer) {
      clearTimeout(proc.codexPreemptKillTimer);
      proc.codexPreemptKillTimer = undefined;
    }

    // Server-backed opencode: drop the SSE handler so events for this session
    // stop routing anywhere. The opencode session itself stays alive on the
    // server (it can be resumed on next startSession).
    if (proc.serverBacked && proc.cliProvider === 'opencode' && proc.claudeSessionId) {
      opencodeServer.unsubscribe(proc.claudeSessionId, proc.userId);
    }

    this.processes.delete(sessionId);

    // Runs from child 'exit'/'error' handlers: a DB throw here would become an
    // uncaughtException and take the backend down with it.
    try {
      await pgRun(
        'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        'stopped',
        sessionId
      );
    } catch (error) {
      console.error(`[CLEANUP] Failed to mark session ${sessionId} stopped:`, error);
    }

    this.emitStatus(sessionId, {
      sessionId,
      status: 'stopped',
    });
  }

  getRunningSessionIds(): string[] {
    return Array.from(this.processes.keys());
  }

  getSessionRuntimeSnapshot(sessionId: string): SessionRuntimeSnapshot {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return {
        running: false,
        provider: null,
        mode: this.pendingModes.get(sessionId) ?? null,
        model: null,
        workingDirectory: null,
        claudeSessionId: null,
        busy: false,
        streaming: false,
        currentToolName: null,
        currentAgentType: null,
        currentAgentDescription: null,
        subagents: [],
        activitySummary: null,
        queueDepth: 0,
        queueItems: [],
        lastActivityAt: null,
        disconnectedAt: null,
        usage: null,
      };
    }

    const queueItems = this.getQueuedTurnItems(proc).map((turn) => ({
      id: turn.queueId,
      preview: turn.originalMessage.slice(0, 240),
      createdAt: turn.queuedAt,
      attachments: turn.attachments?.length,
    }));
    const hasActiveSubagents = Array.from(proc.subagentRuns.values()).some(
      (run) => run.status === 'started' && !run.background
    );
    const hasPendingCodexFollowup =
      proc.cliProvider === 'codex' && (proc.codexQueuedTurns?.length ?? 0) > 0;
    const busy =
      proc.cliProvider === 'codex'
        ? !proc.codexIdle || hasPendingCodexFollowup || hasActiveSubagents
        : proc.cliProvider === 'opencode'
          ? !proc.opencodeIdle || queueItems.length > 0 || hasActiveSubagents
          : isClaudeTransportProvider(proc.cliProvider)
            ? proc.claudeIdle === false || queueItems.length > 0 || hasActiveSubagents
            : proc.isStreaming || !!proc.currentToolName || hasActiveSubagents;
    const activitySummary = this.getActivitySummary(proc, busy, queueItems.length);

    return {
      running: true,
      provider: proc.cliProvider,
      mode: proc.mode,
      model: proc.model,
      workingDirectory: proc.workingDirectory,
      claudeSessionId: proc.claudeSessionId,
      busy,
      streaming: proc.isStreaming,
      currentToolName: proc.currentToolName,
      currentAgentType: proc.currentAgentType,
      currentAgentDescription: proc.currentAgentDescription,
      subagents: this.snapshotSubagentRuns(proc),
      activitySummary,
      queueDepth: queueItems.length,
      queueItems,
      lastActivityAt: new Date(proc.lastActivityAt).toISOString(),
      disconnectedAt: proc.disconnectedAt ? new Date(proc.disconnectedAt).toISOString() : null,
      usage: this.buildUsageSnapshot(sessionId, proc),
    };
  }

  /**
   * Gracefully stop every running Claude process. Used on SIGTERM/SIGINT so
   * container restarts don't orphan processes or leave sessions flagged as
   * 'running' in the DB. Sends SIGTERM, waits briefly for stdin/stdout drain,
   * then SIGKILLs anything still alive.
   */
  async shutdownAll(timeoutMs = 3000): Promise<void> {
    const sessionIds = Array.from(this.processes.keys());
    if (sessionIds.length === 0) {
      await opencodeServer.shutdownAll();
      return;
    }

    console.log(`[SHUTDOWN] Terminating ${sessionIds.length} Claude process(es)`);

    for (const sessionId of sessionIds) {
      const proc = this.processes.get(sessionId);
      if (!proc) continue;
      try {
        if (proc.serverBacked && proc.cliProvider === 'opencode') {
          this.detachProcessForRestart(proc);
        } else {
          proc.process.stdin?.end();
          signalManagedProcess(proc.process, 'SIGTERM');
        }
      } catch (err) {
        console.error(`[SHUTDOWN] SIGTERM failed for ${sessionId}:`, err);
      }
      try {
        await pgRun(
          `UPDATE sessions SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          sessionId
        );
      } catch {
        // DB may already be closing — best effort.
      }
    }

    // Give processes a moment to exit cleanly before force-killing.
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));

    for (const sessionId of sessionIds) {
      const proc = this.processes.get(sessionId);
      if (!proc) continue;
      try {
        signalManagedProcess(proc.process, 'SIGKILL');
      } catch {
        // Process may already have exited.
      }
      this.processes.delete(sessionId);
    }
    await opencodeServer.shutdownAll();
  }

  // Handle permission approval - restart session with allowed tools and resend message
  async approvePermission(
    sessionId: string,
    userId: string,
    toolNames: string[],
    originalMessage: string
  ): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      throw new Error('Session not running');
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    console.log(`[PERMISSION] Approving tools: ${toolNames.join(', ')} for session ${sessionId}`);

    // Get the pending denials and last message
    const lastMessage = originalMessage || proc.lastUserMessage;
    if (!lastMessage) {
      throw new Error('No message to resend');
    }

    // Clear pending denials
    proc.pendingPermissionDenials = null;

    // The kill→respawn below leaves the session absent from `processes` across
    // several awaits. Publish that window through `startingSessions` so a
    // concurrent sendMessage/startSession waits for the respawn instead of
    // spawning a second child that would be orphaned (but keep streaming) once
    // the respawn overwrites the map entry.
    let releaseRestartGuard!: () => void;
    const restartGuard = new Promise<void>((resolve) => {
      releaseRestartGuard = resolve;
    });
    this.startingSessions.set(sessionId, restartGuard);
    try {
      await this.respawnWithApprovedTools(sessionId, userId, toolNames, proc);
    } finally {
      if (this.startingSessions.get(sessionId) === restartGuard) {
        this.startingSessions.delete(sessionId);
      }
      releaseRestartGuard();
    }

    const resumeMessage = [
      `Permission granted for tools: ${toolNames.join(', ') || 'approved tools'}.`,
      'Continue the previous request from the existing context.',
      'Do not repeat earlier analysis or summaries; resume where you left off.',
    ].join('\n');

    // Send a resume signal instead of re-sending the full prompt,
    // and skip recording/emitting the message to avoid duplicates in the UI.
    // This runs outside the restart guard: if the fresh child died instantly,
    // sendMessage may legitimately need startSession, which would otherwise
    // deadlock on the guard it is part of.
    await this.sendMessage(sessionId, userId, resumeMessage, undefined, {
      recordMessage: false,
      updateLastMessage: false,
    });
  }

  /** Kill the current child and respawn it with the approved tools allowed. */
  private async respawnWithApprovedTools(
    sessionId: string,
    userId: string,
    toolNames: string[],
    proc: ClaudeProcess
  ): Promise<void> {
    // Store session info before killing
    const claudeSessionId = proc.claudeSessionId;
    const workingDirectory = proc.workingDirectory;
    const mode = proc.mode;
    const cliProvider = proc.cliProvider;
    const providerConfig = CLI_PROVIDERS[cliProvider];

    // Kill current process
    terminateManagedProcess(proc.process);
    this.processes.delete(sessionId);

    // Wait for process to terminate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Restart with allowed tools
    const session = (await pgGet(
      'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
      sessionId,
      userId
    )) as unknown as
      | {
          working_directory: string;
          claude_session_id: string | null;
          allowed_directories: string | null;
        }
      | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    // Parse allowed directories
    const allowedDirs: string[] = safeJsonParse<string[]>(session.allowed_directories, []);

    let args: string[] = [];
    const requestedModel =
      cliProvider === 'opencode'
        ? await getCliModelForSession(userId, cliProvider, sessionId)
        : proc.model && proc.model !== 'unknown'
          ? proc.model
          : await getCliModelForSession(userId, cliProvider, sessionId);
    const requestedReasoning = await getCliReasoningForSession(userId, cliProvider, sessionId);
    const requestedServiceTier = await getCliServiceTierForSession(userId, cliProvider, sessionId);
    if (isClaudeTransportProvider(cliProvider)) {
      args = [
        '--print',
        '--verbose',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--include-partial-messages',
        ...this.getPermissionFlags(mode),
      ];

      if (requestedModel) {
        args.push('--model', requestedModel);
      }

      if (requestedReasoning) {
        args.push('--effort', requestedReasoning);
      }

      for (const toolName of toolNames) {
        args.push('--allowedTools', toolName);
      }

      for (const dir of allowedDirs) {
        args.push('--add-dir', dir);
      }

      if (claudeSessionId) {
        args.push('--resume', claudeSessionId);
      }
    } else {
      // Build command args using CLI provider abstraction
      args = getCLIArgs(cliProvider, {
        mode,
        resumeSessionId: claudeSessionId ?? undefined,
        allowedDirectories: allowedDirs,
        workingDirectory,
        allowedTools: toolNames,
        model: requestedModel ?? undefined,
        reasoningLevel: requestedReasoning ?? undefined,
        serviceTier: requestedServiceTier ?? undefined,
      });
    }

    console.log(`[PERMISSION] Restarting ${providerConfig.name} with args: ${args.join(' ')}`);

    const configHome = resolveConfigHome(cliProvider);
    if (isClaudeTransportProvider(cliProvider)) {
      await sanitizeClaudeSettingsProviderEnv({
        settingsPath: path.join(configHome, 'settings.json'),
      });
    }
    if (cliProvider === 'claude' && claudeSessionId) {
      const transcript = await sanitizeClaudeResumeTranscript(
        configHome,
        workingDirectory,
        claudeSessionId
      );
      if (transcript.updated) {
        console.log(
          `[provider-isolation] Replaced ${transcript.replacements} incompatible Z.AI server tool block(s) before Claude permission resume`
        );
      }
    }

    // Spawn new process
    const newProc = spawnManagedProcess(providerConfig.command, args, {
      cwd: workingDirectory,
      env: {
        ...(isClaudeTransportProvider(cliProvider)
          ? await buildClaudeTransportEnv(cliProvider, userId, configHome, sessionId)
          : process.env),
        ...(await buildAndroidDeviceEnvForSession(sessionId, userId)),
        WEBUI_SESSION_ID: sessionId,
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_PROJECT_PATH: workingDirectory,
        WEBUI_SESSION_MODE: mode,
        WEBUI_CONFIG_HOME: configHome,
        WEBUI_HOOK_SECRET: config.hookSecret,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const claudeProcess: ClaudeProcess = {
      process: newProc,
      sessionId,
      providerChatId: proc.providerChatId,
      currentChatId: proc.currentChatId,
      cliProvider,
      userId,
      workingDirectory,
      claudeSessionId,
      buffer: '',
      streamingText: '',
      isStreaming: false,
      mode,
      currentToolName: null,
      currentToolId: null,
      currentToolInput: '',
      currentActivitySummary: null,
      pendingToolResults: new Map(),
      currentAgentType: null,
      currentAgentDescription: null,
      subagentRuns: new Map(),
      model: proc.model || 'unknown',
      contextWindow: this.resolveObservedContextWindow(proc.model, proc.contextWindow),
      turnInputTokens: 0,
      turnCacheReadTokens: 0,
      turnCacheCreationTokens: 0,
      turnOutputTokens: 0,
      currentUsageTurnId: proc.currentUsageTurnId,
      currentUsageTurnStartedAt: proc.currentUsageTurnStartedAt,
      totalInputTokens: proc.totalInputTokens,
      totalOutputTokens: proc.totalOutputTokens,
      cacheReadTokens: proc.cacheReadTokens,
      cacheCreationTokens: proc.cacheCreationTokens,
      totalCostUsd: proc.totalCostUsd,
      previousTotalCostUsd: proc.previousTotalCostUsd,
      needsWorkingDirReminder: false,
      contextReminder: null,
      outputBuffer: proc.outputBuffer,
      lastActivityAt: Date.now(),
      disconnectedAt: null,
      lastUserMessage: null,
      lastAttachments: null,
      pendingPermissionDenials: null,
      pendingChatMedia: proc.pendingChatMedia,
      sharedContextInjected: false,
      modePromptInjected: null,
      lastContextLimitAt: proc.lastContextLimitAt,
    };

    this.processes.set(sessionId, claudeProcess);

    // Setup handlers
    newProc.stdout?.on('data', async (data: Buffer) => {
      await this.handleJsonOutput(sessionId, data.toString());
    });

    newProc.stderr?.on('data', (data: Buffer) => {
      console.error(`Claude stderr [${sessionId}]:`, data.toString());
    });

    newProc.on('exit', async (exitCode) => {
      console.log(`Claude process for session ${sessionId} exited with code ${exitCode}`);
      await this.cleanupProcess(sessionId, claudeProcess);
    });

    newProc.on('error', async (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);
      await this.notifyDiscordSessionEvent(sessionId, {
        eventType: 'session.error',
        severity: 'error',
        title: 'Session process error',
        summary: err.message,
      });

      await this.cleanupProcess(sessionId, claudeProcess);
    });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Handle permission denial - clear pending state
  denyPermission(sessionId: string, userId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    console.log(`[PERMISSION] User denied permission for session ${sessionId}`);
    proc.pendingPermissionDenials = null;
    proc.lastUserMessage = null;
    proc.lastAttachments = null;
  }
}
