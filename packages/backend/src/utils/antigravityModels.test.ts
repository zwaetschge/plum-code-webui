import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'antigravity-models-test-session-secret-000000000';
process.env.JWT_SECRET ||= 'antigravity-models-test-jwt-secret-00000000000000';

const { agyBridgeModels, discoveredAntigravityModels, PI_ANTIGRAVITY_MODELS } =
  await import('./piConfig.js');

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

test('the agy bridge ids come from its cached `agy models` output', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-cache-'));
  try {
    const cache = path.join(dir, 'models-cache.json');
    // Excerpt of what `agy models` printed for the Ultra account on 2026-11-15.
    const raw = [
      'Fetching available models...',
      'gemini-4-carbon-medium\tGemini 4 Carbon (Medium)',
      'gemini-4-carbon-high\tGemini 4 Carbon (High)',
      'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
      'gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)',
      'gemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)',
      'gemini-pro-orchestrator\tOrchestrator (Carbon)',
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
      'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
    ].join('\n');
    writeFileSync(cache, JSON.stringify({ raw, savedAt: 0 }));
    // The same ids `pi --list-models antigravity` showed with the bridge.
    assert.deepEqual(agyBridgeModels(cache), [
      'antigravity/gemini-4-carbon',
      'antigravity/gemini-4-hydrogen',
      'antigravity/gemini-4-hydrogen-xhigh',
      'antigravity/gemini-pro-orchestrator',
      'antigravity/gemini-3-8-flash',
    ]);
    writeFileSync(cache, JSON.stringify({ raw: 'Error: Please sign in', savedAt: 0 }));
    assert.equal(agyBridgeModels(cache), null);
    assert.equal(agyBridgeModels(path.join(dir, 'missing.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
