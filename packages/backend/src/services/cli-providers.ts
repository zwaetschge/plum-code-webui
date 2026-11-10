/**
 * CLI Provider Abstraction
 *
 * Supports multiple AI CLI tools:
 * - Claude Code CLI (claude) - Anthropic subscription
 * - Z.AI Code (zai) - Claude Code transport with Z.AI-compatible endpoint
 * - Codex CLI (codex) - OpenAI
 * - Pi (pi) - Multi-provider harness over the WebUI model provider registry
 * - Mistral Vibe (vibe) - persistent ACP agent
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { DEFAULT_CODEX_MODEL } from '@plum-code-webui/shared';
import type {
  CodexServiceTier,
  CodexWebSearchMode,
  ProviderCapabilities,
  SessionMode,
} from '@plum-code-webui/shared';
import { getCodexWebuiApprovalPolicy, getCodexWebuiSandboxMode } from '../utils/codexDefaults.js';
import { resolveConfigHome } from '../utils/configPaths.js';

const execFileAsync = promisify(execFile);
const CODEX_UNRAID_DEFAULT_ALLOWED_DIRS = ['/mnt/user', '/mnt/cache'];

export type CLIProvider = 'claude' | 'zai' | 'codex' | 'pi' | 'vibe';

export interface CLIProviderConfig {
  id: CLIProvider;
  name: string;
  command: string;
  icon: string;
  credentialsPath: string;
  supportsStreamJson: boolean;
  supportsResume: boolean;
  supportsModes: boolean;
  capabilities: ProviderCapabilities;
  defaultModel?: string;
  models?: string[];
}

// Fallback models - used when CLI discovery fails or CLI not installed
// Can be overridden via CLI_PROVIDER_<PROVIDER>_MODELS env var
// Claude Code runs Fable/Opus/Sonnet with a 1M window on first-party logins.
// The WebUI offers every such model twice: the `[1m]` ID keeps the 1M window,
// the plain ID runs with the standard 200k window (the spawn sets
// CLAUDE_CODE_DISABLE_1M_CONTEXT, see claudeContextWindowEnv). Haiku has no
// 1M form.
const CLAUDE_1M_SUFFIX = '[1m]';
const CLAUDE_1M_FAMILIES = /^claude-(fable|opus|sonnet)-/;

export function isClaude1mModel(model: string | null | undefined): boolean {
  return typeof model === 'string' && model.trim().toLowerCase().endsWith(CLAUDE_1M_SUFFIX);
}

export function withClaude1mVariants(models: string[]): string[] {
  return models.flatMap((model) =>
    CLAUDE_1M_FAMILIES.test(model) && !isClaude1mModel(model)
      ? [`${model}${CLAUDE_1M_SUFFIX}`, model]
      : [model]
  );
}

/**
 * Harnesses that speak ACP (Agent Client Protocol) over stdio as one persistent
 * process per session. Mistral Vibe uses the spawn, turn
 * queue, permission and cancellation plumbing in ClaudeProcessManager.
 */
export function isAcpProvider(provider: CLIProvider | null | undefined): boolean {
  return provider === 'vibe';
}

/** Absolute VIBE_HOME for this deployment (`~/.vibe` unless overridden). */
export function resolveVibeHome(): string {
  return (
    process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH ||
    process.env.VIBE_HOME ||
    CLI_PROVIDERS.vibe.credentialsPath
  ).replace('~', os.homedir());
}

/**
 * Env for a `vibe-acp` child.
 *
 * Vibe loads `$VIBE_HOME/.env` but an existing process value wins over it, so
 * an inherited `MISTRAL_API_KEY` (the container's regular API key, which draws
 * on the plan's small API allowance) would silently shadow the key the user
 * signed in with through Mistral AI Studio (the €255 Vibe Code allowance).
 * When Vibe's own `.env` carries a key, the inherited one is dropped.
 * `VIBE_TEST_DISABLE_KEYRING=1` keeps Vibe off the desktop keyring, which does
 * not exist in a headless container.
 */
