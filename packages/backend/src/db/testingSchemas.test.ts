/**
 * Test schemas live in the shared database; a crashed run leaves its schema
 * behind, so the next run sweeps the leftovers by the time in their name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { isStaleTestSchema, useTestSchema } from './testing.js';

test('a fresh test schema carries its creation time and is not stale', () => {
  const previous = process.env.PGSCHEMA;
  try {
    const name = useTestSchema();
    assert.match(name, /^test_[0-9a-z]{6,8}_[0-9a-f]{8}$/);
    assert.equal(isStaleTestSchema(name), false);
    // The same name three hours and a bit later is a leftover.
    assert.equal(isStaleTestSchema(name, Date.now() / 1000 + 3 * 3600 + 60), true);
  } finally {
    if (previous === undefined) delete process.env.PGSCHEMA;
    else process.env.PGSCHEMA = previous;
  }
});

test('names of the old scheme are leftovers; other schemas are never touched', () => {
  assert.equal(isStaleTestSchema('test_e3307c2d5595'), true);
  for (const name of ['public', 'it_e3307c2d5595', 'test', 'testing_data', 'test_results']) {
    assert.equal(isStaleTestSchema(name), false, name);
  }
});
