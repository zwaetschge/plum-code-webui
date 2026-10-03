import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer, CreateElicitationRequest } from '@agentclientprotocol/sdk';
import type { TodoItem } from '@plum-code-webui/shared';
import { resolveVibeHome } from '../cli-providers.js';

/**
 * Translation between Mistral Vibe's ACP stream and Plum's session events.
 *
 * Vibe speaks ACP like Kimi, but its payloads differ: a tool's input and
 * human title arrive in the first `tool_call_update` (not in `tool_call`),
 * tool names are snake_case (`bash`, `read_file`, `edit`, `todo`), results
 * are structured objects, todos come as `plan` updates, and the usage it
 * returns per prompt is the session's running total. Everything here is pure
 * or reads Vibe's own files, so it is covered by the Vibe regression suite.
 */

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** Vibe tool → the canonical names Plum's tool cards, todos and agent cards know. */
const VIBE_TOOL_NAMES: Record<string, string> = {
  bash: 'Bash',
  git_bash: 'Bash',
  experimental_bash: 'Bash',
  windows_shell: 'Bash',
  read_file: 'Read',
  write_file: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  task: 'Task',
  todo: 'TodoWrite',
  skill: 'Skill',
  ask_user_question: 'AskUserQuestion',
  exit_plan_mode: 'ExitPlanMode',
};

/** The tool key Vibe used (`_meta.tool_name`, else the bare `tool_call` title). */
export function vibeToolKey(update: { title?: string | null; _meta?: unknown }): string | null {
  const meta = isRecord(update._meta) ? update._meta : {};
  const fromMeta = str(meta.tool_name) || str(meta.toolName);
  if (fromMeta) return fromMeta;
  const title = str(update.title);
  // The first tool_call carries the bare name; later titles are prose.
  return title && /^[a-z][a-z0-9_]*$/.test(title) ? title : null;
}

/** Canonical display name; MCP tools (`server_tool`) keep Vibe's name. */
export function vibeToolName(
  key: string | null | undefined,
  fallbackTitle?: string | null
): string {
  if (key && VIBE_TOOL_NAMES[key]) return VIBE_TOOL_NAMES[key]!;
  return key || str(fallbackTitle) || 'Vibe tool';
}

/** Rename Vibe's camelCase input keys to the Claude-style keys the cards render. */
export function normalizeVibeInput(name: string, rawInput: unknown): unknown {
  if (!isRecord(rawInput)) return rawInput;
  const input: Json = { ...rawInput };
  const move = (from: string, to: string) => {
    if (input[from] !== undefined && input[to] === undefined) input[to] = input[from];
    delete input[from];
  };
  move('filePath', 'file_path');
  move('oldString', 'old_string');
  move('newString', 'new_string');
  move('replaceAll', 'replace_all');
  if (name === 'Task') {
    const task = str(input.task) || str(input.prompt) || '';
    return {
      description: task.length > 80 ? `${task.slice(0, 77)}…` : task,
      prompt: task,
      subagent_type: str(input.agent) || 'explore',
    };
  }
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    return { todos: vibeTodos(input.todos) };
  }
  return input;
}

function normalizeTodoStatus(status: unknown): TodoItem['status'] {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'completed' || status === 'cancelled' || status === 'canceled') return 'completed';
  return 'pending';
}

/** Vibe todos or ACP plan entries → Plum's todo list. */
export function vibeTodos(entries: unknown): TodoItem[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const content = str(entry.content);
    return content ? [{ content, status: normalizeTodoStatus(entry.status) }] : [];
  });
}

interface ToolUpdateLike {
  rawOutput?: unknown;
  content?: Array<Json> | null;
}

/** A readable result: command output, file text or the edit's diff instead of raw JSON. */
export function vibeToolResult(name: string, update: ToolUpdateLike): string {
  const output = update.rawOutput;
  if (isRecord(output)) {
    if (name === 'Bash') {
      const parts = [str(output.stdout), str(output.output), str(output.stderr)].filter(Boolean);
      if (parts.length) return parts.join('\n');
      if (output.stdout === '' && output.stderr === '') return '(keine Ausgabe)';
    }
    if (name === 'Read' && typeof output.content === 'string') return output.content;
    if (name === 'Edit' || name === 'Write') {
      const diff = (update.content || [])
        .filter((entry) => entry.type === 'diff')
        .map((entry) => {
          const file = str(entry.path) || '';
          const before = String(entry.oldText ?? '')
            .split('\n')
            .map((line) => `- ${line}`);
          const after = String(entry.newText ?? '')
            .split('\n')
            .map((line) => `+ ${line}`);
          return [`--- ${file}`, ...(entry.oldText != null ? before : []), ...after].join('\n');
        });
      if (diff.length) return diff.join('\n\n');
    }
    if (name === 'WebSearch' && typeof output.answer === 'string') {
      const sources = Array.isArray(output.sources)
        ? output.sources
            .filter(isRecord)
            .map((source) => `- ${source.title ?? ''} ${source.url ?? ''}`.trim())
        : [];
      return [output.answer, ...sources].join('\n');
    }
    if (name === 'Task' && typeof output.response === 'string') return output.response;
    // MCP tools: {ok, server, tool, text, structured}.
    if (typeof output.server === 'string' && typeof output.tool === 'string') {
      if (typeof output.text === 'string' && output.text) return output.text;
      if (output.structured != null) return JSON.stringify(output.structured, null, 2);
    }
    if (typeof output.message === 'string') return output.message;
  }
  const text = (update.content || [])
    .map((entry) =>
      entry.type === 'content' && isRecord(entry.content) && entry.content.type === 'text'
        ? String(entry.content.text ?? '')
        : ''
    )
    .filter(Boolean)
    .join('\n');
  if (text) return text;
  if (typeof output === 'string') return output;
  if (output !== undefined && output !== null) {
    try {
      return JSON.stringify(output);
    } catch {
      return String(output);
    }
  }
  return '';
}

