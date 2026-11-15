import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'antigravity-models-test-session-secret-000000000';
process.env.JWT_SECRET ||= 'antigravity-models-test-jwt-secret-00000000000000';

const { discoveredAntigravityModels, PI_ANTIGRAVITY_MODELS } = await import('./piConfig.js');

test("the account's live list replaces the static one", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'antigravity-store-'));
  try {
    const store = path.join(dir, 'models-store.json');
    // What pi-antigravity 0.14 stored after its refresh on 2026-11-15.
    writeFileSync(
      store,
      JSON.stringify({
        antigravity: {
          models: [
            { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Antigravity)' },
            { id: 'claude-opus-4-6' },
            { id: 'gemini-3.8-flash' },
            { id: '../../etc/passwd' },
            { name: 'no id' },
          ],
        },
        deepseek: { models: [{ id: 'deepseek-flash' }] },
      })
    );
    assert.deepEqual(discoveredAntigravityModels(store), [
      'antigravity/gemini-3.8-flash',
      'antigravity/claude-opus-4-6',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without a stored list the caller falls back', () => {
  assert.equal(discoveredAntigravityModels('/nonexistent/models-store.json'), null);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'antigravity-store-'));
  try {
    const store = path.join(dir, 'models-store.json');
    writeFileSync(store, JSON.stringify({ antigravity: { models: [] } }));
    assert.equal(discoveredAntigravityModels(store), null);
    writeFileSync(store, '{ broken');
    assert.equal(discoveredAntigravityModels(store), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The fallback no longer offers models Antigravity retired.
  assert.ok(!PI_ANTIGRAVITY_MODELS.some((id) => /gemini-3\.[1-7]/.test(id)));
});
