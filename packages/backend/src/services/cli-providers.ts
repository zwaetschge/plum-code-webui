/**
 * CLI Provider Abstraction
 *
 * Supports multiple AI CLI tools:
 * - Claude Code CLI (claude) - Anthropic subscription
 * - Z.AI Code (zai) - Claude Code transport with Z.AI-compatible endpoint
 * - Codex CLI (codex) - OpenAI
 * - OpenCode CLI (opencode) - Multi-provider (75+ LLM backends)
 * - Pi (pi) - Alternative harness sharing OpenCode provider connections
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import type {
  CodexServiceTier,
  CodexWebSearchMode,
  ProviderCapabilities,
  SessionMode,
} from '@plum-code-webui/shared';
import { getCodexWebuiApprovalPolicy, getCodexWebuiSandboxMode } from '../utils/codexDefaults.js';
import {
  discoverOpenCodeCliModels,
  getOpenCodeModelIdsForProviders,
} from '../utils/opencodeCatalog.js';

const execFileAsync = promisify(execFile);
const CODEX_UNRAID_DEFAULT_ALLOWED_DIRS = ['/mnt/user', '/mnt/cache'];

export type CLIProvider = 'claude' | 'zai' | 'codex' | 'opencode' | 'pi' | 'kimi';

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
const CLI_PROVIDER_MODELS: Record<CLIProvider, string[]> = {
  claude: ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  zai: ['opus', 'sonnet', 'haiku'],
  // Fallback only — runtime list comes from ~/.codex/models_cache.json (filtered to
  // visibility=list, sorted by priority). Cache refreshes via the codex CLI itself;
  // if the user's auth token is expired, the cache freezes and the dropdown stays on
  // whatever was last fetched. gpt-5.5 remains the default; codex CLI 0.144.0
  // lists the 5.6 family after it.
  codex: [
    'gpt-5.5',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex-spark',
  ],
  opencode: [
    'opencode-go/kimi-k2.7',
    'opencode/kimi-k2.7',
    'z-ai/glm-5.1',
    'z-ai/glm-5',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'deepseek/deepseek-chat',
    'google/gemini-2.5-pro',
  ],
  pi: [
    'opencode-go/kimi-k2.7',
    'opencode/kimi-k2.7',
    'z-ai/glm-5.1',
    'z-ai/glm-5',
    'anthropic/claude-sonnet-4-5',
    'openai/gpt-4o',
    'deepseek/deepseek-chat',
    'google/gemini-2.5-pro',
  ],
  // Kimi Code CLI (@moonshot-ai/kimi-code). Model aliases resolve through the
  // managed Kimi provider that `kimi login` populates. Fallback only — the
  // runtime list should come from the CLI's configured providers after login.
  kimi: ['kimi-code/kimi-for-coding', 'kimi-code/kimi-for-coding-highspeed', 'kimi-code/k3'],
};

// Display labels — enhanced at startup by CLI discovery. Claude aliases stay
// stable, while their labels are replaced with the versions exposed by the
// installed Claude Code CLI.
const MODEL_DISPLAY_LABELS: Record<string, string> = {
  // Claude Code fallback labels. These are used only when CLI discovery fails.
  'claude-fable-5': 'Fable 5',
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
  // Legacy aliases remain labelled for existing sessions and Z.AI mappings.
  opus: 'Opus 5',
  sonnet: 'Sonnet 5',
  haiku: 'Haiku 4.5',
  // Codex (labels for the currently-listed models in upstream models_cache.json)
  'gpt-5.5': 'GPT 5.5',
  'gpt-5.6-sol': 'GPT 5.6 Sol',
  'gpt-5.6-terra': 'GPT 5.6 Terra',
  'gpt-5.6-luna': 'GPT 5.6 Luna',
  'gpt-5.4': 'GPT 5.4',
  'gpt-5.4-mini': 'GPT 5.4 Mini',
  'gpt-5.3-codex': 'GPT 5.3 Codex',
  'gpt-5.3-codex-spark': 'GPT 5.3 Codex Spark',
  'gpt-5.2': 'GPT 5.2',
  // OpenCode (provider/model format)
  'opencode-go/kimi-k2.7': 'Kimi K2.7 (OpenCode Go)',
  'opencode/kimi-k2.7': 'Kimi K2.7',
  'z-ai/glm-5.1': 'GLM 5.1',
  'z-ai/glm-5': 'GLM 5',
  'anthropic/claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'openai/gpt-4o': 'GPT-4o',
  'deepseek/deepseek-chat': 'DeepSeek Chat',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  // Kimi Code CLI model aliases (populated by `kimi login`).
  'kimi-for-coding': 'Kimi K2.7 Code',
  'kimi-for-coding-highspeed': 'Kimi K2.7 Code HighSpeed',
  k3: 'Kimi K3',
  'kimi-code/kimi-for-coding': 'Kimi K2.7 Code',
  'kimi-code/kimi-for-coding-highspeed': 'Kimi K2.7 Code HighSpeed',
  'kimi-code/k3': 'Kimi K3',
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

/**
 * Parse the model catalog embedded in Claude Code.
 *
 * Current native releases expose canonical model ID/display-name pairs in
 * their string table. Older JavaScript releases expose the same IDs in
 * `firstParty` and alias maps. Prefer labelled pairs because native binaries
 * also retain legacy IDs for migrations and compatibility.
 */
