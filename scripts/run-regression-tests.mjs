import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export const REGRESSION_SUITES = [
  {
    // Unit tests, run by Node's built-in runner through tsx. Discovery is by
    // filename, so a new *.test.ts anywhere under the backend joins the suite
    // without touching this list.
    name: 'unit tests',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'node',
      '--import',
      'tsx',
      '--test',
      'src/**/*.test.ts',
    ],
  },
  {
    name: 'regression runner',
    command: 'node',
    args: ['scripts/regression-runner-tests.mjs'],
  },
  {
    name: 'android MCP device selection',
    command: 'node',
    args: ['scripts/android-builder-mcp-regression-tests.mjs'],
  },
  {
    name: 'providers',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:providers'],
  },
  {
    name: 'chat media',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:chat-media'],
  },
  {
    name: 'runtime analytics',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:runtime-analytics'],
  },
  {
    name: 'analytics formatting',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/analytics-format-tests.ts',
    ],
  },
  {
    name: 'security boundaries',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:security-boundaries'],
  },
  {
    name: 'session store',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:session-store'],
  },
  {
    name: 'websocket authorization',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:websocket-auth'],
  },
  {
    name: 'runner access',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:runner-access'],
  },
  {
    name: 'managed process lifecycle',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:process-lifecycle'],
  },
  {
    name: 'session icon thumbnails',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:session-icon-thumbnails'],
  },
  {
    name: 'opencode isolation',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:opencode-isolation'],
  },
  {
    name: 'operations and rollback',
    command: 'node',
    args: ['scripts/ops-release-regression-tests.mjs'],
  },
  {
    name: 'readiness',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:readiness'],
  },
  {
    name: 'migration dry-run',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:migrations'],
  },
  {
    name: 'codex usage cache',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:codex-usage-cache'],
  },
  {
    name: 'design.md',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:design-md'],
  },
  {
    name: 'style previews',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:style-previews'],
  },
  {
    name: 'managed skills',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:managed-skills'],
  },
  {
    name: 'lean skill catalog',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:lean-skills'],
  },
  {
    name: 'skill catalog optimization',
    command: 'node',
    args: ['scripts/skill-catalog-optimization-tests.mjs'],
  },
  {
    name: 'project instructions',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:project-instructions'],
  },
  {
    name: 'android emulator',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:android-emulator'],
  },
  {
    name: 'home assistant status',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:home-assistant'],
  },
  {
    name: 'docker',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      'scripts/docker-regression-tests.ts',
    ],
  },
  {
    name: 'appearance themes',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/appearance-theme-tests.ts',
    ],
  },
  {
    name: 'ambient motion',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/ambient-motion-tests.ts',
    ],
  },
  {
    name: 'chat timeline',
    command: 'node',
    args: ['scripts/chat-timeline-tests.mjs'],
  },
  {
    name: 'operations view state',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/operations-view-state-tests.ts',
    ],
  },
  {
    name: 'session list polling',
    command: 'node',
    args: ['packages/frontend/scripts/session-list-polling-tests.mjs'],
  },
  {
    name: 'progressive extension lists',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/progressive-list-tests.ts',
    ],
  },
  {
    name: 'capability catalog view',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/capability-catalog-view-tests.ts',
    ],
  },
  {
    name: 'task workbench',
    command: 'pnpm',
    args: [
      '--filter',
      '@plum-code-webui/backend',
      'exec',
      'tsx',
      '../frontend/scripts/task-workbench-tests.ts',
    ],
  },
  {
    name: 'usage limit history',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:usage-limit-history'],
  },
  {
    name: 'websocket send ack',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:websocket-send-ack'],
  },
  {
    name: 'durable chat',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:durable-chat'],
  },
  {
    name: 'cli login',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:cli-login'],
  },
  {
    name: 'claude oauth refresh',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:claude-oauth-refresh'],
  },
  {
    name: 'message pagination',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:message-pagination'],
  },
  {
    name: 'analytics settings',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/backend', 'run', 'test:analytics-settings'],
  },
  {
    name: 'pi settings tab',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/frontend', 'run', 'test:pi-settings'],
  },
  {
    name: 'recent sessions limit',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/frontend', 'run', 'test:recent-sessions'],
  },
  {
    name: 'chat delivery',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/frontend', 'run', 'test:chat-delivery'],
  },
  {
    name: 'dashboard ux',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/frontend', 'run', 'test:dashboard-ux'],
  },
  {
    name: 'message history',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/frontend', 'run', 'test:message-history'],
  },
  {
    name: 'web ux',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/frontend', 'run', 'test:web-ux'],
  },
  {
    name: 'analytics model breakdown',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/frontend', 'run', 'test:analytics-model-breakdown'],
  },
];

function resolveCommand(suite) {
  if (suite.command === 'node') {
    return { command: process.execPath, args: suite.args };
  }

  const pnpmExec = process.env.npm_execpath || path.join(repoRoot, 'node_modules', '.bin', 'pnpm');
  if (/\.(?:c?js|mjs)$/.test(pnpmExec)) {
    return { command: process.execPath, args: [pnpmExec, ...suite.args] };
  }
  return { command: pnpmExec, args: suite.args };
}

function runCommand(suite) {
  const invocation = resolveCommand(suite);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`[regression] ${suite.name}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export async function runRegressionSuites(
  suites = REGRESSION_SUITES,
  runSuite = runCommand,
  logger = console
) {
  const failures = [];
  for (const suite of suites) {
    logger.log(`[regression] running ${suite.name}`);
    const exitCode = await runSuite(suite);
    if (exitCode !== 0) {
      failures.push({ name: suite.name, exitCode });
      logger.error(`[regression] failed ${suite.name} (exit ${exitCode})`);
    }
  }
  return { failures };
}

async function main() {
  // Integration-test child processes resolve shared through its package exports,
  // which point at dist. A fresh checkout has no previous build to resolve.
  const sharedBuild = runCommand({
    name: 'build shared test dependency',
    command: 'pnpm',
    args: ['--filter', '@plum-code-webui/shared', 'run', 'build'],
  });
  if (sharedBuild !== 0) {
    process.exitCode = sharedBuild;
    return;
  }
  const { failures } = await runRegressionSuites();
  if (failures.length > 0) {
    console.error(
      `[regression] ${failures.length} suite(s) failed: ${failures.map(({ name }) => name).join(', ')}`
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[regression] all ${REGRESSION_SUITES.length} suites passed`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
