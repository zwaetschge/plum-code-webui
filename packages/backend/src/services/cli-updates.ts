import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { CliProviderUpdateResponse, CLIProvider } from '@plum-code-webui/shared';
import { getCliEnv, getNpmPrefix } from '../utils/cliPaths.js';

const execAsync = promisify(exec);

export const CLI_UPDATE_PROVIDERS = ['claude', 'codex', 'pi', 'vibe'] as const;

/**
 * Mistral Vibe 3 ships only glibc (manylinux) wheels; on this Alpine image pip
 * falls back to the source package, which needs a Rust toolchain. The release
 * page also carries a self-contained `vibe-acp` (PyInstaller) per platform, and
 * that is the only binary Plum runs. It works through gcompat once its bundled
 * glibc libgcc_s is dropped (that one needs `__cpu_indicator_init`, which musl's
 * loader does not provide; Alpine's own libgcc_s is used instead).
 *
 * Versions go under the persistent npm prefix and `bin/vibe-acp` is switched
 * atomically, so an update survives image rebuilds and wins over the image's
 * pinned pipx copy (findCliBinary looks in the npm prefix first). The previous
 * version stays for a running session and is pruned on the next update.
 */
const VIBE_ACP_UPDATE = [
  'set -eu',
  'prefix="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"',
  'root="$prefix/opt/mistral-vibe"',
  'case "$(uname -m)" in x86_64) arch=x86_64 ;; aarch64|arm64) arch=aarch64 ;; *) echo "unsupported arch $(uname -m)"; exit 1 ;; esac',
  'tag=$(curl -fsSL https://api.github.com/repos/mistralai/mistral-vibe/releases/latest | jq -r .tag_name)',
  'ver="${tag#v}"',
  'case "$ver" in [0-9]*) ;; *) echo "no release tag: $tag"; exit 1 ;; esac',
  'mkdir -p "$root" "$prefix/bin"',
  'if [ ! -x "$root/$ver/vibe-acp" ]; then',
  '  tmp=$(mktemp -d "$root/.download-XXXXXX")',
  '  trap \'rm -rf "$tmp"\' EXIT',
  '  curl -fsSL -o "$tmp/vibe-acp.tar.gz" "https://github.com/mistralai/mistral-vibe/releases/download/$tag/vibe-acp-linux-$arch-$ver.tar.gz"',
  '  mkdir "$tmp/x"',
  '  tar xzf "$tmp/vibe-acp.tar.gz" -C "$tmp/x"',
  '  if [ -e /etc/alpine-release ]; then rm -f "$tmp/x/_internal/libgcc_s.so.1"; fi',
  '  "$tmp/x/vibe-acp" --version | grep -F "$ver"',
  '  mv "$tmp/x" "$root/$ver"',
  'fi',
  'ln -sfn "$root/$ver/vibe-acp" "$prefix/bin/vibe-acp.new"',
  'mv -fT "$prefix/bin/vibe-acp.new" "$prefix/bin/vibe-acp"',
  'ls -1d "$root"/[0-9]* | sort -V | head -n -2 | xargs -r rm -rf',
  '"$prefix/bin/vibe-acp" --version',
].join('\n');

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
  pi: 'npm install -g @earendil-works/pi-coding-agent@latest pi-mcp-adapter@latest',
  vibe: VIBE_ACP_UPDATE,
};

let updateInFlight: Promise<CliProviderUpdateResponse> | null = null;

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