export function parseClaudeCliModelCatalog(source: string): ClaudeCliModelCatalog {
  const candidates = new Map<
    ClaudeModelFamily,
    Array<{ modelId: string; version: string; label: string }>
  >();
  for (const family of CLAUDE_MODEL_FAMILIES) candidates.set(family, []);

  const lines = source.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    const modelId = lines[index - 1]?.trim() ?? '';
    const displayName = lines[index]?.trim() ?? '';
    const modelMatch = /^claude-(fable|opus|sonnet|haiku)-[a-z0-9-]+$/.exec(modelId);
    const labelMatch = /^Claude (Fable|Opus|Sonnet|Haiku) (\d+(?:\.\d+)*)$/.exec(displayName);
    if (!modelMatch?.[1] || !labelMatch?.[1] || !labelMatch[2]) continue;

    const family = modelMatch[1] as ClaudeModelFamily;
    if (labelMatch[1].toLowerCase() !== family) continue;
    candidates.get(family)!.push({
      modelId,
      version: labelMatch[2],
      label: `${labelMatch[1]} ${labelMatch[2]}`,
    });
  }

  // JavaScript CLI fallback: extract canonical IDs when no adjacent display
  // labels exist. Dated snapshots collapse to their stable family/version ID.
  if ([...candidates.values()].every((items) => items.length === 0)) {
    const modelPattern = /claude-(fable|opus|sonnet|haiku)-\d+(?:-\d+)*(?:-\d{8})?/g;
    let match: RegExpExecArray | null;
    while ((match = modelPattern.exec(source)) !== null) {
      const family = match[1] as ClaudeModelFamily;
      const version = versionFromClaudeModelId(match[0], family);
      if (!version) continue;
      const stableId = `claude-${family}-${version.replace(/\./g, '-')}`;
      const familyLabel = family.charAt(0).toUpperCase() + family.slice(1);
      candidates.get(family)!.push({
        modelId: stableId,
        version,
        label: `${familyLabel} ${version}`,
      });
    }
  }

  const models: string[] = [];
  const labels: Record<string, string> = {};
  for (const family of CLAUDE_MODEL_FAMILIES) {
    const latest = candidates
      .get(family)!
      .sort((left, right) => compareClaudeVersions(right.version, left.version))[0];
    if (!latest) continue;
    models.push(latest.modelId);
    labels[latest.modelId] = latest.label;
    labels[family] = latest.label;
  }

  return { models, labels };
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
      source = execFileSync('strings', [bin], {
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    }

    const catalog = parseClaudeCliModelCatalog(source);
    if (catalog.models.length === 0) return;
    discoveredModels.claude = catalog.models;
    Object.assign(MODEL_DISPLAY_LABELS, catalog.labels);
    console.log(
      `[CLI-PROVIDERS] claude: discovered ${catalog.models.length} models:`,
      catalog.models
    );
  } catch {
    /* keep defaults */
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

/**
 * OpenCode: Discover models from either the user's opencode.json config
 * (explicit allow-list) or from the auth.json (enabled providers).
 *
 * Precedence:
 * 1. Explicit `models` array in ~/.config/opencode/opencode.json
 * 2. Auth file: expand each configured provider to its default model set
 * 3. Fall back to CLI_PROVIDER_MODELS.opencode
 */
function discoverOpenCode(): void {
  try {
    const homeDir = os.homedir();
    const authDir = (
      getProviderEnv('opencode', 'CREDENTIALS_PATH') ||
      path.join(homeDir, '.local', 'share', 'opencode')
    ).replace(/^~/, homeDir);
    const configDir = (
      getProviderEnv('opencode', 'CONFIG_PATH') || path.join(homeDir, '.config', 'opencode')
    ).replace(/^~/, homeDir);
    const configPath = path.join(configDir, 'opencode.json');
    const authPath = path.join(authDir, 'auth.json');

    const userModels: string[] = [];
    // Top-level `models` is an explicit allow-list — honor it and skip
    // auth-based expansion. Provider blocks are additive: they declare custom
    // providers (e.g. llama-local) that should coexist with the models
    // auth.json's providers expose. Those should merge, not short-circuit.
    let hasExplicitAllowList = false;

    // 1. Explicit allow-list in opencode.json
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const cfg = JSON.parse(raw) as {
          model?: string;
          models?: string[];
          provider?: Record<string, { models?: Record<string, unknown> }>;
        };
        if (Array.isArray(cfg.models) && cfg.models.length > 0) {
          userModels.push(...cfg.models);
          hasExplicitAllowList = true;
        }
        // Provider-scoped model blocks (provider.<id>.models.<modelId>)
        if (cfg.provider) {
          for (const [providerId, block] of Object.entries(cfg.provider)) {
            if (block?.models) {
              for (const modelId of Object.keys(block.models)) {
                userModels.push(`${providerId}/${modelId}`);
              }
            }
          }
        }
      } catch {
        // Malformed JSON — fall through to auth-based discovery
      }
    }

    // 2. Live OpenCode CLI output covers authenticated providers plus providers
    // configured through environment variables. It is intentionally not the
    // complete provider list; the Settings provider browser uses models.dev for
    // that. Here we keep the session selector to runnable/default models.
    if (!hasExplicitAllowList) {
      const liveProviders = discoverOpenCodeCliModels();
      for (const [providerId, models] of Object.entries(liveProviders)) {
        for (const modelId of models) {
          userModels.push(`${providerId}/${modelId}`);
        }
      }
    }

    // 3. Auth file fallback: derive model set from enabled providers via the
    // same models.dev catalog used by the Settings page.
    if (!hasExplicitAllowList && userModels.length === 0 && fs.existsSync(authPath)) {
      try {
        const raw = fs.readFileSync(authPath, 'utf-8');
        const auth = JSON.parse(raw) as Record<string, unknown>;
        const configuredProviders = Object.keys(auth).filter(
          (id) => typeof auth[id] === 'object' && auth[id] !== null
        );

        userModels.push(...getOpenCodeModelIdsForProviders(configuredProviders));
        if (userModels.length === 0) {
          for (const providerId of configuredProviders) {
            for (const model of PROVIDER_DEFAULT_MODELS[providerId] ?? []) {
              userModels.push(`${providerId}/${model}`);
            }
          }
        }
      } catch {
        // Malformed auth.json — fall through
      }
    }

    if (userModels.length > 0) {
      const unique = [...new Set(userModels)];
      discoveredModels.opencode = unique;
      for (const modelId of unique) {
        if (!MODEL_DISPLAY_LABELS[modelId]) {
          MODEL_DISPLAY_LABELS[modelId] = formatOpenCodeLabel(modelId);
        }
      }
      console.log(`[CLI-PROVIDERS] opencode: discovered ${unique.length} models:`, unique);
    }
  } catch {
    // Keep defaults
  }
}

