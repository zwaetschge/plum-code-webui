/**
 * End-to-end test of the subagents MCP bridge (scripts/mcp-servers/subagents.mjs)
 * over its real stdio protocol, with fake provider CLIs on PATH and a stub
 * backend. The properties that matter:
 *
 * - the spawned CLI gets exactly the headless invocation we promise
 *   (codex exec --json over the HTTPS transport, claude -p --output-format
 *   json, pi -p)
 * - a pi model is resolved against the backend's model list: a bare name that
 *   exists on two APIs is refused instead of left to Pi's fuzzy match, which
 *   silently billed the wrong account
 * - a codex/pi child must NOT inherit ANTHROPIC_* router overrides,
 *   while a claude child keeps them (that's how nested GLM routing works)
 * - a `zai` child runs the claude binary but on the Z.AI endpoint the backend
 *   injects, never on the inherited Anthropic/router upstream, and books its
 *   usage as provider zai — it must not fall back to Anthropic unconfigured
 * - completed runs book their token usage against the calling session once
 * - the depth guard refuses delegation from inside a delegated run
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = fileURLToPath(
  new URL('../../../../scripts/mcp-servers/subagents.mjs', import.meta.url)
);

interface McpClient {
  call(method: string, params?: unknown): Promise<any>;
  close(): void;
  proc: ChildProcess;
}

function startMcp(env: Record<string, string>): McpClient {
  const proc = spawn(process.execPath, [SERVER_PATH], {
    env: { ...env, PATH: env.PATH ?? process.env.PATH ?? '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, (value: any) => void>();
  let nextId = 1;
  const rl = createInterface({ input: proc.stdout! });
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* stderr chatter never reaches stdout; ignore non-JSON */
    }
  });
  return {
    call(method, params) {
      const id = nextId++;
      const message = { jsonrpc: '2.0', id, method, params };
      proc.stdin!.write(JSON.stringify(message) + '\n');
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`MCP call ${method} timed out`));
        }, 15_000);
      });
    },
    close() {
      proc.stdin!.end();
      proc.kill();
    },
    proc,
  };
}

/**
 * A fake CLI that records its argv and env to a file and prints a canned
 * response, so the test can assert the exact invocation without any real
 * provider being involved.
 */
function writeFakeCli(dir: string, name: string, stdout: string): string {
  const record = path.join(dir, `${name}.record.json`);
  const script = [
    '#!/usr/bin/env node',
    'const fs = require("fs");',
    `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({`,
    '  argv: process.argv.slice(2),',
    '  cwd: process.cwd(),',
    '  env: {',
    '    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? null,',
    '    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? null,',
    '    PLUM_SUBAGENT_DEPTH: process.env.PLUM_SUBAGENT_DEPTH ?? null,',
    '    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ?? null,',
    '    ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? null,',
    '  },',
    '}));',
    `process.stdout.write(${JSON.stringify(stdout)});`,
  ].join('\n');
  const file = path.join(dir, name);
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return record;
}

function toolText(response: any): string {
  return response.result?.content?.[0]?.text ?? '';
}

