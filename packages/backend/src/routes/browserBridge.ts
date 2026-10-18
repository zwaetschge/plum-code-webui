import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { get as pgGet } from '../db/pg.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { requireHookSecret } from '../middleware/hookSecret.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { BrowserBridgeError, browserBridge } from '../services/browserBridge/bridge.js';
import {
  buildPairedChromePackage,
  EXTENSION_FILES,
  findExtensionArtifact,
} from '../services/browserBridge/package.js';
import {
  createBrowserToken,
  listBrowserTokens,
  resolveBrowserToken,
  revokeBrowserToken,
} from '../services/browserBridge/tokens.js';
import { deskSpeech, deskTranscribe, deskTurn, deskWake } from '../services/browserBridge/desk.js';
import {
  createInstallCode,
  DESKTOP_RULES,
  getDesktopRules,
  installScript,
  setDesktopRules,
} from '../services/browserBridge/desktop.js';

/**
 * Firefox browser control.
 *
 * User-facing: pair a Firefox extension (mint/revoke `plum_ff_` tokens), see
 * which browsers are connected, download the extension. Internal: the
 * `firefox` MCP server forwards agent tool calls here with the hook secret and
 * its WebUI session id; the bridge relays them over the extension's socket.
 */

const router = Router();

function rejectGatewayCaller(req: Request): void {
  if ((req as AuthenticatedRequest).viaGateway) {
    throw new AppError('Gateway tokens cannot pair browsers', 403, 'GATEWAY_FORBIDDEN');
  }
}

router.get('/status', requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  res.json({
    success: true,
    data: {
      connections: browserBridge.listConnections(userId),
      extensionAvailable: !!findExtensionArtifact(EXTENSION_FILES.firefox),
      chromeExtensionAvailable: !!findExtensionArtifact(EXTENSION_FILES.chrome),
    },
  });
});

router.get('/tokens', requireAuth, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = (req as AuthenticatedRequest).userId;
  res.json({ success: true, data: await listBrowserTokens(userId) });
});

router.post('/tokens', requireAuth, rateLimiters.strict, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) throw new AppError('A browser name is required', 400, 'VALIDATION_ERROR');
  const userId = (req as AuthenticatedRequest).userId;
  const { token, row } = await createBrowserToken(userId, parsed.data.name);
  // The only time the secret is ever returned.
  res.json({ success: true, data: { ...row, token } });
});

router.delete('/tokens/:id', requireAuth, async (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const userId = (req as AuthenticatedRequest).userId;
  const removed = await revokeBrowserToken(userId, req.params.id!);
  if (!removed) throw new AppError('Token not found', 404, 'NOT_FOUND');
  browserBridge.disconnectToken(req.params.id!);
  res.json({ success: true, data: { id: req.params.id } });
});

router.get('/extension.xpi', requireAuth, (_req: Request, res: Response) => {
  const file = findExtensionArtifact(EXTENSION_FILES.firefox);
  if (!file) throw new AppError('Extension package not built', 404, 'NOT_FOUND');
  res.setHeader('Content-Type', 'application/x-xpinstall');
  res.setHeader('Content-Disposition', `attachment; filename="${EXTENSION_FILES.firefox}"`);
  res.sendFile(file);
});

// Chrome/Edge: unpacked MV3 build as a zip, for chrome://extensions → "Load unpacked".
router.get('/extension-chrome.zip', requireAuth, (_req: Request, res: Response) => {
  const file = findExtensionArtifact(EXTENSION_FILES.chrome);
  if (!file) throw new AppError('Extension package not built', 404, 'NOT_FOUND');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${EXTENSION_FILES.chrome}"`);
  res.sendFile(file);
});

/**
 * Chrome package with this Plum's address and a freshly minted pairing token in
 * `plum-config.json`: unzip, Load unpacked, and it connects by itself.
 */
router.post(
  '/extension-chrome-paired.zip',
  requireAuth,
  rateLimiters.strict,
  async (req: Request, res: Response) => {
    rejectGatewayCaller(req);
    const parsed = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
    if (!parsed.success) throw new AppError('A browser name is required', 400, 'VALIDATION_ERROR');
    const userId = (req as AuthenticatedRequest).userId;
    // trust proxy is set, so protocol and host are the ones the user's browser used.
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    let pkg;
    try {
      pkg = await buildPairedChromePackage({ userId, name: parsed.data.name, serverUrl });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Extension package not built', 404, 'NOT_FOUND');
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pkg.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pkg.zip);
  }
);

