#!/usr/bin/env node
// CLI-subagent MCP bridge for Plum Code WebUI.
//
// Lets ANY harness (Claude Code, Codex, Pi) delegate a task to a whole other
// provider CLI as a one-shot headless worker instead of its own built-in
// subagent: Codex can spawn `pi -p --model z-ai/glm-5.2`, Claude can spawn
// `codex exec`, and so on. Codex and Claude use the shared logins under
// ~/.codex and ~/.claude; Pi's per-user agent dir and registry keys arrive as
// env from the backend.
//
// `zai` is the one provider that is not its own binary: it runs the Claude CLI
// against the user's Z.AI endpoint, which is how the WebUI's second Claude
// transport works. A GLM subagent therefore stays inside the Claude harness.
// Its endpoint and token arrive as env from the backend, same channel as Pi's
// credentials.
//
// Which subagents exist (label, provider, model) is configured per WebUI user
// in Settings → General → Subagents and fetched from the backend with the
// hook secret. Without backend access the bare providers remain usable.
//
// Zero-dependency by design, same protocol boilerplate as godot.mjs.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
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
// The permission mode of the session that calls this server. A worker used to
// run with every permission whatever the session allowed, which made
// delegating the way around a planning or manual session.
const SESSION_MODE = String(RUNTIME_ENV.WEBUI_SESSION_MODE || '').trim();
const MAX_OUTPUT_CHARS = Number(RUNTIME_ENV.SUBAGENT_MAX_OUTPUT_CHARS || 60_000);
// MAX_OUTPUT_CHARS only trims what we hand back. The raw capture needs its own
// ceiling: a subagent that loops on a progress spinner can emit hundreds of
// megabytes, and every byte of it used to be concatenated onto a string in this
// process. Keep the head (Claude's single JSON object starts there) and the
// tail (where the final answer lands for JSONL and plain-text harnesses); drop
// the middle, which is progress noise in every format we parse.
const MAX_CAPTURE_CHARS = Number(RUNTIME_ENV.SUBAGENT_MAX_CAPTURE_CHARS || 4_000_000);

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

const KNOWN_PROVIDERS = ['codex', 'claude', 'pi', 'zai', 'vibe'];

// Which binary a provider actually spawns. Only `zai` differs from its name.
const PROVIDER_BINARY = { zai: 'claude' };
const binaryFor = (provider) => PROVIDER_BINARY[provider] || provider;

// Set by a Z.AI or model-router session and never valid for a child that is
// not deliberately pointed at the same upstream.
const CLAUDE_UPSTREAM_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'API_TIMEOUT_MS',
];

const FALLBACK_ENTRIES = KNOWN_PROVIDERS.map((provider) => ({
  id: provider,
  label: provider,
  provider,
  model: '',
  enabled: true,
}));

