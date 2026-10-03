#!/usr/bin/env node
// Ultracode for Mistral Vibe: deterministic multi-agent workflows.
//
// The Vibe counterpart of Claude Code's Ultracode and of
// scripts/pi-ultracode-extension.ts. The model writes a small JavaScript
// workflow script; this MCP server runs it and gives every `agent()` call its
// own `vibe -p` process with a fresh context, so fan-out, pipelines and
// verification passes are code, not the model deciding turn by turn.
//
// Plum registers the server only for sessions whose effort is `ultracode`, via
// VIBE_MCP_SERVERS (ClaudeProcessManager → buildVibeUltracodeEnv): config
// entries are the only way to lift Vibe's 60 s MCP tool timeout. The children
// do not inherit that variable, so a workflow agent cannot start workflows.
//
// Agents report to POST /api/ultracode/internal/progress, which turns them into
// subagent cards and books their tokens on the session's turn. Vibe hands the
// model `structuredContent` instead of the text when both exist, so the tool
// result is text only.
//
// Runs live under $VIBE_HOME/ultracode/runs/<runId>/ (script, per-call cache,
// result); `resumeFromRunId` replays unchanged agent() calls from that cache.
//
// Zero-dependency, like the other MCP bridges.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import vm from 'node:vm';

const env = process.env;
const VIBE_HOME = env.VIBE_HOME || path.join(os.homedir(), '.vibe');
const VIBE_BIN = env.VIBE_BIN || 'vibe';
const PROJECT = env.WEBUI_PROJECT_PATH || process.cwd();
const READ_ONLY = env.WEBUI_SESSION_MODE === 'planning';
const BACKEND = (env.WEBUI_BACKEND_URL || '').replace(/\/$/, '');

const CONCURRENCY = clampInt(env.VIBE_ULTRACODE_CONCURRENCY, 4, 1, 16);
/** Hard cap per run. The size guideline in the description is much lower. */
const MAX_AGENTS = clampInt(env.VIBE_ULTRACODE_MAX_AGENTS, 40, 1, 200);
const SIZE_GUIDELINE = clampInt(env.VIBE_ULTRACODE_SIZE_GUIDELINE, 10, 1, 200);
const MAX_TURNS = clampInt(env.VIBE_ULTRACODE_MAX_TURNS, 60, 1, 500);
const AGENT_OUTPUT_CAP = 48 * 1024;
const RESULT_CAP = 60 * 1024;
const PROGRESS_MS = 1_000;

const log = (...args) => console.error('[mcp-vibe-ultracode]', ...args);

