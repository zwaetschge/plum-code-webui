/**
 * Ultracode for Pi: deterministic multi-agent workflows.
 *
 * The Pi counterpart of Claude Code's Ultracode. The model writes a small
 * JavaScript workflow script. This extension runs it and gives every `agent()`
 * call its own `pi` process with a fresh context, so fan-out, pipelines and
 * verification passes are code, not the model deciding turn by turn.
 *
 * Opt-in, like Ultracode:
 * - the session's effort is `ultracode` (Plum sets PI_ULTRACODE=1), or
 * - the prompt contains the word "ultracode" (that turn only).
 * Otherwise the `workflow` tool stays inactive. Child agents never get it, so
 * a workflow cannot recurse into more workflows.
 *
 * Runs are stored under <agent dir>/ultracode/runs/<runId>/ (script, per-call
 * cache, result). `resumeFromRunId` replays every unchanged agent() call from
 * that cache, so an interrupted or edited workflow only re-runs what changed.
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const TOOL_NAME = 'workflow';
const IS_CHILD = process.env.PI_ULTRACODE_CHILD === '1';
const SESSION_ULTRACODE = process.env.PI_ULTRACODE === '1';
const KEYWORD = /\bultra-?code\b/i;

const CONCURRENCY = clampInt(process.env.PI_ULTRACODE_CONCURRENCY, 4, 1, 16);
/** Hard cap per run. The size guideline in the prompt is much lower. */
const MAX_AGENTS = clampInt(process.env.PI_ULTRACODE_MAX_AGENTS, 40, 1, 200);
const SIZE_GUIDELINE = clampInt(process.env.PI_ULTRACODE_SIZE_GUIDELINE, 10, 1, 200);
const AGENT_OUTPUT_CAP = 48 * 1024;
const RESULT_CAP = 60 * 1024;
const HEARTBEAT_MS = 15_000;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
}

function runsDir(): string {
  return path.join(agentDir(), 'ultracode', 'runs');
}

// ── Authoring guide (system prompt section while Ultracode is on) ────────────

const GUIDE = `Ultracode is on: you may orchestrate multi-agent work with the \`workflow\` tool.

When a task benefits from several independent agents (broad reviews, audits, fan-out over many files or dimensions, implement-then-verify loops), write a workflow script instead of doing everything in this context. For small or single-file tasks keep working directly.

Script rules:
- Plain JavaScript (no TypeScript). It must begin with \`export const meta = { name: '...', description: '...', phases: [{ title: '...' }] }\` — a pure literal.
- The rest is the body of an async function: use \`await\` and \`return\` freely. The returned value (JSON-serialisable) is the workflow result.
- Globals: \`agent(prompt, opts)\`, \`parallel(thunks)\`, \`pipeline(items, ...stages)\`, \`phase(title)\`, \`log(message)\`, \`args\`.
  - \`agent(prompt, { label, phase, schema, agent, model, tools, thinking, cwd })\` runs one agent in a fresh \`pi\` process with no access to this conversation. Put everything it needs into the prompt. Returns its final text, or the parsed object when \`schema\` (a JSON Schema) is given. Throws when the agent fails.
  - \`agent\` (in opts) picks an agent definition by name (e.g. "explore", "backend-dev", "test-engineer"); \`model\` overrides the model ("provider/id"); \`tools\` limits tools, e.g. ["read","grep","find","ls"] for read-only work.
  - \`parallel([() => agent(...), () => agent(...)])\` runs thunks concurrently (at most ${CONCURRENCY} agents at once) and returns their results in order; a failed entry becomes \`null\`.
  - \`pipeline(items, stage1, stage2, ...)\` pushes every item through the stages independently — item A can be verifying while item B is still reviewing. Each stage is \`(previous, item, index) => value\`; the first stage gets the item. Returns final values in item order; failed items become \`null\`.
  - \`phase(title)\` sets the phase label for following agents; \`log(message)\` adds a progress line.
- No require/import, no filesystem or network in the script itself — agents do the work.
- Keep workflows under ${SIZE_GUIDELINE} agents unless the user asked for more; the hard limit is ${MAX_AGENTS} per run.

Quality patterns: give each agent a narrow, concrete job; ask for structured output with \`schema\`; verify findings adversarially with a second agent before reporting them; merge and deduplicate in the script, then summarise the result for the user yourself.

The tool returns a \`runId\` and the script path. To iterate, pass \`resumeFromRunId\`: unchanged agent() calls (same prompt and options) return their cached result instantly and only edited or new calls run. To re-run an edited script file, pass \`scriptPath\` instead of \`script\`.

Example:
\`\`\`js
export const meta = { name: 'review-changes', description: 'Review the diff per dimension, verify each finding', phases: [{ title: 'Review' }, { title: 'Verify' }] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, file: { type: 'string' } }, required: ['title', 'file'] } } }, required: ['findings'] }
const VERDICT = { type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real'] }
const dims = ['correctness', 'security', 'performance']
const reviewed = await pipeline(dims,
  d => agent(\`Review \\\`git diff HEAD\\\` in \${args.repo} for \${d} problems only.\`, { label: \`review:\${d}\`, phase: 'Review', schema: FINDINGS, tools: ['read', 'grep', 'find', 'ls', 'bash'] }),
  r => parallel(r.findings.map(f => () => agent(\`Adversarially check whether this is a real problem: \${JSON.stringify(f)}\`, { label: \`verify:\${f.file}\`, phase: 'Verify', schema: VERDICT }).then(v => ({ ...f, verdict: v })))))
return reviewed.flat().filter(f => f && f.verdict?.real)
\`\`\``;

