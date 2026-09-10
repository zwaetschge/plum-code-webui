#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const sidecarScript = path.join(scriptDir, 'rebuild-robot-sidecar.sh');
const rebuildTriggerScript = path.join(scriptDir, 'plum-rebuild.sh');
const maintenanceScript = path.join(scriptDir, 'plum-maintenance.mjs');
const productionGuardScript = path.join(scriptDir, 'validate-production-env.sh');
const hubCompose = path.join(projectDir, 'docker-compose.hub.yml');
const portableCompose = path.join(projectDir, 'docker-compose.yml');
const overrideExample = path.join(projectDir, 'docker-compose.override.yml.example');
const envExample = path.join(projectDir, '.env.example');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectDir,
    encoding: 'utf8',
    ...options,
  });
}

async function setAge(file, isoTimestamp) {
  const time = new Date(isoTimestamp);
  await utimes(file, time, time);
}

async function testRebuildRollback(tempDir) {
  execFileSync('sh', ['-n', sidecarScript]);

  const callsFile = path.join(tempDir, 'docker-calls.log');
  const statusFile = path.join(tempDir, 'status.log');
  const harness = path.join(tempDir, 'rollback-harness.sh');
  await writeFile(
    harness,
    `#!/bin/sh
REBUILD_ROBOT_SOURCE_ONLY=true . '${sidecarScript}'
CALLS_FILE='${callsFile}'
STATUS_LOG='${statusFile}'
COMPOSE_FILE='/tmp/fake-compose.yml'
OVERRIDE_FILE='/tmp/missing-override.yml'
TRIGGER_FILE='${path.join(tempDir, 'missing-trigger.json')}'
REPORT_FILE='${path.join(tempDir, 'report.md')}'
LOG_FILE='${path.join(tempDir, 'robot.log')}'
READINESS_ATTEMPTS=1
READINESS_INTERVAL=1
docker() {
  printf '%s\\n' "$*" >> "$CALLS_FILE"
  case "$*" in
    *"config --format json"*)
      printf '%s\\n' '{"services":{"claude-code-webui":{"image":"plum-code-webui:latest"}}}'
      ;;
    *"config --services"*)
      printf '%s\\n' 'claude-code-webui' 'docker-socket-proxy'
      ;;
    *"ps --all -q claude-code-webui"*)
      printf '%s\\n' 'old-container'
      ;;
    *"ps --all -q docker-socket-proxy"*)
      printf '%s\\n' 'proxy-container'
      ;;
    "inspect --format {{.Image}} old-container")
      printf '%s\\n' 'sha256:previous'
      ;;
    "inspect --format {{.State.Status}} old-container")
      printf '%s\\n' 'running'
      ;;
    "inspect --format {{.State.Status}} proxy-container")
      printf '%s\\n' 'running'
      ;;
    "inspect --format {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} proxy-container")
      printf '%s\\n' 'healthy'
      ;;
    "image inspect plum-code-webui:latest --format {{.Id}}")
      printf '%s\\n' 'sha256:candidate'
      ;;
  esac
  return 0
}
wait_for_readiness() { [ "$2" = 'sha256:previous' ]; }
write_status() { printf '%s|%s|%s\\n' "$1" "$2" "$3" >> "$STATUS_LOG"; }
write_report() { :; }
log_info() { :; }
log_warn() { :; }
log_error() { :; }
log_success() { :; }
sleep() { :; }
if do_rebuild false; then
  exit 9
fi
[ "$ROLLBACK_RESULT" = 'erfolgreich; vorheriges Image wieder aktiv' ]
`,
    { mode: 0o700 }
  );

  const result = run('sh', [harness]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await readFile(callsFile, 'utf8');
  assert.match(calls, /image tag sha256:previous plum-code-webui:latest/);
  assert.match(
    calls,
    /up -d --no-deps docker-socket-proxy/,
    'the rollout must provision the configured Docker proxy'
  );
  const proxyUpIndex = calls.indexOf('up -d --no-deps docker-socket-proxy');
  const mainBuildIndex = calls.indexOf('build claude-code-webui');
  assert.ok(
    proxyUpIndex >= 0 && mainBuildIndex >= 0 && proxyUpIndex < mainBuildIndex,
    'the configured Docker proxy must refresh before the main image build starts'
  );
  assert.ok(
    (calls.match(/up -d --no-deps claude-code-webui/g) || []).length >= 2,
    'candidate and rollback releases must both be started'
  );
  const statuses = await readFile(statusFile, 'utf8');
  assert.match(statuses, /^rolling-back\|/m);
  assert.match(statuses, /^error\|.*Rollback erfolgreich\.\|rolled-back$/m);

  const source = await readFile(sidecarScript, 'utf8');
  assert.match(source, /\/health\/ready/);
  assert.match(source, /wait_for_readiness .*CANDIDATE_IMAGE_ID/);
  assert.ok((source.match(/reject_candidate/g) || []).length >= 3);
}

async function testHubProductionGuards(tempDir) {
  const emptyEnv = path.join(tempDir, 'empty.env');
  await writeFile(emptyEnv, '');
  const baseEnv = {
    ...process.env,
    HOME: tempDir,
    SESSION_SECRET: 's'.repeat(48),
    JWT_SECRET: 'j'.repeat(48),
    ENCRYPTION_KEY: 'e'.repeat(48),
    AUTH_ALLOWED_EMAILS: 'admin@example.com',
    POSTGRES_PASSWORD: 'p'.repeat(24),
  };

  const valid = run(
    'docker',
    ['compose', '--env-file', emptyEnv, '-f', hubCompose, 'config', '--format', 'json'],
    {
      env: baseEnv,
    }
  );
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  const normalizedCompose = JSON.parse(valid.stdout);
  assert.equal(
    normalizedCompose.services['plum-code-webui'].depends_on['config-guard'].condition,
    'service_completed_successfully'
  );
  assert.deepEqual(normalizedCompose.services['config-guard'].entrypoint, [
    '/bin/sh',
    '/app/scripts/validate-production-env.sh',
  ]);
  assert.equal(
    normalizedCompose.services['plum-code-webui'].environment.CLI_RUNNER_ACCESS,
    'admin-only'
  );

  for (const required of [
    'SESSION_SECRET',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'AUTH_ALLOWED_EMAILS',
    'POSTGRES_PASSWORD',
  ]) {
    const env = { ...baseEnv, [required]: '' };
    const rejected = run(
      'docker',
      ['compose', '--env-file', emptyEnv, '-f', hubCompose, 'config', '-q'],
      { env }
    );
    assert.notEqual(rejected.status, 0, `${required} unexpectedly accepted as empty`);
    assert.match(rejected.stderr, new RegExp(required));
  }

  const source = await readFile(hubCompose, 'utf8');
  assert.doesNotMatch(source, /changeme-session|changeme-jwt/);

  const guardAccepted = run('sh', [productionGuardScript], { env: baseEnv });
  assert.equal(guardAccepted.status, 0, guardAccepted.stderr || guardAccepted.stdout);

  const invalidCases = [
    { SESSION_SECRET: 'short' },
    { SESSION_SECRET: 'changeme-session-secret-at-least-32-chars' },
    { SESSION_SECRET: 'your-session-secret-at-least-32-characters' },
    { JWT_SECRET: baseEnv.SESSION_SECRET },
    { ENCRYPTION_KEY: baseEnv.SESSION_SECRET },
    { AUTH_ALLOWED_EMAILS: ' ,  ,' },
  ];
  for (const invalid of invalidCases) {
    const rejected = run('sh', [productionGuardScript], {
      env: { ...baseEnv, ...invalid },
    });
    assert.notEqual(rejected.status, 0, `production guard accepted ${JSON.stringify(invalid)}`);
    assert.match(rejected.stderr, /production configuration rejected:/);
  }
}

async function testDockerProxyReleaseContract(tempDir) {
  const [overrideSource, envSource, rebuildSource] = await Promise.all([
    readFile(overrideExample, 'utf8'),
    readFile(envExample, 'utf8'),
    readFile(rebuildTriggerScript, 'utf8'),
  ]);

  const writeFlags = ['CONTAINERS', 'IMAGES', 'NETWORKS', 'BUILD', 'POST'];
  for (const flag of writeFlags) {
    const variable = `DOCKER_PROXY_${flag}`;
    const failClosedValue = `\${${variable}:-0}`;
    assert.match(
      envSource,
      new RegExp(`^${variable}=0$`, 'm'),
      `${variable} must remain disabled in the portable environment template`
    );

    const exampleLine = overrideSource.split('\n').find((line) => {
      const entry = line.trim().replace(/^#\s*/, '');
      return entry.startsWith(`${flag}:`) && entry.includes(failClosedValue);
    });
    assert.ok(
      exampleLine,
      `${flag} must use the fail-closed ${failClosedValue} default in the proxy example`
    );
  }

  const emptyEnv = path.join(tempDir, 'portable-empty.env');
  await writeFile(emptyEnv, '');
  const normalized = run(
    'docker',
    [
      'compose',
      '--env-file',
      emptyEnv,
      '-f',
      portableCompose,
      '-f',
      overrideExample,
      'config',
      '--format',
      'json',
    ],
    {
      env: {
        ...process.env,
        SESSION_SECRET: 's'.repeat(48),
        JWT_SECRET: 'j'.repeat(48),
        POSTGRES_PASSWORD: 'p'.repeat(24),
      },
    }
  );
  assert.equal(normalized.status, 0, normalized.stderr || normalized.stdout);
  const services = JSON.parse(normalized.stdout).services;
  const mainService = services['claude-code-webui'];
  assert.ok(mainService, 'portable compose must define the main WebUI service');
  assert.ok(services.postgres, 'portable compose must define the database it now requires');
  assert.ok(
    mainService.depends_on?.postgres,
    'the WebUI must wait for the database rather than race it on boot'
  );
  assert.doesNotMatch(
    JSON.stringify(mainService.volumes ?? []),
    /\/var\/run\/docker\.sock/,
    'the main WebUI service must never mount the raw Docker socket'
  );

  // Without a password there is no sensible default to fall back to, so the
  // deployment has to fail loudly instead of reaching some other database.
  const withoutPassword = run(
    'docker',
    ['compose', '-f', portableCompose, 'config', '--quiet'],
    {
      env: {
        ...process.env,
        SESSION_SECRET: 's'.repeat(48),
        JWT_SECRET: 'j'.repeat(48),
        POSTGRES_PASSWORD: '',
      },
    }
  );
  assert.notEqual(withoutPassword.status, 0, 'a missing POSTGRES_PASSWORD must fail the config');
  assert.match(withoutPassword.stderr, /POSTGRES_PASSWORD/);

  assert.match(rebuildSource, /^SIDECAR_NAME="repair-bot"$/m);
  assert.match(rebuildSource, /TRIGGER_FILE=.*rebuild-trigger\.json/);
  assert.match(rebuildSource, /cat > "\$TRIGGER_FILE"/);
  assert.match(rebuildSource, /exit 3/);

  const executableRebuildSource = rebuildSource
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(
    executableRebuildSource,
    /^\s*docker\s+compose\s+(?:build|stop|rm|up)\b/m,
    'plum-rebuild must delegate release mutations to repair-bot through the trigger file'
  );
}

/**
 * Every runtime file the backend reads next to its own module has to be copied
 * into dist/, because tsc emits only what it compiles. Missing one is invisible
 * in development — everything runs from src/ there — and fatal in the image:
 * the server throws before it listens, the readiness gate rejects the release,
 * and the rollback leaves a successful build looking like the problem.
 */
async function testRuntimeAssetsAreCopiedIntoDist() {
  const backendSrc = path.join(projectDir, 'packages/backend/src');
  // Two mechanisms are in play and both count: copy-build-assets.mjs for files
  // that belong next to the compiled module, and the Dockerfile for the handful
  // it copies out of src/ directly.
  const copyScript = await readFile(
    path.join(projectDir, 'packages/backend/scripts/copy-build-assets.mjs'),
    'utf8'
  );
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');

  const referenced = new Set();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      const source = await readFile(full, 'utf8');
      for (const match of source.matchAll(/__dirname,\s*'([^']+\.[a-z]+)'/g)) {
        referenced.add(path.posix.join(path.relative(backendSrc, dir), match[1]));
      }
    }
  };
  await walk(backendSrc);

  const missing = [...referenced].filter((asset) => {
    const base = path.posix.basename(asset);
    return !copyScript.includes(asset) && !dockerfile.includes(base);
  });
  assert.deepEqual(
    missing,
    [],
    'files read from __dirname must be listed in copy-build-assets.mjs'
  );
}

