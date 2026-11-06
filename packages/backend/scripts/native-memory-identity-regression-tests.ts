import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'native-identity-fixture-encryption-key-00';
const testing = await import('../src/db/testing.js');
const schema = testing.useTestSchema();
const { run, get, readPgConfig } = await import('../src/db/pg.js');
const { connectMatrix } = await import('../src/services/assistant/matrix.js');
const { nativeMemoryList } = await import('../src/services/assistant/nativeMemory.js');
const originalFetch = globalThis.fetch;
const root = await mkdtemp(path.join(tmpdir(), 'plum-native-identity-'));
const user = 'native-identity-fixture';
let principal = '@owner:matrix.fixture.invalid',
  revoked = false,
  requests = 0,
  switchEpoch = false;
process.env.PLUM_MATRIX_HOMESERVER = 'https://matrix.fixture.invalid';
process.env.PLUM_NATIVE_MEMORY_OWNER_MXID = principal;
process.env.PLUM_NATIVE_MEMORY_SCHEMA = schema;
process.env.PLUM_HERMES_MEMORY_ROOTS = JSON.stringify({ fixture: root });
globalThis.fetch = async (input) => {
  const url = String(input);
  assert.equal(
    url,
    'https://matrix.fixture.invalid/_matrix/client/v3/account/whoami',
    'identity checks must never enumerate rooms or fetch private room state'
  );
  requests++;
  if (switchEpoch) {
    const credential = await get(
      "SELECT public_json FROM assistant_credentials WHERE user_id=? AND service='matrix'",
      user
    );
    const identity = JSON.parse(credential.public_json);
    identity.epoch = 'changed-in-flight';
    await run(
      "UPDATE assistant_credentials SET public_json=? WHERE user_id=? AND service='matrix'",
      JSON.stringify(identity),
      user
    );
  }
  return Response.json(
    revoked ? { errcode: 'M_UNKNOWN_TOKEN' } : { user_id: principal, device_id: 'fixture' },
    { status: revoked ? 401 : 200 }
  );
};
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const pg = readPgConfig();
  process.env.PLUM_NATIVE_MEMORY_DATABASE_URL = `postgresql://${encodeURIComponent(pg.user)}:${encodeURIComponent(pg.password)}@${pg.host}:${pg.port}/${pg.database}`;
  await run(
    "INSERT INTO users(id,email,provider,provider_id) VALUES(?,?,'test',?)",
    user,
    user + '@example.invalid',
    user
  );
  await run('CREATE TABLE gedaechtnis(id BIGSERIAL PRIMARY KEY,agent TEXT,text TEXT,task_id TEXT)');
  await run(
    "INSERT INTO gedaechtnis(agent,text,task_id) VALUES('fixture','Native fixture fact','fixture')"
  );
  await writeFile(path.join(root, 'MEMORY.md'), 'Hermes fixture fact');
  await writeFile(path.join(root, 'USER.md'), 'Hermes fixture preference');
  await connectMatrix(user, { accessToken: 'fake-native-token' });
  const before = requests;
  const result = await nativeMemoryList(user);
  assert.equal(
    requests - before,
    1,
    'one whoami verifies the principal instead of synchronising all rooms'
  );
  assert.deepEqual(result.unavailable, []);
  assert(result.entries.some((entry) => entry.text.includes('Native fixture fact')));
  assert(result.entries.some((entry) => entry.text.includes('Hermes fixture fact')));
  principal = '@different:matrix.fixture.invalid';
  await assert.rejects(nativeMemoryList(user), /gewechselt/);
  principal = process.env.PLUM_NATIVE_MEMORY_OWNER_MXID!;
  revoked = true;
  await assert.rejects(nativeMemoryList(user));
  revoked = false;
  switchEpoch = true;
  await assert.rejects(nativeMemoryList(user), /gewechselt/);
  console.log(
    'PASS: native memory authenticates with one bounded whoami, reads isolated PostgreSQL/Hermes, rejects wrong/revoked principal and an account epoch changed in flight; no room enumeration or external model API'
  );
} finally {
  globalThis.fetch = originalFetch;
  await testing.dropTestSchema();
  await rm(root, { recursive: true, force: true });
}