export function buildVibeEnv(): Record<string, string | undefined> {
  const home = resolveVibeHome();
  const env: Record<string, string | undefined> = {
    VIBE_HOME: home,
    VIBE_TEST_DISABLE_KEYRING: '1',
  };
  try {
    const dotEnv = fs.readFileSync(path.join(home, '.env'), 'utf-8');
    if (/^\s*MISTRAL_API_KEY\s*=\s*['"]?[^'"\s]+/m.test(dotEnv)) {
      env.MISTRAL_API_KEY = undefined;
    }
  } catch {
    // No Vibe home yet: keep whatever the deployment provides.
  }
  return env;
}

/**
 * Env for the context-window choice of a Claude Code session. An explicit
 * canonical model without `[1m]` gets the 200k window; `[1m]` and aliases or
 * the default model keep the CLI's own 1M behaviour.
 */
export function claudeContextWindowEnv(
  model: string | null | undefined
): Record<string, string | undefined> {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (isClaude1mModel(trimmed)) return { CLAUDE_CODE_DISABLE_1M_CONTEXT: undefined };
  if (CLAUDE_1M_FAMILIES.test(trimmed)) return { CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' };
  return {};
}

const CLI_PROVIDER_MODELS: Record<CLIProvider, string[]> = {
  claude: withClaude1mVariants([
    'claude-fable-5-2',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
  ]),
  zai: ['opus', 'sonnet', 'haiku'],
  // Fallback only — runtime list comes from ~/.codex/models_cache.json (filtered to
  // visibility=list, sorted by priority). Cache refreshes via the codex CLI itself;
  // if the user's auth token is expired, the cache freezes and the dropdown stays on
  // whatever was last fetched. gpt-6.1-sol is the default (gpt-5.5 is no longer
  // served to ChatGPT accounts); codex CLI 0.162 lists the 6.1/6 family first.
  // An older CLI never sees the newer entries at all — the models endpoint
  // filters by client version.
  codex: [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-5.5',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ],
  pi: [
    'z-ai/glm-5.1',
    'z-ai/glm-5',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'deepseek/deepseek-chat',
    'google/gemini-2.5-pro',
  ],
  // Mistral Vibe ships exactly one hosted model: the alias `mistral-medium-3.5`
  // for `mistral-vibe-cli-latest`, which is the model the plan's Vibe Code
  // allowance pays for. Its second built-in entry (`local`) points at a
  // llama.cpp server on 127.0.0.1:8080 and is not offered here. Operators can
  // list more ids through CLI_PROVIDER_VIBE_MODELS; Vibe only accepts what its
  // own config.toml defines, so an unknown id fails at session start.
  vibe: ['mistral-medium-3.5'],
};

// Display labels — enhanced at startup by CLI discovery. Claude aliases stay
// stable, while their labels are replaced with the versions exposed by the
// installed Claude Code CLI.
const MODEL_DISPLAY_LABELS: Record<string, string> = {
  // Claude Code fallback labels, used when CLI discovery fails. The previous
  // generation stays labelled for existing sessions.
  'claude-fable-5-2': 'Fable 5.2',
  'claude-fable-5-1': 'Fable 5.1',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-5-5': 'Haiku 5.5',
  'claude-fable-5': 'Fable 5',
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
  ...claude1mLabels({
    'claude-fable-5-2': 'Fable 5.2',
    'claude-fable-5-1': 'Fable 5.1',
    'claude-opus-5-5': 'Opus 5.5',
    'claude-sonnet-5-5': 'Sonnet 5.5',
    'claude-fable-5': 'Fable 5',
    'claude-opus-5': 'Opus 5',
    'claude-sonnet-5': 'Sonnet 5',
  }),
  // Aliases remain labelled for existing sessions and Z.AI mappings.
  fable: 'Fable 5.2',
  opus: 'Opus 5.5',
  sonnet: 'Sonnet 5.5',
  haiku: 'Haiku 5.5',
  // Codex (labels for the currently-listed models in upstream models_cache.json)
  'gpt-6.1-sol': 'GPT 6.1 Sol',
  'gpt-6-astra': 'GPT 6 Astra',
  'gpt-5.5': 'GPT 5.5',
  'gpt-5.6-sol': 'GPT 5.6 Sol',
  'gpt-5.6-terra': 'GPT 5.6 Terra',
  'gpt-5.6-luna': 'GPT 5.6 Luna',
  'gpt-5.4': 'GPT 5.4',
  'gpt-5.4-mini': 'GPT 5.4 Mini',
  'gpt-5.3-codex': 'GPT 5.3 Codex',
  'gpt-5.3-codex-spark': 'GPT 5.3 Codex Spark',
  'gpt-5.2': 'GPT 5.2',
  // Pi (provider/model format)
  'z-ai/glm-5.1': 'GLM 5.1',
  'z-ai/glm-5': 'GLM 5',
  'anthropic/claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'openai/gpt-4o': 'GPT-4o',
  'deepseek/deepseek-chat': 'DeepSeek Chat',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  k3: 'Kimi K3',
  // Mistral Vibe aliases. `mistral-medium-3.5` is the alias Vibe exposes for
  // `mistral-vibe-cli-latest`; the others come from a deployment's own
  // config.toml (see discoverVibe) or from Mistral API traffic through Pi.
  'mistral-medium-3.5': 'Mistral Medium 3.5',
  'mistral-vibe-cli-latest': 'Mistral Medium 3.5',
  'devstral-small': 'Devstral Small 2',
  'devstral-2': 'Devstral 2',
  'glm-5.3': 'GLM-5.3',
  'mistral-large-3': 'Mistral Large 3',
};

function normalizeAllowedDirectory(dir: string): string | null {
  const trimmed = dir.trim();
  if (!trimmed) return null;
  if (!path.isAbsolute(trimmed)) return null;

  try {
    const resolved = path.resolve(trimmed);
    if (resolved === path.parse(resolved).root) return null;
    if (!fs.existsSync(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

function parseAllowedBasePaths(): string[] {
  const configured = (process.env.ALLOWED_BASE_PATHS || '')
    .split(',')
    .map((dir) => normalizeAllowedDirectory(dir))
    .filter((dir): dir is string => !!dir);

  if (configured.length > 0) return configured;

  return CODEX_UNRAID_DEFAULT_ALLOWED_DIRS.map((dir) => normalizeAllowedDirectory(dir)).filter(
    (dir): dir is string => !!dir
  );
}

function getCodexAllowedDirectories(options: {
  allowedDirectories?: string[];
  workingDirectory?: string;
}): string[] {
  const workingDirectory = options.workingDirectory
    ? normalizeAllowedDirectory(options.workingDirectory)
    : null;
  const seen = new Set<string>();

  return [...parseAllowedBasePaths(), ...(options.allowedDirectories || [])]
    .map((dir) => normalizeAllowedDirectory(dir))
    .filter((dir): dir is string => !!dir)
    .filter((dir) => {
      if (workingDirectory && dir === workingDirectory) return false;
      if (seen.has(dir)) return false;
      seen.add(dir);
      return true;
    });
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * GPT-5.6's stronger delegation behaviour can turn an ordinary WebUI turn into
 * dozens of child threads. Keep regular 5.6 work in the root thread unless the
 * user deliberately selects Ultra or an operator explicitly enables parallel
 * agents. This applies only to WebUI-launched Codex commands, never a user's
 * direct Codex CLI invocation.
 */
function getCodexWebuiAgentLimitArgs(
  model: string | undefined,
  effort: string | undefined
): string[] {
  const configuredMode = (process.env.CODEX_WEBUI_AGENT_MODE || '').trim().toLowerCase();
  const configuredDepth = parseNonNegativeInteger(process.env.CODEX_WEBUI_AGENT_MAX_DEPTH);
  const configuredThreads = parseNonNegativeInteger(process.env.CODEX_WEBUI_AGENT_MAX_THREADS);
  const shouldUseSingleAgentDefaults =
    configuredMode === 'single' ||
    (configuredMode !== 'parallel' && model?.startsWith('gpt-5.6-') && effort !== 'ultra');

  // Codex CLI 0.144.0+ rejects agents.max_depth=0 ("must be at least 1").
  // Use 1 as the single-agent floor: the root agent can spawn one level of
  // children but those children cannot delegate further, which still keeps
  // 5.6 delegation tightly bounded without crashing the spawn.
  const maxDepth = configuredDepth ?? (shouldUseSingleAgentDefaults ? 1 : undefined);
  const maxThreads = configuredThreads ?? (shouldUseSingleAgentDefaults ? 1 : undefined);
  const args: string[] = [];
  if (maxDepth !== undefined) args.push('-c', `agents.max_depth=${maxDepth}`);
  if (maxThreads !== undefined) args.push('-c', `agents.max_threads=${maxThreads}`);
  return args;
}

// ── CLI Model Discovery ──────────────────────────────────────────────

/**
 * Find a CLI binary's real path.
 */
function findCliBinary(command: string): string | null {
  const candidates = command.includes('/')
    ? [command.replace(/^~/, os.homedir())]
    : [
        `/home/node/.npm-global/bin/${command}`,
        `/opt/plum-cli/bin/${command}`,
        `/usr/local/bin/${command}`,
        `/usr/bin/${command}`,
      ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  try {
    const pathParts = (process.env.PATH || '').split(':').filter(Boolean);
    for (const item of [
      '/home/node/.npm-global/bin',
      '/opt/plum-cli/bin',
      '/usr/local/bin',
      '/usr/bin',
    ]) {
      if (!pathParts.includes(item)) pathParts.unshift(item);
    }
    const p = execFileSync('which', [command], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: pathParts.join(':') },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return p ? fs.realpathSync(p) : null;
  } catch {
    return null;
  }
}

/**
 * Read a file relative to a CLI binary's install directory.
 * Searches both the binary dir and the typical npm global layout.
 */
function readCliFile(binaryPath: string, ...segments: string[]): string | null {
  const cliDir = path.dirname(binaryPath);
  // Try relative to binary dir
  const direct = path.join(cliDir, ...segments);
  if (fs.existsSync(direct)) return fs.readFileSync(direct, 'utf-8');
  // Try npm global layout: <prefix>/lib/node_modules/<pkg>/...
  const npmGlobal = path.join(cliDir, '..', 'lib', 'node_modules', ...segments);
  if (fs.existsSync(npmGlobal)) return fs.readFileSync(npmGlobal, 'utf-8');
  return null;
}

const CLAUDE_MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const;
type ClaudeModelFamily = (typeof CLAUDE_MODEL_FAMILIES)[number];

export interface ClaudeCliModelCatalog {
  models: string[];
  labels: Record<string, string>;
}

function compareClaudeVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function versionFromClaudeModelId(modelId: string, family: ClaudeModelFamily): string | null {
  const suffix = modelId.replace(new RegExp(`^claude-${family}-`), '').replace(/-\d{8}$/, '');
  if (!/^\d+(?:-\d+)*$/.test(suffix)) return null;
  return suffix.replace(/-/g, '.');
}

const CLAUDE_MODEL_ID_PATTERN = /claude-(fable|opus|sonnet|haiku)-\d+(?:-\d+)*(?:-\d{8})?/g;
const CLAUDE_DISPLAY_NAME_LINE = /^Claude (Fable|Opus|Sonnet|Haiku) (\d+(?:\.\d+)*)$/;

/**
 * Parse the model catalog embedded in Claude Code: per family the newest model
 * ID the CLI knows.
 *
 * Native releases carry display names ("Claude Opus 5.5") as separate strings;
 * since 2.1.3xx they no longer sit next to their IDs. A family with display
 * names only accepts IDs whose version has one, so legacy and unreleased IDs
 * kept for migrations or feature gates never win. The JavaScript CLI has no
 * standalone display names; there every ID counts. Dated snapshots collapse
 * to their stable family/version ID.
 */
export function parseClaudeCliModelCatalog(source: string): ClaudeCliModelCatalog {
  const released = new Map<ClaudeModelFamily, Map<string, string>>();
  for (const line of source.split(/\r?\n/)) {
    const match = CLAUDE_DISPLAY_NAME_LINE.exec(line.trim());
    if (!match?.[1] || !match[2]) continue;
    const family = match[1].toLowerCase() as ClaudeModelFamily;
    if (!released.has(family)) released.set(family, new Map());
    released.get(family)!.set(match[2], `${match[1]} ${match[2]}`);
  }

  const latest = new Map<ClaudeModelFamily, { modelId: string; version: string; label: string }>();
  for (const match of source.matchAll(CLAUDE_MODEL_ID_PATTERN)) {
    const family = match[1] as ClaudeModelFamily;
    const version = versionFromClaudeModelId(match[0], family);
    if (!version) continue;
    const names = released.get(family);
    const label = names
      ? names.get(version)
      : `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
    if (!label) continue;
    const current = latest.get(family);
    if (current && compareClaudeVersions(version, current.version) <= 0) continue;
    latest.set(family, {
      modelId: `claude-${family}-${version.replace(/\./g, '-')}`,
      version,
      label,
    });
  }

  const models: string[] = [];
  const labels: Record<string, string> = {};
  for (const family of CLAUDE_MODEL_FAMILIES) {
    const entry = latest.get(family);
    if (!entry) continue;
    models.push(entry.modelId);
    labels[entry.modelId] = entry.label;
    labels[family] = entry.label;
  }

  return { models, labels };
}

function claude1mLabels(labels: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [model, label] of Object.entries(labels)) {
    if (!CLAUDE_1M_FAMILIES.test(model)) continue;
    result[model] = `${label} · 200k`;
    result[`${model}${CLAUDE_1M_SUFFIX}`] = `${label} · 1M`;
  }
  return result;
}

/** Per family the newer entry of the two catalogs; the CLI wins a tie. */
export function mergeClaudeCatalogs(
  cli: ClaudeCliModelCatalog | null,
  api: ClaudeCliModelCatalog | null
): ClaudeCliModelCatalog {
  const byFamily = new Map<ClaudeModelFamily, { modelId: string; label: string }>();
  for (const catalog of [cli, api]) {
    for (const modelId of catalog?.models ?? []) {
      const family = /^claude-(fable|opus|sonnet|haiku)-/.exec(modelId)?.[1] as
        | ClaudeModelFamily
        | undefined;
      if (!family) continue;
      const version = versionFromClaudeModelId(modelId, family);
      const current = byFamily.get(family);
      const currentVersion = current ? versionFromClaudeModelId(current.modelId, family) : null;
      if (
        current &&
        (!version || (currentVersion && compareClaudeVersions(version, currentVersion) <= 0))
      ) {
        continue;
      }
      byFamily.set(family, { modelId, label: catalog!.labels[modelId] ?? modelId });
    }
  }
  const models: string[] = [];
  const labels: Record<string, string> = {};
  for (const family of CLAUDE_MODEL_FAMILIES) {
    const entry = byFamily.get(family);
    if (!entry) continue;
    models.push(entry.modelId);
    labels[entry.modelId] = entry.label;
    labels[family] = entry.label;
  }
  return { models, labels };
}

/**
 * The models the Claude login can use, as the Anthropic models API reports
 * them. A model ships there before the installed Claude Code knows its name
 * (2026-11-09: Fable 5.2 under CLI 2.1.319, which still runs it with an
 * "unrecognized_model" note), so the CLI catalog alone hid it from the picker.
 */
let claudeCliCatalog: ClaudeCliModelCatalog | null = null;
let claudeApiCatalog: ClaudeCliModelCatalog | null = null;
let claudeApiCheckedAt = 0;
let claudeApiInFlight: Promise<void> | null = null;
const CLAUDE_API_REFRESH_MS = 6 * 60 * 60 * 1000;

function applyClaudeCatalog(): void {
  const merged = mergeClaudeCatalogs(claudeCliCatalog, claudeApiCatalog);
  if (merged.models.length === 0) return;
  discoveredModels.claude = withClaude1mVariants(merged.models);
  Object.assign(MODEL_DISPLAY_LABELS, merged.labels, claude1mLabels(merged.labels));
}

/** Builds the catalog from a `/v1/models` answer: display names plus IDs. */
export function claudeCatalogFromApiModels(
  data: Array<{ id?: unknown; display_name?: unknown }>
): ClaudeCliModelCatalog {
  const lines: string[] = [];
  for (const model of data) {
    if (typeof model.display_name === 'string') lines.push(model.display_name);
    if (typeof model.id === 'string') lines.push(model.id);
  }
  return parseClaudeCliModelCatalog(lines.join('\n'));
}

async function refreshClaudeApiCatalog(): Promise<void> {
  try {
    const credentials = JSON.parse(
      await fs.promises.readFile(path.join(resolveConfigHome(), '.credentials.json'), 'utf-8')
    ) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
    const oauth = credentials.claudeAiOauth;
    if (!oauth?.accessToken || (oauth.expiresAt && oauth.expiresAt < Date.now())) return;
    const response = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return;
    const body = (await response.json()) as {
      data?: Array<{ id?: unknown; display_name?: unknown }>;
    };
    const catalog = claudeCatalogFromApiModels(body.data ?? []);
    if (catalog.models.length === 0) return;
    const before = discoveredModels.claude?.join(',');
    claudeApiCatalog = catalog;
    applyClaudeCatalog();
    if (discoveredModels.claude?.join(',') !== before) {
      console.log(
        '[CLI-PROVIDERS] claude: models from the Anthropic API:',
        discoveredModels.claude
      );
    }
  } catch (error) {
    console.warn(
      '[CLI-PROVIDERS] claude: Anthropic models API unavailable:',
      error instanceof Error ? error.message : error
    );
  } finally {
    claudeApiCheckedAt = Date.now();
  }
}

function scheduleClaudeApiRefresh(): void {
  if (claudeApiInFlight || Date.now() - claudeApiCheckedAt < CLAUDE_API_REFRESH_MS) return;
  claudeApiInFlight = refreshClaudeApiCatalog().finally(() => {
    claudeApiInFlight = null;
  });
}

/**
 * Claude: read the current model catalog from the installed CLI. Claude Code
 * moved from cli.js to a native executable in 2.1.x, so both formats are
 * supported.
 */
function discoverClaude(): void {
  try {
    const bin = findCliBinary('claude');
    if (!bin) return;
    let source =
      readCliFile(bin, 'cli.js') ?? readCliFile(bin, '@anthropic-ai', 'claude-code', 'cli.js');
    if (!source) {
      // The native binary's full string table is over 70 MB (2.1.318) and
      // overflowed any sane buffer, which silently left the stale fallback
      // list in place. Keep only display names and lines naming a model ID.
      source = execFileSync(
        'sh',
        [
          '-c',
          'strings "$1" | grep -E "^Claude (Fable|Opus|Sonnet|Haiku) [0-9.]+$|claude-(fable|opus|sonnet|haiku)-[0-9]"',
          'sh',
          bin,
        ],
        { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
      );
    }

    const catalog = parseClaudeCliModelCatalog(source);
    if (catalog.models.length === 0) {
      console.warn('[CLI-PROVIDERS] claude: no models found in the CLI, keeping the fallback list');
      return;
    }
    claudeCliCatalog = catalog;
    applyClaudeCatalog();
    console.log(
      `[CLI-PROVIDERS] claude: discovered ${catalog.models.length} models:`,
      discoveredModels.claude
    );
  } catch (error) {
    console.warn(
      '[CLI-PROVIDERS] claude: model discovery failed, keeping the fallback list:',
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Codex: Discover models from the CLI's models_cache.json.
 * The Codex CLI maintains this cache by fetching from the OpenAI API.
 * Falls back to extracting model strings from the Rust binary.
 */
function discoverCodex(): void {
  const cachePath = getCodexModelsCachePath();
  codexModelsCacheFingerprint = readCodexModelsCacheFingerprint(cachePath);

  try {
    // Try models_cache.json first (maintained by Codex CLI from OpenAI API)
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      const cache = JSON.parse(raw) as {
        fetched_at?: string;
        models?: Array<{
          slug: string;
          display_name: string;
          visibility?: string;
          priority?: number;
        }>;
      };

      if (cache.models && cache.models.length > 0) {
        // Sort by priority (lower = more important), filter to visible models
        const sorted = cache.models
          .filter((m) => m.visibility === 'list')
          .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

        if (sorted.length > 0) {
          const modelIds = sorted.map((m) => m.slug);
          discoveredModels.codex = modelIds;

          for (const m of sorted) {
            MODEL_DISPLAY_LABELS[m.slug] = formatCodexLabel(m.display_name || m.slug);
          }

          const age = cache.fetched_at
            ? Math.round((Date.now() - new Date(cache.fetched_at).getTime()) / 3600000) + 'h ago'
            : 'unknown';
          console.log(
            `[CLI-PROVIDERS] codex: discovered ${modelIds.length} models from cache (${age}):`,
            modelIds
          );
          return;
        }
      }
    }

    // Fallback: extract model strings from the Rust binary
    discoverCodexFromBinary();
  } catch {
    /* keep defaults */
  }
}

/**
 * Fallback: Extract model IDs from the compiled Codex Rust binary using `strings`.
 */
function discoverCodexFromBinary(): void {
  try {
    const bin = findCliBinary('codex');
    if (!bin) return;

    const cliDir = path.dirname(bin);
    const platform = os.platform();
    const arch = os.arch();
    let triple = '';
    if (platform === 'linux' && arch === 'x64') triple = 'x86_64-unknown-linux-musl';
    else if (platform === 'linux' && arch === 'arm64') triple = 'aarch64-unknown-linux-musl';
    else if (platform === 'darwin' && arch === 'x64') triple = 'x86_64-apple-darwin';
    else if (platform === 'darwin' && arch === 'arm64') triple = 'aarch64-apple-darwin';

    if (!triple) return;

    const binaryPaths = [
      path.join(cliDir, '..', 'vendor', triple, 'codex', 'codex'),
      path.join(
        cliDir,
        '..',
        'lib',
        'node_modules',
        '@openai',
        'codex',
        'vendor',
        triple,
        'codex',
        'codex'
      ),
    ];

    let binaryPath = '';
    for (const p of binaryPaths) {
      try {
        const stat = fs.statSync(p);
        if (stat.size > 0) {
          binaryPath = p;
          break;
        }
      } catch {
        /* next */
      }
    }
    if (!binaryPath) return;

    const output = execFileSync('strings', [binaryPath], {
      encoding: 'utf-8',
      maxBuffer: 200 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const models = new Set<string>();

    const patterns = [
      /^(gpt-[0-9][.0-9]*(?:-[a-z0-9]+)*)$/gm,
      /^(o[0-9](?:-[a-z0-9]+)*)$/gm,
      /^(codex-[a-z0-9-]+)$/gm,
      /^(chatgpt-[a-z0-9-]+)$/gm,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(output)) !== null) {
        if (m[1]) models.add(m[1]);
      }
    }

    if (models.size > 0) {
      const sorted = [...models].sort();
      discoveredModels.codex = sorted;
      for (const id of sorted) {
        if (!MODEL_DISPLAY_LABELS[id]) {
          MODEL_DISPLAY_LABELS[id] = formatCodexLabel(id);
        }
      }
      console.log(`[CLI-PROVIDERS] codex: discovered ${sorted.length} models from binary:`, sorted);
    }
  } catch {
    /* keep defaults */
  }
}

function formatCodexLabel(modelId: string): string {
  // "o4-mini" → "o4 mini", "gpt-5.6-luna" → "GPT 5.6 luna"
  if (/^gpt-/i.test(modelId)) {
    return modelId.replace(/^gpt-/i, 'GPT ').replace(/-/g, ' ');
  }
  return modelId.replace(/-/g, ' ');
}

// ── Discovery Cache ──────────────────────────────────────────────────

const discoveredModels: Partial<Record<CLIProvider, string[]>> = {};
let discoveryDone = false;
let codexModelsCacheFingerprint: string | null = null;

function getCodexModelsCachePath(): string {
  const credPath = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
  return path.join(credPath, 'models_cache.json');
}

function readCodexModelsCacheFingerprint(cachePath = getCodexModelsCachePath()): string | null {
  try {
    const stat = fs.statSync(cachePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/**
 * Vibe only accepts models its own `config.toml` defines: a fresh install ships
 * `mistral-medium-3.5` (the alias of `mistral-vibe-cli-latest`, paid from the
 * plan's Vibe Code allowance) plus a `local` llama.cpp entry, and operators add
 * hosted models themselves. Parse that file so the menu follows the deployment
 * instead of a guess. Exported for the regression suite.
 */
export function parseVibeModelCatalog(source: string): {
  models: string[];
  labels: Record<string, string>;
} {
  const models: string[] = [];
  const labels: Record<string, string> = {};
  let inModels = false;
  let entry: { alias?: string; provider?: string; displayName?: string } = {};

  const flush = () => {
    const alias = entry.alias;
    // The `llamacpp` provider needs a local server on 127.0.0.1:8080, so it is
    // not offered as a Plum model; hosted Mistral models are.
    if (alias && (entry.provider || 'mistral') === 'mistral' && !models.includes(alias)) {
      models.push(alias);
      if (entry.displayName) labels[alias] = entry.displayName;
    }
    entry = {};
  };

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      flush();
      inModels = line.replace(/\s+/g, '') === '[[models]]';
      continue;
    }
    if (!inModels) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'alias') entry.alias = value;
    else if (key === 'provider') entry.provider = value;
    else if (key === 'display_name') entry.displayName = value;
  }
  flush();
  return { models, labels };
}

function discoverVibe(): void {
  try {
    const source = fs.readFileSync(path.join(resolveVibeHome(), 'config.toml'), 'utf-8');
    const catalog = parseVibeModelCatalog(source);
    if (catalog.models.length === 0) return;
    discoveredModels.vibe = catalog.models;
    Object.assign(MODEL_DISPLAY_LABELS, catalog.labels);
    console.log(
      `[CLI-PROVIDERS] vibe: discovered ${catalog.models.length} models:`,
      catalog.models
    );
  } catch {
    /* No Vibe home yet: keep the built-in default. */
  }
}

function ensureDiscovery(): void {
  scheduleClaudeApiRefresh();
  if (discoveryDone) return;
  discoveryDone = true;
  discoverClaude();
  discoverCodex();
  discoverVibe();
}

/**
 * Reset discovery cache so models are re-read on next access.
 * Call after CLI updates or manual cache refresh.
 */
export function resetDiscovery(): void {
  discoveryDone = false;
  claudeCliCatalog = null;
  claudeApiCheckedAt = 0;
  codexModelsCacheFingerprint = null;
  delete discoveredModels.claude;
  delete discoveredModels.codex;
  delete discoveredModels.pi;
  delete discoveredModels.vibe;
}

// Single shared promise so concurrent callers don't spawn multiple Codex processes
// (each run takes up to 30s and hits the OpenAI API). Cleared in `finally`.
let codexRefreshInFlight: Promise<boolean> | null = null;

/**
 * Refresh the Codex models cache by running a minimal Codex session.
 * The Codex CLI fetches from the OpenAI API on startup.
 * Uses an in-flight lock so concurrent callers share one run.
 */
export async function refreshCodexModelsCache(): Promise<boolean> {
  if (codexRefreshInFlight) return codexRefreshInFlight;

  codexRefreshInFlight = (async () => {
    try {
      const bin = findCliBinary('codex');
      if (!bin) return false;

      const cachePath = getCodexModelsCachePath();
      const beforeMtime = fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : 0;

      // Async spawn so we don't block the event loop for up to 30s.
      // --ephemeral is mandatory for every helper invocation: without it this
      // probe writes a rollout file into ~/.codex/sessions on each refresh and
      // shows up as a phantom conversation.
      await execFileAsync(
        bin,
        [
          'exec',
          '--json',
          '--ephemeral',
          '--skip-git-repo-check',
          '--model',
          DEFAULT_CODEX_MODEL,
          'say OK',
        ],
        { cwd: '/app', timeout: 30000 }
      );

      const afterMtime = fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : 0;
      if (afterMtime > beforeMtime) {
        resetDiscovery();
        console.log('[CLI-PROVIDERS] Codex models cache refreshed');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  })();

  try {
    return codexRefreshInFlight;
  } finally {
    codexRefreshInFlight = null;
  }
}

function getDiscoveredModels(provider: CLIProvider): string[] {
  ensureDiscovery();
  if (provider === 'codex') {
    const latestFingerprint = readCodexModelsCacheFingerprint();
    if (latestFingerprint !== codexModelsCacheFingerprint) {
      delete discoveredModels.codex;
      discoverCodex();
    }
  }
  return discoveredModels[provider] ?? CLI_PROVIDER_MODELS[provider];
}

export function resolveConfiguredModel(
  selectedModel: string | null | undefined,
  configuredModels: string[]
): string | null {
  const selected =
    typeof selectedModel === 'string' && selectedModel.trim() ? selectedModel.trim() : null;
  const configured = configuredModels
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  if (configured.length === 0) {
    return selected;
  }

  return selected && configured.includes(selected) ? selected : configured[0]!;
}

export function resolveCliProviderSelectedModel(
  provider: CLIProvider,
  userSelectedModel: string | null | undefined,
  configuredModels: string[],
  sessionSelectedModel?: string | null
): string | null {
  const userSelected =
    typeof userSelectedModel === 'string' && userSelectedModel.trim()
      ? userSelectedModel.trim()
      : null;
  const sessionSelected =
    typeof sessionSelectedModel === 'string' && sessionSelectedModel.trim()
      ? sessionSelectedModel.trim()
      : null;

  if (provider !== 'pi') {
    return sessionSelected ?? userSelected;
  }

  return resolveConfiguredModel(sessionSelected ?? userSelected, configuredModels);
}

function parseEnvModels(provider: CLIProvider): string[] | undefined {
  const raw = getProviderEnv(provider, 'MODELS');
  if (!raw) return undefined;
  const models = raw
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
  return models.length > 0 ? models : undefined;
}

function getProviderEnv(provider: CLIProvider, key: string): string | undefined {
  const envKey = `CLI_PROVIDER_${provider.toUpperCase()}_${key}`;
  return process.env[envKey];
}

function envOr(provider: CLIProvider, key: string, fallback: string): string {
  return getProviderEnv(provider, key) || fallback;
}

/**
 * The in-app update installs Vibe releases under the npm prefix and switches the
 * `bin/vibe-acp` link (cli-updates.ts). Spawning through the link, not its
 * resolved target, lets the next session pick up an update without a restart.
 */
function vibeAcpCommand(): string {
  const link = path.join(os.homedir(), '.npm-global', 'bin', 'vibe-acp');
  return fs.existsSync(link) ? link : (findCliBinary('vibe-acp') ?? 'vibe-acp');
}

function defaultCliCommand(provider: CLIProvider, command: string): string {
  return envOr(provider, 'COMMAND', findCliBinary(command) ?? command);
}

// Insertion order matters: routes/cli-providers.ts uses Object.values() so the
// frontend picker lists providers in this order. Codex is the primary going
// forward; Claude is intentionally last (legacy) since claude -p is being
// restricted / moved to a credit system upstream.
export const CLI_PROVIDERS: Record<CLIProvider, CLIProviderConfig> = {
  codex: {
    id: 'codex',
    name: 'Codex',
    command: defaultCliCommand('codex', 'codex'),
    icon: '🟢',
    credentialsPath: envOr('codex', 'CREDENTIALS_PATH', '~/.codex'),
    // Codex CLI itself is single-shot per turn, but the WebUI simulates streaming
    // by handling `item.delta` events and resume by prepending a transcript of
    // prior turns to each respawned process's stdin.
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: true,
      imageBridge: false,
      mcp: true,
      mcpSessionAttribution: 'native',
      usageLimits: 'upstream',
      reasoning: true,
      serviceTier: true,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('codex', 'DEFAULT_MODEL') || DEFAULT_CODEX_MODEL,
    models: parseEnvModels('codex') ?? CLI_PROVIDER_MODELS.codex,
  },
  pi: {
    id: 'pi',
    name: 'Pi',
    command: defaultCliCommand('pi', 'pi'),
    icon: 'π',
    // API connections come from the WebUI model provider registry. Pi itself
    // stores only generated, secret-free provider references in ~/.pi, so a
    // configured registry endpoint is what makes it usable.
    credentialsPath: envOr('pi', 'CREDENTIALS_PATH', '~/.pi'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: true,
      imageBridge: false,
      mcp: true,
      mcpSessionAttribution: 'prompt-scoped',
      usageLimits: 'local-budget',
      reasoning: true,
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('pi', 'DEFAULT_MODEL') || 'z-ai/glm-5.1',
    models: parseEnvModels('pi') ?? CLI_PROVIDER_MODELS.pi,
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: defaultCliCommand('claude', 'claude'),
    icon: '🟠',
    credentialsPath: envOr('claude', 'CREDENTIALS_PATH', '~/.claude'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: false,
      imageBridge: false,
      mcp: true,
      mcpSessionAttribution: 'native',
      usageLimits: 'upstream',
      reasoning: true,
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    // The stable alias always follows the installed CLI's current Sonnet.
    defaultModel: getProviderEnv('claude', 'DEFAULT_MODEL') || 'sonnet',
    models: parseEnvModels('claude') ?? CLI_PROVIDER_MODELS.claude,
  },
  zai: {
    id: 'zai',
    name: 'Z.AI Code',
    command: defaultCliCommand('zai', 'claude'),
    icon: '🟩',
    credentialsPath: envOr('zai', 'CREDENTIALS_PATH', '~/.claude'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: false,
      imageBridge: false,
      mcp: true,
      mcpSessionAttribution: 'native',
      usageLimits: 'upstream',
      reasoning: true,
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('zai', 'DEFAULT_MODEL') || 'opus',
    models: parseEnvModels('zai') ?? CLI_PROVIDER_MODELS.zai,
  },
  vibe: {
    id: 'vibe',
    name: 'Mistral Vibe',
    command: envOr('vibe', 'COMMAND', vibeAcpCommand()),
    icon: '🧡',
    // Vibe keeps its config, sessions and the plan key (`.env`) under
    // VIBE_HOME. Signing in through Mistral stores a key that draws on the
    // plan's Vibe allowance rather than the API allowance.
    credentialsPath: envOr('vibe', 'CREDENTIALS_PATH', '~/.vibe'),
    // Persistent `vibe-acp` over stdio: streaming, native resume,
    // cancellation and queued follow-ups.
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: true,
      imageBridge: false,
      mcp: true,
      mcpSessionAttribution: 'native',
      usageLimits: 'local-budget',
      reasoning: true,
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('vibe', 'DEFAULT_MODEL') || 'mistral-medium-3.5',
    models: parseEnvModels('vibe') ?? CLI_PROVIDER_MODELS.vibe,
  },
};

export function getProviderCapabilities(provider: CLIProvider): ProviderCapabilities {
  return CLI_PROVIDERS[provider].capabilities;
}

/**
 * Get CLI arguments for a provider
 */
export function getCLIArgs(
  provider: CLIProvider,
  options: {
    mode?: SessionMode;
    resumeSessionId?: string;
    allowedDirectories?: string[];
    workingDirectory?: string;
    allowedTools?: string[];
    model?: string;
    reasoningLevel?: string;
    serviceTier?: CodexServiceTier | string | null;
    webSearchMode?: CodexWebSearchMode;
    ephemeral?: boolean;
    codexExecCommand?: { type: 'review'; args: string[]; prompt?: string };
  }
): string[] {
  if (options.ephemeral) options = { ...options, resumeSessionId: undefined };
  const config = CLI_PROVIDERS[provider];
  const args: string[] = [];

  switch (provider) {
    case 'claude':
    case 'zai':
      // Claude Code CLI arguments
      args.push(
        '--print',
        '--verbose',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--include-partial-messages'
      );

      // Permission mode
      if (options.mode && config.supportsModes) {
        args.push(...getClaudePermissionFlags(options.mode));
      }

      // Resume session
      if (options.resumeSessionId && config.supportsResume) {
        args.push('--resume', options.resumeSessionId);
      }

      // Effort level (reasoning)
      if (options.reasoningLevel) {
        const launch = claudeEffortLaunch(options.reasoningLevel);
        args.push('--effort', launch.effort);
        if (launch.ultracode) args.push('--settings', JSON.stringify(ULTRACODE_SETTINGS));
      }

      // Allowed directories
      if (options.allowedDirectories) {
        for (const dir of options.allowedDirectories) {
          args.push('--add-dir', dir);
        }
      }
      break;

    case 'codex': {
      // Codex CLI 0.130 non-interactive: `codex exec [resume <id>] [opts] [prompt]`
      // Native resume preferred when a sessionId is known. Note: `codex exec resume`
      // accepts a NARROWER flag set than `codex exec` — no --sandbox, no --add-dir.
      // Danger deployments can still bypass the inherited sandbox via resume's bypass flag.
      const isReview = options.codexExecCommand?.type === 'review';
      const isResume = !!(options.resumeSessionId && config.supportsResume);
      if (isReview) {
        args.push('exec', '--json');
        if (options.ephemeral) args.push('--ephemeral');
      } else if (isResume) {
        args.push('exec', 'resume');
        if (shouldBypassCodexResumeSandbox(options.mode)) {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        }
        args.push(options.resumeSessionId as string, '--json');
      } else {
        args.push('exec', '--json');
      }

      if (options.ephemeral && !args.includes('--ephemeral')) args.push('--ephemeral');
      args.push(...codexTransportArgs());

      // Sandbox / approval flags only apply to fresh `exec`, not `exec resume`.
      if (!isResume) {
        args.push(...getCodexApprovalArgs(options.mode));
      }

      const useFastTier = options.serviceTier === 'fast' || options.reasoningLevel === 'fast';
      // Fast mode is a service-tier setting, not a model shortcut. Keep the
      // session/default model unless the caller explicitly pinned one.
      if (options.model) {
        args.push('--model', options.model);
      }

      if (useFastTier) {
        args.push('-c', 'service_tier="fast"');
      }

      // Reasoning effort. Valid Codex values: none | minimal | low | medium | high | xhigh | max | ultra.
      // Map common aliases (extra_high / extrahigh / very_high) → xhigh; drop unknown
      // values silently so a stale user setting doesn't crash the spawn.
      const VALID_EFFORTS = [
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
        'ultra',
      ] as const;
      const EFFORT_ALIASES: Record<string, (typeof VALID_EFFORTS)[number]> = {
        extra_high: 'xhigh',
        extrahigh: 'xhigh',
        very_high: 'xhigh',
        veryhigh: 'xhigh',
      };
      const requestedEffort = options.reasoningLevel === 'fast' ? null : options.reasoningLevel;
      const rawEffort =
        requestedEffort ?? (options.mode === 'planning' ? 'high' : useFastTier ? 'low' : undefined);
      let effort: (typeof VALID_EFFORTS)[number] | undefined;
      if (rawEffort) {
        const normalized = rawEffort.toLowerCase().trim();
        if ((VALID_EFFORTS as readonly string[]).includes(normalized)) {
          effort = normalized as (typeof VALID_EFFORTS)[number];
        } else if (EFFORT_ALIASES[normalized]) {
          effort = EFFORT_ALIASES[normalized];
        }
      }
      if (effort) {
        args.push('-c', `model_reasoning_effort="${effort}"`);
      }

      args.push(...getCodexWebuiAgentLimitArgs(options.model || config.defaultModel, effort));

      if (options.webSearchMode && options.webSearchMode !== 'auto') {
        args.push('-c', `web_search="${options.webSearchMode}"`);
      }

      if (options.workingDirectory && !isResume) {
        args.push('--cd', options.workingDirectory);
        args.push('--skip-git-repo-check');
      }

      // --add-dir is exec-only (resume inherits from the original session).
      // Include deployment-level base paths so Codex can write mounted Unraid shares.
      if (!isResume && options.mode !== 'danger') {
        for (const dir of getCodexAllowedDirectories(options)) {
          args.push('--add-dir', dir);
        }
      }
      if (isReview) {
        args.push('review', ...options.codexExecCommand!.args);
        if (options.codexExecCommand!.prompt) {
          args.push(options.codexExecCommand!.prompt);
        }
      }
      break;
    }

    case 'pi':
      // Pi's RPC mode is a persistent JSONL process. Provider/model credentials
      // and shared extensions are prepared in the per-user PI_CODING_AGENT_DIR.
      args.push('--mode', 'rpc', '--approve');

      if (options.model) {
        args.push('--model', options.model);
      }

      if (options.reasoningLevel) {
        args.push('--thinking', normalizePiThinking(options.reasoningLevel));
      }

      if (options.resumeSessionId && config.supportsResume) {
        args.push('--session', options.resumeSessionId);
      }
      break;
    case 'vibe':
      // `vibe-acp` takes no arguments; model, mode and thinking are ACP
      // session config options set after the session opens.
      break;
  }

  return args;
}

/**
 * Claude Code's `ultracode` setting: standing dynamic-workflow orchestration
 * (the Workflow tool on every turn). It needs the Workflows feature, which the
 * same settings layer switches on.
 */
export const ULTRACODE_SETTINGS = { ultracode: true, enableWorkflows: true } as const;

/**
 * How a Claude/Z.AI effort choice launches the CLI. `ultrathink` and
 * `ultracode` are Plum choices, not `--effort` values: the first is max effort
 * plus the "ultrathink" keyword on every prompt, the second xhigh effort plus
 * the `ultracode` setting (Claude Code 2.1.28x+, also behind Z.AI).
 */
export function claudeEffortLaunch(reasoningLevel: string): {
  effort: string;
  ultrathink: boolean;
  ultracode: boolean;
} {
  if (reasoningLevel === 'ultrathink') return { effort: 'max', ultrathink: true, ultracode: false };
  if (reasoningLevel === 'ultracode')
    return { effort: 'xhigh', ultrathink: false, ultracode: true };
  return { effort: reasoningLevel, ultrathink: false, ultracode: false };
}

/** Vibe has no ultracode thinking level: workflows run at `high`. */
export function vibeThinkingLevel(reasoningLevel: string): string {
  return reasoningLevel === 'ultracode' ? 'high' : reasoningLevel;
}

function normalizePiThinking(reasoningLevel: string): string {
  const normalized = reasoningLevel
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'none') return 'off';
  if (normalized === 'extra_high') return 'xhigh';
  if (normalized === 'ultra') return 'max';
  // Ultracode is xhigh thinking plus the workflow tool (PI_ULTRACODE, set at spawn).
  if (normalized === 'ultracode') return 'xhigh';
  return normalized;
}

/**
 * Codex reaches OpenAI over the Responses WebSocket by default, and that socket
 * is often closed by the server mid-turn ("websocket closed by server before
 * response.completed"), which Codex answers with five reconnects before it
 * falls back. The same ChatGPT login over HTTPS streaming (SSE) has no such
 * drops, keeps prompt caching and resumes WebSocket-era threads. A custom
 * provider is needed because the built-in `openai` one cannot be overridden.
 * PLUM_CODEX_WEBSOCKETS=1 restores the WebSocket transport.
 */
export function codexTransportArgs(): string[] {
  if (process.env.PLUM_CODEX_WEBSOCKETS === '1') return [];
  return [
    '-c',
    'model_providers.openai-https={name="OpenAI",requires_openai_auth=true,wire_api="responses",supports_websockets=false}',
    '-c',
    'model_provider="openai-https"',
  ];
}

function getCodexApprovalArgs(mode?: SessionMode): string[] {
  // Codex CLI 0.130 `exec` subcommand only exposes:
  //   -s, --sandbox (read-only | workspace-write | danger-full-access)
  //   --dangerously-bypass-approvals-and-sandbox
  // It does NOT expose `--ask-for-approval` or `--full-auto` directly — approval
  // policy comes via `-c approval_policy=<value>` config override.
  //
  // In Docker the Landlock sandbox used by workspace-write often fails with
  // LandlockRestrict errors (kernel/capability mismatch), so the WebUI default
  // is danger-full-access there. Operators can override it with
  // CODEX_WEBUI_SANDBOX_MODE=read-only|workspace-write|danger-full-access.
  const defaultSandbox = getCodexWebuiSandboxMode();
  const defaultApproval = getCodexWebuiApprovalPolicy();

  switch (mode) {
    case 'planning':
      // Read-only filesystem: agent designs without mutating files. Approval=never
      // because plans surface through the WebUI, not blocking prompts.
      return ['--sandbox', 'read-only', '-c', 'approval_policy="never"'];
    case 'manual':
      // User-facing approval: surface every shell/file action back to the WebUI.
      return ['--sandbox', defaultSandbox, '-c', 'approval_policy="untrusted"'];
    case 'danger':
      return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'auto-accept':
    default:
      return ['--sandbox', defaultSandbox, '-c', `approval_policy="${defaultApproval}"`];
  }
}

function shouldBypassCodexResumeSandbox(mode?: SessionMode): boolean {
  if (mode === 'danger') return true;
  if (mode === 'planning' || mode === 'manual') return false;
  return (
    getCodexWebuiSandboxMode() === 'danger-full-access' && getCodexWebuiApprovalPolicy() === 'never'
  );
}

/**
 * Get Claude permission flags based on mode
 */
function getClaudePermissionFlags(mode: SessionMode): string[] {
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

/**
 * Check if a CLI provider is available (credentials exist).
 *
 * Pass `userId` for the harnesses whose credentials live in the WebUI provider
 * registry rather than in a CLI's home directory. Without it they fall back to
 * the directory probe, which answers "is the harness installed" — not "can this
 * account actually run a turn".
 */
/**
 * Installed-and-authenticated status for every configured harness.
 *
 * Cached: `/health/ready` can be polled by Docker every few seconds, and each
 * probe otherwise walks the filesystem once per provider. A logged-out harness
 * is not an emergency, so 30 seconds of staleness is fine.
 */
let providerStatusCache: { at: number; value: Record<string, ProviderRuntimeStatus> } | null = null;
const PROVIDER_STATUS_TTL_MS = 30_000;

export interface ProviderRuntimeStatus {
  installed: boolean;
  authenticated: boolean;
}

export async function getProviderStatuses(): Promise<Record<string, ProviderRuntimeStatus>> {
  const now = Date.now();
  if (providerStatusCache && now - providerStatusCache.at < PROVIDER_STATUS_TTL_MS) {
    return providerStatusCache.value;
  }

  const value: Record<string, ProviderRuntimeStatus> = {};
  for (const provider of Object.keys(CLI_PROVIDERS) as CLIProvider[]) {
    const command = CLI_PROVIDERS[provider].command;
    value[provider] = {
      installed: !!findCliBinary(command),
      // Per-user harnesses (Pi) report false here; their credentials
      // are per account, and this endpoint has no user.
      authenticated: await isProviderAvailable(provider).catch(() => false),
    };
  }

  providerStatusCache = { at: now, value };
  return value;
}

export async function isProviderAvailable(
  provider: CLIProvider,
  userId?: string
): Promise<boolean> {
  const fs = await import('fs/promises');
  const os = await import('os');

  const config = CLI_PROVIDERS[provider];
  const credPath = config.credentialsPath.replace('~', os.homedir());

  try {
    // Pi routes through endpoints the user configures in the model provider
    // registry, so a configured endpoint is the credential. This is what lets
    // an operator set up one harness and leave the others untouched.
    if (userId && provider === 'pi') {
      const { readModelProvidersForUser } = await import('../utils/modelProviderKeys.js');
      return (await readModelProvidersForUser(userId)).some(
        (entry) => entry.enabled && entry.apiKey.trim().length > 0
      );
    }
    if (provider === 'codex') {
      const raw = await fs.readFile(path.join(credPath, 'auth.json'), 'utf-8');
      const auth = JSON.parse(raw) as {
        OPENAI_API_KEY?: string | null;
        tokens?: { access_token?: string | null };
      };
      return !!(auth.tokens?.access_token || auth.OPENAI_API_KEY);
    }
    if (provider === 'vibe') {
      // Signing in (browser or pasted key) writes MISTRAL_API_KEY to
      // VIBE_HOME/.env. A key in the process environment counts too: Vibe
      // itself accepts it and reports `authState: process_env`.
      const dotEnv = await fs
        .readFile(path.join(resolveVibeHome(), '.env'), 'utf-8')
        .catch(() => '');
      if (/^\s*MISTRAL_API_KEY\s*=\s*['"]?[^'"\s]+/m.test(dotEnv)) {
        return true;
      }
      return Boolean(process.env.MISTRAL_API_KEY && process.env.MISTRAL_API_KEY.trim());
    }
    await fs.access(credPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all available providers
 */
export async function getAvailableProviders(userId?: string): Promise<CLIProviderConfig[]> {
  const available: CLIProviderConfig[] = [];

  for (const provider of Object.values(CLI_PROVIDERS)) {
    if (await isProviderAvailable(provider.id, userId)) {
      available.push(provider);
    }
  }

  return available;
}

/**
 * Parse stream output based on provider
 * Different CLIs may have different output formats
 */
export function parseStreamOutput(_provider: CLIProvider, line: string): unknown {
  // For now, all providers use JSON lines
  // This can be extended for provider-specific parsing
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Get available models for a provider.
 * Priority: env var override > CLI discovery > hardcoded defaults.
 */
export function getCliModels(provider: CLIProvider): string[] {
  const envModels = parseEnvModels(provider);
  if (envModels) return envModels;
  return getDiscoveredModels(provider);
}

export function getModelDisplayLabels(): Record<string, string> {
  ensureDiscovery();
  return MODEL_DISPLAY_LABELS;
}

/**
 * Format input message for a provider
 */
export function formatInputMessage(provider: CLIProvider, message: string): string {
  switch (provider) {
    case 'claude':
    case 'zai':
      // Claude uses stream-json input
      return (
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: message,
          },
        }) + '\n'
      );

    case 'pi':
      return `${JSON.stringify({
        type: 'prompt',
        message,
        streamingBehavior: 'followUp',
      })}\n`;

    case 'codex':
      // Plain text + newline
      return message + '\n';

    default:
      return message + '\n';
  }
}
