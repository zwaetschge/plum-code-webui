/**
 * The SPA catch-all, which the integration harness cannot cover because it runs
 * in development mode where the route is not registered at all.
 *
 * Express 4 spelled this `*`. Express 5 rejects a bare wildcard, and the
 * obvious replacement `/*splat` silently stops matching `/` — deep links keep
 * working while the application's front door returns 404. Health checks stay
 * green throughout, so nothing else would notice.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

const SPA_PATTERN = '/{*splat}';

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const app = express();
  app.get(SPA_PATTERN, (_req, res) => res.status(200).send('index'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the SPA fallback matches the root', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(base + '/')).status, 200);
  });
});

test('the SPA fallback matches nested routes and paths with dots', async () => {
  await withServer(async (base) => {
    for (const path of ['/sessions', '/sessions/abc/deep/link', '/a.b-c_d']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
  });
});

test('the pattern in index.ts is the one under test', async () => {
  // Guards against the source drifting away from what this file proves.
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../index.ts', import.meta.url),
    'utf8'
  );
  assert.ok(
    source.includes(`app.get('${SPA_PATTERN}'`),
    `index.ts must register the SPA fallback as ${SPA_PATTERN}`
  );
});
