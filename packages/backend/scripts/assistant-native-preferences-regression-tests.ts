import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'preferences-fixture-secret-000000000';
process.env.ENCRYPTION_KEY = 'preferences-fixture-encryption-key-00000';
process.env.PLUM_MATRIX_HOMESERVER = 'https://matrix.preferences-fixture.invalid';
const { useTestSchema, createTestSchema, dropTestSchema, databaseReachable } =
  await import('../src/db/testing.js');
useTestSchema();
const { run, closePool } = await import('../src/db/pg.js');
const matrix = await import('../src/services/assistant/matrix.js');
const { default: router } = await import('../src/routes/assistant.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const originalFetch = globalThis.fetch,
  settings: Record<string, Record<string, unknown>> = {
    alice: {
      v: 1,
      zeit: 100,
      vorlagen: [
        {
          id: 'existing',
          titel: 'Bericht',
          agent: 'brian',
          ziel: 'Bericht über {Thema}',
          favorit: false,
        },
      ],
      pdfSeiten: false,
      einrichtungErledigt: ['push'],
      future: { keep: true },
    },
    bob: { v: 1, zeit: 100 },
  };
let puts = 0,
  lose = false,
  switchRead = false;
const app = express();
app.use(express.json());
app.use('/api/assistant', router);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.origin === origin) return originalFetch(input, options);
  assert.equal(url.origin, process.env.PLUM_MATRIX_HOMESERVER);
  const actor =
    new Headers(options?.headers).get('Authorization') === 'Bearer native-bob' ? 'bob' : 'alice';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname.endsWith('/account/whoami'))
    return json({ user_id: `@${actor}:fixture.invalid`, device_id: 'existing-device' });
  assert(url.pathname.endsWith('/account_data/ch.zwaetschge.schwarm.einstellungen'));
  if (options?.method === 'PUT') {
    puts++;
    settings[actor] = JSON.parse(String(options.body));
    if (lose) {
      lose = false;
      throw new TypeError('Lost native response');
    }
    return json({});
  }
  if (switchRead) {
    switchRead = false;
    await matrix.connectMatrix('preferences-alice', { accessToken: 'native-alice' });
  }
  return json(settings[actor]);
};
if (!(await databaseReachable())) {
  globalThis.fetch = originalFetch;
  await closePool();
  server.close();
  throw new Error('Own test database unavailable');
}
try {
  await createTestSchema();
  for (const name of ['alice', 'bob'])
    await run(
      "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
      `preferences-${name}`,
      `${name}@fixture.invalid`,
      name
    );
  const alice = await matrix.connectMatrix('preferences-alice', { accessToken: 'native-alice' });
  await matrix.connectMatrix('preferences-bob', { accessToken: 'native-bob' });
  const snapshot = await matrix.matrixPreferences('preferences-alice');
  assert.equal(snapshot.epoch, alice.epoch);
  assert.equal(snapshot.settings.vorlagen?.length, 1);
  assert.equal(
    'future' in snapshot.settings,
    false,
    'Display hides unsupported keys without deleting native state'
  );
  const packet = matrix.MATRIX_PREFERENCES_INPUT.parse({
    commandId: randomUUID(),
    nativeUserId: snapshot.nativeUserId,
    epoch: snapshot.epoch,
    expectedHash: snapshot.hash,
    zeit: 200,
    changes: { pdfSeiten: true },
  });
  const race = await Promise.all([
    matrix.updateMatrixPreferences('preferences-alice', packet),
    matrix.updateMatrixPreferences('preferences-alice', packet),
  ]);
  assert.deepEqual(race[0], race[1]);
  assert.equal(puts, 1);
  assert.deepEqual(settings.alice!.future, { keep: true });
  assert.deepEqual(settings.alice!.einrichtungErledigt, ['push']);
  assert.equal((settings.alice!.vorlagen as unknown[]).length, 1);
  await assert.rejects(
    matrix.updateMatrixPreferences('preferences-alice', {
      ...packet,
      changes: { pdfSeiten: false },
    }),
    /anderen Inhalt/
  );
  await assert.rejects(matrix.updateMatrixPreferences('preferences-bob', packet), /gewechselt/);
  const latest = await matrix.matrixPreferences('preferences-alice');
  settings.alice = { ...settings.alice, zeit: 300, antwortenVorlesen: true };
  await assert.rejects(
    matrix.updateMatrixPreferences('preferences-alice', {
      ...packet,
      commandId: randomUUID(),
      zeit: 400,
      expectedHash: latest.hash,
      changes: { pdfSeiten: false },
    }),
    /inzwischen geändert/
  );
  assert.equal(puts, 1);
  const beforeLoss = await matrix.matrixPreferences('preferences-alice'),
    retry = {
      ...packet,
      commandId: randomUUID(),
      zeit: 500,
      expectedHash: beforeLoss.hash,
      changes: { pdfSeiten: false },
    };
  lose = true;
  await assert.rejects(
    matrix.updateMatrixPreferences('preferences-alice', retry),
    /nicht erreichbar/
  );
  assert.equal(puts, 2);
  const recovered = await matrix.updateMatrixPreferences('preferences-alice', retry);
  assert.equal(recovered.settings.pdfSeiten, false);
  assert.equal(
    puts,
    2,
    'Unknown native acknowledgement recovered by exact desired state, no second PUT'
  );
  const token = jwt.sign({ userId: 'preferences-alice' }, process.env.JWT_SECRET!);
  const live = await matrix.matrixPreferences('preferences-alice');
  const response = await fetch(origin + '/api/assistant/matrix/preferences', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...packet,
      commandId: randomUUID(),
      zeit: 600,
      expectedHash: live.hash,
      changes: { antwortenVorlesen: false },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(
    (settings.alice!.vorlagen as unknown[]).length,
    1,
    'Flag-only HTTP update preserves templates'
  );
  assert.deepEqual(settings.alice!.future, { keep: true });
  assert.equal(
    matrix.MATRIX_PREFERENCES_INPUT.safeParse({ ...packet, changes: { password: 'no' } }).success,
    false
  );
  assert.equal(
    matrix.MATRIX_PREFERENCES_INPUT.safeParse({
      ...packet,
      changes: {
        vorlagen: Array.from({ length: 7 }, (_, n) => ({
          id: String(n),
          titel: 'Favorit',
          agent: 'brian',
          ziel: 'Prüfen',
          favorit: true,
        })),
      },
    }).success,
    false
  );
  settings.alice = { ...settings.alice, v: 2 };
  assert.deepEqual((await matrix.matrixPreferences('preferences-alice')).settings, { v: 2 });
  await assert.rejects(
    matrix.updateMatrixPreferences('preferences-alice', {
      ...packet,
      commandId: randomUUID(),
      zeit: 700,
    }),
    /Version/
  );
  settings.alice = { ...settings.alice, v: 1 };
  switchRead = true;
  await assert.rejects(matrix.matrixPreferences('preferences-alice'), /gewechselt/);
  await assert.rejects(matrix.updateMatrixPreferences('preferences-alice', packet), /gewechselt/);
  console.log(
    'PASS: own encrypted Matrix identity, native preference reads/partial merge, preserved templates/unknown setup fields, concurrency and durable UUID receipts, changed-state conflict, exact recovery after lost native acknowledgment without repeat PUT, foreign/epoch/version gates and actual authenticated HTTP; no live Matrix traffic'
  );
} finally {
  globalThis.fetch = originalFetch;
  await new Promise<void>((r) => server.close(() => r()));
  await dropTestSchema();
}
