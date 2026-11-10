import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readAgentDatabaseEnv, stripBackendSecretsFromEnv } from './childProcessEnv.js';

const backend = {
  PATH: '/usr/bin',
  PGHOST: 'db',
  PGPORT: '5432',
  PGDATABASE: 'plumcode',
  PGUSER: 'plum_app',
  PGPASSWORD: 'application-password',
  JWT_SECRET: 'jwt',
};

test('without a configured agent role the user name stays and the password goes', () => {
  const env = stripBackendSecretsFromEnv(backend, null);
  assert.equal(env.PGUSER, 'plum_app');
  assert.equal(env.PGPASSWORD, undefined);
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.PATH, '/usr/bin');
});

test('a configured agent role replaces the application role as a whole', () => {
  const env = stripBackendSecretsFromEnv(backend, {
    PGUSER: 'plum_test',
    PGPASSWORD: 'test-password',
  });
  assert.equal(env.PGUSER, 'plum_test');
  assert.equal(env.PGPASSWORD, 'test-password');
  assert.equal(env.PGHOST, 'db');
});

test('the file is read from the data directory and only database keys count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-db-env-'));
  try {
    assert.equal(readAgentDatabaseEnv(dir), null, 'no file, no role');
    fs.writeFileSync(
      path.join(dir, 'agent-test-db.env'),
      '# test role\nPGHOST=db\nPGUSER=plum_test\nPGPASSWORD=test-password\nJWT_SECRET=nope\n  PGPORT = 5433 \n'
    );
    assert.deepEqual(readAgentDatabaseEnv(dir), {
      PGHOST: 'db',
      PGUSER: 'plum_test',
      PGPASSWORD: 'test-password',
      PGPORT: '5433',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a file without user and password is not used', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-db-env-'));
  try {
    fs.writeFileSync(path.join(dir, 'agent-test-db.env'), 'PGHOST=db\nPGUSER=plum_test\n');
    assert.equal(readAgentDatabaseEnv(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