// ── Script preparation ────────────────────────────────────────────────────────

interface WorkflowMeta {
  name: string;
  description?: string;
  phases?: { title: string; detail?: string }[];
}

function splitMeta(source: string): { meta: WorkflowMeta; body: string } {
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
  let quote: string | null = null;
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
  const literal = source.slice(start, end);
  let meta: unknown;
  try {
    // A pure literal: evaluated in an empty context with a short timeout.
    meta = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 100 });
  } catch (error) {
    throw new Error(`\`meta\` must be a pure literal: ${errorText(error)}`);
  }
  if (!isRecord(meta) || typeof meta.name !== 'string' || !meta.name.trim()) {
    throw new Error('`meta.name` is required.');
  }
  const body = source.slice(end).replace(/^\s*;/, '');
  return { meta: meta as unknown as WorkflowMeta, body };
}

// ── JSON schema (the subset agents are asked to fill) ─────────────────────────

type Schema = Record<string, unknown>;

function validate(value: unknown, schema: Schema, at = '$'): string | null {
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

function matchesType(value: unknown, type: string): boolean {
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
function extractJson(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (const fence of fences.reverse()) {
    try {
      return JSON.parse(fence[1]!);
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

// ── Agent definitions (Plum converts ~/.claude/agents into the agent dir) ────

interface AgentDefinition {
  name: string;
  systemPrompt: string;
  tools?: string[];
  model?: string;
}

function loadAgentDefinition(name: string): AgentDefinition | null {
  if (!/^[\w.-]+$/.test(name)) return null;
  const file = path.join(agentDir(), 'agents', `${name}.md`);
  let source: string;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const frontmatter = match?.[1] ?? '';
  const field = (key: string) =>
    new RegExp(`^${key}:\\s*(.+)$`, 'm')
      .exec(frontmatter)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '');
  const tools = field('tools')
    ?.replace(/^\[|\]$/g, '')
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
  const model = field('model');
  return {
    name,
    systemPrompt: match ? source.slice(match[0].length) : source,
    tools: tools?.length ? tools : undefined,
    model: model && model !== 'inherit' ? model : undefined,
  };
}

// ── Child pi processes ───────────────────────────────────────────────────────

function piInvocation(args: string[]): { command: string; args: string[] } {
  const script = process.argv[1];
  if (script && !script.startsWith('/$bunfs/') && fs.existsSync(script)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  const exec = path.basename(process.execPath).toLowerCase();
  if (!/^(node|bun)(\.exe)?$/.test(exec)) return { command: process.execPath, args };
  return { command: 'pi', args };
}

interface AgentOptions {
  label?: string;
  phase?: string;
  schema?: Schema;
  agent?: string;
  model?: string;
  tools?: string[];
  thinking?: string;
  cwd?: string;
}

type AgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cached';

interface AgentRecord {
  id: string;
  label: string;
  phase?: string;
  agent?: string;
  model?: string;
  status: AgentStatus;
  activity?: string;
  output?: string;
  error?: string;
  usage: { input: number; output: number; cost: number; turns: number };
  startedAt?: number;
  endedAt?: number;
}

interface ChildResult {
  text: string;
  model?: string;
  failed: boolean;
  error?: string;
}

async function runChild(
  prompt: string,
  opts: AgentOptions,
  defaults: { model?: string; thinking?: string; cwd: string },
  record: AgentRecord,
  signal: AbortSignal,
  changed: () => void
): Promise<ChildResult> {
  const definition = opts.agent ? loadAgentDefinition(opts.agent) : null;
  if (opts.agent && !definition) {
    return { text: '', failed: true, error: `Unknown agent "${opts.agent}"` };
  }
  const model = opts.model ?? definition?.model ?? defaults.model;
  const thinking = opts.thinking ?? defaults.thinking;
  const tools = opts.tools ?? definition?.tools;
  const args = ['--mode', 'json', '-p', '--no-session'];
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  if (tools?.length) args.push('--tools', tools.join(','));

  let promptDir: string | null = null;
  if (definition?.systemPrompt.trim()) {
    promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-ultracode-'));
    const file = path.join(promptDir, 'agent.md');
    fs.writeFileSync(file, definition.systemPrompt, { mode: 0o600 });
    args.push('--append-system-prompt', file);
  }
  args.push(prompt);
  record.model = model;

  try {
    return await new Promise<ChildResult>((resolve) => {
      const invocation = piInvocation(args);
      const child = spawn(invocation.command, invocation.args, {
        cwd: opts.cwd || defaults.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PI_ULTRACODE: '0', PI_ULTRACODE_CHILD: '1' },
      });
      let buffer = '';
      let stderr = '';
      let lastText = '';
      let stopReason: string | undefined;
      let errorMessage: string | undefined;
      let resolvedModel = model;

      const onLine = (line: string) => {
        if (!line.trim()) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (event.type === 'tool_execution_start' && typeof event.toolName === 'string') {
          record.activity = `Tool: ${event.toolName}`;
          changed();
        }
        const message = isRecord(event.message) ? event.message : null;
        if (event.type === 'message_end' && message?.role === 'assistant') {
          const content = Array.isArray(message.content) ? message.content : [];
          const text = content
            .filter(
              (part): part is { type: string; text: string } =>
                isRecord(part) && part.type === 'text'
            )
            .map((part) => part.text)
            .join('\n');
          if (text.trim()) lastText = text;
          const usage = isRecord(message.usage) ? message.usage : {};
          record.usage.turns++;
          record.usage.input += Number(usage.input) || 0;
          record.usage.output += Number(usage.output) || 0;
          record.usage.cost += Number(isRecord(usage.cost) ? usage.cost.total : 0) || 0;
          if (typeof message.model === 'string' && !resolvedModel) resolvedModel = message.model;
          if (typeof message.stopReason === 'string') stopReason = message.stopReason;
          if (typeof message.errorMessage === 'string') errorMessage = message.errorMessage;
          record.activity = text.trim()
            ? text.trim().split('\n')[0]!.slice(0, 200)
            : record.activity;
          changed();
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(onLine);
      });
      child.stderr.on('data', (chunk: Buffer) => {
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
        const failed =
          signal.aborted || code !== 0 || stopReason === 'error' || stopReason === 'aborted';
        resolve({
          text: lastText,
          model: resolvedModel,
          failed,
          error: failed
            ? signal.aborted
              ? 'aborted'
              : errorMessage || stderr.trim().split('\n').slice(-3).join('\n') || `exit ${code}`
            : undefined,
        });
      });
    });
  } finally {
    if (promptDir) fs.rmSync(promptDir, { recursive: true, force: true });
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

interface RunState {
  runId: string;
  name: string;
  phase?: string;
  agents: AgentRecord[];
  logs: string[];
  startedAt: number;
}

class Semaphore {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
  }
  release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

function cacheKey(prompt: string, opts: AgentOptions): string {
  return createHash('sha256')
    .update(JSON.stringify([prompt, opts]))
    .digest('hex');
}

function newRunId(): string {
  return `wf_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

function readCache(runId: string): Record<string, unknown> {
  if (!/^wf_[a-z0-9]+$/.test(runId)) throw new Error(`Invalid run id "${runId}".`);
  const file = path.join(runsDir(), runId, 'cache.json');
  if (!fs.existsSync(file)) throw new Error(`Run "${runId}" has no cache to resume from.`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function summarise(state: RunState): string {
  const count = (status: AgentStatus) => state.agents.filter((a) => a.status === status).length;
  const parts = [
    `${state.name}${state.phase ? ` · ${state.phase}` : ''}`,
    `${count('completed') + count('cached')}/${state.agents.length} fertig`,
  ];
  if (count('running')) parts.push(`${count('running')} laufen`);
  if (count('queued')) parts.push(`${count('queued')} warten`);
  if (count('failed')) parts.push(`${count('failed')} fehlgeschlagen`);
  return parts.join(' · ');
}

function publicDetails(state: RunState) {
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

function truncate(text: string, cap: number): string {
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  let cut = text.slice(0, cap);
  while (Buffer.byteLength(cut, 'utf8') > cap) cut = cut.slice(0, -1);
  return `${cut}\n\n[… gekürzt]`;
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function ultracode(pi: ExtensionAPI) {
  if (IS_CHILD) return;

  pi.registerTool({
    name: TOOL_NAME,
    label: 'Workflow (Ultracode)',
    description:
      'Run a deterministic multi-agent workflow script (Ultracode). Each agent() call runs in its own pi process with a fresh context. See the Ultracode section of the system prompt for the script API.',
    promptSnippet: 'Run a multi-agent workflow script (Ultracode)',
    parameters: Type.Object({
      script: Type.Optional(
        Type.String({
          description:
            'Workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal); the rest is an async function body.',
          maxLength: 512 * 1024,
        })
      ),
      scriptPath: Type.Optional(
        Type.String({
          description:
            "Path of a persisted script (or a run id wf_…, meaning that run's script) to run instead of `script`.",
        })
      ),
      args: Type.Optional(Type.Any({ description: 'Value exposed to the script as `args`.' })),
      resumeFromRunId: Type.Optional(
        Type.String({ description: 'Reuse cached agent() results of an earlier run (wf_…).' })
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // A bare run id stands for that run's persisted script.
      const scriptPath =
        typeof params.scriptPath === 'string' && /^wf_[a-z0-9]+$/.test(params.scriptPath)
          ? path.join(runsDir(), params.scriptPath, 'script.js')
          : params.scriptPath;
      const source =
        typeof scriptPath === 'string' && scriptPath
          ? fs.readFileSync(path.resolve(ctx.cwd, scriptPath), 'utf8')
          : typeof params.script === 'string'
            ? params.script
            : '';
      if (!source.trim()) throw new Error('Pass `script` or `scriptPath`.');
      const { meta, body } = splitMeta(source);
      const previous = params.resumeFromRunId ? readCache(params.resumeFromRunId) : {};

      const state: RunState = {
        runId: newRunId(),
        name: meta.name,
        agents: [],
        logs: [],
        startedAt: Date.now(),
      };
      const runDir = path.join(runsDir(), state.runId);
      fs.mkdirSync(runDir, { recursive: true });
      const scriptFile = path.join(runDir, 'script.js');
      fs.writeFileSync(scriptFile, source);
      const cache: Record<string, unknown> = {};
      const saveCache = () =>
        fs.writeFileSync(path.join(runDir, 'cache.json'), JSON.stringify(cache));

      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', abort, { once: true });

      let lastEmit = 0;
      let pending: NodeJS.Timeout | null = null;
      const emit = (force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < 400) {
          pending ??= setTimeout(() => {
            pending = null;
            emit(true);
          }, 400);
          return;
        }
        lastEmit = now;
        onUpdate?.({
          content: [{ type: 'text', text: summarise(state) }],
          details: publicDetails(state),
        });
      };
      const heartbeat = setInterval(() => emit(true), HEARTBEAT_MS);

      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const defaults = { model, thinking: ctx.thinkingLevel as string | undefined, cwd: ctx.cwd };
      const gate = new Semaphore(CONCURRENCY);

      const agent = async (prompt: unknown, rawOpts: unknown = {}): Promise<unknown> => {
        if (typeof prompt !== 'string' || !prompt.trim()) {
          throw new Error('agent(prompt) needs a non-empty prompt string');
        }
        const opts = (isRecord(rawOpts) ? JSON.parse(JSON.stringify(rawOpts)) : {}) as AgentOptions;
        if (state.agents.length >= MAX_AGENTS) {
          throw new Error(`Agent limit of ${MAX_AGENTS} per run reached`);
        }
        const record: AgentRecord = {
          id: String(state.agents.length + 1),
          label: opts.label || prompt.trim().split('\n')[0]!.slice(0, 80),
          phase: opts.phase ?? state.phase,
          agent: opts.agent,
          status: 'queued',
          usage: { input: 0, output: 0, cost: 0, turns: 0 },
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
          let result = await runChild(
            prompt + schemaNote,
            opts,
            defaults,
            record,
            controller.signal,
            emit
          );
          let value: unknown = result.text;
          if (!result.failed && opts.schema) {
            let problem: string | null;
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
                defaults,
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
          record.model = result.model ?? record.model;
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

      const settle = async (fn: () => unknown): Promise<unknown> => {
        try {
          return await fn();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          state.logs.push(`Fehler: ${errorText(error)}`);
          return null;
        }
      };
      const parallel = async (thunks: unknown): Promise<unknown[]> => {
        if (!Array.isArray(thunks)) throw new Error('parallel() takes an array of functions');
        return Promise.all(
          thunks.map((thunk) => settle(() => (typeof thunk === 'function' ? thunk() : thunk)))
        );
      };
      const pipeline = async (items: unknown, ...stages: unknown[]): Promise<unknown[]> => {
        if (!Array.isArray(items)) throw new Error('pipeline() takes an array of items');
        return Promise.all(
          items.map((item, index) =>
            settle(async () => {
              let value: unknown = item;
              for (const stage of stages) {
                if (typeof stage !== 'function')
                  throw new Error('pipeline stages must be functions');
                value = await stage(value, item, index);
                if (value === null || value === undefined) break;
              }
              return value;
            })
          )
        );
      };
      const phase = (title: unknown) => {
        state.phase = typeof title === 'string' ? title : undefined;
        emit();
      };
      const log = (...parts: unknown[]) => {
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
        log,
        args: params.args === undefined ? undefined : JSON.parse(JSON.stringify(params.args)),
        meta,
        console: { log, info: log, warn: log, error: log },
      });

      emit(true);
      let returned: unknown;
      let failure: string | null = null;
      try {
        const run = vm.runInContext(`(async () => {\n${body}\n})()`, sandbox, {
          filename: scriptFile,
          timeout: 2_000,
        }) as Promise<unknown>;
        returned = await run;
      } catch (error) {
        failure = controller.signal.aborted ? 'Workflow abgebrochen' : errorText(error);
      } finally {
        clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        signal?.removeEventListener('abort', abort);
        if (!controller.signal.aborted) controller.abort();
      }

      let serialised: string;
      try {
        serialised = JSON.stringify(returned ?? null, null, 2) ?? 'null';
      } catch {
        serialised = String(returned);
      }
      fs.writeFileSync(
        path.join(runDir, 'result.json'),
        JSON.stringify({ meta, failure, result: returned ?? null, agents: state.agents }, null, 2)
      );
      emit(true);

      const cost = state.agents.reduce((sum, a) => sum + a.usage.cost, 0);
      const lines = [
        `Workflow "${meta.name}" ${failure ? 'fehlgeschlagen' : 'abgeschlossen'} · runId ${state.runId}`,
        `Script: ${scriptFile}`,
        `Agents: ${state.agents.length} (${state.agents.filter((a) => a.status === 'cached').length} aus Cache, ${state.agents.filter((a) => a.status === 'failed').length} fehlgeschlagen)${cost ? ` · $${cost.toFixed(4)}` : ''}`,
      ];
      if (failure)
        lines.push(
          `Fehler: ${failure}`,
          'Mit resumeFromRunId lassen sich die fertigen agent()-Aufrufe wiederverwenden.'
        );
      if (state.logs.length)
        lines.push('', 'Log:', ...state.logs.slice(-30).map((line) => `- ${line}`));
      lines.push('', 'Ergebnis:', truncate(serialised, RESULT_CAP));
      if (failure && state.agents.length === 0) throw new Error(lines.join('\n'));
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: publicDetails(state),
      };
    },
  });

  // The tool is registered once and switched per turn: on for an Ultracode
  // session or a prompt that says "ultracode", off otherwise.
  pi.on('before_agent_start', async (event) => {
    const enabled = SESSION_ULTRACODE || KEYWORD.test(event.prompt ?? '');
    const active = new Set(pi.getActiveTools());
    if (enabled) active.add(TOOL_NAME);
    else active.delete(TOOL_NAME);
    pi.setActiveTools([...active]);
    if (!enabled) return;
    const options = event.systemPromptOptions as { sections?: Record<string, string> } | undefined;
    if (options?.sections) {
      options.sections.ultracode = GUIDE;
      return;
    }
    return { systemPrompt: `${event.systemPrompt}\n\n<ultracode>\n${GUIDE}\n</ultracode>` };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
