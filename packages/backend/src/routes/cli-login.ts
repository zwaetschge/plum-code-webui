import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import * as pty from 'node-pty';
import os from 'os';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
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
import { hasPiAntigravityLogin } from '../utils/piConfig.js';
import {
  clearVibeApiKey,
  readVibeAuthStateFromAgent,
  startVibeBrowserLogin,
  writeVibeApiKey,
  type VibeBrowserLogin,
} from '../services/vibe/vibeAuth.js';

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
// "welcome" must never be part of this: `codex login --device-auth` prints a
// "Welcome to Codex" banner before the device flow even starts, and matching
// it flips the login to completed within the first output chunk — the dialog
// then claims saved credentials exist, closes, and kills the still-waiting
// OAuth process before auth.json is ever written.
const LOGIN_SUCCESS_REGEX = /successfully\s+(logged|signed|authenticated)|logged\s+in\s+as/i;

const loginSessions = new Map<string, LoginSession>();

function markPiLoginIfSaved(session: LoginSession): boolean {
  if (session.provider !== 'pi') return false;
  if (
    session.status !== 'completed' &&
    piAntigravityLoginSince(session.userId, session.createdAt)
  ) {
    session.status = 'completed';
    session.error = undefined;
    // Pi's TUI keeps running after /login; the credentials are on disk now.
    try {
      session.proc?.kill();
    } catch {
      // Already gone.
    }
  }
  return session.status === 'completed';
}

function piAntigravityLoginSince(userId: string, since: number): boolean {
  if (!hasPiAntigravityLogin(userId)) return false;
  const segment = userId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'default';
  try {
    const authFile = path.join(os.homedir(), '.pi', 'webui-users', segment, 'agent', 'auth.json');
    return fs.statSync(authFile).mtimeMs >= since;
  } catch {
    return false;
  }
}

/** Live Vibe browser sign-ins, keyed by the login session id. */
const vibeLogins = new Map<string, VibeBrowserLogin>();

// Codex device-auth banners and status lines change between CLI releases, so
// the only trustworthy "completed" signal is the auth.json the CLI writes
// after a successful token exchange — the same file isProviderAvailable()
// checks. Output regexes stay as a fast path for the other providers.
function hasCodexCredentials(): boolean {
  try {
    const authPath = path.join(
      CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir()),
      'auth.json'
    );
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as {
      OPENAI_API_KEY?: string | null;
      tokens?: { access_token?: string | null };
    };
    return !!(auth.tokens?.access_token || auth.OPENAI_API_KEY);
  } catch {
    return false;
  }
}

function loginOutputSignalsSuccess(session: LoginSession): boolean {
  if (session.provider === 'pi') {
    // Pi's TUI prints no stable success line; auth.json is rewritten on success.
    return piAntigravityLoginSince(session.userId, session.createdAt);
  }
  if (session.provider === 'codex') {
    // File-backed: a matching line alone can come from banners or re-login
    // notices while the token exchange has not happened yet.
    return (
      (ALREADY_LOGGED_REGEX.test(session.output) || LOGIN_SUCCESS_REGEX.test(session.output)) &&
      hasCodexCredentials()
    );
  }
  return ALREADY_LOGGED_REGEX.test(session.output) || LOGIN_SUCCESS_REGEX.test(session.output);
}

const lastOutputAt = new WeakMap<LoginSession, number>();

/**
 * Type a TUI login command (Pi's `/login antigravity`) once the interface has
 * settled, and submit it until the CLI answers with a login URL. Fixed delays
 * failed whenever startup was slow: the text sat in the composer and the
 * Enter keys had gone in before the input handler existed.
 */
