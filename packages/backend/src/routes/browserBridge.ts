import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { get as pgGet } from '../db/pg.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { requireHookSecret } from '../middleware/hookSecret.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import { AppError } from '../middleware/errorHandler.js';
import { BrowserBridgeError, browserBridge } from '../services/browserBridge/bridge.js';
import { EXTENSION_FILES, findExtensionArtifact } from '../services/browserBridge/package.js';
import {
  createBrowserToken,
  listBrowserTokens,
  revokeBrowserToken,
} from '../services/browserBridge/tokens.js';

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

const internalRouter = Router();

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
    const result = await browserBridge.call(
      row.user_id,
      { id: sessionId, name: row.name || sessionId },
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

export default router;
