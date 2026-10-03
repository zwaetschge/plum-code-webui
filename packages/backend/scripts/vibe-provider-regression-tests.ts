/**
 * Mistral Vibe provider regression tests.
 *
 * Vibe is the second persistent ACP harness next to Kimi Code, so its risk sits
 * in two opposite places: where it must differ from Kimi (ACP mode ids, thinking
 * levels, credential home, the separate Mistral allowance) and where it must not
 * (the spawn/queue/recovery plumbing that is keyed on `isAcpProvider`).
 *
 * Everything here runs offline. No `vibe-acp` child is started, no Mistral
 * endpoint is called, and credential fixtures live in a temporary VIBE_HOME with
 * keys that are obviously fake.
 *
 * Run: `pnpm --filter @plum-code-webui/backend run test:vibe-provider`
 * (registered as the `vibe provider` suite in scripts/run-regression-tests.mjs,
 * so `pnpm test` at the repository root runs it too). The ledger half needs
 * Postgres, like every other suite that uses src/db/testing.ts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTestSchema, dropTestSchema, useTestSchema } from '../src/db/testing.js';

// Pin the operator overrides before any provider module loads. `CLI_PROVIDERS`
// is built once at import time, so a deployment exporting `CLI_PROVIDER_VIBE_*`
// would otherwise change what these assertions see. An empty string counts as
// unset for `envOr`/`parseEnvModels`, which is exactly the built-in default.
process.env.CLI_PROVIDER_VIBE_COMMAND = '';
process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH = '';
process.env.CLI_PROVIDER_VIBE_DEFAULT_MODEL = '';
process.env.CLI_PROVIDER_VIBE_MODELS = '';

const {
  CLI_PROVIDERS,
  buildVibeEnv,
  getCLIArgs,
  getProviderCapabilities,
  isAcpProvider,
  isProviderAvailable,
  resolveVibeHome,
} = await import('../src/services/cli-providers.js');
const { normalizeReasoningLevel } = await import('../src/utils/reasoningLevel.js');
const {
  acpModeForSessionMode,
  acpProviderLabel,
  appliesModeOnNextTurnWithoutRestart,
  kimiAcpModeForSessionMode,
  shouldRecoverInterruptedKimiTurn,
} = await import('../src/services/claude/ClaudeProcessManager.js');
const { clearVibeApiKey, readVibeAuthState, writeVibeApiKey } =
  await import('../src/services/vibe/vibeAuth.js');

useTestSchema();
const { run: pgRun } = await import('../src/db/pg.js');
await createTestSchema();
const {
  MISTRAL_PRO_ALLOWANCES,
  buildMistralLimitResponse,
  getMistralPlanConfig,
  getVibePlanConfig,
  saveMistralPlanConfig,
  saveVibePlanConfig,
} = await import('../src/services/mistralPlanUsage.js');

/** Obviously fake: valid shape for the writer, useless as a credential. */
const FAKE_KEY = 'plum-test-fake-key-0001';
const OTHER_FAKE_KEY = 'plum-test-fake-key-0002';

/**
 * A throwaway VIBE_HOME plus the env override that points the code at it, so a
 * test never reads or writes the deployment's real `~/.vibe`.
 */
