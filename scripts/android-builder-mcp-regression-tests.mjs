import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function waitForResponse(child, id) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('MCP response timeout')), 5000);
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split('\n');
      buffered = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === id) {
          clearTimeout(timer);
          resolve(message);
        }
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function testSoleLiveDeviceIsUsedWithoutExplicitSerial() {
  const requests = [];
  let emulatorStartBody = null;
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/emulator/start' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        emulatorStartBody = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        res.end(JSON.stringify({ status: 'starting' }));
      });
      return;
    }
    if (req.url === '/api/devices') {
      res.end(
        JSON.stringify([
          {
            serial: 'emulator-5554',
            status: 'device',
            model: 'sdk_gphone64_x86_64',
            type: 'emulator',
          },
        ])
      );
      return;
    }
    if (req.url === '/api/devices/emulator-5554/current-activity') {
      res.end(JSON.stringify({ success: true, packageName: 'com.example.app' }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const address = await listen(server);
  assert.ok(address && typeof address === 'object');

  const child = spawn(process.execPath, ['scripts/mcp-servers/android-builder.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ANDROID_BUILDER_URL: `http://127.0.0.1:${address.port}`,
      ANDROID_BUILDER_ENGINES: '',
      ANDROID_BUILDER_ENGINES_FILE: '/nonexistent/android-build-engines.json',
      WEBUI_ANDROID_DEVICE_SERIAL: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    const responsePromise = waitForResponse(child, 1);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'adb_current_activity', arguments: {} },
      })}\n`
    );
    const response = await responsePromise;
    assert.equal(response.result?.isError, undefined);
    assert.match(response.result?.content?.[0]?.text || '', /com\.example\.app/);
    assert.deepEqual(requests, ['/api/devices', '/api/devices/emulator-5554/current-activity']);

    const startResponsePromise = waitForResponse(child, 2);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'emulator_start', arguments: { avd: 'pixel_test' } },
      })}\n`
    );
    const startResponse = await startResponsePromise;
    assert.equal(startResponse.result?.isError, undefined);
    assert.deepEqual(emulatorStartBody, { avdName: 'pixel_test' });
  } finally {
    child.kill('SIGTERM');
    server.close();
  }
}

function jsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      resolve(text ? JSON.parse(text) : {});
    });
  });
}

