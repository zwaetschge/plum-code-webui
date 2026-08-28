#!/usr/bin/env node
// CLI-subagent MCP bridge for Plum Code WebUI.
//
// Lets ANY harness (Claude Code, Codex, OpenCode, Pi) delegate a task to a
// whole other provider CLI as a one-shot headless worker instead of its own
// built-in subagent: Codex can spawn `opencode run -m z-ai/glm-5.2`, Claude
// can spawn `codex exec`, and so on. The spawned CLIs use the shared logins
// under ~/.codex, ~/.claude, ~/.opencode — no credentials pass through here.
//
// Which subagents exist (label, provider, model) is configured per WebUI user
// in Settings → General → Subagents and fetched from the backend with the
// hook secret. Without backend access the bare providers remain usable.
//
// Zero-dependency by design, same protocol boilerplate as godot.mjs.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

function readParentEnv() {
  if (process.platform !== 'linux' || !process.ppid) return {};
  try {
    const raw = readFileSync(`/proc/${process.ppid}/environ`, 'utf8');
    const entries = {};
    for (const item of raw.split('\0')) {
      if (!item) continue;
      const separator = item.indexOf('=');
      if (separator <= 0) continue;
      entries[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return entries;
  } catch {
    return {};
  }
}

const RUNTIME_ENV = { ...readParentEnv(), ...process.env };
const BACKEND = RUNTIME_ENV.WEBUI_BACKEND_URL || 'http://localhost:3001';
const HOOK_SECRET = RUNTIME_ENV.WEBUI_HOOK_SECRET || '';
const SESSION_ID = RUNTIME_ENV.WEBUI_SESSION_ID || '';
// A spawned CLI subagent inherits this env, gets the same MCP servers from the
// shared settings, and could recurse. One level of delegation is the feature;
// two is a fork bomb.
const SUBAGENT_DEPTH = Number(RUNTIME_ENV.PLUM_SUBAGENT_DEPTH || 0);
const DEFAULT_TIMEOUT_S = Number(RUNTIME_ENV.SUBAGENT_TIMEOUT_SECONDS || 600);
const MAX_OUTPUT_CHARS = Number(RUNTIME_ENV.SUBAGENT_MAX_OUTPUT_CHARS || 60_000);

const log = (...args) => console.error('[mcp-subagents]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

function asText(payload, isError = false) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text: body }], isError };
}

// ---------------------------------------------------------------------------
// Configuration

const KNOWN_PROVIDERS = ['codex', 'claude', 'opencode'];

const FALLBACK_ENTRIES = KNOWN_PROVIDERS.map((provider) => ({
  id: provider,
  label: provider,
  provider,
  model: '',
  enabled: true,
}));