function clampInt(raw, fallback, min, max) {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

const runsDir = () => path.join(VIBE_HOME, 'ultracode', 'runs');
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const errorText = (error) => (error instanceof Error ? error.message : String(error));

// ── Tool description (the authoring guide) ───────────────────────────────────

const DESCRIPTION = `Ultracode: run a deterministic multi-agent workflow script. Each agent() call runs in its own \`vibe\` process with a fresh context and no access to this conversation.

Use it when a task benefits from several independent agents (broad reviews, audits, fan-out over many files or dimensions, implement-then-verify loops). For small or single-file tasks keep working directly.

Script rules:
- Plain JavaScript. It must begin with \`export const meta = { name: '...', description: '...', phases: [{ title: '...' }] }\` (a pure literal).
- The rest is the body of an async function: use \`await\` and \`return\`. The returned value (JSON-serialisable) is the workflow result.
- Globals: \`agent(prompt, opts)\`, \`parallel(thunks)\`, \`pipeline(items, ...stages)\`, \`phase(title)\`, \`log(message)\`, \`args\`.
  - \`agent(prompt, { label, phase, schema, agent, model, tools, cwd })\` runs one agent. Put everything it needs into the prompt. Returns its final text, or the parsed object when \`schema\` (a JSON Schema) is given. Throws when the agent fails.
  - \`agent\` (in opts) picks a role: a Vibe agent profile ("plan" is read-only, "accept-edits", "auto-approve" or one from ~/.vibe/agents) or a Plum agent by name ("explore", "backend-dev", "test-engineer", "security-auditor" …). \`model\` picks a Vibe model alias. \`tools\` limits tools, e.g. ["read_file","grep","bash"] for read-only work.
  - \`parallel([() => agent(...), () => agent(...)])\` runs thunks concurrently (at most ${CONCURRENCY} agents at once) and returns results in order; a failed entry becomes \`null\`.
  - \`pipeline(items, stage1, stage2, ...)\` pushes every item through the stages independently. Each stage is \`(previous, item, index) => value\`; the first stage gets the item. Failed items become \`null\`.
  - \`phase(title)\` labels the following agents; \`log(message)\` adds a progress line.
- No require/import, no filesystem or network in the script itself; agents do the work.
- Keep workflows under ${SIZE_GUIDELINE} agents unless the user asked for more; the hard limit is ${MAX_AGENTS} per run.${READ_ONLY ? '\n- This session is in planning mode: every agent runs read-only.' : ''}

Quality patterns: give each agent a narrow, concrete job; ask for structured output with \`schema\`; verify findings adversarially with a second agent before reporting them; merge and deduplicate in the script, then summarise the result for the user yourself.

The result names a \`runId\`. To iterate, pass \`resumeFromRunId\`: unchanged agent() calls return their cached result instantly. To re-run a saved script, pass \`scriptPath\` (a path, or a run id) instead of \`script\`.

Example:
\`\`\`js
export const meta = { name: 'review-changes', description: 'Review the diff per dimension, verify each finding', phases: [{ title: 'Review' }, { title: 'Verify' }] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, file: { type: 'string' } }, required: ['title', 'file'] } } }, required: ['findings'] }
const VERDICT = { type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real'] }
const reviewed = await pipeline(['correctness', 'security', 'performance'],
  d => agent(\`Review \\\`git diff HEAD\\\` in \${args.repo} for \${d} problems only.\`, { label: \`review:\${d}\`, phase: 'Review', schema: FINDINGS, agent: 'plan' }),
  r => parallel(r.findings.map(f => () => agent(\`Check adversarially whether this is a real problem: \${JSON.stringify(f)}\`, { label: \`verify:\${f.file}\`, phase: 'Verify', schema: VERDICT, agent: 'plan' }).then(v => ({ ...f, verdict: v })))))
return reviewed.flat().filter(f => f && f.verdict?.real)
\`\`\``;

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    script: {
      type: 'string',
      description:
        'Workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal); the rest is an async function body.',
    },
    scriptPath: {
      type: 'string',
      description: "Path of a saved script, or a run id (wf_…) meaning that run's script.",
    },
    args: { description: 'Value exposed to the script as `args`.' },
    resumeFromRunId: {
      type: 'string',
      description: 'Reuse cached agent() results of an earlier run (wf_…).',
    },
  },
};

// ── Script preparation ───────────────────────────────────────────────────────

function splitMeta(source) {
  const match = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*export\s+const\s+meta\s*=\s*/.exec(
    source
  );
  if (!match) {
    throw new Error(
      'The script must begin with `export const meta = { name, description, phases }`.'
    );
  }
  const start = match[0].length;
  if (source[start] !== '{') throw new Error('`meta` must be an object literal.');
  // Find the matching brace, skipping strings and template literals.
  let depth = 0;
  let end = -1;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw new Error('Unterminated `meta` object.');
  let meta;
  try {
    // A pure literal: evaluated in an empty context with a short timeout.
    meta = vm.runInNewContext(`(${source.slice(start, end)})`, Object.create(null), {
      timeout: 100,
    });
  } catch (error) {
    throw new Error(`\`meta\` must be a pure literal: ${errorText(error)}`);
  }
  if (!isRecord(meta) || typeof meta.name !== 'string' || !meta.name.trim()) {
    throw new Error('`meta.name` is required.');
  }
  return { meta, body: source.slice(end).replace(/^\s*;/, '') };
}

// ── JSON schema (the subset agents are asked to fill) ────────────────────────

function validate(value, schema, at = '$') {
  const type = schema.type;
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    return `${at} must be one of ${JSON.stringify(schema.enum)}`;
  }
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.length && !types.some((t) => matchesType(value, String(t)))) {
    return `${at} must be ${types.join(' or ')}`;
  }
  if (isRecord(value) && isRecord(schema.properties)) {
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!(String(key) in value)) return `${at}.${String(key)} is required`;
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value && isRecord(sub)) {
        const problem = validate(value[key], sub, `${at}.${key}`);
        if (problem) return problem;
      }
    }
  }
  if (Array.isArray(value) && isRecord(schema.items)) {
    for (let i = 0; i < value.length; i++) {
      const problem = validate(value[i], schema.items, `${at}[${i}]`);
      if (problem) return problem;
    }
  }
  return null;
}

