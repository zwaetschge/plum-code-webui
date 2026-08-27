import { get as pgGet } from '../db/pg.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import { getOracleBrowserManager } from '../services/oracleBrowser.js';
import {
  buildOracleRuntimeConfig,
  getOracleBrowserSettingsForUser,
  getOracleRuntimeConfigForSession,
} from '../utils/oracleSettings.js';

const router = Router();

function requireHookSecret(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('x-webui-hook-secret') || '';
  const expected = config.hookSecret;

  if (!expected) {
    res
      .status(503)
      .json({ success: false, error: { code: 'NO_HOOK', message: 'hook secret unconfigured' } });
    return;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'invalid secret' } });
    return;
  }

  next();
}

router.use((req, res, next) => {
  if (req.path.startsWith('/internal/')) return next();
  return requireAuth(req, res, next);
});

function splitRemoteChromeTarget(target: string): { host: string; port: number } {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error('Remote Chrome target is empty. Expected host:port.');
  }

  const ipv6Match = trimmed.match(/^\[(.+)]:(\d+)$/);
  let host = '';
  let portRaw = '';

  if (ipv6Match) {
    host = ipv6Match[1]?.trim() || '';
    portRaw = ipv6Match[2]?.trim() || '';
  } else {
    const idx = trimmed.lastIndexOf(':');
    if (idx === -1) {
      throw new Error(`Invalid remote Chrome target "${trimmed}". Expected host:port.`);
    }
    host = trimmed.slice(0, idx).trim();
    portRaw = trimmed.slice(idx + 1).trim();
    if (host.includes(':')) {
      throw new Error(
        `Invalid remote Chrome target "${trimmed}". Wrap IPv6 hosts in brackets, e.g. [2001:db8::1]:9222.`
      );
    }
  }

  const port = Number.parseInt(portRaw, 10);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid remote Chrome target "${trimmed}". Expected a valid host:port.`);
  }

  return { host, port };
}

async function probeRemoteChrome(target: string): Promise<{
  browser: string | null;
  protocolVersion: string | null;
  webSocketDebuggerUrl: string | null;
}> {
  const { host, port } = splitRemoteChromeTarget(target);
  const response = await fetch(`http://${host}:${port}/json/version`, {
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Remote Chrome returned non-JSON from /json/version: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(
      `Remote Chrome probe failed with HTTP ${response.status}: ${
        typeof parsed.message === 'string' ? parsed.message : text.slice(0, 120)
      }`
    );
  }

  return {
    browser: typeof parsed.Browser === 'string' ? parsed.Browser : null,
    protocolVersion:
      typeof parsed['Protocol-Version'] === 'string'
        ? (parsed['Protocol-Version'] as string)
        : null,
    webSocketDebuggerUrl:
      typeof parsed.webSocketDebuggerUrl === 'string' ? parsed.webSocketDebuggerUrl : null,
  };
}

async function assertOwnedSession(sessionId: string, userId: string): Promise<void> {
  const row = (await pgGet(
    'SELECT 1 AS ok FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  )) as unknown as { ok: number } | undefined;

  if (!row?.ok) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }
}

async function getOwnedSessionContext(
  req: Request
): Promise<{ sessionId: string; userId: string }> {
  const sessionId = (req.params.sessionId || '').trim();
  if (!sessionId) {
    throw new AppError('Missing session ID', 400, 'VALIDATION_ERROR');
  }

  const userId = (req as AuthenticatedRequest).userId;
  await assertOwnedSession(sessionId, userId);
  return { sessionId, userId };
}

router.get('/test', async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const settings = await getOracleBrowserSettingsForUser(userId);
  const mode = settings?.mode || 'profile';
  const chatgptUrl = settings?.chatgptUrl || 'https://chatgpt.com/';

  if (mode === 'remote') {
    const target = settings?.remoteChrome?.trim() || '';
    if (!target) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REMOTE_CHROME',
          message: 'Remote mode is selected but no Chrome DevTools target is configured.',
        },
      });
    }

    try {
      const probe = await probeRemoteChrome(target);
      return res.json({
        success: true,
        data: {
          connected: true,
          mode,
          remoteChrome: target,
          chatgptUrl,
          browser: probe.browser,
          protocolVersion: probe.protocolVersion,
          webSocketDebuggerUrl: probe.webSocketDebuggerUrl,
          message: `Remote Chrome at ${target} is reachable.`,
        },
      });
    } catch (error) {
      return res.status(502).json({
        success: false,
        data: {
          connected: false,
          mode,
          remoteChrome: target,
          chatgptUrl,
        },
        error: {
          code: 'REMOTE_CHROME_UNREACHABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const browserPath =
    process.env.CHROME_BIN ||
    process.env.CHROMIUM_PATH ||
    process.env.BROWSER ||
    '/usr/local/bin/plum-chromium';
  const browserExists = existsSync(browserPath);
  const message =
    mode === 'manual'
      ? browserExists
        ? 'Oracle can launch the container Chromium binary for a manual ChatGPT login flow.'
        : 'Manual login mode needs a Chromium binary inside the container, but the configured path was not found.'
      : browserExists
        ? 'Oracle will use the container Chromium binary and try to copy ChatGPT cookies from the configured profile.'
        : 'Profile mode needs a Chromium binary inside the container, but the configured path was not found.';

  const payload = {
    connected: browserExists,
    mode,
    browserPath,
    chatgptUrl,
    chromeProfile: settings?.chromeProfile || null,
    chromeCookiePath: settings?.chromeCookiePath || null,
    manualLoginProfileDir: settings?.manualLoginProfileDir || null,
    message,
  };

  if (!browserExists) {
    return res.status(503).json({
      success: false,
      data: payload,
      error: {
        code: 'BROWSER_NOT_FOUND',
        message,
      },
    });
  }

  return res.json({ success: true, data: payload });
});

router.get('/browser/:sessionId', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const state = await getOracleBrowserManager().getState(sessionId, userId);
  res.json({ success: true, data: state });
});

router.post('/browser/:sessionId/start', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const url = typeof req.body?.url === 'string' ? req.body.url : undefined;
  const state = await getOracleBrowserManager().start(sessionId, userId, url);
  res.json({ success: true, data: state });
});

