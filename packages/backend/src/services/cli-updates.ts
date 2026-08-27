import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { CliProviderUpdateResponse, CLIProvider } from '@plum-code-webui/shared';
import { getCliEnv, getNpmPrefix } from '../utils/cliPaths.js';

const execAsync = promisify(exec);

export const CLI_UPDATE_PROVIDERS = ['claude', 'codex', 'opencode', 'pi', 'kimi'] as const;

const CLI_UPDATE_COMMANDS: Record<CLIProvider, string> = {
  // npm 12 can leave Claude Code's executable placeholder in place even when
  // the platform-specific optional package was downloaded. The placeholder is
  // intentionally not a shell script and therefore fails with ENOEXEC. Run the
  // package's idempotent installer explicitly, then prove the promoted binary
  // can execute before reporting the update as successful.
  claude:
    'npm install -g @anthropic-ai/claude-code@latest && node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs" && claude --version',
  zai: 'npm install -g @anthropic-ai/claude-code@latest && node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs" && claude --version',
  codex: 'npm install -g @openai/codex@latest',
  opencode: 'npm install -g opencode-ai@latest',
  pi: 'npm install -g @earendil-works/pi-coding-agent@latest pi-mcp-adapter@latest',
  kimi: 'npm install -g @moonshot-ai/kimi-code@latest',
};

let updateInFlight: Promise<CliProviderUpdateResponse> | null =
  await await await await await await await await null;

async function runUpdateCommand(command: string, env: NodeJS.ProcessEnv, timeoutMs: number) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      env,
      cwd: os.homedir(),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = [stdout, stderr].filter((value) => value && value.length > 0).join('');
    return { output, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const output = [err.stdout, err.stderr, err.message]
      .filter((value) => value && value.length > 0)
      .join('\n');
    const exitCode = typeof err.code === 'number' ? err.code : null;
    return { output, exitCode };
  }
}

export function getCliUpdateCommand(provider: CLIProvider): string | undefined {
  return CLI_UPDATE_COMMANDS[provider];
}

export async function runCliUpdates(providers?: CLIProvider[]): Promise<CliProviderUpdateResponse> {
  if (updateInFlight) {
    return updateInFlight;
  }

  updateInFlight = (async () => {
    const targetProviders =
      providers && providers.length > 0 ? providers : [...CLI_UPDATE_PROVIDERS];

    const results: CliProviderUpdateResponse['results'] = [];
    for (const provider of targetProviders) {
      const prefix = getNpmPrefix();
      const env = getCliEnv();
      await fs.mkdir(path.join(prefix, 'bin'), { recursive: true });
      await fs.mkdir(path.join(prefix, 'lib'), { recursive: true });

      const command = getCliUpdateCommand(provider);
      if (!command) {
        results.push({
          provider,
          command: '',
          output: 'No update command configured.',
          exitCode: null,
          status: 'failed',
        });
        continue;
      }

      const timeoutMs = 5 * 60 * 1000;
      const { output, exitCode } = await runUpdateCommand(command, env, timeoutMs);
      results.push({
        provider,
        command,
        output,
        exitCode,
        status: exitCode === 0 ? 'updated' : 'failed',
      });
    }

    return { results };
  })();

  try {
    return updateInFlight;
  } finally {
    updateInFlight = null;
  }
}