async function withTempVibeHome<T>(body: (home: string) => T | Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-vibe-home-'));
  const previous = process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH;
  process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH = home;
  try {
    return await body(home);
  } finally {
    if (previous === undefined) delete process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH;
    else process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Swap the inherited `MISTRAL_API_KEY` for a fake one and return the restore
 * function. The container exports a real key, so any assertion about "no key in
 * the environment" has to remove it first.
 */
function overrideProcessApiKey(value: string | undefined): () => void {
  const previous = process.env.MISTRAL_API_KEY;
  if (value === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = value;
  return () => {
    if (previous === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previous;
  };
}

function readEnvFile(home: string): string {
  return fs.readFileSync(path.join(home, '.env'), 'utf-8');
}

function envFileKeyLines(home: string): string[] {
  return readEnvFile(home)
    .split('\n')
    .filter((line) => /^\s*MISTRAL_API_KEY\s*=/.test(line));
}

function testAcpProviderClassification() {
  // Vibe shares Kimi's persistent stdio harness; the other five do not.
  assert.equal(isAcpProvider('vibe'), true);
  assert.equal(isAcpProvider('kimi'), true);
  for (const provider of ['codex', 'opencode', 'pi', 'claude', 'zai'] as const) {
    assert.equal(isAcpProvider(provider), false, `${provider} is not an ACP harness`);
  }
  assert.equal(isAcpProvider(null), false);
  assert.equal(isAcpProvider(undefined), false);

  // The plumbing keyed on isAcpProvider must treat Vibe like Kimi: mode changes
  // ride along on the next turn instead of respawning the child, and a stopped
  // session whose last message is a user turn is an interrupted ACP turn.
  assert.equal(appliesModeOnNextTurnWithoutRestart('vibe'), true);
  assert.equal(appliesModeOnNextTurnWithoutRestart('kimi'), true);
  assert.equal(appliesModeOnNextTurnWithoutRestart('opencode'), false);
  assert.equal(shouldRecoverInterruptedKimiTurn('vibe', 'stopped', 'user'), true);
  assert.equal(shouldRecoverInterruptedKimiTurn('vibe', 'stopped', 'assistant'), false);
  assert.equal(shouldRecoverInterruptedKimiTurn('vibe', 'running', 'user'), false);

  assert.equal(acpProviderLabel('vibe'), 'Vibe');
  assert.equal(acpProviderLabel('kimi'), 'Kimi');
  assert.equal(acpProviderLabel(null), 'Kimi');
}

function testAcpModeMapping() {
  // Vibe's ACP agent advertises ask/accept-edits/plan/auto-approve.
  assert.equal(acpModeForSessionMode('vibe', 'planning'), 'plan');
  assert.equal(acpModeForSessionMode('vibe', 'danger'), 'auto-approve');
  assert.equal(acpModeForSessionMode('vibe', 'manual'), 'ask');
  assert.equal(acpModeForSessionMode('vibe', 'auto-accept'), 'accept-edits');

  // Kimi keeps its own vocabulary: sending Vibe's ids to Kimi (or the reverse)
  // makes the harness reject the session config option.
  assert.equal(acpModeForSessionMode('kimi', 'planning'), 'plan');
  assert.equal(acpModeForSessionMode('kimi', 'danger'), 'yolo');
  assert.equal(acpModeForSessionMode('kimi', 'manual'), 'default');
  assert.equal(acpModeForSessionMode('kimi', 'auto-accept'), 'auto');
  assert.deepEqual(
    (['planning', 'danger', 'manual', 'auto-accept'] as const).map((mode) =>
      kimiAcpModeForSessionMode(mode)
    ),
    ['plan', 'yolo', 'default', 'auto']
  );
}

function testVibeProviderConfig() {
  const vibe = CLI_PROVIDERS.vibe;
  assert.equal(vibe.id, 'vibe');
  assert.equal(vibe.name, 'Mistral Vibe');
  // ACP needs the dedicated `vibe-acp` entry point: the plain `vibe` binary is
  // the interactive TUI and `vibe-app-server` speaks a different protocol.
  // Depending on the image it resolves to an absolute path or stays bare.
  assert.equal(path.basename(vibe.command), 'vibe-acp');
  assert.equal(vibe.credentialsPath, '~/.vibe');
  assert.equal(vibe.supportsStreamJson, true);
  assert.equal(vibe.supportsResume, true);
  assert.equal(vibe.supportsModes, true);

  // One hosted model: the alias the plan's Vibe Code allowance pays for. Vibe's
  // second built-in entry (`local`, a llama.cpp server) is deliberately absent.
  const models = vibe.models ?? [];
  assert.equal(vibe.defaultModel, 'mistral-medium-3.5');
  assert.ok(models.includes('mistral-medium-3.5'), 'the default model must be selectable');
  assert.equal(models.includes('local'), false);
  for (const model of models) {
    assert.match(
      model,
      /^mistral[-/]/,
      `Vibe only serves Mistral ids; ${model} looks like another provider's catalog`
    );
  }

  const capabilities = getProviderCapabilities('vibe');
  assert.equal(capabilities, vibe.capabilities);
  assert.equal(capabilities.usageLimits, 'local-budget');
  assert.equal(capabilities.reasoning, true);
  assert.equal(capabilities.serviceTier, false);
  // A persistent ACP child streams, resumes natively, honors Plum modes and
  // asks for permission through the client.
  assert.equal(capabilities.streaming, true);
  assert.equal(capabilities.resume, true);
  assert.equal(capabilities.modes, true);
  assert.equal(capabilities.approvals, true);

  // `vibe-acp` takes no arguments: model, mode and thinking are ACP session
  // config options applied after the session opens.
  assert.deepEqual(getCLIArgs('vibe', {}), []);
  assert.deepEqual(
    getCLIArgs('vibe', {
      model: 'mistral-medium-3.5',
      mode: 'danger',
      reasoningLevel: 'high',
      resumeSessionId: 'session_native-vibe-id',
      allowedDirectories: ['/workspace/plum'],
    }),
    []
  );
}

function testResolveVibeHomeHonorsOverrides() {
  assert.equal(resolveVibeHome(), path.join(os.homedir(), '.vibe'));

  const previousHome = process.env.VIBE_HOME;
  try {
    process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH = '/tmp/plum-vibe-credentials';
    assert.equal(resolveVibeHome(), '/tmp/plum-vibe-credentials');

    // The provider override wins over a plain VIBE_HOME, which is what lets an
    // operator keep Vibe's state on the config mount.
    process.env.VIBE_HOME = '/tmp/plum-vibe-home';
    assert.equal(resolveVibeHome(), '/tmp/plum-vibe-credentials');

    process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH = '';
    assert.equal(resolveVibeHome(), '/tmp/plum-vibe-home');
  } finally {
    process.env.CLI_PROVIDER_VIBE_CREDENTIALS_PATH = '';
    if (previousHome === undefined) delete process.env.VIBE_HOME;
    else process.env.VIBE_HOME = previousHome;
  }
}

async function testBuildVibeEnvIsolatesTheSignedInKey() {
  const restoreInherited = overrideProcessApiKey('inherited-fake-container-key');
  try {
    // No Vibe home yet (fresh install): keep whatever the deployment provides.
    const missing = await withTempVibeHome(() => buildVibeEnv());
    assert.equal(missing.VIBE_TEST_DISABLE_KEYRING, '1');
    assert.equal(
      Object.hasOwn(missing, 'MISTRAL_API_KEY'),
      false,
      'without a Vibe `.env` the inherited key must survive'
    );

    // A `.env` that carries other settings but no key is still "not signed in".
    const withoutKey = await withTempVibeHome((home) => {
      fs.writeFileSync(path.join(home, '.env'), 'VIBE_THEME=dark\n', 'utf-8');
      return buildVibeEnv();
    });
    assert.equal(Object.hasOwn(withoutKey, 'MISTRAL_API_KEY'), false);

    // Signed in: the inherited container key (which draws on the small API
    // allowance) must not shadow the plan key Vibe persisted itself.
    const withKey = await withTempVibeHome((home) => {
      fs.writeFileSync(path.join(home, '.env'), `MISTRAL_API_KEY=${FAKE_KEY}\n`, 'utf-8');
      return buildVibeEnv();
    });
    assert.equal(Object.hasOwn(withKey, 'MISTRAL_API_KEY'), true);
    assert.equal(withKey.MISTRAL_API_KEY, undefined);
    // This is the spread the spawn uses; Node drops undefined values, so the
    // child ends up with Vibe's own `.env` as the only key source.
    assert.equal(
      ({ ...process.env, ...withKey } as Record<string, string | undefined>).MISTRAL_API_KEY,
      undefined
    );

    // Quoted and indented forms are what `vibe --setup` and hand-edited files
    // produce; both count as signed in.
    for (const line of [`MISTRAL_API_KEY="${FAKE_KEY}"`, `  MISTRAL_API_KEY = ${FAKE_KEY}`]) {
      const quoted = await withTempVibeHome((home) => {
        fs.writeFileSync(path.join(home, '.env'), `${line}\n`, 'utf-8');
        return buildVibeEnv();
      });
      assert.equal(quoted.MISTRAL_API_KEY, undefined, `unhandled .env form: ${line}`);
    }
  } finally {
    restoreInherited();
  }
}

async function testVibeEnvPointsAtResolvedHome() {
  const home = await withTempVibeHome((tempHome) => {
    const env = buildVibeEnv();
    assert.equal(env.VIBE_HOME, resolveVibeHome());
    assert.equal(env.VIBE_HOME, tempHome);
    return tempHome;
  });
  assert.equal(fs.existsSync(home), false, 'the temporary VIBE_HOME must be cleaned up');
}

async function testVibeSignInDetection() {
  const restoreNoKey = overrideProcessApiKey(undefined);
  try {
    // Nothing anywhere: not signed in, and the status panel says so.
    await withTempVibeHome(async (home) => {
      assert.equal(await isProviderAvailableWithHome(home), false);
      const state = readVibeAuthState();
      assert.equal(state.authenticated, false);
      assert.equal(state.source, 'none');
      assert.equal(state.home, home);
    });

    // A key Vibe persisted itself.
    await withTempVibeHome(async (home) => {
      writeVibeApiKey(FAKE_KEY);
      assert.equal(await isProviderAvailableWithHome(home), true);
      const state = readVibeAuthState();
      assert.equal(state.authenticated, true);
      assert.equal(state.source, 'dot-env');
    });
  } finally {
    restoreNoKey();
  }

  // A key only in the process environment (the deployment's console key) also
  // counts, because Vibe itself accepts it and reports `authState: process_env`.
  const restoreInherited = overrideProcessApiKey('inherited-fake-container-key');
  try {
    await withTempVibeHome(async (home) => {
      assert.equal(await isProviderAvailableWithHome(home), true);
      const state = readVibeAuthState();
      assert.equal(state.authenticated, true);
      assert.equal(state.source, 'process-env');
    });
  } finally {
    restoreInherited();
  }
}

/**
 * `isProviderAvailable` reads `CLI_PROVIDERS.vibe.credentialsPath` (resolved at
 * import), not `resolveVibeHome()`, so a runtime env override cannot redirect
 * it. Swap the field the way the provider suite swaps Codex's, and restore it.
 */
async function isProviderAvailableWithHome(home: string): Promise<boolean> {
  const original = CLI_PROVIDERS.vibe.credentialsPath;
  CLI_PROVIDERS.vibe.credentialsPath = home;
  try {
    return await isProviderAvailable('vibe');
  } finally {
    CLI_PROVIDERS.vibe.credentialsPath = original;
  }
}

function testVibeReasoningLevels() {
  // Vibe calls it "Thinking" and offers off/low/medium/high/max.
  for (const level of ['off', 'low', 'medium', 'high', 'max']) {
    assert.equal(normalizeReasoningLevel('vibe', level), level);
  }
  // The picker sends trimmed uppercase values; normalization is shared.
  assert.equal(normalizeReasoningLevel('vibe', ' Max '), 'max');
  assert.equal(normalizeReasoningLevel('vibe', 'OFF'), 'off');

  // Ultracode is Plum's workflow server on top of `high` thinking.
  assert.equal(normalizeReasoningLevel('vibe', 'ultracode'), 'ultracode');

  // Levels from the other harnesses must be rejected rather than silently
  // mapped: Codex's ultra/xhigh/minimal and Kimi's minimal are not Vibe modes,
  // and Vibe has no `none`/`ultrathink`/`extra_high`.
  for (const level of ['ultra', 'xhigh', 'minimal', 'none', 'ultrathink', 'extra_high', '']) {
    assert.equal(normalizeReasoningLevel('vibe', level), null, `vibe must reject ${level || "''"}`);
  }
  assert.equal(normalizeReasoningLevel('vibe', null), null);
  assert.equal(normalizeReasoningLevel('vibe', 5), null);

  // The neighbouring providers keep their own sets: Kimi has no off/max, Codex
  // still accepts ultra.
  assert.equal(normalizeReasoningLevel('kimi', 'max'), null);
  assert.equal(normalizeReasoningLevel('kimi', 'off'), null);
  assert.equal(normalizeReasoningLevel('kimi', 'minimal'), 'minimal');
  assert.equal(normalizeReasoningLevel('codex', 'ultra'), 'ultra');
  assert.equal(normalizeReasoningLevel('codex', 'off'), null);
  assert.equal(normalizeReasoningLevel('codex', 'none'), 'none');
}

async function testVibeApiKeyFileHandling() {
  await withTempVibeHome((home) => {
    const file = path.join(home, '.env');

    // Injection and typo guards: the value lands verbatim in a dotenv file.
    for (const invalid of [
      `${FAKE_KEY}\nMISTRAL_API_KEY=second`,
      'plum test fake key 0001',
      'short',
      '',
      '   ',
      `${FAKE_KEY} # comment`,
    ]) {
      assert.throws(
        () => writeVibeApiKey(invalid),
        /Mistral API key/,
        `must reject ${JSON.stringify(invalid)}`
      );
      assert.equal(fs.existsSync(file), false, 'a rejected key must not create .env');
    }

    // A valid key is written the way `vibe --setup` writes it, readable only by
    // the CLI user.
    writeVibeApiKey(FAKE_KEY);
    assert.equal(readEnvFile(home), `MISTRAL_API_KEY=${FAKE_KEY}\n`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    // Rewriting replaces the line instead of appending a second one — Vibe reads
    // the last match, so a duplicate would silently keep the old key.
    writeVibeApiKey(OTHER_FAKE_KEY);
    assert.deepEqual(envFileKeyLines(home), [`MISTRAL_API_KEY=${OTHER_FAKE_KEY}`]);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);

    // Unrelated settings (Vibe's own theme, trusted folders) survive both writes.
    fs.writeFileSync(file, `# plum fixture\nMISTRAL_API_KEY=${OTHER_FAKE_KEY}\nVIBE_THEME=dark\n`);
    writeVibeApiKey(FAKE_KEY);
    assert.equal(
      readEnvFile(home),
      `# plum fixture\nMISTRAL_API_KEY=${FAKE_KEY}\nVIBE_THEME=dark\n`,
      'an existing key is replaced in place, other lines stay untouched'
    );

    assert.equal(clearVibeApiKey(), true);
    assert.deepEqual(envFileKeyLines(home), []);
    assert.match(readEnvFile(home), /VIBE_THEME=dark/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    // Signing out twice is a no-op, not an error.
    assert.equal(clearVibeApiKey(), false);
  });

  // No Vibe home at all: nothing to clear.
  await withTempVibeHome(() => {
    assert.equal(clearVibeApiKey(), false);
  });

  // A key that only exists in a `.env` Vibe wrote itself, with other content
  // around it and no trailing newline.
  await withTempVibeHome((home) => {
    fs.writeFileSync(
      path.join(home, '.env'),
      `VIBE_THEME=dark\nMISTRAL_API_KEY=${FAKE_KEY}`,
      'utf-8'
    );
    assert.equal(clearVibeApiKey(), true);
    assert.deepEqual(envFileKeyLines(home), []);
    assert.match(readEnvFile(home), /VIBE_THEME=dark/);
  });
}

const VIBE_USER = 'vibe-ledger-user';
const OTHER_USER = 'vibe-ledger-other';

async function insertUsageRow(row: {
  turnId: string;
  userId: string;
  sessionId: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  createdAt: string;
}): Promise<void> {
  // `usage_history.id` is BIGSERIAL: insert the turn id, never the id. The
  // unique index is (session_id, provider, turn_id), so turn ids repeat only
  // across sessions or providers.
  await pgRun(
    `INSERT INTO usage_history (turn_id, user_id, session_id, provider, model, input_tokens,
       output_tokens, cache_read_tokens, cache_creation_tokens, total_tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)`,
    row.turnId,
    row.userId,
    row.sessionId,
    row.provider,
    row.model,
    row.input,
    row.output,
    row.input + row.output,
    row.createdAt
  );
}

async function testMistralAllowanceSplit() {
  assert.deepEqual(MISTRAL_PRO_ALLOWANCES, { api: 25.5, vibe: 255 });

  for (const id of [VIBE_USER, OTHER_USER]) {
    await pgRun(
      `INSERT INTO users (id, email, name, provider, provider_id)
       VALUES (?, ?, ?, 'local', ?)`,
      id,
      `${id}@example.test`,
      id,
      id
    );
  }
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider, status)
     VALUES ('vibe-ledger-pi', ?, 'pi', '/tmp', 'pi', 'stopped')`,
    VIBE_USER
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider, status)
     VALUES ('vibe-ledger-vibe', ?, 'vibe', '/tmp', 'vibe', 'stopped')`,
    VIBE_USER
  );
  await pgRun(
    `INSERT INTO sessions (id, user_id, name, working_directory, cli_provider, status)
     VALUES ('vibe-ledger-other', ?, 'vibe', '/tmp', 'vibe', 'stopped')`,
    OTHER_USER
  );

  const now = new Date();
  const inWindow = now.toISOString().slice(0, 19).replace('T', ' ');
  // Far outside any billing month, so the window filter is what excludes it.
  const outOfWindow = '2020-01-15 00:00:00';

  // API/Studio allowance: `mistral/*` traffic routed through Pi/OpenCode.
  // Devstral 2 list price is $0.40 in / $2 out per 1M tokens.
  await insertUsageRow({
    turnId: 'api-1',
    userId: VIBE_USER,
    sessionId: 'vibe-ledger-pi',
    provider: 'pi',
    model: 'mistral/devstral-latest',
    input: 1_000_000,
    output: 500_000,
    createdAt: inWindow,
  });
  await insertUsageRow({
    turnId: 'api-2',
    userId: VIBE_USER,
    sessionId: 'vibe-ledger-pi',
    provider: 'pi',
    model: 'mistral/devstral-latest',
    input: 200_000,
    output: 100_000,
    createdAt: inWindow,
  });
  // Vibe Code allowance: booked with provider 'vibe'.
  // Mistral Medium 3.5 list price is $1.50 in / $7.50 out per 1M tokens.
  await insertUsageRow({
    turnId: 'vibe-1',
    userId: VIBE_USER,
    sessionId: 'vibe-ledger-vibe',
    provider: 'vibe',
    model: 'mistral-medium-3.5',
    input: 1_000_000,
    output: 200_000,
    createdAt: inWindow,
  });
  await insertUsageRow({
    turnId: 'vibe-2',
    userId: VIBE_USER,
    sessionId: 'vibe-ledger-vibe',
    provider: 'vibe',
    model: 'mistral-medium-3.5',
    input: 200_000,
    output: 40_000,
    createdAt: inWindow,
  });
  // Attribution beats the model prefix: a `mistral/*` id booked by the Vibe
  // harness still draws on the Vibe allowance, not the API one.
  await insertUsageRow({
    turnId: 'vibe-3',
    userId: VIBE_USER,
    sessionId: 'vibe-ledger-vibe',
    provider: 'vibe',
    model: 'mistral/devstral-latest',
    input: 100_000,
    output: 50_000,
    createdAt: inWindow,
  });
  // Neither allowance: a different vendor, and a different month.
  await insertUsageRow({
    turnId: 'ignored-glm',
    userId: VIBE_USER,
    sessionId: 'vibe-ledger-pi',
    provider: 'pi',
    model: 'z-ai/glm-5.1',
    input: 9_000_000,
    output: 9_000_000,
    createdAt: inWindow,
  });
  await insertUsageRow({
    turnId: 'ignored-old',
    userId: VIBE_USER,
    sessionId: 'vibe-ledger-vibe',
    provider: 'vibe',
    model: 'mistral-medium-3.5',
    input: 7_000_000,
    output: 7_000_000,
    createdAt: outOfWindow,
  });
  // Another user's Vibe turn must not leak into this ledger.
  await insertUsageRow({
    turnId: 'other-user',
    userId: OTHER_USER,
    sessionId: 'vibe-ledger-other',
    provider: 'vibe',
    model: 'mistral-medium-3.5',
    input: 5_000_000,
    output: 5_000_000,
    createdAt: inWindow,
  });

  // --- API allowance view -------------------------------------------------
  const api = await buildMistralLimitResponse(VIBE_USER, 'api');
  assert.equal(api.supported, true);
  assert.equal(api.provider, 'mistral');
  assert.equal(api.data?.planUsage.requests, 2, 'only mistral/* rows outside Vibe count');
  assert.equal(api.data?.planUsage.tokens, 1_800_000);
  // 1M in × $0.40 + 0.5M out × $2 = $1.40; 0.2M × $0.40 + 0.1M × $2 = $0.28.
  assert.equal(api.data?.planUsage.spend, 1.68);
  assert.equal(api.data?.planUsage.allowance, 'api');
  assert.equal(api.data?.planUsage.budget, null);
  assert.equal(api.data?.sevenDay, null);
  assert.equal(api.error?.code, 'NO_BUDGET');

  // --- Vibe allowance view, no budget saved yet ---------------------------
  const vibeDefault = await buildMistralLimitResponse(VIBE_USER, 'vibe');
  assert.equal(vibeDefault.supported, true);
  assert.equal(vibeDefault.provider, 'vibe');
  assert.equal(vibeDefault.data?.planUsage.allowance, 'vibe');
  assert.equal(vibeDefault.data?.planUsage.requests, 3, "only provider 'vibe' rows count");
  assert.equal(vibeDefault.data?.planUsage.tokens, 1_590_000);
  // $3.00 + $0.60 for the two Medium 3.5 turns, $0.14 for the Devstral turn.
  assert.equal(vibeDefault.data?.planUsage.spend, 3.74);
  // The Vibe side defaults to the published Pro allowance so a fresh session
  // shows a percentage without a settings detour.
  assert.equal(vibeDefault.data?.planUsage.budget, 255);
  assert.equal(vibeDefault.data?.planUsage.currency, 'EUR');
  assert.equal(vibeDefault.data?.subscriptionType, 'Vibe Code allowance');
  assert.equal(vibeDefault.data?.source, 'local-estimate');
  assert.equal(vibeDefault.data?.sevenDay?.limit, 255);
  assert.equal(vibeDefault.data?.sevenDay?.unit, 'eur');
  assert.equal(vibeDefault.data?.sevenDay?.used, 3.74);
  assert.equal(vibeDefault.data?.sevenDay?.remaining, 251.26);
  // Whole percent: the Android client decodes utilization as an Int.
  assert.equal(vibeDefault.data?.sevenDay?.utilization, 1);
  assert.ok(Number.isInteger(vibeDefault.data?.sevenDay?.utilization));
  assert.equal(vibeDefault.error, undefined, 'a default budget means no NO_BUDGET error');

  const vibeConfig = await getVibePlanConfig(VIBE_USER);
  assert.equal(vibeConfig.allowance, 'vibe');
  assert.equal(vibeConfig.monthlyBudget, 255);
  const apiConfig = await getMistralPlanConfig(VIBE_USER);
  assert.equal(apiConfig.allowance, 'api');
  assert.equal(apiConfig.monthlyBudget, null);

  // --- Budgets stay on their own side -------------------------------------
  await saveMistralPlanConfig(VIBE_USER, {
    monthlyBudget: 10,
    currency: 'EUR',
    billingDay: 1,
    allowance: 'api',
  });
  const apiBudgeted = await buildMistralLimitResponse(VIBE_USER, 'api');
  assert.equal(apiBudgeted.data?.sevenDay?.limit, 10);
  assert.equal(apiBudgeted.data?.sevenDay?.utilization, 17, '1.68 of 10 EUR');
  assert.equal(apiBudgeted.error, undefined);
  assert.equal(
    (await buildMistralLimitResponse(VIBE_USER, 'vibe')).data?.sevenDay?.limit,
    255,
    'an API budget must not touch the Vibe allowance'
  );

  await saveVibePlanConfig(VIBE_USER, { monthlyBudget: 100, currency: 'EUR', billingDay: 1 });
  const vibeBudgeted = await buildMistralLimitResponse(VIBE_USER, 'vibe');
  assert.equal(vibeBudgeted.data?.planUsage.allowance, 'vibe');
  assert.equal(vibeBudgeted.data?.sevenDay?.limit, 100);
  assert.equal(vibeBudgeted.data?.sevenDay?.utilization, 4, '3.74 of 100 EUR');
  assert.equal(vibeBudgeted.data?.sevenDay?.remaining, 96.26);
  assert.equal(
    (await buildMistralLimitResponse(VIBE_USER, 'api')).data?.sevenDay?.limit,
    10,
    'a Vibe budget must not touch the API allowance'
  );

  // PUT /api/usage/plan/mistral still accepts allowance:'vibe' and routes the
  // budget to the Vibe side, leaving the API budget alone.
  await saveMistralPlanConfig(VIBE_USER, {
    monthlyBudget: 50,
    currency: 'EUR',
    billingDay: 1,
    allowance: 'vibe',
  });
  assert.equal((await getVibePlanConfig(VIBE_USER)).monthlyBudget, 50);
  assert.equal((await getMistralPlanConfig(VIBE_USER)).monthlyBudget, 10);
  assert.equal((await getMistralPlanConfig(VIBE_USER)).allowance, 'api');
  assert.equal(
    (await buildMistralLimitResponse(VIBE_USER, 'vibe')).data?.sevenDay?.utilization,
    7,
    '3.74 of 50 EUR'
  );

  // The default argument is the API view: existing callers must not silently
  // start reading the Vibe ledger.
  const implicit = await buildMistralLimitResponse(VIBE_USER);
  assert.equal(implicit.provider, 'mistral');
  assert.equal(implicit.data?.planUsage.allowance, 'api');
  assert.equal(implicit.data?.planUsage.requests, 2);
}

// ---------------------------------------------------------------- ACP stream translation
// Payloads below are copied from a real vibe-acp 2.25 session.

async function testVibeAcpTranslation() {
  const acp = await import('../src/services/vibe/vibeAcp.js');

  // The bare name comes with tool_call; prose titles must not become names.
  assert.equal(acp.vibeToolKey({ title: 'read_file' }), 'read_file');
  assert.equal(acp.vibeToolKey({ title: 'Reading calc.py' }), null);
  assert.equal(acp.vibeToolKey({ title: 'x', _meta: { tool_name: 'bash' } }), 'bash');
  assert.equal(acp.vibeToolName('bash'), 'Bash');
  assert.equal(acp.vibeToolName('read_file'), 'Read');
  assert.equal(acp.vibeToolName('edit'), 'Edit');
  assert.equal(acp.vibeToolName('todo'), 'TodoWrite');
  assert.equal(acp.vibeToolName('task'), 'Task');
  assert.equal(
    acp.vibeToolName('firefox_tab_open'),
    'firefox_tab_open',
    'MCP tools keep their name'
  );

  // Claude-style keys light up the existing Read/Edit cards.
  assert.deepEqual(
    acp.normalizeVibeInput('Edit', {
      filePath: '/p/calc.py',
      oldString: 'a - b',
      newString: 'a + b',
      replaceAll: false,
    }),
    { file_path: '/p/calc.py', old_string: 'a - b', new_string: 'a + b', replace_all: false }
  );
  assert.deepEqual(acp.normalizeVibeInput('Task', { task: 'Find the config', agent: 'explore' }), {
    description: 'Find the config',
    prompt: 'Find the config',
    subagent_type: 'explore',
  });

  // Readable results instead of JSON objects.
  assert.equal(
    acp.vibeToolResult('Bash', { rawOutput: { stdout: '5\n', stderr: '', output: '' } }),
    '5\n'
  );
  assert.match(
    acp.vibeToolResult('Edit', {
      rawOutput: { file: '/p/calc.py' },
      content: [
        { type: 'diff', path: '/p/calc.py', oldText: 'return a - b', newText: 'return a + b' },
      ],
    }),
    /- return a - b\n\+ return a \+ b/
  );
  assert.equal(
    acp.vibeToolResult('Read', { rawOutput: { message: 'read_file failed: File not found' } }),
    'read_file failed: File not found'
  );

  assert.equal(
    acp.vibeToolResult('firefox_status', {
      rawOutput: { ok: true, server: 'firefox', tool: 'status', text: '{"connected": true}' },
      content: [{ type: 'content', content: { type: 'text', text: 'Ran status' } }],
    }),
    '{"connected": true}',
    'MCP result text, not the "Ran …" label'
  );

  // plan entries → todos, cancelled counts as done.
  assert.deepEqual(
    acp.vibeTodos([
      { content: 'calc.py lesen', priority: 'high', status: 'completed' },
      { content: 'Fehler beheben', priority: 'high', status: 'in_progress' },
      { content: 'Abgebrochen', status: 'cancelled' },
      { content: '', status: 'pending' },
    ]),
    [
      { content: 'calc.py lesen', status: 'completed' },
      { content: 'Fehler beheben', status: 'in_progress' },
      { content: 'Abgebrochen', status: 'completed' },
    ]
  );
  assert.equal(acp.isVibeCompaction('Compacting conversation history...'), true);

  // Running totals → per-turn usage; a reset after resume counts from zero.
  assert.deepEqual(
    acp.vibeTurnUsage(
      { prompt: 300_000, completion: 900, cached: 250_000 },
      { prompt: 260_000, completion: 700, cached: 220_000 }
    ),
    { prompt: 40_000, completion: 200, cached: 30_000 }
  );
  assert.deepEqual(
    acp.vibeTurnUsage(
      { prompt: 1000, completion: 10, cached: 0 },
      { prompt: 5000, completion: 50, cached: 0 }
    ),
    { prompt: 1000, completion: 10, cached: 0 }
  );

  // ask_user_question form ↔ Plum question card.
  const request = {
    sessionId: 's',
    mode: 'form',
    message: 'User input required',
    requestedSchema: {
      type: 'object',
      properties: {
        q0: {
          type: 'string',
          title: 'Format',
          description: 'Welches Format?',
          oneOf: [
            { const: 'PNG', title: 'PNG' },
            { const: 'JPG', title: 'JPG' },
          ],
        },
        q1: {
          type: 'array',
          title: 'Teile',
          description: 'Was exportieren?',
          items: {
            anyOf: [
              { const: 'A', title: 'A' },
              { const: 'B', title: 'B' },
            ],
          },
        },
      },
      required: ['q0', 'q1'],
    },
  } as unknown as Parameters<typeof acp.vibeElicitationQuestions>[0];
  const { keys, questions } = acp.vibeElicitationQuestions(request);
  assert.deepEqual(keys, ['q0', 'q1']);
  assert.equal(questions[0]!.question, 'Welches Format?');
  assert.deepEqual(
    questions[0]!.options.map((option) => option.label),
    ['PNG', 'JPG']
  );
  assert.equal(questions[1]!.multiple, true);
  assert.deepEqual(acp.vibeElicitationContent(keys, questions, [['JPG'], ['A', 'B']]), {
    q0: 'JPG',
    q1: ['A', 'B'],
  });
  assert.equal(acp.vibeElicitationContent(keys, questions, [['JPG'], []]), null);
}

async function testVibeMcpServersCarryTheSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-mcp-'));
  const previous = process.env.WEBUI_CONFIG_HOME;
  process.env.WEBUI_CONFIG_HOME = dir;
  try {
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        mcpServers: {
          firefox: { command: 'node', args: ['/app/scripts/mcp-servers/firefox.mjs'] },
          comfy: {
            type: 'stdio',
            command: 'node',
            args: ['c.mjs'],
            env: { COMFYUI_TIMEOUT_SECONDS: '60' },
          },
          remote: {
            type: 'http',
            url: 'https://mcp.example/x',
            headers: { Authorization: 'Bearer t' },
          },
          off: { command: 'node', disabled: true },
        },
      })
    );
    const acp = await import('../src/services/vibe/vibeAcp.js');
    {
      const servers = acp.buildVibeMcpServers('SESSION1', { WEBUI_HOOK_SECRET: 'h' });
      assert.deepEqual(
        servers.map((server) => server.name),
        ['firefox', 'comfy', 'remote']
      );
      const firefox = servers[0] as { env: Array<{ name: string; value: string }> };
      const env = Object.fromEntries(firefox.env.map((entry) => [entry.name, entry.value]));
      assert.equal(env.WEBUI_SESSION_ID, 'SESSION1');
      assert.equal(env.WEBUI_HOOK_SECRET, 'h');
      const comfy = servers[1] as { env: Array<{ name: string; value: string }> };
      assert.ok(comfy.env.some((entry) => entry.name === 'COMFYUI_TIMEOUT_SECONDS'));
      assert.equal((servers[2] as { type?: string }).type, 'http');
    }
  } finally {
    if (previous === undefined) delete process.env.WEBUI_CONFIG_HOME;
    else process.env.WEBUI_CONFIG_HOME = previous;
  }
}