async function fetchConfig() {
  if (!HOOK_SECRET || !SESSION_ID) return { entries: FALLBACK_ENTRIES, env: {}, piModels: [] };
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
    const piModels = Array.isArray(body?.data?.piModels) ? body.data.piModels : [];
    return { entries, env, piModels };
  } catch (error) {
    log('config fetch failed, using bare providers:', String(error));
    return { entries: FALLBACK_ENTRIES, env: {}, piModels: [] };
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

/**
 * What a worker may do, from the calling session's mode. A headless worker
 * cannot ask anyone, so "manual" means the same as "planning" for it: look,
 * do not touch. A harness that states no mode keeps the full profile it had.
 */
function permissionProfile(mode) {
  if (!mode || mode === 'danger') return 'full';
  if (mode === 'auto-accept') return 'edits';
  return 'read-only';
}

function buildInvocation(provider, prompt, model, profile = 'full') {
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
          profile === 'read-only' ? 'read-only' : 'workspace-write',
          '-c',
          'approval_policy="never"',
          // HTTPS streaming instead of the Responses WebSocket, which the server
          // often closes mid-turn (see codexTransportArgs in the backend).
          ...(process.env.PLUM_CODEX_WEBSOCKETS === '1'
            ? []
            : [
                '-c',
                'model_providers.openai-https={name="OpenAI",requires_openai_auth=true,wire_api="responses",supports_websockets=false}',
                '-c',
                'model_provider="openai-https"',
              ]),
          ...(model ? ['-m', model] : []),
          prompt,
        ],
      };
    case 'claude':
    case 'zai':
      return {
        command: 'claude',
        args: [
          '-p',
          '--output-format',
          'json',
          ...(profile === 'full'
            ? ['--dangerously-skip-permissions']
            : ['--permission-mode', profile === 'edits' ? 'acceptEdits' : 'plan']),
          ...(model ? ['--model', model] : []),
          prompt,
        ],
      };
    case 'pi':
      // Pi's print mode has no restricted variant; it only runs for a session
      // that may do everything itself.
      if (profile !== 'full') return { refused: true };
      // --print is pi's non-interactive mode; --no-session keeps one-shot
      // workers out of the session store. --model accepts provider/id ids.
      // --mode json makes the run report its tokens: the plain text mode prints
      // the answer and nothing else, so Pi workers never reached the analytics.
      return {
        command: 'pi',
        args: [
          '-p',
          '--mode',
          'json',
          '--no-session',
          ...(model ? ['--model', model] : []),
          prompt,
        ],
        stream: 'pi-json',
      };
    case 'vibe':
      // Mistral Vibe's programmatic mode. It spends the plan's Vibe Code
      // allowance, which is why a swarm can delegate to it at all. --trust
      // skips the interactive workspace-trust prompt (a headless child cannot
      // answer it) and --auto-approve replaces tool approvals. Vibe picks its
      // model from its own config, so `model` is reported but not passed.
      // Without --auto-approve a headless Vibe just blocks, so like Pi it is
      // only offered to a session with full permissions.
      if (profile !== 'full') return { refused: true };
      return {
        command: 'vibe',
        args: [
          '--prompt',
          prompt,
          '--output',
          'json',
          '--auto-approve',
          '--trust',
          '--max-turns',
          '40',
        ],
      };
    default:
      return null;
  }
}

function buildChildEnv(provider, providerEnv) {
  const env = { ...RUNTIME_ENV };

  if (provider === 'zai') {
    // The child must talk to Z.AI and nothing else, so whatever upstream the
    // calling session carried is replaced wholesale rather than merged. The
    // backend only sends this block when the user actually has Z.AI configured.
    for (const key of CLAUDE_UPSTREAM_ENV_KEYS) delete env[key];
  } else if (provider !== 'claude') {
    // The calling session may carry model-router overrides for the Claude
    // transport. A codex/pi child must not inherit them: an anthropic provider
    // would otherwise send its traffic through a router token that meters
    // someone else's turn.
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
  }

  return {
    ...env,
    ...(providerEnv?.[provider] || {}),
    PLUM_SUBAGENT_DEPTH: String(SUBAGENT_DEPTH + 1),
  };
}

/**
 * Bounded stdout/stderr capture: keeps the first and last halves of the budget
 * and reports how much was dropped in between.
 */
function createCapture(limit = MAX_CAPTURE_CHARS) {
  const half = Math.max(1, Math.floor(limit / 2));
  let head = '';
  let tail = '';
  let dropped = 0;

  return {
    push(chunk) {
      const text = chunk.toString();
      if (head.length < half) {
        const room = half - head.length;
        head += text.slice(0, room);
        if (text.length <= room) return;
        tail += text.slice(room);
      } else {
        tail += text;
      }
      if (tail.length > half) {
        dropped += tail.length - half;
        tail = tail.slice(tail.length - half);
      }
    },
    value() {
      if (!dropped) return head + tail;
      return `${head}\n… [${dropped} chars dropped from the middle of the output]\n${tail}`;
    },
  };
}

/**
 * Reads Pi's JSON event stream while it arrives: the answer, and the tokens of
 * every model call.
 *
 * The stream cannot go through the bounded capture. A one-word answer is
 * already 150 kB of events, a real run is many megabytes, and the capture
 * drops the middle — which is where most of the usage records are. Only
 * `message_end` records matter; everything else (deltas, and the turn and agent
 * summaries that repeat whole messages) is skipped without being buffered.
 */