function matchesType(value, type) {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

/** The last fenced JSON block, else the last balanced top-level object/array. */
function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (const fence of fences.reverse()) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* try the next one */
    }
  }
  for (let start = text.length - 1; start >= 0; start--) {
    const ch = text[start];
    if (ch !== '{' && ch !== '[') continue;
    try {
      return JSON.parse(text.slice(start).replace(/[^}\]]*$/, ''));
    } catch {
      /* keep scanning */
    }
  }
  throw new Error('no JSON found in the agent output');
}

// ── Roles: Vibe agent profiles and Plum's agents (~/.claude/agents) ──────────

const VIBE_BUILTIN_AGENTS = new Set(['default', 'plan', 'ask', 'accept-edits', 'auto-approve']);

/** Plum/Claude tool names → Vibe's, for an agent definition's `tools:` line. */
const VIBE_TOOLS = {
  read: 'read_file',
  write: 'write_file',
  edit: 'edit',
  multiedit: 'edit',
  grep: 'grep',
  glob: 'bash',
  ls: 'bash',
  bash: 'bash',
  webfetch: 'web_fetch',
  websearch: 'web_search',
  todowrite: 'todo',
};

function loadPlumAgent(name) {
  const home = env.WEBUI_CONFIG_HOME || path.join(os.homedir(), '.claude');
  let source;
  try {
    source = fs.readFileSync(path.join(home, 'agents', `${name}.md`), 'utf8');
  } catch {
    return null;
  }
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const frontmatter = match?.[1] ?? '';
  const tools = /^tools:\s*(.+)$/m
    .exec(frontmatter)?.[1]
    ?.replace(/^\[|\]$/g, '')
    .split(',')
    .map(
      (tool) =>
        VIBE_TOOLS[
          tool
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .toLowerCase()
        ]
    )
    .filter(Boolean);
  return {
    systemPrompt: (match ? source.slice(match[0].length) : source).trim(),
    tools: tools?.length ? [...new Set(tools)] : undefined,
  };
}

function resolveRole(name) {
  if (!name) return {};
  if (!/^[\w.-]+$/.test(name)) throw new Error(`Invalid agent name "${name}"`);
  if (
    VIBE_BUILTIN_AGENTS.has(name) ||
    fs.existsSync(path.join(VIBE_HOME, 'agents', `${name}.toml`))
  ) {
    return { profile: name };
  }
  const plum = loadPlumAgent(name);
  if (!plum) throw new Error(`Unknown agent "${name}"`);
  return { brief: plum.systemPrompt, tools: plum.tools };
}

// ── Child vibe processes ─────────────────────────────────────────────────────

function readStats(vibeSessionId) {
  if (!vibeSessionId) return null;
  const dir = path.join(VIBE_HOME, 'logs', 'session');
  try {
    const suffix = `_${vibeSessionId.slice(0, 8)}`;
    const match = fs
      .readdirSync(dir)
      .filter((entry) => entry.endsWith(suffix))
      .sort()
      .pop();
    if (!match) return null;
    const stats = JSON.parse(fs.readFileSync(path.join(dir, match, 'meta.json'), 'utf8')).stats;
    return isRecord(stats) ? stats : null;
  } catch {
    return null;
  }
}