/**
 * Per-provider model seeds used when auth.json lists a provider but no
 * opencode.json model allow-list is present. Pairs with the user's auth
 * config to produce a sensible default surface.
 */
const PROVIDER_DEFAULT_MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  'z-ai': ['glm-5.1', 'glm-5'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  groq: ['llama-3.3-70b-versatile'],
  openrouter: [],
  'x-ai': ['grok-2-latest'],
  mistral: ['mistral-large-latest'],
  cohere: ['command-r-plus'],
  together: [],
};

function formatOpenCodeLabel(modelId: string): string {
  // "z-ai/glm-5.1" → "GLM 5.1", "anthropic/claude-sonnet-4-5" → "Claude Sonnet 4.5"
  const parts = modelId.split('/');
  const tail = parts[parts.length - 1] || modelId;
  const provider = parts.length > 1 ? parts[0] : undefined;

  const cleaned = tail
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((segment) => {
      if (/^\d/.test(segment)) return segment; // keep version segments verbatim
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');

  if (provider === 'z-ai') {
    return cleaned.replace(/^Glm/i, 'GLM');
  }
  if (provider === 'openai' || provider === 'x-ai') {
    return cleaned.replace(/^Gpt/i, 'GPT').replace(/^Grok/i, 'Grok');
  }
  return cleaned;
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

function ensureDiscovery(): void {
  if (discoveryDone) return;
  discoveryDone = true;
  discoverClaude();
  discoverCodex();
  discoverOpenCode();
}

/**
 * Reset discovery cache so models are re-read on next access.
 * Call after CLI updates or manual cache refresh.
 */
export function resetDiscovery(): void {
  discoveryDone = false;
  codexModelsCacheFingerprint = null;
  delete discoveredModels.claude;
  delete discoveredModels.codex;
  delete discoveredModels.opencode;
  delete discoveredModels.pi;
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
      await execFileAsync(
        bin,
        ['exec', '--json', '--skip-git-repo-check', '--model', 'gpt-5.5', 'say OK'],
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
    return await codexRefreshInFlight;
  } finally {
    codexRefreshInFlight = null;
  }
}

function getDiscoveredModels(provider: CLIProvider): string[] {
  ensureDiscovery();
  if (provider === 'pi') {
    return discoveredModels.opencode ?? CLI_PROVIDER_MODELS.opencode;
  }
  if (provider === 'codex') {
    const latestFingerprint = readCodexModelsCacheFingerprint();
    if (latestFingerprint !== codexModelsCacheFingerprint) {
      delete discoveredModels.codex;
      discoverCodex();
    }
  }
  return discoveredModels[provider] ?? CLI_PROVIDER_MODELS[provider];
}

export function resolveOpenCodeConfiguredModel(
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

  if (provider !== 'opencode' && provider !== 'pi') {
    return sessionSelected ?? userSelected;
  }

  return resolveOpenCodeConfiguredModel(sessionSelected ?? userSelected, configuredModels);
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
    defaultModel: getProviderEnv('codex', 'DEFAULT_MODEL') || 'gpt-5.5',
    models: parseEnvModels('codex') ?? CLI_PROVIDER_MODELS.codex,
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    command: defaultCliCommand('opencode', 'opencode'),
    icon: '⚡',
    // OpenCode writes auth/tokens to ~/.local/share/opencode/auth.json per XDG.
    // Config lives at ~/.config/opencode/opencode.json but absence of a config
    // file doesn't mean the CLI is unusable — auth presence is the real signal.
    credentialsPath: envOr('opencode', 'CREDENTIALS_PATH', '~/.local/share/opencode'),
    supportsStreamJson: true,
    supportsResume: true,
    supportsModes: true,
    capabilities: {
      streaming: true,
      resume: true,
      modes: true,
      approvals: true,
      nativeVision: false,
      imageBridge: true,
      mcp: true,
      mcpSessionAttribution: 'prompt-scoped',
      usageLimits: 'local-budget',
      reasoning: true,
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('opencode', 'DEFAULT_MODEL') || 'z-ai/glm-5.1',
    models: parseEnvModels('opencode') ?? CLI_PROVIDER_MODELS.opencode,
  },
  pi: {
    id: 'pi',
    name: 'Pi',
    command: defaultCliCommand('pi', 'pi'),
    icon: 'π',
    // Authentication and API connections are intentionally shared with OpenCode.
    // Pi itself stores only generated, secret-free provider references in ~/.pi.
    // Pi keeps its own config under ~/.pi. Pointing availability at ~/.opencode
    // made Pi look uninstalled whenever OpenCode was absent, even though Pi
    // only needs a configured endpoint from the WebUI provider registry.
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
    defaultModel:
      getProviderEnv('pi', 'DEFAULT_MODEL') ||
      getProviderEnv('opencode', 'DEFAULT_MODEL') ||
      'z-ai/glm-5.1',
    models: parseEnvModels('pi') ?? parseEnvModels('opencode') ?? CLI_PROVIDER_MODELS.opencode,
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
  kimi: {
    id: 'kimi',
    name: 'Kimi Code',
    command: defaultCliCommand('kimi', 'kimi'),
    icon: '🌙',
    // Kimi Code CLI (@moonshot-ai/kimi-code) keeps OAuth + provider state under
    // ~/.kimi-code. `kimi login` writes the device-code OAuth token there; the
    // managed Kimi provider/models are populated into config.toml on success.
    credentialsPath: envOr('kimi', 'CREDENTIALS_PATH', '~/.kimi-code'),
    // Interactive runtime uses persistent `kimi acp` over stdio. The argument
    // builder below remains for one-shot diagnostics and compatibility tests.
    // NDJSON on stdout (assistant text, tool_calls, tool results); thinking is
    // omitted from the JSONL and tool progress goes to stderr.
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
      serviceTier: false,
      webSearch: true,
      allowedDirectories: true,
    },
    defaultModel: getProviderEnv('kimi', 'DEFAULT_MODEL') || 'kimi-code/kimi-for-coding',
    models: parseEnvModels('kimi') ?? CLI_PROVIDER_MODELS.kimi,
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
    codexExecCommand?: { type: 'review'; args: string[]; prompt?: string };
  }
): string[] {
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
        args.push('--effort', options.reasoningLevel);
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
      } else if (isResume) {
        args.push('exec', 'resume');
        if (shouldBypassCodexResumeSandbox(options.mode)) {
          args.push('--dangerously-bypass-approvals-and-sandbox');
        }
        args.push(options.resumeSessionId as string, '--json');
      } else {
        args.push('exec', '--json');
      }

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

    case 'opencode':
      // OpenCode CLI: `opencode run --format json --model <model> "prompt"`
      // Permission semantics are declarative (OPENCODE_PERMISSION env JSON)
      // rather than hook-based — see buildOpenCodePermissionJson().
      args.push('run', '--format', 'json');

      if (options.model) {
        args.push('--model', options.model);
      }

      if (options.reasoningLevel) {
        args.push('--variant', normalizeOpenCodeVariant(options.reasoningLevel));
      }

      // Resume explicit session; OpenCode also supports --continue for the
      // latest session, but we always carry an explicit session id when one
      // exists, so --session is the right primitive here.
      if (options.resumeSessionId && config.supportsResume) {
        args.push('--session', options.resumeSessionId);
      }

      // Danger mode bypasses permission prompts entirely. All other modes
      // rely on the OPENCODE_PERMISSION env var built at spawn time.
      if (options.mode === 'danger') {
        args.push('--dangerously-skip-permissions');
      }
      break;

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

    case 'kimi': {
      // Legacy one-shot diagnostics: `kimi --output-format stream-json [-m model] [--session id] -p "<prompt>"`.
      // The prompt itself is appended as the trailing `-p <message>` arg by the
      // process manager (kimi does not read the prompt from stdin).
      // `--output-format` may only be combined with `--prompt`.
      args.push('--output-format', 'stream-json');
      if (options.model) {
        // `kimi login` registers aliases as `kimi-code/<model>`. Preserve
        // explicitly-qualified custom aliases, while upgrading the unqualified
        // values stored by the first WebUI integration for compatibility.
        const model = options.model.includes('/') ? options.model : `kimi-code/${options.model}`;
        args.push('-m', model);
      }
      if (options.resumeSessionId && config.supportsResume) {
        // Kimi only resumes an ID it previously emitted; it cannot create a
        // native session from an arbitrary WebUI id.
        args.push('--session', options.resumeSessionId);
      }
      // Reasoning effort is expressed as a model-alias suffix (e.g. model:high)
      // in kimi-code; there is no standalone --thinking flag in prompt mode, so
      // we leave the model alias untouched here.
      break;
    }
  }

  return args;
}

function normalizePiThinking(reasoningLevel: string): string {
  const normalized = reasoningLevel
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'none') return 'off';
  if (normalized === 'extra_high') return 'xhigh';
  if (normalized === 'ultra') return 'max';
  return normalized;
}

