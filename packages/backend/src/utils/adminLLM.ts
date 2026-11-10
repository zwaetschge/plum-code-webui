/**
 * Admin / helper LLM invocations.
 *
 * One-shot text completion for internal WebUI features (commit messages,
 * summaries, etc.) — NOT the user's interactive session.
 *
 * Claude Code is the primary admin provider again (2026-11-09: Codex is no
 * longer used and its account is on the free plan). Claude runs Sonnet by
 * default (`ADMIN_LLM_CLAUDE_MODEL`): these are housekeeping calls, and on
 * memory work Sonnet 5.5 matches Opus 5.5 (Anthropic, "components of agent
 * memory"). The prompt goes in on stdin, so long inputs never hit the argv
 * limit, and runs are not persisted as sessions.
 *
 * Order of preference: claude → codex. Pi is not a candidate: its provider
 * connections are per user, and these helper calls have no user context.
 * Override via env `ADMIN_LLM_PROVIDER=codex|claude`.
 */

import { spawn } from 'child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  codexTransportArgs,
  isProviderAvailable,
  type CLIProvider,
} from '../services/cli-providers.js';
import { getCodexWebuiApprovalPolicy, getCodexWebuiSandboxMode } from './codexDefaults.js';

const DEFAULT_ORDER: CLIProvider[] = ['claude', 'codex'];
const DEFAULT_CLAUDE_ADMIN_MODEL = 'claude-sonnet-5-5';

interface RunOpts {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  model?: string;
  /**
   * The call works with files (reads anywhere, edits in `cwd`) instead of only
   * answering. Claude then runs without permission prompts, which print mode
   * cannot answer; callers keep a backup of what it may change.
   */
  agentic?: boolean;
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
        args: (prompt, opts) => {
          const model = opts.model ?? codexAdminModel();
          return [
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            // Same transport as the sessions: on the default provider the
            // ChatGPT account rejects the configured model and every admin call
            // (memory optimizer, dreaming, summaries) failed.
            ...codexTransportArgs(),
            ...(model ? ['-m', model] : []),
            '--sandbox',
            getCodexWebuiSandboxMode(),
            '-c',
            `approval_policy="${getCodexWebuiApprovalPolicy()}"`,
            prompt,
          ];
        },
      };
    case 'claude':
    default:
      return {
        command: 'claude',
        args: (_prompt, opts) => [
          '--print',
          '--no-session-persistence',
          '--model',
          opts.model ?? process.env.ADMIN_LLM_CLAUDE_MODEL ?? DEFAULT_CLAUDE_ADMIN_MODEL,
          ...(opts.agentic ? ['--dangerously-skip-permissions'] : []),
        ],
        pipeOnStdin: true,
      };
  }
}

/**
 * A model the Codex account actually offers. The configured default can be
 * one the plan no longer includes (2026-11-09: `gpt-6.1-sol` after a switch to
 * a smaller plan, rejected with "not supported when using Codex with a ChatGPT
 * account"); Codex lists what the account may use in `models_cache.json`.
 * Returns undefined to keep Codex's own default when nothing better is known.
 */
export function codexAdminModel(codexHome = path.join(os.homedir(), '.codex')): string | undefined {
  if (process.env.ADMIN_LLM_CODEX_MODEL) return process.env.ADMIN_LLM_CODEX_MODEL;
  let available: string[];
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(codexHome, 'models_cache.json'), 'utf8'));
    const models: Array<{ slug?: unknown; visibility?: unknown }> = Array.isArray(cache?.models)
      ? cache.models
      : [];
    available = models
      // `hide` marks internal entries (reserve, auto-review), not chat models.
      .filter((model) => model?.visibility !== 'hide')
      .map((model) => model?.slug)
      .filter((slug): slug is string => typeof slug === 'string');
  } catch {
    return undefined;
  }
  if (available.length === 0) return undefined;
  let configured: string | undefined;
  try {
    configured = /^model\s*=\s*"([^"]+)"/m.exec(
      fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')
    )?.[1];
  } catch {
    configured = undefined;
  }
  if (configured && available.includes(configured)) return undefined;
  return available.find((slug) => /terra/i.test(slug)) ?? available[0];
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