// Two fake engines: "unraid" (plain android-app-creator) and "geekom"
// (gateway with /api/engine/status). Covers build routing, the per-project
// lock, device -> engine resolution, emulator placement and install guard.
async function testMultiEngineRouting() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'android-engines-'));
  const projectsRoot = path.join(tmp, 'builder', 'projects');
  const dataRoot = path.join(tmp, 'builder', 'data');
  const stateDir = path.join(tmp, 'state');
  const now = () => new Date().toISOString();
  const writeMeta = (id, meta) => {
    mkdirSync(path.join(projectsRoot, id), { recursive: true });
    writeFileSync(
      path.join(projectsRoot, id, '.appcreator.json'),
      JSON.stringify({ id, name: id, status: 'built', updatedAt: now(), ...meta })
    );
  };
  writeMeta('p1', {});
  writeMeta('p2', {});
  writeMeta('busy', { status: 'building' });
  mkdirSync(path.join(dataRoot, 'gradle-homes', 'p2', 'caches'), { recursive: true });

  const calls = { unraid: [], geekom: [] };
  const geekomActive = new Set();
  let unraidEmulator = 'running';
  let geekomEmulator = 'stopped';

  const unraid = createServer(async (req, res) => {
    calls.unraid.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    const send = (code, payload) => {
      res.statusCode = code;
      res.end(JSON.stringify(payload));
    };
    if (req.url === '/api/engine/status') return send(404, { error: 'not found' });
    if (req.url === '/api/health') return send(200, { status: 'ok' });
    if (req.url === '/api/projects') {
      const ids = ['p1', 'p2', 'busy'];
      return send(
        200,
        ids.map((id) =>
          JSON.parse(String(readFileSyncSafe(path.join(projectsRoot, id, '.appcreator.json'))))
        )
      );
    }
    if (req.url === '/api/emulator/status')
      return send(200, { status: unraidEmulator, vncUrl: null });
    if (req.url === '/api/devices') {
      return send(200, [
        { serial: '192.168.1.110:35415', status: 'device', type: 'wifi' },
        { serial: 'emulator-5554', status: 'device', type: 'emulator' },
      ]);
    }
    if (req.url === '/api/devices/known') return send(200, []);
    if (req.method === 'POST' && req.url.startsWith('/api/build/')) {
      await jsonBody(req);
      return send(200, { status: 'building', buildType: 'debug' });
    }
    if (req.method === 'POST' && req.url.includes('/install/')) {
      await jsonBody(req);
      return send(200, { success: true, output: 'Success' });
    }
    if (req.url.endsWith('/current-activity'))
      return send(200, { success: true, packageName: 'unraid.pkg' });
    if (req.url.endsWith('/tap')) {
      await jsonBody(req);
      return send(200, { success: true });
    }
    return send(404, { error: 'not found' });
  });

  const geekom = createServer(async (req, res) => {
    calls.geekom.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    const send = (code, payload) => {
      res.statusCode = code;
      res.end(JSON.stringify(payload));
    };
    if (req.url.startsWith('/api/engine/status')) {
      return send(200, {
        engine: 'geekom',
        health: { status: 'ok' },
        busy: geekomActive.size,
        activeBuilds: [...geekomActive].map((projectId) => ({ projectId, phase: 'building' })),
        emulator: { status: geekomEmulator },
        project: { warm: false },
      });
    }
    if (req.url === '/api/emulator/status')
      return send(200, { status: geekomEmulator, vncUrl: null });
    if (req.method === 'POST' && req.url === '/api/emulator/start') {
      await jsonBody(req);
      geekomEmulator = 'starting';
      return send(200, { status: 'starting' });
    }
    if (req.url === '/api/devices') {
      return send(
        200,
        geekomEmulator === 'stopped' ? [] : [{ serial: 'emulator-5554', status: 'device' }]
      );
    }
    if (req.url === '/api/devices/known') return send(200, []);
    if (req.method === 'POST' && req.url.startsWith('/api/build/')) {
      await jsonBody(req);
      geekomActive.add(decodeURIComponent(req.url.split('/').pop()));
      return send(200, { status: 'building', engine: 'geekom', phase: 'syncing' });
    }
    if (req.url.endsWith('/current-activity'))
      return send(200, { success: true, packageName: 'geekom.pkg' });
    return send(404, { error: 'not found' });
  });

  const unraidAddress = await listen(unraid);
  const geekomAddress = await listen(geekom);
  const unraidUrl = `http://127.0.0.1:${unraidAddress.port}`;
  const geekomUrl = `http://127.0.0.1:${geekomAddress.port}`;
  const child = spawn(process.execPath, ['scripts/mcp-servers/android-builder.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ANDROID_BUILDER_URL: unraidUrl,
      ANDROID_BUILDER_ENGINES: `unraid=${unraidUrl},geekom=${geekomUrl}`,
      ANDROID_BUILDER_EMULATOR_PREFERENCE: 'geekom,unraid',
      ANDROID_BUILDER_PROJECTS_HOST_PATH: projectsRoot,
      ANDROID_BUILDER_ENGINE_STATE_DIR: stateDir,
      ANDROID_BUILDER_PROJECT_CLAIMS_DIR: path.join(tmp, 'claims'),
      WEBUI_SESSION_ID: 'session-a',
      WEBUI_ANDROID_DEVICE_SERIAL: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 100;
  const call = async (name, args = {}) => {
    const id = nextId++;
    const pending = waitForResponse(child, id);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`
    );
    const response = await pending;
    return response.result;
  };

  try {
    // Unraid has a fresh "building" project, geekom is idle -> geekom.
    let result = await call('android_build', { projectId: 'p1' });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.equal(result.structuredContent.engine, 'geekom');
    assert.equal(result.structuredContent.routing.reason, 'idle');
    assert.ok(existsSync(path.join(stateDir, 'locks', 'p1.json')));
    assert.ok(calls.geekom.includes('POST /api/build/p1'));

    // Same project again: lock + gateway report it -> no second build.
    result = await call('android_build', { projectId: 'p1' });
    assert.equal(result.structuredContent.status, 'already_building');
    assert.equal(result.structuredContent.engine, 'geekom');
    assert.equal(calls.geekom.filter((entry) => entry === 'POST /api/build/p1').length, 1);

    // p2: warm Gradle home on unraid; geekom busy with p1 -> unraid.
    writeMeta('busy', { status: 'built' });
    result = await call('android_build', { projectId: 'p2' });
    assert.equal(result.structuredContent.engine, 'unraid');
    assert.ok(calls.unraid.includes('POST /api/build/p2'));

    // Install while p1 is still building is refused.
    result = await call('android_install', { projectId: 'p1', serial: '192.168.1.110:35415' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /still running on engine geekom/);

    // Build finished on geekom; Wi-Fi tablet lives on unraid -> install there.
    geekomActive.delete('p1');
    writeFileSync(
      path.join(stateDir, 'locks', 'p1.json'),
      JSON.stringify({
        projectId: 'p1',
        engine: 'geekom',
        startedAt: new Date(Date.now() - 120_000).toISOString(),
      })
    );
    result = await call('android_install', { projectId: 'p1', serial: '192.168.1.110:35415' });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    assert.equal(result.structuredContent.engine, 'unraid');
    assert.equal(result.structuredContent.builtOnEngine, 'geekom');
    assert.ok(calls.unraid.includes('POST /api/devices/192.168.1.110%3A35415/install/p1'));
    assert.ok(!existsSync(path.join(stateDir, 'locks', 'p1.json')), 'stale lock is cleaned up');

    // Emulator: unraid's is running, geekom is free and preferred.
    result = await call('emulator_start', {});
    assert.equal(result.structuredContent.engine, 'geekom');
    assert.equal(result.structuredContent.qualifiedSerial, 'emulator-5554@geekom');

    // emulator-5554 exists on both engines -> this session's emulator wins.
    result = await call('adb_current_activity', { serial: 'emulator-5554' });
    assert.equal(result.structuredContent.engine, 'geekom');
    assert.match(result.content[0].text, /geekom\.pkg/);

    // Explicit qualifier reaches the other engine's emulator.
    result = await call('adb_current_activity', { serial: 'emulator-5554@unraid' });
    assert.equal(result.structuredContent.engine, 'unraid');
    assert.ok(calls.unraid.includes('GET /api/devices/emulator-5554/current-activity'));

    // Unique device -> its holder.
    result = await call('adb_tap', { serial: '192.168.1.110:35415', x: 1, y: 2 });
    assert.equal(result.structuredContent.engine, 'unraid');

    // Aggregated device list names engines.
    result = await call('adb_devices', {});
    const items = result.structuredContent.items;
    assert.ok(items.some((d) => d.qualifiedSerial === 'emulator-5554@geekom'));
    assert.ok(items.some((d) => d.qualifiedSerial === '192.168.1.110:35415@unraid'));
  } finally {
    child.kill('SIGTERM');
    unraid.close();
    geekom.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

function readFileSyncSafe(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '{}';
  }
}

await testSoleLiveDeviceIsUsedWithoutExplicitSerial();
await testMultiEngineRouting();
console.log('android builder MCP regression tests passed');