function normalizeOpenCodeVariant(reasoningLevel: string): string {
  const normalized = reasoningLevel
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'extra_high' || normalized === 'xhigh') return 'max';
  return normalized;
}

/**
 * Build the JSON value for the OPENCODE_PERMISSION env var.
 *
 * OpenCode evaluates permissions declaratively at runtime. The JSON schema:
 *   { "edit": "ask"|"allow"|"deny",
 *     "bash": { "<pattern>": "ask"|"allow"|"deny", "*": "ask" },
 *     "webfetch": "ask"|"allow"|"deny" }
 *
 * Modes map to policies matching Claude's permission-mode semantics:
 *   - auto-accept: edits allowed, common bash allowed, destructive bash asked
 *   - manual:      everything asked (OpenCode sends ask-events the UI surfaces)
 *   - planning:    edits denied (read-only), bash mostly denied
 *   - danger:      N/A — bypassed via --dangerously-skip-permissions flag
 */
export function buildOpenCodePermissionJson(mode?: SessionMode): string {
  switch (mode) {
    case 'planning':
      return JSON.stringify({
        edit: 'deny',
        webfetch: 'allow',
        bash: {
          '*': 'deny',
          'ls *': 'allow',
          'cat *': 'allow',
          'grep *': 'allow',
          'find *': 'allow',
          'git status': 'allow',
          'git diff *': 'allow',
          'git log *': 'allow',
        },
      });
    case 'manual':
      return JSON.stringify({
        edit: 'ask',
        webfetch: 'ask',
        bash: { '*': 'ask' },
      });
    case 'danger':
      // Unused — --dangerously-skip-permissions takes effect at the flag level.
      return JSON.stringify({ edit: 'allow', webfetch: 'allow', bash: { '*': 'allow' } });
    case 'auto-accept':
    default:
      return JSON.stringify({
        edit: 'allow',
        webfetch: 'allow',
        bash: {
          '*': 'allow',
          'rm -rf *': 'ask',
          'rm -rf /': 'deny',
          'sudo *': 'ask',
          'curl * | bash *': 'ask',
          'curl * | sh *': 'ask',
          'wget * | bash *': 'ask',
        },
      });
  }
}

