import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isSensitivePath } from './allowedPaths.js';

test('secret files and provider homes are sensitive', () => {
  for (const p of [
    '/mnt/user/appdata/claude-code-webui/.env',
    '/mnt/user/appdata/claude-code-webui/.env.local',
    path.join(os.homedir(), '.claude', '.credentials.json'),
    path.join(os.homedir(), '.codex', 'auth.json'),
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    '/mnt/cache/appdata/plum-code-webui/config/ssh/id_ed25519_geekom',
    '/some/project/.git/config',
    '/data/backups/backup-2026-11-09.dump',
    '/x/server.pem',
    '/x/service.key',
    '/x/docker-compose.override.yml',
  ]) {
    assert.equal(isSensitivePath(p), true, p);
  }
});

test('ordinary workspace files are not sensitive', () => {
  for (const p of [
    '/mnt/user/AI/plum-code/my-app/src/index.ts',
    '/mnt/cache/AI/plum-code/dnd-webui/package.json',
    '/mnt/user/AI/plum-code/readme.md',
  ]) {
    assert.equal(isSensitivePath(p), false, p);
  }
});
