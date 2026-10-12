import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CLI_PROVIDERS, isProviderAvailable } from '../cli-providers.js';
import { AppError } from '../../middleware/errorHandler.js';

/** Same login and user entitlement as an interactive session, with no repository or tools. */
export async function memoryCliAvailable(userId: string) {
  const { getEnabledCliProvidersForUser } = await import('../../routes/settings.js');
  return (
    (await getEnabledCliProvidersForUser(userId)).includes('codex') &&
    (await isProviderAvailable('codex', userId))
  );
}
export async function extractWithMemoryCli(userId: string, prompt: string, model?: string) {
  if (!(await memoryCliAvailable(userId)))
    throw new AppError(
      'Für die Analyse Codex anmelden oder eine eigene API-Verbindung einrichten.',
      409,
      'MEMORY_MODEL_MISSING'
    );
  const provider = CLI_PROVIDERS.codex;
  const root = await mkdtemp(path.join(os.tmpdir(), 'plum-memory-cli-'));
  try {
    const home = provider.credentialsPath.replace(/^~/, os.homedir()),
      work = path.join(root, 'work');
    await mkdir(work, { mode: 0o700 });
    const auth = await readFile(path.join(home, 'auth.json'), 'utf8');
    // Keep native OAuth refresh locking on the existing auth store; never fork refresh tokens.
    const config = [
      'approval_policy="never"',
      'sandbox_mode="read-only"',
      'web_search="disabled"',
      ...[
        'shell_tool',
        'unified_exec',
        'multi_agent',
        'apps',
        'plugins',
        'browser_use',
        'computer_use',
        'image_generation',
      ].map((f) => `features.${f}=false`),
      'features.skip_host_skill_discovery=true',
    ];
    const env = { ...process.env, CODEX_HOME: home, PLUM_SUBAGENT_DEPTH: '1' };
    for (const key of Object.keys(env))
      if (
        /^(?:OPENAI_API_KEY|ANTHROPIC_|WEBUI_|MISTRAL_API_KEY|Z_AI_API_KEY|CODEX_THREAD_ID)/.test(
          key
        )
      )
        delete env[key as keyof typeof env];
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-rules',
      '--ignore-user-config',
      '--json',
      '--color',
      'never',
      '-m',
      model || provider.defaultModel || 'gpt-5.5',
      ...config.flatMap((value) => ['-c', value]),
      '-',
    ];
    if (JSON.parse(auth).tokens?.access_token)
      args.splice(args.length - 1, 0, '-c', 'auth_mode="chatgpt"');
    const result = await new Promise<{ text: string; tokens: Record<string, number> | null }>(
      (resolve, reject) => {
        const child = spawn(provider.command, args, {
          cwd: work,
          env,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        let buffer = '',
          text = '',
          tokens: Record<string, number> | null = null,
          captured = 0,
          finished = false;
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve({ text, tokens });
        };
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish(new Error('MEMORY_CLI_TIMEOUT'));
        }, 90000);
        child.stdout.on('data', (chunk: Buffer) => {
          captured += chunk.length;
          if (captured > 256000) {
            child.kill('SIGKILL');
            finish(new Error('MEMORY_CLI_OUTPUT_LIMIT'));
            return;
          }
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines)
            try {
              const event = JSON.parse(line);
              if (event.type === 'item.completed' && event.item?.type === 'agent_message')
                text = event.item.text;
              if (event.type === 'turn.completed') tokens = event.usage;
              if (
                event.type === 'item.started' &&
                /tool|command|call/i.test(event.item?.type ?? '')
              ) {
                child.kill('SIGKILL');
                finish(new Error('MEMORY_CLI_TOOL_REFUSED'));
              }
            } catch {
              /* Not a JSON event. */
            }
        });
        child.once('error', () => finish(new Error('MEMORY_CLI_UNAVAILABLE')));
        child.once('close', (code) =>
          finish(code || !text ? new Error('MEMORY_CLI_INCOMPLETE') : undefined)
        );
        child.stdin.on('error', () => undefined);
        child.stdin.end(prompt);
      }
    );
    const input = result.tokens?.input_tokens ?? 0,
      cached = result.tokens?.cached_input_tokens ?? 0,
      output = result.tokens?.output_tokens ?? 0;
    return {
      text: result.text,
      usage: {
        cliProvider: 'codex' as const,
        model: model || provider.defaultModel || 'gpt-5.5',
        input: Math.max(0, input - cached),
        cached,
        output,
      },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