router.post('/browser/:sessionId/stop', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const state = await getOracleBrowserManager().stop(sessionId, userId);
  res.json({ success: true, data: state });
});

router.post('/browser/:sessionId/reload', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const state = await getOracleBrowserManager().reload(sessionId, userId);
  res.json({ success: true, data: state });
});

router.post('/browser/:sessionId/navigate', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  if (!url.trim()) {
    throw new AppError('Navigation URL is required', 400, 'VALIDATION_ERROR');
  }
  const state = await getOracleBrowserManager().navigate(sessionId, userId, url);
  res.json({ success: true, data: state });
});

router.get('/browser/:sessionId/frame', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const frame = await getOracleBrowserManager().captureFrame(sessionId, userId);
  res.setHeader('Content-Type', frame.contentType);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Oracle-Browser-Updated-At', String(frame.updatedAt));
  res.send(frame.body);
});

router.post('/browser/:sessionId/click', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const xRatio = Number(req.body?.xRatio);
  const yRatio = Number(req.body?.yRatio);
  const button =
    req.body?.button === 'middle' || req.body?.button === 'right' ? req.body.button : 'left';

  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
    throw new AppError('xRatio and yRatio are required', 400, 'VALIDATION_ERROR');
  }

  await getOracleBrowserManager().click(sessionId, userId, { xRatio, yRatio, button });
  res.json({ success: true });
});

router.post('/browser/:sessionId/wheel', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const xRatio = Number(req.body?.xRatio);
  const yRatio = Number(req.body?.yRatio);
  const deltaX = Number(req.body?.deltaX || 0);
  const deltaY = Number(req.body?.deltaY || 0);

  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
    throw new AppError('xRatio and yRatio are required', 400, 'VALIDATION_ERROR');
  }

  await getOracleBrowserManager().wheel(sessionId, userId, { xRatio, yRatio, deltaX, deltaY });
  res.json({ success: true });
});

router.post('/browser/:sessionId/key', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const key = typeof req.body?.key === 'string' ? req.body.key : '';
  if (!key) {
    throw new AppError('Key is required', 400, 'VALIDATION_ERROR');
  }

  await getOracleBrowserManager().key(sessionId, userId, {
    key,
    code: typeof req.body?.code === 'string' ? req.body.code : undefined,
    altKey: !!req.body?.altKey,
    ctrlKey: !!req.body?.ctrlKey,
    metaKey: !!req.body?.metaKey,
    shiftKey: !!req.body?.shiftKey,
  });
  res.json({ success: true });
});

router.post('/browser/:sessionId/text', async (req, res) => {
  const { sessionId, userId } = await getOwnedSessionContext(req);
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text) {
    throw new AppError('Text is required', 400, 'VALIDATION_ERROR');
  }

  await getOracleBrowserManager().text(sessionId, userId, text);
  res.json({ success: true });
});

const internalRouter = Router();

internalRouter.get('/runtime', requireHookSecret, async (req, res) => {
  const sessionId = (req.header('x-webui-session-id') || '').trim();
  const resolved = sessionId
    ? await getOracleRuntimeConfigForSession(sessionId)
    : { userId: null, config: buildOracleRuntimeConfig() };

  res.json({
    success: true,
    data: {
      sessionId: sessionId || null,
      userId: resolved.userId,
      ...resolved.config,
      embeddedRemoteChrome: sessionId
        ? await getOracleBrowserManager().getEmbeddedRemoteChromeTargetForSession(sessionId)
        : null,
    },
  });
});

internalRouter.post('/browser/start', requireHookSecret, async (req, res) => {
  const sessionId = (req.header('x-webui-session-id') || '').trim();
  if (!sessionId) {
    throw new AppError('Missing session ID', 400, 'VALIDATION_ERROR');
  }

  const resolved = await getOracleRuntimeConfigForSession(sessionId);
  if (!resolved.userId) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }

  const state = await getOracleBrowserManager().start(
    sessionId,
    resolved.userId,
    resolved.config.chatgptUrl
  );

  res.json({
    success: true,
    data: {
      sessionId,
      userId: resolved.userId,
      mode: resolved.config.mode,
      chatgptUrl: resolved.config.chatgptUrl,
      embeddedRemoteChrome: state.remoteChromeTarget,
      profileDir: state.profileDir,
      status: state.status,
      running: state.running,
      message: state.message,
    },
  });
});

router.use('/internal', internalRouter);

export default router;