export type OpenCodePermissionRule = {
  permission: string;
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
};

function openCodeDirectoryPatterns(
  workingDirectory?: string,
  allowedDirectories?: string[]
): string[] {
  const values = [workingDirectory, ...(allowedDirectories || [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => path.resolve(value));
  const unique = Array.from(new Set(values));
  return unique.flatMap((dir) => [dir, `${dir}/**`]);
}

function openCodeDirectoryAllowRules(
  workingDirectory?: string,
  allowedDirectories?: string[]
): OpenCodePermissionRule[] {
  return openCodeDirectoryPatterns(workingDirectory, allowedDirectories).map((pattern) => ({
    permission: 'external_directory',
    pattern,
    action: 'allow',
  }));
}

export function buildOpenCodePermissionRules(
  mode?: SessionMode,
  opts: { workingDirectory?: string; allowedDirectories?: string[] } = {}
): OpenCodePermissionRule[] {
  const directoryAllows = openCodeDirectoryAllowRules(
    opts.workingDirectory,
    opts.allowedDirectories
  );
  // OpenCode permission patterns are last-match-wins, so broad external_directory
  // catch-alls must come before the specific WebUI workspace/add-dir allows.
  const allowRead: OpenCodePermissionRule[] = [
    { permission: 'read', pattern: '*', action: 'allow' },
    { permission: 'list', pattern: '*', action: 'allow' },
    { permission: 'glob', pattern: '*', action: 'allow' },
    { permission: 'grep', pattern: '*', action: 'allow' },
    { permission: 'webfetch', pattern: '*', action: 'allow' },
    { permission: 'websearch', pattern: '*', action: 'allow' },
  ];

  switch (mode) {
    case 'planning':
      return [
        ...allowRead,
        { permission: 'edit', pattern: '*', action: 'deny' },
        { permission: 'bash', pattern: '*', action: 'deny' },
        { permission: 'task', pattern: '*', action: 'deny' },
        { permission: 'todowrite', pattern: '*', action: 'deny' },
        { permission: 'external_directory', pattern: '*', action: 'deny' },
        ...directoryAllows,
        { permission: 'repo_clone', pattern: '*', action: 'deny' },
        { permission: 'plan_enter', pattern: '*', action: 'deny' },
        { permission: 'plan_exit', pattern: '*', action: 'deny' },
      ];
    case 'manual':
      return [
        ...allowRead,
        { permission: 'edit', pattern: '*', action: 'ask' },
        { permission: 'bash', pattern: '*', action: 'ask' },
        { permission: 'task', pattern: '*', action: 'ask' },
        { permission: 'todowrite', pattern: '*', action: 'ask' },
        { permission: 'external_directory', pattern: '*', action: 'ask' },
        ...directoryAllows,
        { permission: 'repo_clone', pattern: '*', action: 'ask' },
      ];
    case 'danger':
      return [
        { permission: '*', pattern: '*', action: 'allow' },
        { permission: 'question', pattern: '*', action: 'deny' },
      ];
    case 'auto-accept':
    default:
      return [
        ...allowRead,
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: '*', action: 'allow' },
        { permission: 'task', pattern: '*', action: 'allow' },
        { permission: 'todowrite', pattern: '*', action: 'allow' },
        { permission: 'external_directory', pattern: '*', action: 'ask' },
        ...directoryAllows,
        { permission: 'repo_clone', pattern: '*', action: 'allow' },
        { permission: 'question', pattern: '*', action: 'deny' },
      ];
  }
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
      // Per-user harnesses (Pi, OpenCode) report false here; their credentials
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
    // Pi and OpenCode route through endpoints the user configures here, so a
    // configured endpoint is the credential. This is what lets an operator set
    // up one harness and leave the others untouched.
    if (userId && (provider === 'pi' || provider === 'opencode')) {
      const { readOpenCodeProvidersForUser } = await import('../utils/opencodeProviderKeys.js');
      return readOpenCodeProvidersForUser(userId).some(
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
    if (provider === 'kimi') {
      // Kimi Code CLI only creates ~/.kimi-code/credentials/ after a successful
      // `kimi login` (device-code OAuth). The home dir itself exists before
      // login, so directory presence alone is not a logged-in signal.
      const credsDir = path.join(credPath, 'credentials');
      const entries = await fs.readdir(credsDir);
      return entries.some((entry) => !entry.startsWith('.'));
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
    case 'opencode':
      // Plain text + newline
      return message + '\n';

    default:
      return message + '\n';
  }
}
