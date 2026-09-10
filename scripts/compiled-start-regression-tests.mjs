#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-compiled-start-'));
const home = path.join(tempRoot, 'home');
const data = path.join(tempRoot, 'data');
const config = path.join(tempRoot, 'config');
await Promise.all([
  fs.mkdir(home, { recursive: true }),
  fs.mkdir(data, { recursive: true }),
  fs.mkdir(config, { recursive: true }),
]);

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const selectedPort = address.port;
    server.close((error) => (error ? reject(error) : resolve(selectedPort)));
  });
});

let output = '';
const child = spawn(process.execPath, ['packages/backend/dist/index.js'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOME: home,
    PORT: String(port),
    FRONTEND_URL: `http://127.0.0.1:${port}`,
    WEBUI_DATA_DIR: data,
    WEBUI_CONFIG_HOME: config,
    CLAUDE_CONFIG_HOME: config,
    WEBUI_EXTERNAL_SKILL_SYNC: 'false',
    WEBUI_SUPPRESS_BOOTSTRAP_CREDENTIAL_LOG: '1',
    CLI_AUTO_UPDATE: 'false',
    SESSION_SECRET: 'compiled-start-session-secret-000000000000000',
    JWT_SECRET: 'compiled-start-jwt-secret-000000000000000000',
    ENCRYPTION_KEY: 'compiled-start-encryption-key-0000000000000',
    AUTH_ALLOWED_EMAILS: 'compiled-start@example.com',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-12_000);
  });
}

async function stopChild() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

try {
  const deadline = Date.now() + 45_000;
  let response;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.ok) break;
    } catch {
      // The compiled server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  assert.equal(child.exitCode, null, `compiled backend exited before readiness:\n${output}`);
  assert.ok(response?.ok, `compiled backend did not become ready:\n${output}`);
  const readiness = await response.json();
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.checks.database.ok, true);
  assert.equal(readiness.checks.frontend.ok, true);

  const liveness = await fetch(`http://127.0.0.1:${port}/health/live`);
  assert.equal(liveness.status, 200);
  assert.equal((await liveness.json()).status, 'ok');

  // Readiness only proves that the frontend directory and entry document exist.
  // Exercise the browser's actual production path as well: SPA fallback, entry
  // document, and every JS/CSS bundle referenced by that document.
  const frontendOrigin = `http://127.0.0.1:${port}`;
  const spaResponse = await fetch(`${frontendOrigin}/settings?tab=extensions#skills`, {
    headers: { Origin: frontendOrigin },
  });
  assert.equal(spaResponse.status, 200);
  assert.match(spaResponse.headers.get('content-type') || '', /^text\/html\b/);
  assert.match(spaResponse.headers.get('cache-control') || '', /\bno-cache\b/);
  assert.equal(spaResponse.headers.get('access-control-allow-origin'), frontendOrigin);
  const spaHtml = await spaResponse.text();
  assert.match(spaHtml, /<div id="root"><\/div>/);

  const assetPaths = Array.from(
    spaHtml.matchAll(/\b(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g),
    (match) => match[1]
  );
  assert.ok(assetPaths.some((assetPath) => assetPath.endsWith('.js')));
  assert.ok(assetPaths.some((assetPath) => assetPath.endsWith('.css')));

  for (const assetPath of new Set(assetPaths)) {
    const assetResponse = await fetch(`${frontendOrigin}${assetPath}`, {
      headers: { Origin: frontendOrigin },
    });
    assert.equal(assetResponse.status, 200, `${assetPath} must be served`);
    assert.match(
      assetResponse.headers.get('cache-control') || '',
      /\bmax-age=31536000\b.*\bimmutable\b/,
      `${assetPath} must use long-lived immutable caching`
    );
    const expectedType = assetPath.endsWith('.js') ? /^text\/javascript\b/ : /^text\/css\b/;
    assert.match(
      assetResponse.headers.get('content-type') || '',
      expectedType,
      `${assetPath} must have a browser-compatible MIME type`
    );
    assert.equal(assetResponse.headers.get('access-control-allow-origin'), frontendOrigin);
    assert.ok((await assetResponse.arrayBuffer()).byteLength > 0);
  }

  console.log('compiled production start regression test passed');
} finally {
  await stopChild();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