function createPiJsonReader() {
  const KEEP = '{"type":"message_end"';
  const MAX_LINE_CHARS = 16_000_000;
  const decoder = new StringDecoder('utf8');
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let line = '';
  let skipping = false;
  let decided = false;
  let text = '';
  let model = '';
  let errorMessage = '';
  let calls = 0;

  const add = (reported) => {
    if (!reported || typeof reported !== 'object') return;
    const input = Number(reported.input) || 0;
    const output = Number(reported.output) || 0;
    const cacheRead = Number(reported.cacheRead) || 0;
    const cacheWrite = Number(reported.cacheWrite) || 0;
    // Whatever Pi counts into its total beyond the four (reasoning tokens some
    // APIs report apart from the output) was produced by the model as well.
    const beyond = Math.max(
      0,
      (Number(reported.totalTokens) || 0) - input - output - cacheRead - cacheWrite
    );
    usage.inputTokens += input;
    usage.outputTokens += output + beyond;
    usage.cacheReadTokens += cacheRead;
    usage.cacheCreationTokens += cacheWrite;
  };

  const take = (record) => {
    if (record?.type !== 'message_end' || !record.message) return;
    const message = record.message;
    if (message.role !== 'assistant') {
      // A tool that ran a model of its own reports those tokens on its result.
      add(message.usage);
      return;
    }
    calls += 1;
    add(message.usage);
    if (message.provider && message.model) model = `${message.provider}/${message.model}`;
    const parts = (Array.isArray(message.content) ? message.content : [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text);
    if (parts.length > 0) text = parts.join('\n');
    errorMessage =
      message.stopReason === 'error' || message.stopReason === 'aborted'
        ? String(message.errorMessage || `Pi stopped (${message.stopReason})`)
        : '';
  };

  const endLine = () => {
    if (!skipping && line) {
      try {
        take(JSON.parse(line.endsWith('\r') ? line.slice(0, -1) : line));
      } catch {
        /* a cut-off or foreign line carries nothing we need */
      }
    }
    line = '';
    skipping = false;
    decided = false;
  };

  const feed = (piece) => {
    if (skipping || !piece) return;
    line += piece;
    if (!decided && line.length >= KEEP.length) {
      decided = true;
      // Every record starts with its type; anything but message_end is dropped
      // from here to the end of the line.
      if (line.startsWith('{"type":"') && !line.startsWith(KEEP)) skipping = true;
    }
    if (line.length > MAX_LINE_CHARS) skipping = true;
    if (skipping) line = '';
  };

  return {
    push(chunk) {
      const data = decoder.write(chunk);
      let start = 0;
      for (;;) {
        const end = data.indexOf('\n', start);
        if (end < 0) {
          feed(data.slice(start));
          return;
        }
        feed(data.slice(start, end));
        endLine();
        start = end + 1;
      }
    },
    result() {
      feed(decoder.end());
      endLine();
      const total =
        usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
      return {
        text,
        model,
        calls,
        isError: errorMessage !== '',
        errorMessage,
        usage: total > 0 ? { ...usage } : null,
      };
    },
  };
}

function runChild(invocation, { cwd, env, timeoutMs, onStdout }) {
  return new Promise((resolve) => {
    // stdin must be closed: codex and pi both detect a piped stdin and wait
    // for EOF to append it to the prompt — an open pipe hangs them forever.
    const proc = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutCapture = createCapture();
    const stderrCapture = createCapture();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    proc.stdout.on('data', (chunk) => {
      // A stream with a reader of its own is not kept a second time.
      if (onStdout) onStdout(chunk);
      else stdoutCapture.push(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      stderrCapture.push(chunk);
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout: stdoutCapture.value(),
        stderr: `${stderrCapture.value()}\n${String(error)}`,
        timedOut,
      });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stdout: stdoutCapture.value(),
        stderr: stderrCapture.value(),
        timedOut,
      });
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
      isError: parsed?.is_error === true,
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

function parseVibeJson(stdout) {
  // `vibe --output json` prints the whole session history as one JSON array.
  // The answer is the last assistant message entry; reasoning entries are
  // separate and stay out of the result.
  const start = stdout.indexOf('[');
  if (start < 0) return { text: stdout.trim(), usage: null };
  try {
    const parsed = JSON.parse(stdout.slice(start));
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.history)
        ? parsed.history
        : [];
    let text = '';
    for (const entry of entries) {
      if (entry?.type !== 'message' || entry?.role !== 'assistant') continue;
      const content = Array.isArray(entry.content) ? entry.content : [];
      const parts = content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text);
      if (parts.length > 0) text = parts.join('\n');
    }
    // Vibe reports no token counters in programmatic mode, so nothing is
    // booked: an estimate would corrupt the plan ledger.
    return { text: text || stdout.trim(), usage: null };
  } catch {
    return { text: stdout.trim(), usage: null };
  }
}

// Identifies one subagent run for the whole life of this MCP process. The
// backend deduplicates usage rows on (session, provider, turn id), so the id has
// to survive a retry of the booking call — a fresh one per attempt would charge
// the same tokens twice. Random prefix so two MCP processes in the same session
// cannot collide on the counter.
const RUN_ID_PREFIX = Math.random().toString(36).slice(2, 10);
let runCounter = 0;

function nextRunId() {
  runCounter += 1;
  return `${RUN_ID_PREFIX}-${runCounter}`;
}

async function reportActivity(data) {
  if (!HOOK_SECRET || !SESSION_ID) return;
  try {
    const response = await fetch(`${BACKEND}/api/settings/internal/cli-subagents/activity`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webui-hook-secret': HOOK_SECRET,
        'x-webui-session-id': SESSION_ID,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`backend responded ${response.status}`);
  } catch (error) {
    log('activity reporting failed:', String(error));
  }
}

async function bookUsage(provider, model, usage, runId) {
  if (!usage || !HOOK_SECRET || !SESSION_ID) return;
  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  if (total <= 0) return;
  try {
    const response = await fetch(`${BACKEND}/api/settings/internal/cli-subagents/usage`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webui-hook-secret': HOOK_SECRET,
        'x-webui-session-id': SESSION_ID,
      },
      body: JSON.stringify({ provider, model: model || provider, runId, ...usage }),
      signal: AbortSignal.timeout(5000),
    });
    // A refused booking used to pass for a booked one.
    if (!response.ok) throw new Error(`backend responded ${response.status}`);
  } catch (error) {
    log('usage booking failed:', String(error));
  }
}

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated ${text.length - MAX_OUTPUT_CHARS} chars]`;
}

// ---------------------------------------------------------------------------
// Pi model routes
//
// Pi reaches several APIs, and one model family can sit on two of them: the
// vendor's own API (`deepseek/deepseek-flash`, the DeepSeek key) or hosted by
// another provider (`mistral/deepseek-v4-1-flash-1017`, the Mistral budget).
// A bare name is resolved here against the user's available models; Pi's own
// fuzzy `--model` silently picks one, which is how runs meant for DeepSeek
// ended up on the Mistral budget.

// Dots and dashes alike, and without the vendor prefix a host adds
// (`zai-glm-5-3` on Mistral is `glm-5.3` on Z.AI).
const normalizeModelName = (value) =>
  String(value).toLowerCase().replace(/[._]/g, '-').replace(/^zai-/, '');

function resolvePiModel(requested, piModels) {
  const wanted = String(requested || '').trim();
  if (!wanted || piModels.length === 0) return { id: wanted };
  const ids = piModels.map((entry) => entry.id);
  const part = (id) => normalizeModelName(id.slice(id.indexOf('/') + 1));
  if (wanted.includes('/')) {
    if (ids.includes(wanted)) return { id: wanted };
    const sameName = ids.filter((id) => part(id) === part(wanted));
    return { error: `Pi model "${wanted}" is not available.`, candidates: sameName };
  }
  const name = normalizeModelName(wanted);
  const exact = ids.filter((id) => part(id) === name);
  const matches = exact.length > 0 ? exact : ids.filter((id) => part(id).includes(name));
  if (matches.length === 1) return { id: matches[0] };
  if (matches.length === 0) return { error: `No Pi model matches "${wanted}".`, candidates: [] };
  return {
    error: `"${wanted}" is ambiguous in Pi: it exists on more than one API. Name the provider.`,
    candidates: matches,
  };
}

function describePiCandidates(candidates, piModels) {
  if (!candidates.length) {
    return piModels.map((entry) => `  ${entry.id} — ${entry.description}`).join('\n');
  }
  return candidates
    .map((id) => {
      const entry = piModels.find((item) => item.id === id);
      return `  ${id} — ${entry ? entry.description : ''}`;
    })
    .join('\n');
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
      'Delegate a task to another provider CLI as a headless one-shot subagent (e.g. Codex, Claude Code, the Z.AI/GLM harness, or Pi). The subagent runs in the given working directory with full tool access and returns its final answer. Use this instead of the built-in subagent when the task should run on a different provider or subscription. For GLM work prefer the "zai" subagent: it is the Claude harness pointed at Z.AI. Pi models are reached only through this tool: a `pi` started from the shell has none of the user\'s provider keys.',
    inputSchema: {
      type: 'object',
      properties: {
        subagent: {
          type: 'string',
          description:
            'Which subagent to run: a configured label or a bare provider (codex, claude, zai, pi, vibe). See list_subagents.',
        },
        prompt: {
          type: 'string',
          description:
            'Complete, self-contained task for the subagent. It shares the working directory but none of this conversation.',
        },
        model: {
          type: 'string',
          description:
            'Optional model override. For pi give the full provider/model id from list_subagents (pi_models), e.g. deepseek/deepseek-flash for DeepSeek on its own API or mistral/zai-glm-5-3 for GLM hosted by Mistral: the provider part decides which account is billed.',
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
  const { entries, piModels } = await fetchConfig();
  const hasPi = entries.some((entry) => entry.provider === 'pi');
  const routeOf = (id) => piModels.find((item) => item.id === id)?.description;
  return asText({
    subagents: entries.map((entry) => ({
      subagent: entry.label,
      provider: entry.provider,
      model:
        entry.model ||
        (entry.provider === 'pi' && piModels[0]
          ? `${piModels[0].id} (Pi default)`
          : '(provider default)'),
      ...(entry.provider === 'pi' && routeOf(entry.model || piModels[0]?.id)
        ? { route: routeOf(entry.model || piModels[0]?.id) }
        : {}),
      installed: cliAvailable(binaryFor(entry.provider)),
    })),
    ...(hasPi && piModels.length
      ? {
          pi_models: piModels.map((entry) => ({ model: entry.id, route: entry.description })),
          pi_note:
            'Any pi subagent accepts model=<provider/model> from pi_models. The provider part decides which account is billed: the same model family can be available directly and hosted by another provider.',
        }
      : {}),
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

  const { entries, env: providerEnv, piModels } = await fetchConfig();
  const entry =
    entries.find((e) => e.label.toLowerCase() === requested.toLowerCase()) ||
    entries.find((e) => e.provider === requested.toLowerCase());
  if (!entry) {
    const available = entries.map((e) => e.label).join(', ') || '(none configured)';
    return asText(`Unknown subagent "${requested}". Configured: ${available}`, true);
  }

  if (entry.provider === 'zai' && !providerEnv?.zai?.ANTHROPIC_BASE_URL) {
    // Falling through would run the Claude CLI on the Anthropic subscription
    // while calling itself a GLM worker. Better to say so.
    return asText(
      'The zai subagent needs a Z.AI endpoint. Configure it under Settings → General → Z.AI API.',
      true
    );
  }

  let model = String(args.model || '').trim() || entry.model || '';
  if (entry.provider === 'pi') {
    // Without a model Pi would take its own default; name it, so the run and
    // its usage row say which API was used.
    const resolved = resolvePiModel(model || piModels[0]?.id || '', piModels);
    if (resolved.error) {
      return asText(
        `${resolved.error}\n${resolved.candidates.length ? 'Choose one of:' : 'Available Pi models:'}\n${describePiCandidates(resolved.candidates, piModels)}`,
        true
      );
    }
    model = resolved.id;
  }
  const profile = permissionProfile(SESSION_MODE);
  const invocation = buildInvocation(entry.provider, prompt, model, profile);
  if (!invocation) return asText(`Unsupported provider "${entry.provider}".`, true);
  if (invocation.refused) {
    return asText(
      `This session runs in "${SESSION_MODE}" mode, and a ${entry.provider} worker cannot be held to it. ` +
        'Use a Claude or Codex worker, which run read-only or edit-only here, or switch the session mode.',
      true
    );
  }
  if (!cliAvailable(invocation.command)) {
    return asText(`The ${entry.provider} CLI is not installed in this environment.`, true);
  }

  const cwd = String(args.working_directory || '').trim() || process.cwd();
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return asText(`working_directory does not exist: ${cwd}`, true);
  }
  const timeoutMs =
    Math.min(Math.max(Number(args.timeout_seconds) || DEFAULT_TIMEOUT_S, 30), 3600) * 1000;

  const runId = nextRunId();
  log(`spawning ${entry.provider}${model ? ` (${model})` : ''} in ${cwd}`);
  const startedAt = Date.now();
  await reportActivity({
    id: runId,
    provider: entry.provider,
    model,
    description: prompt.slice(0, 2000),
    status: 'started',
  });
  const piReader = invocation.stream === 'pi-json' ? createPiJsonReader() : null;
  const result = await runChild(invocation, {
    cwd,
    env: buildChildEnv(entry.provider, providerEnv),
    timeoutMs,
    onStdout: piReader ? (chunk) => piReader.push(chunk) : undefined,
  }).catch(async (error) => {
    await reportActivity({
      id: runId,
      provider: entry.provider,
      status: 'error',
      error: String(error).slice(0, 2000),
    });
    throw error;
  });
  const durationS = Math.round((Date.now() - startedAt) / 1000);

  const piRun = piReader ? piReader.result() : null;

  if (result.timedOut) {
    await reportActivity({
      id: runId,
      provider: entry.provider,
      status: 'error',
      error: 'Zeitlimit erreicht',
    });
    // The tokens of a run that was cut off were spent all the same.
    if (piRun) await bookUsage(entry.provider, model, piRun.usage, runId);
    return asText(
      `Subagent ${entry.label} timed out after ${Math.round(timeoutMs / 1000)}s.\nPartial output:\n${truncate((piRun ? piRun.text : result.stdout) || result.stderr)}`,
      true
    );
  }

  let text = '';
  let usage = null;
  let usageModel = model;
  let observedModel = model;
  let failed = result.code !== 0;
  if (entry.provider === 'codex') {
    const parsed = parseCodexJsonl(result.stdout);
    text = parsed.text;
    usage = parsed.usage;
    usageModel = model || 'gpt-5.5';
  } else if (entry.provider === 'claude' || entry.provider === 'zai') {
    const parsed = parseClaudeJson(result.stdout);
    text = parsed.text;
    usage = parsed.usage;
    observedModel = parsed.model || model;
    failed ||= parsed.isError === true;
    // An empty model still lands on GLM: the Z.AI env maps the opus/sonnet/haiku
    // aliases. Report the mapped id so the usage row is priced as GLM instead of
    // being attributed to Anthropic.
    const zaiDefault =
      providerEnv?.zai?.ANTHROPIC_DEFAULT_SONNET_MODEL ||
      providerEnv?.zai?.ANTHROPIC_DEFAULT_OPUS_MODEL ||
      'glm';
    usageModel = model || parsed.model || (entry.provider === 'zai' ? zaiDefault : 'claude');
  } else if (entry.provider === 'vibe') {
    const parsed = parseVibeJson(result.stdout);
    text = parsed.text;
    usage = parsed.usage;
    usageModel = model || 'mistral-medium-3.5';
  } else if (piRun) {
    text = piRun.text;
    usage = piRun.usage;
    failed ||= piRun.isError;
    if (piRun.isError && !text) text = piRun.errorMessage;
  } else {
    text = result.stdout.trim();
  }

  await reportActivity({
    id: runId,
    provider: entry.provider,
    model: observedModel,
    status: failed ? 'error' : 'completed',
    result: failed ? undefined : text.slice(0, 12000),
    error: failed
      ? (text || result.stderr || `CLI beendet mit Code ${result.code}`).slice(0, 2000)
      : undefined,
  });

  // Booked before any early return: a run that failed has still spent its tokens.
  // Awaited: this process may exit as soon as the answer is out, and a booking
  // still on its way was lost with it.
  await bookUsage(entry.provider, usageModel, usage, runId);

  if (result.code !== 0 && !text) {
    return asText(
      `Subagent ${entry.label} exited with code ${result.code}.\n${truncate(result.stderr || result.stdout)}`,
      true
    );
  }

  const header = `[subagent ${entry.label} · ${entry.provider}${model ? ` · ${model}` : ''} · ${durationS}s${
    usage ? ` · ${usage.inputTokens} in / ${usage.outputTokens} out tokens` : ''
  }]`;
  return asText(
    `${header}\n\n${truncate(text || result.stdout.trim() || (piRun ? result.stderr.trim() : ''))}`,
    failed
  );
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
