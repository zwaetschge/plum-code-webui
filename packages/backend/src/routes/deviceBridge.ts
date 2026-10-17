import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { get as pgGet } from '../db/pg.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { requireHookSecret } from '../middleware/hookSecret.js';
import { DeviceBridgeError, deviceBridge } from '../services/deviceBridge/bridge.js';

/**
 * Android device control.
 *
 * User-facing: which phones are paired over the app's device control
 * (accessibility-driven, no adb). Internal: the `android-device` MCP server
 * forwards agent tool calls here with the hook secret and its WebUI session
 * id; the bridge relays them over the device's socket.
 */

const router = Router();

router.get('/status', requireAuth, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  res.json({
    success: true,
    data: {
      devices: deviceBridge.listDevices(userId),
    },
  });
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

  if (parsed.data.tool === 'devices') {
    res.json({
      success: true,
      data: {
        content: [
          { type: 'text', text: JSON.stringify(deviceBridge.listDevices(row.user_id), null, 2) },
        ],
      },
    });
    return;
  }

  try {
    const result = await deviceBridge.call(
      row.user_id,
      { id: sessionId, name: row.name || sessionId },
      parsed.data.tool,
      parsed.data.args,
      { timeoutMs: parsed.data.timeoutMs, connectionId: parsed.data.connectionId }
    );
    res.json({ success: true, data: result });
  } catch (error) {
    const bridgeError = error instanceof DeviceBridgeError ? error : null;
    res.status(bridgeError?.status ?? 500).json({
      success: false,
      error: {
        code: bridgeError?.code ?? 'DEVICE_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

router.use('/internal', internalRouter);

export default router;