/**
 * Vibe Ultracode: the server is registered through VIBE_MCP_SERVERS with a long
 * tool timeout, and its workflow tool runs agents as `vibe -p` children. A fake
 * `vibe` stands in for the CLI, so this costs no tokens: it answers with the
 * prompt's first line, or JSON when a schema is asked for, writes a meta.json
 * like Vibe does, and the run reports its agents and usage to a fake backend.
 */
async function testVibeUltracodeWorkflow() {
  const { buildVibeUltracodeEnv, isVibeUltracodeTool, resolveVibeUltracodeScript } =
    await import('../src/services/vibe/vibeAcp.js');
  assert.ok(isVibeUltracodeTool('ultracode_workflow'));
  assert.ok(!isVibeUltracodeTool('workflow'));
  const script = resolveVibeUltracodeScript();
  assert.ok(script, 'vibe-ultracode.mjs must be found');

  await withTempVibeHome(async (home) => {
    const built = buildVibeUltracodeEnv({
      sessionId: 'sess-uc',
      model: 'devstral-2',
      vibeEnv: { VIBE_HOME: home, VIBE_TEST_DISABLE_KEYRING: '1', MISTRAL_API_KEY: undefined },
      extraEnv: { WEBUI_SESSION_MODE: 'danger' },
    });
    const [server] = JSON.parse(built.VIBE_MCP_SERVERS!) as Array<Record<string, any>>;
    assert.equal(server!.name, 'ultracode');
    assert.ok(server!.tool_timeout_sec >= 3600, 'workflows outlive the 60 s default');
    assert.equal(server!.env.WEBUI_SESSION_ID, 'sess-uc');
    assert.equal(server!.env.VIBE_ULTRACODE_MODEL, 'devstral-2');
    assert.equal(server!.env.VIBE_HOME, home);
    assert.ok(!('MISTRAL_API_KEY' in server!.env), 'a signed-in Vibe key is never shadowed');

    const { spawn } = await import('node:child_process');
    const http = await import('node:http');
    const fakeVibe = path.join(home, 'fake-vibe.mjs');
    fs.writeFileSync(
      fakeVibe,
      `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1];
const id = 'abcdef12-0000-0000-0000-' + String(Math.random()).slice(2, 14);
const dir = path.join(process.env.VIBE_HOME, 'logs', 'session', 'session_20261002_000000_' + id.slice(0, 8));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ stats: { session_prompt_tokens: 100, session_completion_tokens: 10, session_cached_tokens: 40, session_cost: 0.01 } }));
fs.appendFileSync(path.join(process.env.VIBE_HOME, 'calls.log'), JSON.stringify({ args, model: process.env.VIBE_ACTIVE_MODEL, servers: process.env.VIBE_MCP_SERVERS ?? null }) + '\\n');
const line = (o) => process.stdout.write(JSON.stringify({ sessionId: id, ...o }) + '\\n');
line({ type: 'effect', title: 'bash', detail: { display: { summary: 'bash: ls' } } });
await new Promise((resolve) => setTimeout(resolve, 1200));
const text = prompt.includes('JSON Schema') ? '\\u0060\\u0060\\u0060json\\n{"n": ' + prompt.length + '}\\n\\u0060\\u0060\\u0060' : 'echo ' + prompt.split('\\n')[0];
line({ type: 'message', role: 'assistant', content: [{ type: 'text', text }] });
`,
      { mode: 0o755 }
    );

    const reports: Array<Record<string, any>> = [];
    const backend = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        assert.equal(req.url, '/api/ultracode/internal/progress');
        assert.equal(req.headers['x-webui-hook-secret'], 'hook-test');
        assert.equal(req.headers['x-webui-session-id'], 'sess-uc');
        reports.push(JSON.parse(body));
        res.end('{"success":true}');
      });
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const port = (backend.address() as { port: number }).port;

    const child = spawn(process.execPath, [script!], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: home,
        ...server!.env,
        VIBE_BIN: fakeVibe,
        WEBUI_BACKEND_URL: `http://127.0.0.1:${port}`,
        WEBUI_HOOK_SECRET: 'hook-test',
        WEBUI_PROJECT_PATH: home,
      },
    });
    const responses = new Map<number, any>();
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const message = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        responses.set(message.id, message);
      }
    });
    const call = async (id: number, method: string, params: unknown) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      const deadline = Date.now() + 20_000;
      while (!responses.has(id) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
      assert.ok(responses.has(id), `no answer to ${method}`);
      return responses.get(id);
    };

    try {
      await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
      const listed = await call(2, 'tools/list', {});
      assert.equal(listed.result.tools[0].name, 'workflow');
      const workflow = `export const meta = { name: 'probe', phases: [{ title: 'Fan-out' }] }
phase('Fan-out')
const texts = await parallel(['alpha', 'beta'].map(w => () => agent('say ' + w, { label: w })))
const typed = await agent('count', { label: 'typed', schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }, model: 'mistral-small' })
return { texts, typed }`;
      const first = await call(3, 'tools/call', {
        name: 'workflow',
        arguments: { script: workflow },
      });
      const text = first.result.content[0].text as string;
      assert.equal(first.result.structuredContent, undefined, 'Vibe would hide the text');
      assert.match(text, /Workflow "probe" abgeschlossen/);
      assert.match(text, /"echo say alpha"/);
      assert.match(text, /"n": \d+/);
      const runId = /runId (wf_[a-z0-9]+)/.exec(text)![1]!;

      const calls = fs
        .readFileSync(path.join(home, 'calls.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(calls.length, 3);
      for (const entry of calls) {
        assert.equal(entry.servers, null, 'agents must not get the workflow server');
        assert.ok(entry.args.includes('--auto-approve') && entry.args.includes('--trust'));
        assert.equal(entry.args[entry.args.indexOf('--workdir') + 1], home);
      }
      assert.deepEqual(calls.map((entry) => entry.model).sort(), [
        'devstral-2',
        'devstral-2',
        'mistral-small',
      ]);

      const final = reports.at(-1)!;
      assert.deepEqual(final.usage, { input: 300, output: 30, cached: 120 });
      assert.equal(final.details.agents.length, 3);
      assert.ok(final.details.agents.every((agent: any) => agent.status === 'completed'));
      assert.ok(reports.some((r) => r.details.agents.some((a: any) => a.status === 'running')));

      // Resume: every unchanged agent() comes from the cache, no new process.
      const second = await call(4, 'tools/call', {
        name: 'workflow',
        arguments: { scriptPath: runId, resumeFromRunId: runId },
      });
      assert.match(second.result.content[0].text, /3 aus Cache/);
      assert.equal(
        fs.readFileSync(path.join(home, 'calls.log'), 'utf8').trim().split('\n').length,
        3
      );
      assert.deepEqual(reports.at(-1)!.usage, { input: 0, output: 0, cached: 0 });
    } finally {
      child.kill();
      backend.close();
    }
  });
}

// The schema lives in the shared database, so a failing assertion must not
// leave it behind: everything runs inside one try/finally.
try {
  testAcpProviderClassification();
  testAcpModeMapping();
  testVibeProviderConfig();
  testResolveVibeHomeHonorsOverrides();
  await testBuildVibeEnvIsolatesTheSignedInKey();
  await testVibeEnvPointsAtResolvedHome();
  testVibeReasoningLevels();
  await testVibeApiKeyFileHandling();
  await testVibeSignInDetection();
  await testMistralAllowanceSplit();
  await testVibeAcpTranslation();
  await testVibeMcpServersCarryTheSession();
  await testVibeUltracodeWorkflow();
} finally {
  await dropTestSchema();
}

console.log('vibe provider regression tests passed');
process.exit(0);