/**
 * Live view for the WebUI and the Android app: a current picture of the tab a
 * session works in, cursor and marks included.
 */
router.get('/live/:sessionId', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const sessionId = req.params.sessionId!;
  const row = (await pgGet(
    'SELECT name FROM sessions WHERE id = ? AND user_id = ?',
    sessionId,
    userId
  )) as unknown as { name: string | null } | undefined;
  if (!row) throw new AppError('Session not found', 404, 'NOT_FOUND');
  try {
    const result = await browserBridge.call(
      userId,
      { id: sessionId, name: row.name || sessionId },
      'peek',
      {},
      { timeoutMs: 12_000 }
    );
    const image = result.content.find((item) => item.type === 'image');
    const info = result.content.find((item) => item.type === 'text');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        image: image ? { data: image.data, mimeType: image.mimeType } : null,
        info: typeof info?.text === 'string' ? info.text : null,
        paused: browserBridge
          .listConnections(userId)
          .some((conn) => conn.client.kind === 'browser' && conn.paused),
        at: new Date().toISOString(),
      },
    });
  } catch (error) {
    const bridgeError = error instanceof BrowserBridgeError ? error : null;
    res.json({
      success: true,
      data: {
        image: null,
        info: error instanceof Error ? error.message : String(error),
        code: bridgeError?.code ?? 'BROWSER_ERROR',
        paused: false,
        at: new Date().toISOString(),
      },
    });
  }
});

router.post('/pause', requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const paused = req.body?.paused === true;
  res.json({ success: true, data: { paused, browsers: browserBridge.setPaused(userId, paused) } });
});

// ---------------------------------------------------------------- Plum Desktop

router.get('/desktop/rules', requireAuth, async (req: Request, res: Response) => {
  res.json({ success: true, data: await getDesktopRules((req as AuthenticatedRequest).userId) });
});

router.put('/desktop/rules', requireAuth, async (req: Request, res: Response) => {
  const parsed = DESKTOP_RULES.safeParse(req.body?.rules);
  if (!parsed.success) throw new AppError('Invalid desktop rules', 400, 'VALIDATION_ERROR');
  const userId = (req as AuthenticatedRequest).userId;
  const rules = await setDesktopRules(userId, parsed.data);
  browserBridge.sendDesktop(userId, { type: 'rules', rules });
  res.json({ success: true, data: rules });
});

