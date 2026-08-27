import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import * as pty from 'node-pty';
import os from 'os';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { CLI_PROVIDERS, type CLIProvider } from '../services/cli-providers.js';
import fs from 'fs';
import path from 'path';
import { getCliEnv } from '../utils/cliPaths.js';
import {
  ensureOpenCodeTenantDirectories,
  resolveOpenCodeTenantPaths,
} from '../services/opencode/tenantPaths.js';
import {
  extractCliDeviceCode,
  extractCliLoginUrl,
  CLI_LOGIN_TUI_INPUT,
  resolveCliLoginInvocation,
  stripCliLoginAnsi,
} from '../utils/cliLoginOutput.js';
import { getRunnerAccessDecision } from '../utils/runnerAccess.js';

const router = Router();

type LoginStatus = 'starting' | 'awaiting_code' | 'completed' | 'error';

interface LoginSession {
  id: string;
  userId: string;
  provider: CLIProvider;
  proc: pty.IPty | null;
  status: LoginStatus;
  output: string;
  rawOutput: string;
  loginUrl?: string;
  verificationCode?: string;
  error?: string;
  exitCode?: number | null;
  createdAt: number;
  waiters: Array<() => void>;
}

const LOGIN_TTL_MS = 10 * 60 * 1000;
const OUTPUT_LIMIT = 8000;
// Each `/start` spawns a `pty.spawn` that keeps an interactive CLI resident
// for up to LOGIN_TTL_MS. Without caps, a single authed user could hold open
// hundreds of Node TUIs in parallel and exhaust container resources. Caps
// are applied against the active (non-terminated) sessions.
const MAX_LOGIN_SESSIONS_PER_USER = 2;
const MAX_LOGIN_SESSIONS_TOTAL = 10;
const CODE_PROMPT_REGEX = /(enter|paste|type).*(code|verification|authorization)|device.*code/i;
const ALREADY_LOGGED_REGEX = /already\s+logged\s+in|already\s+signed\s+in/i;
const LOGIN_SUCCESS_REGEX =
  /successfully\s+(logged|signed|authenticated)|welcome|logged\s+in\s+as/i;

const loginSessions = new Map<string, LoginSession>();

function appendOutput(session: LoginSession, chunk: string): void {
  const cleaned = stripCliLoginAnsi(chunk);
  session.output = (session.output + cleaned).slice(-OUTPUT_LIMIT);
  // The URL has to be read from the untouched stream: a TUI publishes it as an
  // OSC-8 hyperlink and only prints a shortened label, so stripping escapes
  // first throws away the one complete copy.
  session.rawOutput = (session.rawOutput + chunk).slice(-OUTPUT_LIMIT);

  if (!session.loginUrl) {
    session.loginUrl = extractCliLoginUrl(session.rawOutput) || undefined;
  }

  if (!session.verificationCode) {
    session.verificationCode = extractCliDeviceCode(session.output) || undefined;
  }

  if (
    session.status === 'starting' &&
    (session.loginUrl || CODE_PROMPT_REGEX.test(session.output))
  ) {
    session.status = 'awaiting_code';
  }

  // A provider that binds a fixed loopback port for the OAuth callback fails
  // outright while an abandoned attempt still holds it. Without this the run
  // just never produces a URL, which reads like a hang.
  if (session.status !== 'completed' && !session.loginUrl) {
    const failure = session.output.match(/Failed to login[^\n]*/i)?.[0];
    if (failure) {
      session.status = 'error';
      session.error = /EADDRINUSE/i.test(failure)
        ? `${failure.trim()} — a previous login attempt is still running. Cancel it and try again.`
        : failure.trim();
    }
  }

  if (ALREADY_LOGGED_REGEX.test(session.output) || LOGIN_SUCCESS_REGEX.test(session.output)) {
    session.status = 'completed';
  }
}

function finalizeSession(session: LoginSession, exitCode: number | null): void {
  session.exitCode = exitCode;
  session.proc = null;

  if (session.status !== 'completed') {
    session.status = exitCode === 0 ? 'completed' : 'error';
  }
  if (session.status === 'error' && !session.error) {
    session.error = 'CLI login failed';
  }

  if (session.waiters.length) {
    session.waiters.splice(0).forEach((notify) => notify());
  }
}