async function testMaintenance(tempDir) {
  const dataDir = path.join(tempDir, 'data');
  const configDir = path.join(tempDir, 'config');
  const backupDir = path.join(dataDir, 'backups');
  const logsDir = path.join(dataDir, 'logs');
  const sessionDir = path.join(configDir, 'codex', 'sessions', '2026', '07');
  const cacheDir = path.join(configDir, 'codex', 'cache');
  await Promise.all([
    mkdir(backupDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
  ]);


  const files = {
    oldBackup: path.join(backupDir, 'backup-2026-01-01_00-00-00.dump'),
    recentBackup: path.join(backupDir, 'backup-2026-07-13_00-00-00.dump'),
    manualBackup: path.join(backupDir, 'manual.dump'),
    oldLog: path.join(dataDir, 'oc-debug.log'),
    recentLog: path.join(logsDir, 'current.log'),
    oldSession: path.join(sessionDir, 'old.jsonl'),
    recentSession: path.join(sessionDir, 'current.jsonl'),
    unrelatedJsonl: path.join(cacheDir, 'catalog.jsonl'),
  };
  for (const file of Object.values(files)) await writeFile(file, '{}\n');

  for (const file of [files.oldBackup, files.oldLog, files.oldSession]) {
    await setAge(file, '2026-01-01T00:00:00.000Z');
  }
  for (const file of [
    files.recentBackup,
    files.manualBackup,
    files.recentLog,
    files.recentSession,
    files.unrelatedJsonl,
  ]) {
    await setAge(file, '2026-07-10T00:00:00.000Z');
  }

  const result = run(process.execPath, [
    maintenanceScript,
    '--data-dir',
    dataDir,
    '--config-dir',
    configDir,
    '--backup-retention-days',
    '14',
    '--log-retention-days',
    '14',
    '--session-retention-days',
    '30',
    // Backups are the server's job now: it owns the only connection to the live
    // database, and this script asks for one over the API. Retention is what is
    // under test here, so it runs without that round trip.
    '--skip-backup',
    '--now=2026-07-14T12:00:00.000Z',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  await assert.rejects(stat(files.oldBackup), { code: 'ENOENT' });
  await assert.rejects(stat(files.oldLog), { code: 'ENOENT' });
  await assert.rejects(stat(files.oldSession), { code: 'ENOENT' });
  for (const file of [
    files.recentBackup,
    files.manualBackup,
    files.recentLog,
    files.recentSession,
    files.unrelatedJsonl,
  ]) {
    assert.ok((await stat(file)).isFile(), `${file} should be retained`);
  }

  // Retention must never touch a file it does not recognise. The naming rule is
  // the only thing standing between "prune old backups" and "delete whatever is
  // in this directory", so a hand-named file is the case worth asserting.
  assert.ok(
    existsSync(files.manualBackup),
    'a file outside the backup naming scheme must survive retention'
  );

  await writeFile(files.oldLog, 'old again\n');
  await setAge(files.oldLog, '2026-01-01T00:00:00.000Z');
  const dryRun = run(process.execPath, [
    maintenanceScript,
    '--data-dir',
    dataDir,
    '--config-dir',
    configDir,
    '--skip-backup',
    '--dry-run',
    '--now=2026-07-14T12:00:00.000Z',
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /would remove log:/);
  assert.ok((await stat(files.oldLog)).isFile(), 'dry-run must not delete files');
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'plum-ops-release-'));
try {
  await testRebuildRollback(tempDir);
  await testHubProductionGuards(tempDir);
  await testDockerProxyReleaseContract(tempDir);
  await testRuntimeAssetsAreCopiedIntoDist();
  await testMaintenance(tempDir);
  process.stdout.write('ops release regression tests passed\n');
} finally {
  await chmod(tempDir, 0o700).catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}
