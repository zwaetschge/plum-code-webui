/**
 * Admin / helper LLM invocations.
 *
 * One-shot text completion for internal WebUI features (commit messages,
 * summaries, etc.) — NOT the user's interactive session.
 *
 * Codex is the primary admin provider going forward. Anthropic is restricting
 * `claude -p` and moving to a credit system, so Claude is treated as a fallback.
 *
 * Order of preference: codex → claude. Pi is not a candidate: its provider
 * connections are per user, and these helper calls have no user context.
 * Override via env `ADMIN_LLM_PROVIDER=codex|claude`.
 */

import { spawn } from 'child_process';
import { isProviderAvailable, type CLIProvider } from '../services/cli-providers.js';
import { getCodexWebuiApprovalPolicy, getCodexWebuiSandboxMode } from './codexDefaults.js';

const DEFAULT_ORDER: CLIProvider[] = ['codex', 'claude'];

interface RunOpts {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  model?: string;
}

interface ProviderRunner {
  command: string;
  args: (prompt: string, opts: RunOpts) => string[];
  // Some CLIs (codex) accept the prompt as a positional arg; others
  // (claude) pass it via -p. This flag controls whether the prompt is
  // also piped on stdin as a safety net for very long prompts.
  pipeOnStdin?: boolean;
}

function buildRunner(provider: CLIProvider): ProviderRunner {
  switch (provider) {
    case 'codex':
      // `codex exec <prompt>` is the non-interactive one-shot mode.
      // --skip-git-repo-check lets it run in arbitrary working dirs.
      // --ephemeral skips persisting to ~/.codex/sessions/ so admin calls
      // (commit messages, summaries, etc.) don't pollute the resume picker.
      return {
        command: 'codex',
        args: (prompt, opts) => [
          'exec',
          '--skip-git-repo-check',
          '--ephemeral',
          ...(opts.model ? ['-m', opts.model] : []),
          '--sandbox',
          getCodexWebuiSandboxMode(),
          '-c',
          `approval_policy="${getCodexWebuiApprovalPolicy()}"`,
          prompt,
        ],
      };
    case 'claude':
    default:
      return {
        command: 'claude',
        args: (prompt) => ['--print', '-p', prompt],
        pipeOnStdin: false,
      };
  }
}

async function pickProvider(): Promise<CLIProvider | null> {
  const override = process.env.ADMIN_LLM_PROVIDER as CLIProvider | undefined;
  if (override && DEFAULT_ORDER.includes(override)) {
    if (await isProviderAvailable(override)) return override;
  }
  for (const provider of DEFAULT_ORDER) {
    if (await isProviderAvailable(provider)) return provider;
  }
  return null;
}

export interface AdminLLMResult {
  text: string;
  provider: CLIProvider;
}

/**
 * Run a one-shot prompt against the preferred admin LLM.
 *
 * Throws if no provider is available or if the CLI exits with no output.
 */
export async function runAdminLLM(prompt: string, opts: RunOpts = {}): Promise<AdminLLMResult> {
  const provider = await pickProvider();
  if (!provider) {
    throw new Error('No admin LLM provider available (codex/claude). Run a CLI login first.');
  }

  const runner = buildRunner(provider);
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return await new Promise<AdminLLMResult>((resolve, reject) => {
    const proc = spawn(runner.command, runner.args(prompt, opts), {
      cwd: opts.cwd,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${runner.command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const text = stdout.trim();
      if (code !== 0 && !text) {
        reject(new Error(stderr.trim() || `${runner.command} exited with code ${code}`));
        return;
      }
      resolve({ text, provider });
    });

    if (runner.pipeOnStdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      });
    }
  });
}