router.post('/desktop/mode', requireAuth, (req: Request, res: Response) => {
  const parsed = z
    .object({
      mode: z.enum(['control', 'guide', 'paused']),
      connectionId: z.string().max(40).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    throw new AppError('mode must be control, guide or paused', 400, 'VALIDATION_ERROR');
  const reached = browserBridge.sendDesktop(
    (req as AuthenticatedRequest).userId,
    { type: 'control', mode: parsed.data.mode },
    parsed.data.connectionId
  );
  if (!reached) throw new AppError('Plum Desktop is not connected', 409, 'DESKTOP_NOT_CONNECTED');
  res.json({ success: true, data: { mode: parsed.data.mode, reached } });
});

router.post('/desktop/record', requireAuth, (req: Request, res: Response) => {
  const parsed = z
    .object({
      action: z.enum(['start', 'stop', 'cancel']),
      connectionId: z.string().max(40).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    throw new AppError('action must be start, stop or cancel', 400, 'VALIDATION_ERROR');
  const reached = browserBridge.sendDesktop(
    (req as AuthenticatedRequest).userId,
    { type: 'control', record: parsed.data.action },
    parsed.data.connectionId
  );
  if (!reached) throw new AppError('Plum Desktop is not connected', 409, 'DESKTOP_NOT_CONNECTED');
  res.json({ success: true, data: { action: parsed.data.action, reached } });
});

router.post('/desktop/action', requireAuth, (req: Request, res: Response) => {
  const parsed = z
    .object({
      connectionId: z.string().min(1).max(40),
      action: z.enum(['stop', 'message', 'context', 'open_result', 'layout']),
      message: z.string().trim().max(4000).optional(),
      layout: z
        .object({
          chatScreen: z.string().max(120).optional(),
          chatPlacement: z.enum(['floating', 'left', 'right', 'full']).optional(),
          chatVisible: z.boolean().optional(),
          chatZoom: z.number().int().min(100).max(250).optional(),
          chatInsetTop: z.number().int().min(0).max(200).optional(),
        })
        .optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) throw new AppError('Ungültige Desktop-Aktion', 400, 'VALIDATION_ERROR');
  const body = parsed.data;
  if (body.action === 'message' && !body.message)
    throw new AppError('Eine Nachricht ist erforderlich', 400, 'VALIDATION_ERROR');
  const reached = browserBridge.sendDesktop(
    (req as AuthenticatedRequest).userId,
    { type: 'control', action: body.action, message: body.message, layout: body.layout },
    body.connectionId
  );
  if (!reached) throw new AppError('Computer ist nicht verbunden', 409, 'DESKTOP_NOT_CONNECTED');
  res.json({ success: true, data: { reached, status: 'dispatched' } });
});

/** Origin the caller reached Plum on; the installer and the companion use it. */
function publicOrigin(req: Request): string {
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0]!.trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0]!.trim();
  return `${proto}://${host}`;
}

router.post('/desktop/install', requireAuth, rateLimiters.strict, (req: Request, res: Response) => {
  rejectGatewayCaller(req);
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) throw new AppError('A computer name is required', 400, 'VALIDATION_ERROR');
  const { code, expiresAt } = createInstallCode(
    (req as AuthenticatedRequest).userId,
    parsed.data.name
  );
  const url = `${publicOrigin(req)}/mobile/api/browser-bridge/desktop/install?code=${code}`;
  res.json({ success: true, data: { command: `curl -fsSL '${url}' | bash`, expiresAt } });
});

// Public through the /mobile gateway: the single-use code is the credential.
router.get('/desktop/install', rateLimiters.strict, async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const script = code ? await installScript(code, publicOrigin(req)) : null;
  res.type('text/x-shellscript');
  if (!script) {
    res
      .status(410)
      .send(
        "echo 'Plum: Installationscode ist abgelaufen oder schon benutzt. Neuen Befehl in Plum erzeugen.'; exit 1\n"
      );
    return;
  }
  res.send(script);
});

const internalRouter = Router();

/**
 * The agent's current status line: a turn saves every assistant text block
 * (also the short lines between tool calls) as a message, so the latest one
 * of the last few minutes says what it is doing right now. Markdown is
 * flattened and long texts are cut to their last paragraph.
 */
async function latestAgentNote(sessionId: string): Promise<string | undefined> {
  try {
    const row = (await pgGet(
      `SELECT content, created_at FROM messages
        WHERE session_id = ? AND role = 'assistant'
        ORDER BY created_at DESC LIMIT 1`,
      sessionId
    )) as unknown as { content: string | null; created_at: string | null } | undefined;
    const raw = String(row?.content || '').trim();
    if (!raw) return undefined;
    // created_at is TEXT "YYYY-MM-DD HH:MM:SS" in UTC; older than 10 minutes is stale.
    const stamp = String(row?.created_at || '');
    const at = Date.parse(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`);
    if (Number.isFinite(at) && Date.now() - at > 10 * 60 * 1000) return undefined;
    const paragraphs = raw
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    const last = paragraphs[paragraphs.length - 1] || raw;
    const flat = last
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_`#>]+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (!flat) return undefined;
    return flat.length > 180 ? `${flat.slice(0, 177).trimEnd()}…` : flat;
  } catch {
    return undefined;
  }
}

const callSchema = z.object({
  tool: z.string().min(1).max(64),
  args: z.record(z.string(), z.unknown()).optional().default({}),
  timeoutMs: z.number().int().positive().optional(),
  connectionId: z.string().max(40).optional(),
});

internalRouter.post('/call', requireHookSecret, async (req: Request, res: Response) => {
  const parsed = callSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } });
    return;
  }
  const sessionId = req.header('x-webui-session-id') || '';
  const row = sessionId
    ? ((await pgGet('SELECT user_id, name FROM sessions WHERE id = ?', sessionId)) as unknown as
        | { user_id: string; name: string | null }
        | undefined)
    : undefined;
  if (!row?.user_id) {
    res.status(403).json({
      success: false,
      error: { code: 'SESSION_REQUIRED', message: 'A valid WebUI session identity is required' },
    });
    return;
  }

  if (parsed.data.tool === 'connections' || parsed.data.tool === 'select_browser') {
    try {
      const data =
        parsed.data.tool === 'select_browser'
          ? browserBridge.selectBrowser(
              row.user_id,
              sessionId,
              String(parsed.data.args.browser ?? 'auto')
            )
          : browserBridge.describeForSession(row.user_id, sessionId);
      res.json({
        success: true,
        data: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] },
      });
    } catch (error) {
      const bridgeError = error instanceof BrowserBridgeError ? error : null;
      res.status(bridgeError?.status ?? 500).json({
        success: false,
        error: {
          code: bridgeError?.code ?? 'BROWSER_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    return;
  }

  try {
    const isDesktop = parsed.data.tool.startsWith('desktop_');
    const result = await browserBridge.call(
      row.user_id,
      {
        id: sessionId,
        name: row.name || sessionId,
        // Plum Desktop shows what the agent is doing next to its cursor.
        ...(isDesktop ? { note: await latestAgentNote(sessionId) } : {}),
      },
      parsed.data.tool,
      parsed.data.args,
      {
        timeoutMs: parsed.data.timeoutMs,
        connectionId: parsed.data.connectionId,
        // desktop_* tools go to the desktop companion, everything else to a browser.
        kind: parsed.data.tool.startsWith('desktop_') ? 'desktop' : 'browser',
      }
    );
    res.json({ success: true, data: result });
  } catch (error) {
    const bridgeError = error instanceof BrowserBridgeError ? error : null;
    res.status(bridgeError?.status ?? 500).json({
      success: false,
      error: {
        code: bridgeError?.code ?? 'BROWSER_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

router.use('/internal', internalRouter);

// ---------------------------------------------------------------- Plum Desk
//
// The ESP32 desk board runs the voice-mode loop against these three routes.
// It has no Plum login; it sends its `plum_ff_` device token as a bearer
// token. Reachable through the /mobile gateway (see mobileGateway.ts).

async function deskOwner(req: Request): Promise<string> {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const resolved = await resolveBrowserToken(token);
  if (!resolved) throw new AppError('Invalid device token', 401, 'UNAUTHORIZED');
  return resolved.userId;
}

router.post(
  '/desk/transcribe',
  rateLimiters.standard,
  express.raw({ type: () => true, limit: '8mb' }),
  async (req: Request, res: Response) => {
    const userId = await deskOwner(req);
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000)
      throw new AppError('Audio fehlt', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: { text: await deskTranscribe(userId, req.body) } });
  }
);

router.post(
  '/desk/wake',
  rateLimiters.standard,
  express.raw({ type: () => true, limit: '2mb' }),
  async (req: Request, res: Response) => {
    const userId = await deskOwner(req);
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000)
      throw new AppError('Audio fehlt', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await deskWake(userId, req.body) });
  }
);

router.post('/desk/turn', rateLimiters.standard, async (req: Request, res: Response) => {
  const userId = await deskOwner(req);
  const parsed = z
    .object({
      text: z.string().trim().min(1).max(4000),
      chatId: z.string().min(1).max(200).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) throw new AppError('text is required', 400, 'VALIDATION_ERROR');
  res.json({ success: true, data: await deskTurn(userId, parsed.data) });
});

router.post('/desk/speech', rateLimiters.standard, async (req: Request, res: Response) => {
  const userId = await deskOwner(req);
  const parsed = z
    .object({
      text: z.string().trim().min(1).max(1000),
      voice: z.string().trim().min(1).max(100).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) throw new AppError('text is required', 400, 'VALIDATION_ERROR');
  const pcm = await deskSpeech(userId, parsed.data.text, parsed.data.voice);
  // Raw 16 kHz mono s16le: the board streams it straight into its speaker.
  res.setHeader('Content-Type', 'audio/L16; rate=16000; channels=1');
  res.setHeader('Content-Length', String(pcm.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(pcm);
});

export default router;
