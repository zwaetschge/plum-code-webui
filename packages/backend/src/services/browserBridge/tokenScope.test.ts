/**
 * Watch tokens live in browser_tokens next to the extension's. The scope is
 * what keeps them apart: re-pairing a watch replaces only that watch's token,
 * and the watch routes can never revoke a browser's pairing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../../db/testing.js');
useTestSchema();

const {
  createBrowserToken,
  listBrowserTokens,
  resolveBrowserToken,
  revokeBrowserToken,
  revokeScopedTokensByName,
} = await import('./tokens.js');

const reachable = await databaseReachable();
if (reachable) await createTestSchema();
test.after(async () => {
  if (reachable) await dropTestSchema();
});

const options = reachable ? {} : { skip: 'no Postgres reachable (set PGHOST/PGPASSWORD to run)' };

test('tokens carry their scope from creation to resolution', options, async () => {
  const browser = await createBrowserToken('alice', 'Firefox');
  const watch = await createBrowserToken('alice', 'Uhr Pixel', 'watch');
  assert.equal(browser.row.scope, 'browser');
  assert.equal(watch.row.scope, 'watch');
  assert.equal((await resolveBrowserToken(browser.token))?.scope, 'browser');
  assert.equal((await resolveBrowserToken(watch.token))?.scope, 'watch');
  const listed = new Map((await listBrowserTokens('alice')).map((row) => [row.id, row.scope]));
  assert.equal(listed.get(browser.row.id), 'browser');
  assert.equal(listed.get(watch.row.id), 'watch');
});

test('re-pairing a watch revokes only that watch token', options, async () => {
  const browser = await createBrowserToken('bob', 'Uhr Pixel');
  const first = await createBrowserToken('bob', 'Uhr Pixel', 'watch');
  const other = await createBrowserToken('bob', 'Uhr Galaxy', 'watch');
  const foreign = await createBrowserToken('carol', 'Uhr Pixel', 'watch');

  assert.deepEqual(await revokeScopedTokensByName('bob', 'Uhr Pixel', 'watch'), [first.row.id]);
  assert.equal(await resolveBrowserToken(first.token), null);
  assert.ok(await resolveBrowserToken(browser.token));
  assert.ok(await resolveBrowserToken(other.token));
  assert.ok(await resolveBrowserToken(foreign.token));
});

test('a scoped revoke cannot touch a token of another scope or user', options, async () => {
  const browser = await createBrowserToken('dave', 'Firefox');
  const watch = await createBrowserToken('dave', 'Uhr', 'watch');
  assert.equal(await revokeBrowserToken('dave', browser.row.id, 'watch'), false);
  assert.equal(await revokeBrowserToken('erin', watch.row.id, 'watch'), false);
  assert.ok(await resolveBrowserToken(browser.token));
  assert.equal(await revokeBrowserToken('dave', watch.row.id, 'watch'), true);
  assert.equal(await resolveBrowserToken(watch.token), null);
});

test('a full set of browser tokens does not block pairing a watch', options, async () => {
  for (let index = 0; index < 10; index += 1) {
    await createBrowserToken('erin', `Browser ${index}`);
  }
  await assert.rejects(createBrowserToken('erin', 'Browser 11'), /10 active browser tokens/);
  const watch = await createBrowserToken('erin', 'Galaxy Watch', 'watch');
  assert.equal(watch.row.scope, 'watch');
  for (let index = 1; index < 5; index += 1) {
    await createBrowserToken('erin', `Watch ${index}`, 'watch');
  }
  await assert.rejects(createBrowserToken('erin', 'Watch 6', 'watch'), /5 Uhren/);
});
