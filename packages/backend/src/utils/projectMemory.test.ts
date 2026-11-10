/**
 * Codex, Pi and Vibe get the same project memory Claude Code loads, from the
 * same directory, within the same size limit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PROJECT_MEMORY_INDEX_MAX_LINES,
  buildProjectMemoryContext,
  claudeProjectSlug,
  projectMemoryDir,
  truncateMemoryIndex,
} from './projectMemory.js';

test('the slug matches Claude Code: spaces, dots and umlauts become dashes', () => {
  assert.equal(
    claudeProjectSlug('/mnt/user/appdata/claude-code-webui'),
    '-mnt-user-appdata-claude-code-webui'
  );
  assert.equal(
    claudeProjectSlug('/mnt/user/AI/plum-code/oled control'),
    '-mnt-user-AI-plum-code-oled-control'
  );
  assert.equal(
    claudeProjectSlug('/mnt/cache/AI/plum-code/VäliBot'),
    '-mnt-cache-AI-plum-code-V-liBot'
  );
  assert.equal(claudeProjectSlug('/workspace/demo.project'), '-workspace-demo-project');
});

test('the index is cut like Claude Code cuts it', () => {
  const long = Array.from({ length: 300 }, (_, i) => `- line ${i}`).join('\n');
  assert.equal(truncateMemoryIndex(long).split('\n').length, PROJECT_MEMORY_INDEX_MAX_LINES);
  const wide = Array.from({ length: 100 }, () => 'x'.repeat(400)).join('\n');
  assert.ok(Buffer.byteLength(truncateMemoryIndex(wide)) <= 25_000);
});

test('a project with an index gets a memory block naming its directory', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-memory-'));
  const workdir = '/workspace/my app';
  assert.equal(await buildProjectMemoryContext(workdir, home), null);

  const dir = projectMemoryDir(workdir, home);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'MEMORY.md'),
    '# Memory\n- [Deploy](deploy.md) — only via repair-bot\n'
  );
  const block = await buildProjectMemoryContext(workdir, home);
  assert.ok(block?.startsWith(`<project-memory dir="${dir}">`));
  assert.match(block!, /only via repair-bot/);
  assert.match(block!, /check a claim against the code/);
});