/** Vibe reports history compaction as a tool call with this title. */
export function isVibeCompaction(title: string | null | undefined): boolean {
  return /compacting conversation/i.test(String(title || ''));
}

// ---------------------------------------------------------------------------- usage

export interface VibeSessionStats {
  prompt: number;
  completion: number;
  cached: number;
}

/**
 * Vibe's running totals for one native session, from
 * `$VIBE_HOME/logs/session/session_<date>_<id8>/meta.json`. ACP returns the
 * same running total per prompt; Plum books the difference.
 */
export function readVibeSessionStats(nativeSessionId: string | undefined): VibeSessionStats | null {
  if (!nativeSessionId) return null;
  const dir = path.join(resolveVibeHome(), 'logs', 'session');
  const suffix = `_${nativeSessionId.slice(0, 8)}`;
  let newest: { file: string; mtime: number } | null = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(suffix)) continue;
      const file = path.join(dir, name, 'meta.json');
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file, mtime };
      } catch {
        /* no meta yet */
      }
    }
    if (!newest) return null;
    const meta = JSON.parse(fs.readFileSync(newest.file, 'utf8')) as Json;
    const stats = isRecord(meta.stats) ? meta.stats : {};
    const num = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 0);
    return {
      prompt: num(stats.session_prompt_tokens),
      completion: num(stats.session_completion_tokens),
      cached: num(stats.session_cached_tokens),
    };
  } catch {
    return null;
  }
}

/** One turn's usage from two running totals (a reset after resume counts from zero). */
export function vibeTurnUsage(
  current: VibeSessionStats,
  baseline: VibeSessionStats | null | undefined
): VibeSessionStats {
  const base =
    baseline &&
    current.prompt >= baseline.prompt &&
    current.completion >= baseline.completion &&
    current.cached >= baseline.cached
      ? baseline
      : { prompt: 0, completion: 0, cached: 0 };
  return {
    prompt: current.prompt - base.prompt,
    completion: current.completion - base.completion,
    cached: current.cached - base.cached,
  };
}

// ---------------------------------------------------------------------------- MCP

const PASSTHROUGH_ENV = [
  'WEBUI_BACKEND_URL',
  'WEBUI_HOOK_SECRET',
  'WEBUI_CONFIG_HOME',
  'DOCKER_HOST',
  'ANDROID_BUILDER_URL',
  'COMFYUI_URL',
  'GODOT_BIN',
  'GODOT_DOCKER_IMAGE',
  'BLENDER_BIN',
  'NODE_PATH',
];

/**
 * Plum's MCP servers (Claude's settings.json, the shared registry every
 * provider mirrors) as ACP stdio servers for Vibe's session/new. The MCP
 * children get Vibe's default environment plus these values, so the session
 * id and hook secret travel explicitly.
 */
export function buildVibeMcpServers(
  sessionId: string,
  extraEnv: Record<string, string | undefined> = {}
): McpServer[] {
  const configHome = process.env.WEBUI_CONFIG_HOME || path.join(os.homedir(), '.claude');
  let servers: Json = {};
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(configHome, 'settings.json'), 'utf8')
    ) as Json;
    servers = isRecord(settings.mcpServers) ? settings.mcpServers : {};
  } catch {
    return [];
  }
  const shared: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key];
    if (value) shared[key] = value;
  }
  for (const [key, value] of Object.entries(extraEnv)) {
    if (typeof value === 'string' && value) shared[key] = value;
  }
  shared.WEBUI_SESSION_ID = sessionId;
  const result: McpServer[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    if (!isRecord(raw) || raw.disabled === true) continue;
    const type = str(raw.type) || 'stdio';
    if (type === 'http' && str(raw.url)) {
      const headers = isRecord(raw.headers) ? raw.headers : {};
      result.push({
        type: 'http',
        name,
        url: String(raw.url),
        headers: Object.entries(headers).map(([header, value]) => ({
          name: header,
          value: String(value),
        })),
      });
      continue;
    }
    const command = str(raw.command);
    if (type !== 'stdio' || !command) continue;
    const env = { ...shared, ...(isRecord(raw.env) ? raw.env : {}) };
    result.push({
      name,
      command,
      args: Array.isArray(raw.args) ? raw.args.map(String) : [],
      env: Object.entries(env).map(([key, value]) => ({ name: key, value: String(value) })),
    });
  }
  return result;
}

