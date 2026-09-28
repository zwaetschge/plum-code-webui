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

  // Levels from the other harnesses must be rejected rather than silently
  // mapped: Codex's ultra/xhigh/minimal and Kimi's minimal are not Vibe modes,
  // and Vibe has no `none`/`ultracode`/`extra_high`.
  for (const level of ['ultra', 'xhigh', 'minimal', 'none', 'ultracode', 'extra_high', '']) {
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
} finally {
  await dropTestSchema();
}

console.log('vibe provider regression tests passed');
process.exit(0);
