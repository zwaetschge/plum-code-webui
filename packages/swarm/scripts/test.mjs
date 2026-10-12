import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The ingested native unit tests import env.ts through pure helper modules.
// Supply fixtures, never the operator's database/appservice credentials.
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:1/fixture',
  HOMESERVER_URL: 'http://127.0.0.1:1',
  AS_TOKEN: 'test-as-token',
  HS_TOKEN: 'test-hs-token',
  MATRIX_DOMAIN: 'zwaetschge-webui.ch',
  OWNER_MXID: '@vale:zwaetschge-webui.ch',
  COUNCIL_URL: '',
  COUNCIL_TOKEN: '',
  NTFY_URL: '',
  NTFY_TOKEN: '',
  AGENTS_FILE: '/fixture/agents-unavailable.yaml',
  ROOMS_FILE: '/fixture/rooms-unavailable.yaml',
};
const entry = join(
  dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))),
  'vitest.mjs'
);
const child = spawn(
  process.execPath,
  [entry, 'run', '--maxWorkers=2', '--minWorkers=1', ...process.argv.slice(2)],
  { env, stdio: 'inherit' }
);
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
