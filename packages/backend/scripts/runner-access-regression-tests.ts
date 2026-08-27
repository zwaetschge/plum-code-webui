import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'runner-access-test-session-secret-00000000000000';
process.env.JWT_SECRET = 'runner-access-test-jwt-secret-000000000000000';
delete process.env.CLI_RUNNER_ACCESS;
delete process.env.CLI_RUNNER_ALLOWED_EMAILS;

const { useTestSchema, createTestSchema, dropTestSchema } = await import('../src/db/testing.js');
useTestSchema();

const { getRunnerAccessDecision } = await import('../src/utils/runnerAccess.js');
const { run: pgRun } = await import('../src/db/pg.js');

await createTestSchema();
for (const [id, email, role, status] of [
  ['admin', 'admin@example.test', 'admin', 'active'],
  ['user', 'user@example.test', 'user', 'active'],
  ['suspended', 'suspended@example.test', 'admin', 'suspended'],
]) {
  await pgRun(
    `INSERT INTO users (id, email, name, provider, provider_id, role, status)
     VALUES (?, ?, ?, 'local', ?, ?, ?)`,
    id,
    email,
    id,
    id,
    role,
    status
  );
}

try {

  assert.equal((await getRunnerAccessDecision('admin')).allowed, true);
  assert.equal((await getRunnerAccessDecision('user')).allowed, false);
  assert.match((await getRunnerAccessDecision('user')).reason || '', /admin-only/);
  assert.equal((await getRunnerAccessDecision('suspended')).allowed, false);
  assert.equal((await getRunnerAccessDecision('missing')).allowed, false);

  process.env.CLI_RUNNER_ALLOWED_EMAILS = 'USER@example.test';
  assert.equal((await getRunnerAccessDecision('user')).allowed, true);

  delete process.env.CLI_RUNNER_ALLOWED_EMAILS;
  process.env.CLI_RUNNER_ACCESS = 'trusted-users';
  assert.equal((await getRunnerAccessDecision('user')).allowed, true);

  console.log('runner access regression tests passed');
} finally {
  await dropTestSchema();
}
