import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the real MCP bridge with deterministic local CLI fixtures: no model calls.
const root = await mkdtemp(path.join(tmpdir(), 'plum-agent-bridge-'));
const events = [];
const server = createServer(async (req, res) => {
  assert.equal(req.headers['x-webui-hook-secret'], 'fixture-secret');
  assert.equal(req.headers['x-webui-session-id'], 'fixture-session');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url.endsWith('/activity')) events.push(JSON.parse(Buffer.concat(chunks).toString()));
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      success: true,
      data: {
        entries: [
          {
            id: 'codex',
            label: 'Codex worker',
            provider: 'codex',
            model: 'fixture-codex',
            enabled: true,
          },
          { id: 'zai', label: 'Z.AI worker', provider: 'zai', model: '', enabled: true },
        ],
        env: {
          zai: {
            ANTHROPIC_BASE_URL: 'https://example.invalid',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'fixture-glm',
          },
        },
      },
    })
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await writeFile(
    path.join(root, 'codex'),
    `#!${process.execPath}\nsetTimeout(()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Codex fixture done'}})),80);\n`,
    { mode: 0o755 }
  );
  await writeFile(
    path.join(root, 'claude'),
    `#!${process.execPath}\nsetTimeout(()=>console.log(JSON.stringify({is_error:process.argv.includes('fixture-fail'),result:process.argv.includes('fixture-fail')?'Fixture API error':'Z.AI fixture done',modelUsage:{'fixture-glm':{}},usage:{input_tokens:2,output_tokens:1}})),40);\n`,
    { mode: 0o755 }
  );
  const script = fileURLToPath(
    new URL('../../../scripts/mcp-servers/subagents.mjs', import.meta.url)
  );
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: {
      ...process.env,
      PATH: root + ':' + process.env.PATH,
      WEBUI_BACKEND_URL: `http://127.0.0.1:${server.address().port}`,
      WEBUI_HOOK_SECRET: 'fixture-secret',
      WEBUI_SESSION_ID: 'fixture-session',
      PLUM_SUBAGENT_DEPTH: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  for (const [id, subagent] of [
    [1, 'codex'],
    [2, 'zai'],
    [3, 'zai'],
  ])
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: {
          name: 'run_subagent',
          arguments: {
            subagent,
            prompt: id === 3 ? 'fixture-fail' : 'Reply with the fixture',
            working_directory: root,
          },
        },
      }) + '\n'
    );
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const exit = await new Promise((resolve) => child.on('exit', resolve));
  clearTimeout(timer);
  assert.equal(exit, 0, stderr);
  const replies = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(replies.filter((r) => r.id && !r.error && !r.result?.isError).length, 2, stdout);
  const starts = events.filter((e) => e.status === 'started');
  assert.equal(starts.length, 3);
  assert.equal(new Set(starts.map((e) => e.id)).size, 3);
  for (const start of starts) {
    const lifecycle = events.filter((e) => e.id === start.id);
    assert.equal(lifecycle[0].status, 'started');
    if (start.description === 'fixture-fail') {
      assert.equal(lifecycle.at(-1).status, 'error');
      assert.equal(
        lifecycle.some((e) => e.status === 'completed'),
        false
      );
      assert.match(lifecycle.at(-1).error, /Fixture API error/);
    } else {
      assert.equal(lifecycle.at(-1).status, 'completed');
      assert.match(lifecycle.at(-1).result, /fixture done/);
    }
    assert.equal(lifecycle.at(-1).provider, start.provider);
  }
  assert.equal(events.filter((e) => e.provider === 'zai').at(-1).model, 'fixture-glm');
  console.log(
    'PASS: MCP bridge reports concurrent invocations and API errors even with CLI exit 0, starts before results, exact provider and observed Z.AI model.'
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