async function typeTuiLogin(session: LoginSession, proc: pty.IPty, command: string): Promise<void> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const write = (value: string) => {
    try {
      proc.write(value);
    } catch {
      // The process may already be gone; onExit reports that.
    }
  };
  const alive = () =>
    loginSessions.get(session.id) === session &&
    (session.status === 'starting' || session.status === 'awaiting_code');
  const started = Date.now();
  // Ready: at least 2 s in and 1.5 s without new output, at most 30 s.
  await sleep(2_000);
  while (alive() && Date.now() - started < 30_000) {
    if (Date.now() - (lastOutputAt.get(session) ?? started) >= 1_500) break;
    await sleep(250);
  }
  if (!alive()) return;
  write(command);
  // Submitting in the same write as the text does not register.
  for (let attempt = 0; attempt < 8 && alive() && !session.loginUrl; attempt++) {
    await sleep(attempt === 0 ? 800 : 2_500);
    if (session.loginUrl) break;
    write('\r');
  }
}

function appendOutput(session: LoginSession, chunk: string): void {
  lastOutputAt.set(session, Date.now());
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

  if (loginOutputSignalsSuccess(session)) {
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
  // Pi's Antigravity login takes the whole Google redirect URL, scopes included.
  code: z.string().min(1).max(4096),
});

/** Pi's Antigravity extension listens here for Google's OAuth redirect. */
const PI_ANTIGRAVITY_CALLBACK = 'http://127.0.0.1:51121/oauth-callback';

/**
 * Google sends the browser to http://localhost:51121/oauth-callback — the
 * user's own machine, not this container, so the page fails to load there.
 * The user pastes that URL (or just its query) and Plum replays it against
 * the callback server Pi opened inside the container.
 */
async function forwardPiOAuthCallback(pasted: string): Promise<string | null> {
  const query = pasted.includes('?') ? pasted.slice(pasted.indexOf('?') + 1) : pasted;
  const params = new URLSearchParams(query.replace(/^[?&]+/, '').split('#')[0]);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  if (error) return `Google meldet: ${error}`;
  if (!code || !state) {
    return 'Bitte die vollständige Adresse aus der Browserzeile einfügen (sie enthält code= und state=).';
  }
  const target = new URL(PI_ANTIGRAVITY_CALLBACK);
  target.search = new URLSearchParams({ code, state }).toString();
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return (await response.text()).slice(0, 300) || `HTTP ${response.status}`;
    return null;
  } catch (fetchError) {
    return `Pi wartet nicht mehr auf den Login (${fetchError instanceof Error ? fetchError.message : fetchError}). Login neu starten.`;
  }
}

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