async function runChild(prompt, opts, record, signal, changed) {
  let role;
  try {
    role = resolveRole(opts.agent);
  } catch (error) {
    return { text: '', failed: true, error: errorText(error) };
  }
  const model = opts.model || env.VIBE_ULTRACODE_MODEL;
  const profile = READ_ONLY ? 'plan' : role.profile;
  const tools = opts.tools ?? role.tools;
  const args = ['-p', role.brief ? `${role.brief}\n\n---\n\n${prompt}` : prompt];
  args.push('--output', 'streaming', '--trust', '--auto-approve', '--workdir', opts.cwd || PROJECT);
  args.push('--max-turns', String(MAX_TURNS));
  if (profile) args.push('--agent', profile);
  for (const tool of tools ?? []) args.push('--enabled-tools', String(tool));
  record.model = model;

  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    if (key === 'VIBE_MCP_SERVERS' || key.startsWith('VIBE_ULTRACODE_')) delete childEnv[key];
  }
  if (model) childEnv.VIBE_ACTIVE_MODEL = model;

  return await new Promise((resolve) => {
    const child = spawn(VIBE_BIN, args, {
      cwd: opts.cwd || PROJECT,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });
    let buffer = '';
    let stderr = '';
    let lastText = '';
    let vibeSessionId = null;

    const onLine = (line) => {
      if (!line.trim()) return;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof entry.sessionId === 'string') vibeSessionId = entry.sessionId;
      if (entry.type === 'effect') {
        const summary = entry.detail?.display?.summary || entry.title;
        if (summary) {
          record.activity = String(summary).split('\n')[0].slice(0, 200);
          changed();
        }
      } else if (entry.type === 'message' && entry.role === 'assistant') {
        const text = (Array.isArray(entry.content) ? entry.content : [])
          .filter((part) => isRecord(part) && part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        if (text.trim()) {
          lastText = text;
          record.activity = text.trim().split('\n')[0].slice(0, 200);
          changed();
        }
      }
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8_000);
    });
    const kill = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5_000).unref();
    };
    if (signal.aborted) kill();
    else signal.addEventListener('abort', kill, { once: true });
    child.on('error', (error) => resolve({ text: '', failed: true, error: error.message }));
    child.on('close', (code) => {
      signal.removeEventListener('abort', kill);
      if (buffer.trim()) onLine(buffer);
      const stats = readStats(vibeSessionId);
      if (stats) {
        record.usage.input += Number(stats.session_prompt_tokens) || 0;
        record.usage.output += Number(stats.session_completion_tokens) || 0;
        record.usage.cached += Number(stats.session_cached_tokens) || 0;
        record.usage.cost += Number(stats.session_cost) || 0;
      }
      record.usage.turns++;
      const failed = signal.aborted || code !== 0 || !lastText.trim();
      resolve({
        text: lastText,
        failed,
        error: failed
          ? signal.aborted
            ? 'aborted'
            : stderr.trim().split('\n').slice(-3).join('\n') ||
              (code === 0 ? 'no answer' : `exit ${code}`)
          : undefined,
      });
    });
  });
}

// ── Runner ───────────────────────────────────────────────────────────────────

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
  }
  async acquire() {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.waiting.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    this.waiting.shift()?.();
  }
}

const cacheKey = (prompt, opts) =>
  createHash('sha256')
    .update(JSON.stringify([prompt, opts]))
    .digest('hex');
