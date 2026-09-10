/**
 * End-to-end test of the subagents MCP bridge (scripts/mcp-servers/subagents.mjs)
 * over its real stdio protocol, with fake provider CLIs on PATH and a stub
 * backend. The properties that matter:
 *
 * - the spawned CLI gets exactly the headless invocation we promise
 *   (codex exec --json --full-auto, claude -p --output-format json, opencode run)
 * - a codex/opencode child must NOT inherit ANTHROPIC_* router overrides,
 *   while a claude child keeps them (that's how nested GLM routing works)
 * - a `zai` child runs the claude binary but on the Z.AI endpoint the backend
 *   injects, never on the inherited Anthropic/router upstream, and books its
 *   usage as provider zai — it must not fall back to Anthropic unconfigured
 * - completed runs book their token usage against the calling session once
 * - the depth guard refuses delegation from inside a delegated run
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    '    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR ?? null,',
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
  const opencodeRecord = writeFakeCli(bin, 'opencode', 'opencode says hi\n');

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
                  provider: 'opencode',
                  model: 'z-ai/glm-5.3',
                  enabled: true,
                },
                { id: '3', label: 'Claude', provider: 'claude', model: '', enabled: true },
                { id: '4', label: 'Z.AI', provider: 'zai', model: '', enabled: true },
              ],
              // OpenCode auth lives in per-user tenant dirs; the bridge must
              // forward these to opencode children only. The zai block is the
              // user's Z.AI endpoint, which replaces the inherited upstream.
              env: {
                opencode: { OPENCODE_CONFIG_DIR: '/tenant/config' },
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
    const listedText = toolText(listed);
    assert.match(listedText, /GLM/);
    assert.match(listedText, /z-ai\/glm-5\.3/);

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
      'do the thing',
    ]);
    assert.equal(codexSeen.cwd, work);
    assert.equal(codexSeen.env.ANTHROPIC_BASE_URL, null, 'codex must not see the router');
    assert.equal(codexSeen.env.ANTHROPIC_AUTH_TOKEN, null);
    assert.equal(codexSeen.env.PLUM_SUBAGENT_DEPTH, '1');

    // OpenCode: entry model applies, tool-arg model would override it.
    const glmRun = await mcp.call('tools/call', {
      name: 'run_subagent',
      arguments: { subagent: 'GLM', prompt: 'answer briefly', working_directory: work },
    });
    assert.match(toolText(glmRun), /opencode says hi/);
    const opencodeSeen = JSON.parse(readFileSync(opencodeRecord, 'utf8'));
    assert.deepEqual(opencodeSeen.argv, ['run', '-m', 'z-ai/glm-5.3', 'answer briefly']);
    assert.equal(opencodeSeen.env.ANTHROPIC_BASE_URL, null);
    assert.equal(
      opencodeSeen.env.OPENCODE_CONFIG_DIR,
      '/tenant/config',
      'opencode must run in the calling user tenant'
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

    // Usage: codex, claude and zai book (opencode has no usage output in v1).
    // bookUsage is fire-and-forget, so give the posts a beat to land.
    for (let i = 0; i < 50 && usagePosts.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(usagePosts.length, 3);
    // Every booking carries a run id. The backend deduplicates on it, so what
    // matters is that it is there and that two runs never share one; the value
    // itself is per-process and deliberately unpredictable.
    const runIds = usagePosts.map((p) => p.runId);
    assert.ok(
      runIds.every((id) => typeof id === 'string' && id.length > 0),
      JSON.stringify(runIds)
    );
    assert.equal(new Set(runIds).size, 3, JSON.stringify(runIds));

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
    assert.match(toolText(unknown), /Configured: Codex, GLM, Claude, Z.AI/);
  } finally {
    mcp.close();
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