router.post('/:provider/start', requireAuth, async (req, res) => {
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

  // Vibe has no interactive login TUI to scrape: its ACP agent hands out a
  // sign-in URL and exchanges it for a key it persists itself.
  if (provider === 'vibe') {
    const loginId = nanoid();
    const session: LoginSession = {
      id: loginId,
      userId,
      provider,
      proc: null,
      status: 'starting',
      output: 'Starting Mistral sign-in…\n',
      rawOutput: '',
      createdAt: Date.now(),
      waiters: [],
    };
    loginSessions.set(loginId, session);
    try {
      const login = await startVibeBrowserLogin();
      vibeLogins.set(loginId, login);
      session.loginUrl = login.signInUrl;
      session.status = 'awaiting_code';
      appendOutput(
        session,
        `Open the sign-in page in your browser. The link expires at ${login.expiresAt || 'unknown'}.\n`
      );
      void login.completed
        .then(() => {
          session.status = 'completed';
          appendOutput(session, 'Signed in. Mistral Vibe stored the key.\n');
          finalizeSession(session, 0);
        })
        .catch((error: unknown) => {
          session.status = 'error';
          session.error = error instanceof Error ? error.message : String(error);
          appendOutput(session, `${session.error}\n`);
          finalizeSession(session, 1);
        })
        .finally(() => vibeLogins.delete(loginId));
      return res.json({ success: true, data: serializeLoginSession(session) });
    } catch (error) {
      session.status = 'error';
      session.error = error instanceof Error ? error.message : String(error);
      appendOutput(session, `${session.error}\n`);
      finalizeSession(session, 1);
      return res.json({ success: true, data: serializeLoginSession(session) });
    }
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
    // interface has drawn; writing earlier lands before the input is wired.
    // Startup time varies a lot (Pi shows its changelog after an update and
    // connects every MCP server first), so wait until the screen has been
    // quiet, then keep pressing Enter until the login URL shows up.
    const tuiInput = CLI_LOGIN_TUI_INPUT[provider];
    if (tuiInput) {
      void typeTuiLogin(session, proc, tuiInput);
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
});

router.get('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = loginSessions.get(req.params.id!);

  if (!session || session.userId !== userId) {
    throw new AppError('Login session not found', 404, 'NOT_FOUND');
  }
  markPiLoginIfSaved(session);

  res.json({
    success: true,
    data: serializeLoginSession(session),
  });
});

router.post('/:id/code', requireAuth, async (req, res) => {
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
  if (session.provider === 'pi') {
    const forwardError = await forwardPiOAuthCallback(code);
    if (forwardError) {
      session.error = forwardError;
      res.json({ success: true, data: serializeLoginSession(session) });
      return;
    }
    session.error = undefined;
    // Pi exchanges the code for tokens and then writes auth.json; no output
    // chunk is guaranteed to follow, so watch the file.
    const outputBefore = session.output.length;
    let failure: string | undefined;
    for (let i = 0; i < 40 && !markPiLoginIfSaved(session); i += 1) {
      failure = session.output.slice(outputBefore).match(/Failed to login[^\n]*/i)?.[0];
      if (failure) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (session.status !== 'completed') {
      session.error = failure
        ? `${failure.trim()} — Login neu starten und die Adresse direkt danach einfügen.`
        : 'Pi hat noch keine Zugangsdaten gespeichert. Details unten prüfen.';
    }
    res.json({ success: true, data: serializeLoginSession(session) });
    return;
  } else {
    session.proc.write(code + '\r');
  }

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
});

router.delete('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const session = loginSessions.get(req.params.id!);

  if (!session || session.userId !== userId) {
    throw new AppError('Login session not found', 404, 'NOT_FOUND');
  }

  try {
    vibeLogins.get(session.id)?.cancel();
    vibeLogins.delete(session.id);
    session.proc?.kill();
  } catch {
    // The process may already have exited between the lookup and cancellation.
  }
  loginSessions.delete(session.id);

  res.json({ success: true, data: { id: session.id, cancelled: true } });
});

/**
 * Mistral Vibe credentials. The browser sign-in above is the path that draws on
 * the plan's Vibe Code allowance; a key pasted from Code › Vibe CLI does too,
 * while a regular console key spends the much smaller API allowance.
 */
router.get('/vibe/status', requireAuth, async (_req, res) => {
  const state = await readVibeAuthStateFromAgent();
  res.json({
    success: true,
    data: {
      installed: state.installed,
      authenticated: state.authenticated,
      source: state.source,
      authState: state.authState ?? null,
    },
  });
});

router.post('/vibe/key', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const runnerAccess = await getRunnerAccessDecision(userId);
  if (!runnerAccess.allowed) {
    throw new AppError(
      runnerAccess.reason || 'CLI runner access is not allowed for this account.',
      403,
      'RUNNER_ACCESS_DENIED'
    );
  }
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
    apiKey?: unknown;
  };
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
  if (!apiKey.trim()) {
    throw new AppError('An API key is required.', 400, 'VALIDATION_ERROR');
  }
  try {
    writeVibeApiKey(apiKey);
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to store the key.',
      400,
      'VIBE_KEY_INVALID'
    );
  }
  res.json({ success: true, data: { authenticated: true, source: 'dot-env' } });
});

router.delete('/vibe/key', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const runnerAccess = await getRunnerAccessDecision(userId);
  if (!runnerAccess.allowed) {
    throw new AppError(
      runnerAccess.reason || 'CLI runner access is not allowed for this account.',
      403,
      'RUNNER_ACCESS_DENIED'
    );
  }
  const removed = clearVibeApiKey();
  res.json({ success: true, data: { removed } });
});

export default router;