const newRunId = () => `wf_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

function readCache(runId) {
  if (!/^wf_[a-z0-9]+$/.test(runId)) throw new Error(`Invalid run id "${runId}".`);
  const file = path.join(runsDir(), runId, 'cache.json');
  if (!fs.existsSync(file)) throw new Error(`Run "${runId}" has no cache to resume from.`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return isRecord(parsed) ? parsed : {};
}

function publicDetails(state) {
  return {
    kind: 'ultracode',
    runId: state.runId,
    name: state.name,
    phase: state.phase,
    logs: state.logs.slice(-20),
    agents: state.agents.map(({ output, ...agent }) => ({
      ...agent,
      output: output ? output.slice(0, 4_000) : undefined,
    })),
  };
}

function truncate(text, cap) {
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  let cut = text.slice(0, cap);
  while (Buffer.byteLength(cut, 'utf8') > cap) cut = cut.slice(0, -1);
  return `${cut}\n\n[… gekürzt]`;
}

/** Best effort: the workflow runs on even when Plum is unreachable. */
async function report(body) {
  if (!BACKEND || !env.WEBUI_HOOK_SECRET || !env.WEBUI_SESSION_ID) return;
  try {
    await fetch(`${BACKEND}/api/ultracode/internal/progress`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webui-hook-secret': env.WEBUI_HOOK_SECRET,
        'x-webui-session-id': env.WEBUI_SESSION_ID,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    log('progress report failed:', errorText(error));
  }
}

async function runWorkflow(params, signal) {
  // A bare run id stands for that run's saved script.
  const scriptPath =
    typeof params.scriptPath === 'string' && /^wf_[a-z0-9]+$/.test(params.scriptPath)
      ? path.join(runsDir(), params.scriptPath, 'script.js')
      : params.scriptPath;
  const source =
    typeof scriptPath === 'string' && scriptPath
      ? fs.readFileSync(path.resolve(PROJECT, scriptPath), 'utf8')
      : typeof params.script === 'string'
        ? params.script
        : '';
  if (!source.trim()) throw new Error('Pass `script` or `scriptPath`.');
  const { meta, body } = splitMeta(source);
  const previous = params.resumeFromRunId ? readCache(params.resumeFromRunId) : {};

  const state = { runId: newRunId(), name: meta.name, agents: [], logs: [] };
  const runDir = path.join(runsDir(), state.runId);
  fs.mkdirSync(runDir, { recursive: true });
  const scriptFile = path.join(runDir, 'script.js');
  fs.writeFileSync(scriptFile, source);
  const cache = {};
  const saveCache = () => fs.writeFileSync(path.join(runDir, 'cache.json'), JSON.stringify(cache));

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort();
  signal.addEventListener('abort', abort, { once: true });

  let lastReport = 0;
  let pending = null;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < PROGRESS_MS) {
      pending ??= setTimeout(() => {
        pending = null;
        emit(true);
      }, PROGRESS_MS);
      return;
    }
    lastReport = now;
    void report({ details: publicDetails(state) });
  };

  const gate = new Semaphore(CONCURRENCY);

  const agent = async (prompt, rawOpts = {}) => {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('agent(prompt) needs a non-empty prompt string');
    }
    const opts = isRecord(rawOpts) ? JSON.parse(JSON.stringify(rawOpts)) : {};
    if (state.agents.length >= MAX_AGENTS) {
      throw new Error(`Agent limit of ${MAX_AGENTS} per run reached`);
    }
    const record = {
      id: String(state.agents.length + 1),
      label: opts.label || prompt.trim().split('\n')[0].slice(0, 80),
      phase: opts.phase ?? state.phase,
      agent: opts.agent,
      status: 'queued',
      usage: { input: 0, output: 0, cached: 0, cost: 0, turns: 0 },
    };
    state.agents.push(record);
    const key = cacheKey(prompt, opts);
    if (key in previous) {
      cache[key] = previous[key];
      saveCache();
      record.status = 'cached';
      record.endedAt = Date.now();
      emit();
      return JSON.parse(JSON.stringify(previous[key]));
    }
    emit();

    await gate.acquire();
    try {
      if (controller.signal.aborted) throw new Error('Workflow aborted');
      record.status = 'running';
      record.startedAt = Date.now();
      emit();
      const schemaNote = opts.schema
        ? `\n\nEnd your reply with exactly one \`\`\`json code block that matches this JSON Schema:\n${JSON.stringify(opts.schema)}`
        : '';
      let result = await runChild(prompt + schemaNote, opts, record, controller.signal, emit);
      let value = result.text;
      if (!result.failed && opts.schema) {
        let problem;
        try {
          value = extractJson(result.text);
          problem = validate(value, opts.schema);
        } catch (error) {
          problem = errorText(error);
        }
        if (problem) {
          // One repair attempt: the agent's own output plus the complaint.
          record.activity = `Schema-Korrektur: ${problem}`;
          emit();
          result = await runChild(
            `${prompt}\n\nYour previous answer did not match the required format (${problem}). Previous answer:\n${truncate(result.text, 16 * 1024)}${schemaNote}`,
            opts,
            record,
            controller.signal,
            emit
          );
          if (!result.failed) {
            try {
              value = extractJson(result.text);
              const again = validate(value, opts.schema);
              if (again) result = { ...result, failed: true, error: `schema: ${again}` };
            } catch (error) {
              result = { ...result, failed: true, error: `schema: ${errorText(error)}` };
            }
          }
        }
      }
      record.endedAt = Date.now();
      if (result.failed) {
        record.status = 'failed';
        record.error = result.error;
        emit();
        throw new Error(`${record.label}: ${result.error ?? 'failed'}`);
      }
      record.status = 'completed';
      record.output = truncate(result.text, AGENT_OUTPUT_CAP);
      cache[key] = value;
      saveCache();
      emit();
      return value;
    } finally {
      gate.release();
    }
  };

  const settle = async (fn) => {
    try {
      return await fn();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      state.logs.push(`Fehler: ${errorText(error)}`);
      return null;
    }
  };
  const parallel = async (thunks) => {
    if (!Array.isArray(thunks)) throw new Error('parallel() takes an array of functions');
    return Promise.all(
      thunks.map((thunk) => settle(() => (typeof thunk === 'function' ? thunk() : thunk)))
    );
  };
  const pipeline = async (items, ...stages) => {
    if (!Array.isArray(items)) throw new Error('pipeline() takes an array of items');
    return Promise.all(
      items.map((item, index) =>
        settle(async () => {
          let value = item;
          for (const stage of stages) {
            if (typeof stage !== 'function') throw new Error('pipeline stages must be functions');
            value = await stage(value, item, index);
            if (value === null || value === undefined) break;
          }
          return value;
        })
      )
    );
  };
  const phase = (title) => {
    state.phase = typeof title === 'string' ? title : undefined;
    emit();
  };
  const note = (...parts) => {
    state.logs.push(
      parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')
    );
    emit();
  };

  const sandbox = vm.createContext({
    agent,
    parallel,
    pipeline,
    phase,
    log: note,
    args: params.args === undefined ? undefined : JSON.parse(JSON.stringify(params.args)),
    meta,
    console: { log: note, info: note, warn: note, error: note },
  });

  emit(true);
  let returned;
  let failure = null;
  try {
    returned = await vm.runInContext(`(async () => {\n${body}\n})()`, sandbox, {
      filename: scriptFile,
      timeout: 2_000,
    });
  } catch (error) {
    failure = controller.signal.aborted ? 'Workflow abgebrochen' : errorText(error);
  } finally {
    if (pending) clearTimeout(pending);
    signal.removeEventListener('abort', abort);
    if (!controller.signal.aborted) controller.abort();
  }

  let serialised;
  try {
    serialised = JSON.stringify(returned ?? null, null, 2) ?? 'null';
  } catch {
    serialised = String(returned);
  }
  fs.writeFileSync(
    path.join(runDir, 'result.json'),
    JSON.stringify({ meta, failure, result: returned ?? null, agents: state.agents }, null, 2)
  );
  const usage = state.agents.reduce(
    (sum, a) => ({
      input: sum.input + a.usage.input,
      output: sum.output + a.usage.output,
      cached: sum.cached + a.usage.cached,
    }),
    { input: 0, output: 0, cached: 0 }
  );
  await report({ details: publicDetails(state), usage });

  const cost = state.agents.reduce((sum, a) => sum + a.usage.cost, 0);
  const lines = [
    `Workflow "${meta.name}" ${failure ? 'fehlgeschlagen' : 'abgeschlossen'} · runId ${state.runId}`,
    `Script: ${scriptFile}`,
    `Agents: ${state.agents.length} (${state.agents.filter((a) => a.status === 'cached').length} aus Cache, ${state.agents.filter((a) => a.status === 'failed').length} fehlgeschlagen)${cost ? ` · $${cost.toFixed(4)}` : ''}`,
  ];
  if (failure) {
    lines.push(
      `Fehler: ${failure}`,
      'Mit resumeFromRunId lassen sich die fertigen agent()-Aufrufe wiederverwenden.'
    );
  }
  if (state.logs.length)
    lines.push('', 'Log:', ...state.logs.slice(-30).map((line) => `- ${line}`));
  lines.push('', 'Ergebnis:', truncate(serialised, RESULT_CAP));
  return { text: lines.join('\n'), isError: Boolean(failure) && state.agents.length === 0 };
}

// ── MCP stdio ────────────────────────────────────────────────────────────────

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const running = new Map();

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ultracode', version: '1.0.0' },
      },
    });
    return;
  }
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [{ name: 'workflow', description: DESCRIPTION, inputSchema: INPUT_SCHEMA }],
      },
    });
    return;
  }
  if (msg.method === 'notifications/cancelled') {
    running.get(msg.params?.requestId)?.abort();
    return;
  }
  if (msg.method === 'tools/call') {
    if (msg.params?.name !== 'workflow') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool' } });
      return;
    }
    const controller = new AbortController();
    running.set(msg.id, controller);
    try {
      const result = await runWorkflow(msg.params.arguments ?? {}, controller.signal);
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: result.text }], isError: result.isError },
      });
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { content: [{ type: 'text', text: errorText(error) }], isError: true },
      });
    } finally {
      running.delete(msg.id);
    }
    return;
  }
  if (msg.id !== undefined) {
    if (msg.method === 'ping') send({ jsonrpc: '2.0', id: msg.id, result: {} });
    else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
});

process.stdin.on('end', () => {
  for (const controller of running.values()) controller.abort();
});