test('subagents MCP: invocations, env boundaries, usage booking, depth guard', async () => {
  const bin = mkdtempSync(path.join(os.tmpdir(), 'subagents-bin-'));
  const work = mkdtempSync(path.join(os.tmpdir(), 'subagents-work-'));

  const codexStdout = [
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'codex says hi' },
    }),
    JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 100,
        cached_input_tokens: 20,
        output_tokens: 30,
        reasoning_output_tokens: 5,
      },
    }),
  ].join('\n');
  const claudeStdout = JSON.stringify({
    type: 'result',
    result: 'claude says hi',
    usage: {
      input_tokens: 11,
      output_tokens: 7,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
    },
    modelUsage: { 'glm-5.3': {} },
  });
  const codexRecord = writeFakeCli(bin, 'codex', codexStdout);
  const claudeRecord = writeFakeCli(bin, 'claude', claudeStdout);
  // Pi's JSON event stream as it really arrives: deltas, the turn and agent
  // summaries that repeat whole messages, and one line far larger than the
  // rest. Only the message_end records count.
  const piUsage = (input: number, output: number, cacheRead: number, extra = {}) => ({
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: input + output + cacheRead,
    ...extra,
  });
  const piFirst = {
    role: 'assistant',
    provider: 'z-ai',
    model: 'glm-5.3',
    stopReason: 'toolUse',
    content: [
      { type: 'text', text: 'looking' },
      { type: 'toolCall', name: 'read' },
    ],
    usage: { ...piUsage(100, 20, 1000), cacheWrite: 5, totalTokens: 1125 },
  };
  const piLast = {
    role: 'assistant',
    provider: 'z-ai',
    model: 'glm-5.3',
    stopReason: 'stop',
    content: [{ type: 'text', text: 'pi says hi' }],
    // Four reasoning tokens that the total counts but the output does not.
    usage: piUsage(10, 3, 1100, { reasoning: 4, totalTokens: 1117 }),
  };
  const piStdout =
    [
      { type: 'session', version: 3, id: 'pi-session' },
      { type: 'agent_start' },
      { type: 'message_end', message: { role: 'user', content: 'answer briefly' } },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(5000) },
      },
      { type: 'message_end', message: piFirst },
      // A tool that ran a model of its own reports those tokens on its result.
      {
        type: 'message_end',
        message: { role: 'toolResult', content: [], usage: piUsage(7, 1, 0) },
      },
      { type: 'turn_end', message: piFirst, toolResults: [] },
      { type: 'message_end', message: piLast },
      { type: 'agent_end', messages: [piFirst, piLast], padding: 'y'.repeat(300_000) },
      { type: 'agent_settled', aborted: false },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n') + '\n';
  const piRecord = writeFakeCli(bin, 'pi', piStdout);

  const piModels = [
    {
      id: 'z-ai/glm-5.3',
      provider: 'z-ai',
      model: 'glm-5.3',
      route: 'direct',
      description: 'z-ai API',
    },
    {
      id: 'deepseek/deepseek-flash',
      provider: 'deepseek',
      model: 'deepseek-flash',
      route: 'direct',
      description: 'DeepSeek direct (own deepseek API key)',
    },
    {
      id: 'mistral/deepseek-flash',
      provider: 'mistral',
      model: 'deepseek-flash',
      route: 'hosted',
      description: 'DeepSeek hosted by mistral (bills the mistral account)',
    },
    {
      id: 'mistral/devstral-latest',
      provider: 'mistral',
      model: 'devstral-latest',
      route: 'direct',
      description: 'Mistral direct (own mistral API key)',
    },
  ];

  // Stub backend: serves the configured entries and records usage postings.
  const usagePosts: any[] = [];
  const backend = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.headers['x-webui-hook-secret'] !== 'secret-1') {
        res.writeHead(401).end();
        return;
      }
      if (req.method === 'GET' && req.url === '/api/settings/internal/cli-subagents') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              entries: [
                { id: '1', label: 'Codex', provider: 'codex', model: '', enabled: true },
                {
                  id: '2',
                  label: 'GLM',
                  provider: 'pi',
                  model: 'z-ai/glm-5.3',
                  enabled: true,
                },
                { id: '3', label: 'Claude', provider: 'claude', model: '', enabled: true },
                { id: '4', label: 'Z.AI', provider: 'zai', model: '', enabled: true },
                { id: '5', label: 'Pi', provider: 'pi', model: '', enabled: true },
              ],
              // The user's available Pi models with their route (shape of
              // describePiModelRoute in utils/piConfig.ts). DeepSeek Flash sits
              // on two APIs: its own key and hosted by Mistral.
              piModels,
              // Pi runs from a per-user agent dir; the bridge must forward it
              // to pi children only. The zai block is the user's Z.AI
              // endpoint, which replaces the inherited upstream.
              env: {
                pi: { PI_CODING_AGENT_DIR: '/tenant/pi-agent' },
                zai: {
                  ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
                  ANTHROPIC_AUTH_TOKEN: 'zai-token',
                  ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3',
                },
              },
            },
          })
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/api/settings/internal/cli-subagents/usage') {
        usagePosts.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', () => resolve()));
  const backendUrl = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;

  const baseEnv = {
    // The fake CLIs are node scripts; their shebang needs the real node on PATH.
    PATH: `${bin}:${path.dirname(process.execPath)}`,
    WEBUI_BACKEND_URL: backendUrl,
    WEBUI_HOOK_SECRET: 'secret-1',
    WEBUI_SESSION_ID: 'session-77',
    // The calling session carries router overrides — the test asserts who
    // inherits them and who must not.
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/model-router/tok',
    ANTHROPIC_AUTH_TOKEN: 'router-bearer',
  };

  const mcp = startMcp(baseEnv);
  try {
    const init = await mcp.call('initialize', { protocolVersion: '2024-11-05' });
    assert.equal(init.result.serverInfo.name, 'plum-subagents');

    const tools = await mcp.call('tools/list');
    assert.deepEqual(tools.result.tools.map((t: { name: string }) => t.name).sort(), [
      'list_subagents',
      'run_subagent',
    ]);

    const listed = await mcp.call('tools/call', { name: 'list_subagents', arguments: {} });
    const listedBody = JSON.parse(toolText(listed)) as {
      subagents: Array<{ subagent: string; provider: string; model: string; route?: string }>;
      pi_models: Array<{ model: string; route: string }>;
      pi_note: string;
    };
    const listedEntry = (label: string) => {
      const entry = listedBody.subagents.find((item) => item.subagent === label);
      assert.ok(entry, `list_subagents must list ${label}`);
      return entry;
    };
    const listedGlm = listedEntry('GLM');
    assert.equal(listedGlm.provider, 'pi');
    assert.equal(listedGlm.model, 'z-ai/glm-5.3');
    assert.equal(listedGlm.route, 'z-ai API', 'a pi entry names the API it bills');
    // A pi entry without a model runs Pi's first available model, named so.
    const listedPi = listedEntry('Pi');
    assert.equal(listedPi.model, 'z-ai/glm-5.3 (Pi default)');
    assert.equal(listedPi.route, 'z-ai API');
    const listedCodex = listedEntry('Codex');
    assert.equal(listedCodex.model, '(provider default)');
    assert.equal('route' in listedCodex, false, 'only pi entries carry a route');
    assert.deepEqual(
      listedBody.pi_models,
      piModels.map((entry) => ({ model: entry.id, route: entry.description }))
    );
    assert.match(listedBody.pi_note, /provider part decides which account is billed/);

    // Codex: headless invocation, router env stripped, usage booked.
    const codexRun = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Codex', prompt: 'do the thing', working_directory: work },
    });
    assert.match(toolText(codexRun), /codex says hi/);
    const codexSeen = JSON.parse(readFileSync(codexRecord, 'utf8'));
    assert.deepEqual(codexSeen.argv, [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '-c',
      'approval_policy="never"',
      // HTTPS streaming instead of the Responses WebSocket, which the server
      // closed mid-turn (codexTransportArgs in the backend does the same).
      '-c',
      'model_providers.openai-https={name="OpenAI",requires_openai_auth=true,wire_api="responses",supports_websockets=false}',
      '-c',
      'model_provider="openai-https"',
      'do the thing',
    ]);
    assert.equal(codexSeen.cwd, work);
    assert.equal(codexSeen.env.ANTHROPIC_BASE_URL, null, 'codex must not see the router');
    assert.equal(codexSeen.env.ANTHROPIC_AUTH_TOKEN, null);
    assert.equal(codexSeen.env.PLUM_SUBAGENT_DEPTH, '1');

    // Pi: entry model applies, tool-arg model would override it.
    const glmRun = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'GLM', prompt: 'answer briefly', working_directory: work },
    });
    assert.match(toolText(glmRun), /pi says hi/);
    const piSeen = JSON.parse(readFileSync(piRecord, 'utf8'));
    assert.deepEqual(piSeen.argv, [
      '-p',
      '--mode',
      'json',
      '--no-session',
      '--model',
      'z-ai/glm-5.3',
      'answer briefly',
    ]);
    assert.equal(piSeen.env.ANTHROPIC_BASE_URL, null);
    assert.equal(
      piSeen.env.PI_CODING_AGENT_DIR,
      '/tenant/pi-agent',
      'pi must run in the calling user agent dir'
    );

    // Pi without a model: the first available model is named explicitly, so
    // the run says which API it used instead of taking Pi's own default.
    await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Pi', prompt: 'default model', working_directory: work },
    });
    assert.deepEqual(JSON.parse(readFileSync(piRecord, 'utf8')).argv, [
      '-p',
      '--mode',
      'json',
      '--no-session',
      '--model',
      'z-ai/glm-5.3',
      'default model',
    ]);

    // A bare name that exists once resolves to its full provider/model id.
    await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Pi', prompt: 'bare', model: 'devstral', working_directory: work },
    });
    assert.deepEqual(JSON.parse(readFileSync(piRecord, 'utf8')).argv, [
      '-p',
      '--mode',
      'json',
      '--no-session',
      '--model',
      'mistral/devstral-latest',
      'bare',
    ]);

    // A bare name on two APIs is refused before Pi starts, listing both routes.
    const piRunsBefore = readFileSync(piRecord, 'utf8');
    const ambiguous = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Pi', prompt: 'which?', model: 'deepseek-flash' },
    });
    assert.equal(ambiguous.result.isError, true);
    assert.match(toolText(ambiguous), /"deepseek-flash" is ambiguous in Pi/);
    assert.match(
      toolText(ambiguous),
      /deepseek\/deepseek-flash — DeepSeek direct \(own deepseek API key\)/
    );
    assert.match(
      toolText(ambiguous),
      /mistral\/deepseek-flash — DeepSeek hosted by mistral \(bills the mistral account\)/
    );
    // A full id that is not in the list is refused too, with the same-name ids.
    const missing = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Pi', prompt: 'gone', model: 'openrouter/deepseek-flash' },
    });
    assert.equal(missing.result.isError, true);
    assert.match(toolText(missing), /Pi model "openrouter\/deepseek-flash" is not available/);
    assert.match(toolText(missing), /Choose one of:\n {2}deepseek\/deepseek-flash/);
    assert.equal(
      readFileSync(piRecord, 'utf8'),
      piRunsBefore,
      'a refused model must never reach the pi CLI'
    );

    // Claude: keeps the router env — nested GLM routing depends on it.
    const claudeRun = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'claude', prompt: 'hello', model: 'glm-5.3', working_directory: work },
    });
    assert.match(toolText(claudeRun), /claude says hi/);
    const claudeSeen = JSON.parse(readFileSync(claudeRecord, 'utf8'));
    assert.deepEqual(claudeSeen.argv, [
      '-p',
      '--output-format',
      'json',
      '--dangerously-skip-permissions',
      '--model',
      'glm-5.3',
      'hello',
    ]);
    assert.equal(claudeSeen.env.ANTHROPIC_BASE_URL, baseEnv.ANTHROPIC_BASE_URL);
    assert.equal(claudeSeen.env.ANTHROPIC_AUTH_TOKEN, 'router-bearer');

    // Z.AI: the claude binary, but pointed at the user's Z.AI endpoint instead
    // of the inherited router — a GLM subagent stays in the Claude harness.
    const zaiRun = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Z.AI', prompt: 'glm please', working_directory: work },
    });
    assert.match(toolText(zaiRun), /claude says hi/);
    const zaiSeen = JSON.parse(readFileSync(claudeRecord, 'utf8'));
    assert.deepEqual(zaiSeen.argv, [
      '-p',
      '--output-format',
      'json',
      '--dangerously-skip-permissions',
      'glm please',
    ]);
    assert.equal(zaiSeen.env.ANTHROPIC_BASE_URL, 'https://api.z.ai/api/anthropic');
    assert.equal(zaiSeen.env.ANTHROPIC_AUTH_TOKEN, 'zai-token');
    assert.equal(zaiSeen.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'glm-5.3');

    // Usage: every run books — codex, claude, zai, and the three pi runs, which
    // used to print their answer and nothing else. The booking is awaited
    // before the answer goes out, so all six are here by now.
    assert.equal(usagePosts.length, 6);
    // Every booking carries a run id. The backend deduplicates on it, so what
    // matters is that it is there and that two runs never share one; the value
    // itself is per-process and deliberately unpredictable.
    const runIds = usagePosts.map((p) => p.runId);
    assert.ok(
      runIds.every((id) => typeof id === 'string' && id.length > 0),
      JSON.stringify(runIds)
    );
    assert.equal(new Set(runIds).size, 6, JSON.stringify(runIds));

    const withoutRunId = (post: any) => {
      const { runId: _runId, ...rest } = post ?? {};
      return rest;
    };
    const codexUsage = usagePosts.find((p) => p.provider === 'codex');
    assert.deepEqual(withoutRunId(codexUsage), {
      provider: 'codex',
      model: 'gpt-5.5',
      inputTokens: 100,
      outputTokens: 35,
      cacheReadTokens: 20,
      cacheCreationTokens: 0,
    });
    const claudeUsage = usagePosts.find((p) => p.provider === 'claude');
    assert.deepEqual(withoutRunId(claudeUsage), {
      provider: 'claude',
      model: 'glm-5.3',
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
    });

    // Pi: the tokens of both model calls and of the tool's own model call,
    // under the model the run was started with.
    const piPosts = usagePosts.filter((p) => p.provider === 'pi');
    assert.deepEqual(
      piPosts.map((post) => post.model),
      ['z-ai/glm-5.3', 'z-ai/glm-5.3', 'mistral/devstral-latest']
    );
    assert.deepEqual(withoutRunId(piPosts[0]), {
      provider: 'pi',
      model: 'z-ai/glm-5.3',
      inputTokens: 117,
      outputTokens: 28,
      cacheReadTokens: 2100,
      cacheCreationTokens: 5,
    });

    const zaiUsage = usagePosts.find((p) => p.provider === 'zai');
    assert.deepEqual(withoutRunId(zaiUsage), {
      provider: 'zai',
      model: 'glm-5.3',
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
    });

    // Unknown subagent fails with the configured labels, not a crash.
    const unknown = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'nope', prompt: 'x' },
    });
    assert.equal(unknown.result.isError, true);
    assert.match(toolText(unknown), /Configured: Codex, GLM, Claude, Z.AI, Pi/);
  } finally {
    mcp.close();
  }

  // A worker is held to the calling session's permission mode: planning and
  // manual sessions get read-only workers, auto-accept gets edit-only ones.
  const planning = startMcp({ ...baseEnv, WEBUI_SESSION_MODE: 'planning' });
  try {
    await planning.call('initialize', { protocolVersion: '2024-11-05' });
    await planning.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'claude', prompt: 'look', working_directory: work },
    });
    const planned = JSON.parse(readFileSync(claudeRecord, 'utf8'));
    assert.deepEqual(planned.argv, [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'plan',
      'look',
    ]);

    await planning.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Codex', prompt: 'look', working_directory: work },
    });
    const sandbox = JSON.parse(readFileSync(codexRecord, 'utf8')).argv as string[];
    assert.equal(sandbox[sandbox.indexOf('--sandbox') + 1], 'read-only');

    // Pi's print mode cannot be restricted, so it does not start at all.
    rmSync(piRecord, { force: true });
    const refused = await planning.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'GLM', prompt: 'look', working_directory: work },
    });
    assert.equal(refused.result.isError, true);
    assert.match(toolText(refused), /"planning" mode/);
    assert.equal(existsSync(piRecord), false, 'pi must not be started');
  } finally {
    planning.close();
  }

  const autoAccept = startMcp({ ...baseEnv, WEBUI_SESSION_MODE: 'auto-accept' });
  try {
    await autoAccept.call('initialize', { protocolVersion: '2024-11-05' });
    await autoAccept.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'claude', prompt: 'edit', working_directory: work },
    });
    const edits = JSON.parse(readFileSync(claudeRecord, 'utf8'));
    assert.deepEqual(edits.argv, [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'acceptEdits',
      'edit',
    ]);
  } finally {
    autoAccept.close();
  }

  // PLUM_CODEX_WEBSOCKETS=1 keeps the Responses WebSocket as an opt-out.
  const websockets = startMcp({ ...baseEnv, PLUM_CODEX_WEBSOCKETS: '1' });
  try {
    await websockets.call('initialize', { protocolVersion: '2024-11-05' });
    await websockets.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'Codex', prompt: 'over websockets', working_directory: work },
    });
    assert.deepEqual(JSON.parse(readFileSync(codexRecord, 'utf8')).argv, [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '-c',
      'approval_policy="never"',
      'over websockets',
    ]);
  } finally {
    websockets.close();
    backend.close();
  }

  // Without a backend the bridge falls back to the bare providers, which has
  // no Z.AI endpoint. Running zai then must refuse rather than quietly spend the
  // Anthropic subscription under a GLM label.
  // Empty rather than absent: the bridge also reads the parent process environ,
  // so an unset secret would leak in from whatever session runs this test.
  const unconfigured = startMcp({
    PATH: baseEnv.PATH,
    WEBUI_HOOK_SECRET: '',
    WEBUI_SESSION_ID: '',
  });
  try {
    await unconfigured.call('initialize', { protocolVersion: '2024-11-05' });
    const refused = await unconfigured.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'zai', prompt: 'glm please', working_directory: work },
    });
    assert.equal(refused.result.isError, true);
    assert.match(toolText(refused), /needs a Z\.AI endpoint/);
  } finally {
    unconfigured.close();
  }

  // Depth guard: inside a delegated run, further delegation is refused before
  // any CLI or backend is touched.
  const nested = startMcp({ ...baseEnv, PLUM_SUBAGENT_DEPTH: '1' });
  try {
    await nested.call('initialize', { protocolVersion: '2024-11-05' });
    const refused = await nested.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'codex', prompt: 'recurse!' },
    });
    assert.equal(refused.result.isError, true);
    assert.match(toolText(refused), /one level of delegation/);
  } finally {
    nested.close();
  }
});