/** Script of Vibe's Ultracode workflow server (repo checkout first, then the image). */
export function resolveVibeUltracodeScript(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'scripts', 'mcp-servers', 'vibe-ultracode.mjs'),
    path.resolve(process.cwd(), '..', '..', 'scripts', 'mcp-servers', 'vibe-ultracode.mjs'),
    '/app/scripts/mcp-servers/vibe-ultracode.mjs',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Workflows can run for an hour; Vibe's default MCP tool timeout is 60 s. */
const VIBE_ULTRACODE_TOOL_TIMEOUT_SEC = 3 * 60 * 60;

/**
 * `VIBE_MCP_SERVERS` for an Ultracode session: the `ultracode` server and its
 * `workflow` tool. It goes through Vibe's config layer, not ACP, because only
 * config entries can raise the 60 s MCP tool timeout; Vibe merges the list by
 * name with config.toml. The server's children (`vibe -p`) do not inherit it,
 * so a workflow agent cannot start workflows of its own.
 */
export function buildVibeUltracodeEnv(options: {
  sessionId: string;
  model?: string | null;
  vibeEnv: Record<string, string | undefined>;
  extraEnv: Record<string, string | undefined>;
}): Record<string, string> {
  const script = resolveVibeUltracodeScript();
  if (!script) return {};
  const env: Record<string, string> = {};
  for (const source of [options.vibeEnv, options.extraEnv]) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string' && value) env[key] = value;
    }
  }
  // An inherited key only when Vibe's own .env does not carry one (buildVibeEnv).
  if (!('MISTRAL_API_KEY' in options.vibeEnv) && process.env.MISTRAL_API_KEY) {
    env.MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  }
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (options.model) env.VIBE_ULTRACODE_MODEL = options.model;
  env.WEBUI_SESSION_ID = options.sessionId;
  return {
    VIBE_MCP_SERVERS: JSON.stringify([
      {
        name: 'ultracode',
        transport: 'stdio',
        command: process.execPath,
        args: [script],
        env,
        tool_timeout_sec: VIBE_ULTRACODE_TOOL_TIMEOUT_SEC,
      },
    ]),
  };
}

/** Vibe names MCP tools `<server>_<tool>`. */
export function isVibeUltracodeTool(name: string): boolean {
  return name === 'ultracode_workflow';
}

// ---------------------------------------------------------------------------- questions

export interface VibeQuestion {
  question: string;
  header: string;
  options: Array<{ label: string; description?: string }>;
  multiple: boolean;
  custom: boolean;
}

/** Vibe's ask_user_question form (one property per question) → Plum's question card. */
export function vibeElicitationQuestions(request: CreateElicitationRequest): {
  keys: string[];
  questions: VibeQuestion[];
} {
  const schema = 'requestedSchema' in request ? request.requestedSchema : null;
  const properties = schema && isRecord(schema.properties) ? schema.properties : {};
  const keys: string[] = [];
  const questions: VibeQuestion[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) continue;
    // Schema unions are wide; read the few fields Vibe sets structurally.
    const raw = value as Json;
    const items = isRecord(raw.items) ? raw.items : {};
    const multiple = raw.type === 'array';
    const choices: unknown[] = multiple
      ? Array.isArray(items.anyOf)
        ? items.anyOf
        : []
      : Array.isArray(raw.oneOf)
        ? raw.oneOf
        : [];
    keys.push(key);
    questions.push({
      question: str(raw.description) || str(raw.title) || 'Vibe braucht eine Antwort.',
      header: str(raw.title) || `Frage ${questions.length + 1}`,
      options: choices.filter(isRecord).map((choice) => ({
        label: str(choice.title) || String(choice.const ?? ''),
      })),
      multiple,
      custom: true,
    });
  }
  return { keys, questions };
}

/** Plum's answers (per question a list of labels/text) → Vibe's form content. */
export function vibeElicitationContent(
  keys: string[],
  questions: VibeQuestion[],
  answers: string[][]
): Record<string, string | string[]> | null {
  const content: Record<string, string | string[]> = {};
  for (let index = 0; index < keys.length; index += 1) {
    const picked = (answers[index] || []).map((answer) => answer.trim()).filter(Boolean);
    if (!picked.length) return null;
    content[keys[index]!] = questions[index]!.multiple ? picked : picked.join(', ');
  }
  return content;
}
