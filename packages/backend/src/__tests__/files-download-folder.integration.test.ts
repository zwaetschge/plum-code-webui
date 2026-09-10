import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startTestServer, type TestServer } from './harness.js';

/**
 * `GET /api/files/download-folder` streams a directory as one ZIP. The walk
 * skips node_modules/.git unless `full=1`, keeps dotfiles, and never follows
 * symlinks out of the tree.
 */
test('folder download streams a ZIP without node_modules and .git', async (t) => {
  let server: TestServer | undefined;
  try {
    server = await startTestServer();
  } catch (error) {
    t.skip(`test server unavailable: ${(error as Error).message}`);
    return;
  }

  try {
    const root = path.join(server.dataDir, 'download-me');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
    await fs.mkdir(path.join(root, '.git'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const marker = 1;\n');
    await fs.writeFile(path.join(root, '.env.example'), 'KEY=value\n');
    await fs.writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
    await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const headers = { Authorization: `Bearer ${server.token}` };
    const response = await fetch(
      `${server.url}/api/files/download-folder?path=${encodeURIComponent(root)}`,
      { headers }
    );
    assert.equal(response.status, 200, server.logs().slice(-1500));
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition') ?? '', /download-me\.zip/);

    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK', 'ZIP magic');
    // Entry names sit uncompressed in the local file headers.
    assert.ok(bytes.includes('download-me/src/index.ts'), 'source file is included');
    assert.ok(bytes.includes('download-me/.env.example'), 'dotfiles are included');
    assert.ok(!bytes.includes('node_modules'), 'node_modules is skipped');
    assert.ok(!bytes.includes('.git/HEAD'), '.git is skipped');

    const full = await fetch(
      `${server.url}/api/files/download-folder?path=${encodeURIComponent(root)}&full=1`,
      { headers }
    );
    assert.equal(full.status, 200);
    const fullBytes = Buffer.from(await full.arrayBuffer());
    assert.ok(fullBytes.includes('node_modules/dep/index.js'), 'full=1 keeps node_modules');

    const file = await server.request(
      'GET',
      `/api/files/download-folder?path=${encodeURIComponent(path.join(root, 'src', 'index.ts'))}`
    );
    assert.equal(file.status, 400, 'a file is not a folder');

    const outside = await server.request(
      'GET',
      `/api/files/download-folder?path=${encodeURIComponent('/etc')}`
    );
    assert.equal(outside.status, 403, 'outside the allowed base paths');

    const anonymous = await server.anonymous(
      'GET',
      `/api/files/download-folder?path=${encodeURIComponent(root)}`
    );
    assert.equal(anonymous.status, 401);
  } finally {
    await server.stop();
  }
});