function waitForCompletion(session: LoginSession, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.status === 'completed' || session.status === 'error') {
      return resolve();
    }
    const timer = setTimeout(() => {
      const index = session.waiters.indexOf(notify);
      if (index >= 0) {
        session.waiters.splice(index, 1);
      }
      reject(new Error('Login timed out'));
    }, timeoutMs);
    const notify = () => {
      clearTimeout(timer);
      resolve();
    };
    session.waiters.push(notify);
  });
}

const loginSessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const session of loginSessions.values()) {
    if (now - session.createdAt > LOGIN_TTL_MS) {
      try {
        session.proc?.kill();
      } catch {
        // Ignore cleanup errors.
      }
      loginSessions.delete(session.id);
    }
  }
}, 60 * 1000);
loginSessionCleanupTimer.unref();

const startSchema = z.object({
  provider: z.string().optional(),
});

// Cap at 256 chars: real OAuth codes are <200. An upper bound here prevents an
// authed user from piping arbitrary multi-KB payloads into the PTY stdin.
const codeSchema = z.object({
  code: z.string().min(1).max(256),
});

function serializeLoginSession(session: LoginSession) {
  return {
    id: session.id,
    provider: session.provider,
    status: session.status,
    loginUrl: session.loginUrl || null,
    verificationCode: session.verificationCode || null,
    output: session.output,
    error: session.error || null,
  };
}