async function fetchConfig() {
  if (!HOOK_SECRET || !SESSION_ID) return { entries: FALLBACK_ENTRIES, env: {} };
  try {
    const response = await fetch(`${BACKEND}/api/settings/internal/cli-subagents`, {
      headers: {
        'x-webui-hook-secret': HOOK_SECRET,
        'x-webui-session-id': SESSION_ID,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`backend responded ${response.status}`);
    const body = await response.json();
    const entries = Array.isArray(body?.data?.entries) ? body.data.entries : [];
    const env = body?.data?.env && typeof body.data.env === 'object' ? body.data.env : {};
    return { entries, env };
  } catch (error) {
    log('config fetch failed, using bare providers:', String(error));
    return { entries: FALLBACK_ENTRIES, env: {} };
  }
}

function cliAvailable(provider) {
  const dirs = (RUNTIME_ENV.PATH || '').split(':');
  return dirs.some((dir) => {
    if (!dir) return false;
    try {
      const candidate = path.join(dir, provider);
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Spawning

function buildInvocation(provider, prompt, model) {
  switch (provider) {
    case 'codex':
      // --json gives us the final agent message and token usage as JSONL.
      // workspace-write without approval prompts — a headless child cannot
      // answer an approval prompt anyway (same flags the admin LLM uses).
      return {
        command: 'codex',
        args: [
          'exec',
          '--json',
          '--skip-git-repo-check',
          '--sandbox',
          'workspace-write',
          '-c',
          'approval_policy="never"',
          ...(model ? ['-m', model] : []),
          prompt,
        ],
      };
    case 'claude':
      return {
        command: 'claude',
        args: [
          '-p',
          '--output-format',
          'json',
          '--dangerously-skip-permissions',
          ...(model ? ['--model', model] : []),
          prompt,
        ],
      };
    case 'opencode':
      return {
        command: 'opencode',
        args: ['run', ...(model ? ['-m', model] : []), prompt],
      };
    default:
      return null;
  }
}

function buildChildEnv(provider, providerEnv) {
  const env = {
    ...RUNTIME_ENV,
    ...(providerEnv?.[provider] || {}),
    PLUM_SUBAGENT_DEPTH: String(SUBAGENT_DEPTH + 1),
  };
  if (provider !== 'claude') {
    // The calling session may carry model-router overrides for the Claude
    // transport. A codex/opencode child must not inherit them: opencode's
    // anthropic provider would otherwise send its traffic through a router
    // token that meters someone else's turn.
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

function runChild(invocation, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    // stdin must be closed: codex and opencode both detect a piped stdin and
    // wait for EOF to append it to the prompt — an open pipe hangs them forever.
    const proc = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${String(error)}`, timedOut });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

// ---------------------------------------------------------------------------
// Output parsing: final answer + token usage per provider

function parseCodexJsonl(stdout) {
  let text = '';
  let usage = null;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const item = event?.item ?? event?.msg?.item;
    const itemType = String(item?.type || '')
      .replace(/_/g, '')
      .toLowerCase();
    if (itemType === 'agentmessage') {
      const candidate = item.text || item.content || '';
      if (typeof candidate === 'string' && candidate) text = candidate;
    }
    const turnUsage = event?.usage ?? event?.msg?.usage;
    if (turnUsage && typeof turnUsage === 'object' && 'input_tokens' in turnUsage) {
      usage = {
        inputTokens: Number(turnUsage.input_tokens || 0),
        outputTokens:
          Number(turnUsage.output_tokens || 0) + Number(turnUsage.reasoning_output_tokens || 0),
        cacheReadTokens: Number(turnUsage.cached_input_tokens || 0),
        cacheCreationTokens: 0,
      };
    }
  }
  return { text, usage };
}

function parseClaudeJson(stdout) {
  // `claude -p --output-format json` prints exactly one JSON object.
  const start = stdout.indexOf('{');
  if (start < 0) return { text: '', usage: null };
  try {
    const parsed = JSON.parse(stdout.slice(start));
    const rawUsage = parsed?.usage;
    return {
      text: typeof parsed?.result === 'string' ? parsed.result : '',
      model: typeof parsed?.modelUsage === 'object' ? Object.keys(parsed.modelUsage)[0] : undefined,
      usage:
        rawUsage && typeof rawUsage === 'object'
          ? {
              inputTokens: Number(rawUsage.input_tokens || 0),
              outputTokens: Number(rawUsage.output_tokens || 0),
              cacheReadTokens: Number(rawUsage.cache_read_input_tokens || 0),
              cacheCreationTokens: Number(rawUsage.cache_creation_input_tokens || 0),
            }
          : null,
    };
  } catch {
    return { text: '', usage: null };
  }
}

async function bookUsage(provider, model, usage) {
  if (!usage || !HOOK_SECRET || !SESSION_ID) return;
  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  if (total <= 0) return;
  try {
    await fetch(`${BACKEND}/api/settings/internal/cli-subagents/usage`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webui-hook-secret': HOOK_SECRET,
        'x-webui-session-id': SESSION_ID,
      },
      body: JSON.stringify({ provider, model: model || provider, ...usage }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    log('usage booking failed:', String(error));
  }
}

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated ${text.length - MAX_OUTPUT_CHARS} chars]`;
}

// ---------------------------------------------------------------------------
// Tools

const TOOLS = [
  {
    name: 'list_subagents',
    description:
      'List the configured CLI subagents (other provider CLIs that can be spawned as one-shot workers via run_subagent), including which are actually installed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_subagent',
    description:
      'Delegate a task to another provider CLI as a headless one-shot subagent (e.g. Codex, Claude Code, or OpenCode with a GLM/Kimi model). The subagent runs in the given working directory with full tool access and returns its final answer. Use this instead of the built-in subagent when the task should run on a different provider or subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        subagent: {
          type: 'string',
          description:
            'Which subagent to run: a configured label or a bare provider (codex, claude, opencode). See list_subagents.',
        },
        prompt: {
          type: 'string',
          description:
            'Complete, self-contained task for the subagent. It shares the working directory but none of this conversation.',
        },
        model: {
          type: 'string',
          description:
            'Optional model override (opencode expects provider/model ids like z-ai/glm-5.2).',
        },
        working_directory: {
          type: 'string',
          description: 'Directory the subagent works in. Defaults to the current workspace.',
        },
        timeout_seconds: {
          type: 'number',
          description: `Max runtime before the subagent is killed (default ${DEFAULT_TIMEOUT_S}).`,
        },
      },
      required: ['subagent', 'prompt'],
    },
  },
];

async function handleListSubagents() {
  const { entries } = await fetchConfig();
  return asText({
    subagents: entries.map((entry) => ({
      subagent: entry.label,
      provider: entry.provider,
      model: entry.model || '(provider default)',
      installed: cliAvailable(entry.provider),
    })),
    note: 'Call run_subagent with the subagent label (or bare provider name) and a self-contained prompt.',
  });
}

async function handleRunSubagent(args) {
  if (SUBAGENT_DEPTH >= 1) {
    return asText(
      'run_subagent is not available inside a CLI subagent (one level of delegation only). Finish the task directly.',
      true
    );
  }
  const requested = String(args.subagent || '').trim();
  const prompt = String(args.prompt || '').trim();
  if (!requested || !prompt) {
    return asText('Both "subagent" and "prompt" are required.', true);
  }

  const { entries, env: providerEnv } = await fetchConfig();
  const entry =
    entries.find((e) => e.label.toLowerCase() === requested.toLowerCase()) ||
    entries.find((e) => e.provider === requested.toLowerCase());
  if (!entry) {
    const available = entries.map((e) => e.label).join(', ') || '(none configured)';
    return asText(`Unknown subagent "${requested}". Configured: ${available}`, true);
  }

  const model = String(args.model || '').trim() || entry.model || '';
  const invocation = buildInvocation(entry.provider, prompt, model);
  if (!invocation) return asText(`Unsupported provider "${entry.provider}".`, true);
  if (!cliAvailable(invocation.command)) {
    return asText(`The ${entry.provider} CLI is not installed in this environment.`, true);
  }

  const cwd = String(args.working_directory || '').trim() || process.cwd();
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return asText(`working_directory does not exist: ${cwd}`, true);
  }
  const timeoutMs =
    Math.min(Math.max(Number(args.timeout_seconds) || DEFAULT_TIMEOUT_S, 30), 3600) * 1000;

  log(`spawning ${entry.provider}${model ? ` (${model})` : ''} in ${cwd}`);
  const startedAt = Date.now();
  const result = await runChild(invocation, {
    cwd,
    env: buildChildEnv(entry.provider, providerEnv),
    timeoutMs,
  });
  const durationS = Math.round((Date.now() - startedAt) / 1000);

  if (result.timedOut) {
    return asText(
      `Subagent ${entry.label} timed out after ${Math.round(timeoutMs / 1000)}s.\nPartial output:\n${truncate(result.stdout || result.stderr)}`,
      true
    );
  }

  let text = '';
  let usage = null;
  let usageModel = model;
  if (entry.provider === 'codex') {
    const parsed = parseCodexJsonl(result.stdout);
    text = parsed.text;
    usage = parsed.usage;
    usageModel = model || 'gpt-5.5';
  } else if (entry.provider === 'claude') {
    const parsed = parseClaudeJson(result.stdout);
    text = parsed.text;
    usage = parsed.usage;
    usageModel = model || parsed.model || 'claude';
  } else {
    text = result.stdout.trim();
  }

  if (result.code !== 0 && !text) {
    return asText(
      `Subagent ${entry.label} exited with code ${result.code}.\n${truncate(result.stderr || result.stdout)}`,
      true
    );
  }

  void bookUsage(entry.provider, usageModel, usage);

  const header = `[subagent ${entry.label} · ${entry.provider}${model ? ` · ${model}` : ''} · ${durationS}s${
    usage ? ` · ${usage.inputTokens} in / ${usage.outputTokens} out tokens` : ''
  }]`;
  return asText(`${header}\n\n${truncate(text || result.stdout.trim())}`);
}

// ---------------------------------------------------------------------------
// MCP protocol loop

async function handleToolCall(name, args) {
  switch (name) {
    case 'list_subagents':
      return handleListSubagents();
    case 'run_subagent':
      return handleRunSubagent(args || {});
    default:
      return asText(`Unknown tool: ${name}`, true);
  }
}

// A closed stdin must not kill an in-flight subagent: drain first, then exit.
let inFlight = 0;
let stdinClosed = false;
function maybeExit() {
  if (stdinClosed && inFlight === 0) process.exit(0);
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  inFlight += 1;
  void (async () => {
    try {
      if (msg.method === 'initialize') {
        ok(msg.id, {
          protocolVersion: msg.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'plum-subagents', version: '1.0.0' },
        });
        return;
      }
      if (msg.method === 'notifications/initialized' || msg.id === undefined) return;
      if (msg.method === 'tools/list') {
        ok(msg.id, { tools: TOOLS });
        return;
      }
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params || {};
        ok(msg.id, await handleToolCall(name, args));
        return;
      }
      fail(msg.id, -32601, `Method not found: ${msg.method}`);
    } catch (error) {
      log('handler error:', error);
      if (msg.id !== undefined) fail(msg.id, -32603, String(error?.message || error));
    } finally {
      inFlight -= 1;
      maybeExit();
    }
  })();
});

rl.on('close', () => {
  stdinClosed = true;
  maybeExit();
});
log(`ready (session=${SESSION_ID || 'none'}, depth=${SUBAGENT_DEPTH})`);