router.post(
  '/:provider/start',
  requireAuth,
  await asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const provider = (req.params.provider || '').toLowerCase() as CLIProvider;

    const runnerAccess = await getRunnerAccessDecision(userId);
    if (!runnerAccess.allowed) {
      throw new AppError(
        runnerAccess.reason || 'CLI runner access is not allowed for this account.',
        403,
        'RUNNER_ACCESS_DENIED'
      );
    }

    // Claude and OpenCode expose dedicated auth commands. Codex uses its
    // headless device-code flow so the browser interaction can stay in Plum.
    const invocationArgs = resolveCliLoginInvocation(provider);
    if (!invocationArgs) {
      throw new AppError(
        `CLI login is not supported for provider '${provider}'.`,
        400,
        'UNSUPPORTED_PROVIDER'
      );
    }

    const parsed = startSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    let activeForUser = 0;
    let activeTotal = 0;
    for (const existing of loginSessions.values()) {
      if (existing.proc && existing.status !== 'completed' && existing.status !== 'error') {
        activeTotal += 1;
        if (existing.userId === userId) activeForUser += 1;
      }
    }
    if (activeForUser >= MAX_LOGIN_SESSIONS_PER_USER) {
      throw new AppError(
        'You already have a CLI login in progress. Finish or wait for it to expire before starting another.',
        429,
        'LOGIN_CAP_USER'
      );
    }
    if (activeTotal >= MAX_LOGIN_SESSIONS_TOTAL) {
      throw new AppError(
        'Too many concurrent CLI logins on this server. Try again shortly.',
        429,
        'LOGIN_CAP_GLOBAL'
      );
    }

    const config = CLI_PROVIDERS[provider];
    const command = config?.command || provider;
    const loginId = nanoid();
    const session: LoginSession = {
      id: loginId,
      userId,
      provider,
      proc: null,
      status: 'starting',
      output: '',
      rawOutput: '',
      createdAt: Date.now(),
      waiters: [],
    };

    try {
      const env = {
        ...getCliEnv(),
        HOME: os.homedir(),
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      } as Record<string, string>;

      // Provider-specific env
      if (provider === 'claude') {
        const configOverride = process.env.WEBUI_CONFIG_HOME || process.env.CLAUDE_CONFIG_HOME;
        if (configOverride) {
          env.CLAUDE_CONFIG_HOME = configOverride;
        }
      } else if (provider === 'codex') {
        env.CODEX_HOME = CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
      } else if (provider === 'opencode') {
        // Keep OpenCode OAuth/account state in the same per-user tenant used by
        // that user's server. A login can never replace another user's auth.json.
        const tenantPaths = resolveOpenCodeTenantPaths(userId);
        ensureOpenCodeTenantDirectories(tenantPaths);
        env.OPENCODE_CONFIG_DIR = tenantPaths.configDir;
        env.OPENCODE_DATA_DIR = tenantPaths.dataDir;
      } else if (provider === 'pi') {
        // Same per-user agent dir the WebUI hands to Pi sessions, so the token
        // lands where syncPiConfig and the model resolution look for it.
        const segment = userId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'default';
        const agentDir = path.join(os.homedir(), '.pi', 'webui-users', segment, 'agent');
        fs.mkdirSync(agentDir, { recursive: true });
        env.PI_CODING_AGENT_DIR = agentDir;
        env.PI_TELEMETRY = '0';
        env.PI_SKIP_VERSION_CHECK = '1';
      } else if (provider === 'kimi') {
        // Kimi Code CLI keeps OAuth + provider state under ~/.kimi-code by
        // default. The device-code login prints the verification URL + user code
        // to the TTY (merged stdout/stderr) and self-polls until the browser
        // authorization completes; no manual code entry is required.
      }

      const loginArgs = [...invocationArgs];

      const proc = pty.spawn(command, loginArgs, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: os.homedir(),
        env,
      });

      session.proc = proc;
      loginSessions.set(loginId, session);

      proc.onData((data: string) => {
        appendOutput(session, data);
      });

      proc.onExit(({ exitCode }) => {
        finalizeSession(session, exitCode);
      });

      // Providers whose login is a TUI command need it typed after the
      // interface has drawn; writing immediately lands before the input is
      // wired and is swallowed.
      const tuiInput = CLI_LOGIN_TUI_INPUT[provider];
      if (tuiInput) {
        const type = (value: string) => {
          try {
            proc.write(value);
          } catch {
            // The process may already be gone; onExit reports that.
          }
        };
        // Three separate writes on purpose. The TUI needs to have drawn before
        // it accepts input, and submitting in the same write as the text does
        // not register — the command just sits in the composer.
        setTimeout(() => type(tuiInput), 2000);
        setTimeout(() => type('\r'), 3000);
        setTimeout(() => type('\r'), 5000);
      }
    } catch (error) {
      session.status = 'error';
      session.error = error instanceof Error ? error.message : 'Failed to start CLI login';
      loginSessions.set(loginId, session);
    }

    // Wait a bit for the process to start and output the URL
    const waitTime = 600;
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    res.json({
      success: true,
      data: serializeLoginSession(session),
    });
  })
);

router.get('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = loginSessions.get(req.params.id!);

  if (!session || session.userId !== userId) {
    throw new AppError('Login session not found', 404, 'NOT_FOUND');
  }

  res.json({
    success: true,
    data: serializeLoginSession(session),
  });
});

router.post(
  '/:id/code',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const session = loginSessions.get(req.params.id!);

    if (!session || session.userId !== userId) {
      throw new AppError('Login session not found', 404, 'NOT_FOUND');
    }

    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    if (!session.proc) {
      res.json({
        success: true,
        data: serializeLoginSession(session),
      });
      return;
    }

    const code = parsed.data.code.trim();
    session.proc.write(code + '\r');

    try {
      await waitForCompletion(session, 60 * 1000);
    } catch (error) {
      session.status = 'error';
      session.error = error instanceof Error ? error.message : 'Login timed out';
    }

    res.json({
      success: true,
      data: serializeLoginSession(session),
    });
  })
);

router.delete('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = loginSessions.get(req.params.id!);

  if (!session || session.userId !== userId) {
    throw new AppError('Login session not found', 404, 'NOT_FOUND');
  }

  try {
    session.proc?.kill();
  } catch {
    // The process may already have exited between the lookup and cancellation.
  }
  loginSessions.delete(session.id);

  res.json({ success: true, data: { id: session.id, cancelled: true } });
});

export default router;
