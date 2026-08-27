import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

const BUILDER_API = (process.env.ANDROID_BUILDER_URL || 'http://host.docker.internal:4000').replace(
  /\/$/,
  ''
);
const REQUEST_TIMEOUT_MS = Number(process.env.ANDROID_BUILDER_TIMEOUT_MS || 60_000);

const sessionIdSchema = z.string().trim().min(1).max(200);
const serialSchema = z.string().trim().min(1).max(300);
const friendlyNameSchema = z.string().trim().min(1).max(80).optional();

const devicesQuerySchema = z.object({
  sessionId: sessionIdSchema.optional(),
});

const pairSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  pairingCode: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
  friendlyName: friendlyNameSchema,
  connectAfterPair: z.boolean().optional().default(true),
  connectPort: z.coerce.number().int().min(1).max(65535).optional().default(5555),
  selectForSession: z.boolean().optional().default(true),
});

const connectSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).optional().default(5555),
  friendlyName: friendlyNameSchema,
  selectForSession: z.boolean().optional().default(true),
  // Android hands out a fresh debug port on every wireless-debugging restart, so
  // reconnecting the same phone would otherwise pile up one known entry per port.
  // Carries the stale serial to drop once the new one is up.
  replaceSerial: serialSchema.optional(),
});

const bindDeviceSchema = z.object({
  serial: serialSchema.nullable(),
});

const emulatorStartSchema = z.object({
  avdName: z.string().trim().min(1).max(120).optional(),
});

function normalizeDevices<T extends Record<string, unknown>>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['devices', 'knownDevices', 'items', 'data']) {
      const value = obj[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

function readSerial(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of ['serial', 'id', 'deviceId', 'name']) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  if (obj.device && typeof obj.device === 'object') {
    return readSerial(obj.device);
  }
  return null;
}

function selectedDevice(
  live: Array<Record<string, unknown>>,
  known: Array<Record<string, unknown>>,
  serial: string | null
): Record<string, unknown> | null {
  if (!serial) return null;
  return (
    live.find((device) => readSerial(device) === serial) ||
    known.find((device) => readSerial(device) === serial) ||
    null
  );
}

async function builderRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BUILDER_API}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok) {
      const payload = parsed as { error?: string; message?: string; raw?: string } | null;
      const detail =
        payload?.error || payload?.message || payload?.raw || `HTTP ${response.status}`;
      throw new AppError(`Android builder request failed: ${detail}`, 502, 'ANDROID_BUILDER_ERROR');
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new AppError(
      `Android builder unavailable: ${message}`,
      502,
      'ANDROID_BUILDER_UNAVAILABLE'
    );
  } finally {
    clearTimeout(timer);
  }
}

async function builderBinaryRequest(path: string): Promise<{
  body: Buffer;
  contentType: string;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BUILDER_API}${path}`, { signal: ctrl.signal });
    if (!response.ok) {
      const detail = await response.text();
      throw new AppError(
        `Android builder request failed: ${detail || `HTTP ${response.status}`}`,
        502,
        'ANDROID_BUILDER_ERROR'
      );
    }
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new AppError(
      `Android builder unavailable: ${message}`,
      502,
      'ANDROID_BUILDER_UNAVAILABLE'
    );
  } finally {
    clearTimeout(timer);
  }
}

function requireSession(sessionId: string, userId: string): void {
  const db = getDatabase();
  const row = db
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId) as { id: string } | undefined;
  if (!row) {
    throw new AppError('Session not found', 404, 'NOT_FOUND');
  }
}

function getSessionSerial(sessionId: string | undefined, userId: string): string | null {
  if (!sessionId) return null;
  requireSession(sessionId, userId);
  const db = getDatabase();
  const row = db
    .prepare('SELECT android_device_serial as serial FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId) as { serial: string | null } | undefined;
  return row?.serial?.trim() || null;
}

function bindSessionSerial(sessionId: string, userId: string, serial: string | null): void {
  requireSession(sessionId, userId);
  const normalized = serial?.trim() || null;
  getDatabase()
    .prepare(
      `UPDATE sessions
       SET android_device_serial = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    )
    .run(normalized, sessionId, userId);
}

function parsePathParam(schema: z.ZodType<string>, value: unknown, label: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(`Invalid ${label}`, 400, 'VALIDATION_ERROR');
  }
  return parsed.data;
}

async function loadSnapshot(sessionId: string | undefined, userId: string) {
  const [livePayload, knownPayload] = await Promise.all([
    builderRequest<unknown>('GET', '/api/devices'),
    builderRequest<unknown>('GET', '/api/devices/known'),
  ]);
  const live = normalizeDevices(livePayload);
  const known = normalizeDevices(knownPayload);
  const selectedSerial = getSessionSerial(sessionId, userId);
  return {
    live,
    known,
    selectedSerial,
    selectedDevice: selectedDevice(live, known, selectedSerial),
  };
}

router.get(
  '/health',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const health = await builderRequest<unknown>('GET', '/api/health');
    res.json({ success: true, data: health });
  })
);

router.get(
  '/emulator/status',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const status = await builderRequest<unknown>('GET', '/api/emulator/status');
    res.json({ success: true, data: status });
  })
);

router.post(
  '/emulator/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = emulatorStartSchema.safeParse(req.body || {});
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }
    const result = await builderRequest<unknown>('POST', '/api/emulator/start', parsed.data);
    res.json({ success: true, data: result });
  })
);

router.post(
  '/emulator/stop',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const result = await builderRequest<unknown>('POST', '/api/emulator/stop');
    res.json({ success: true, data: result });
  })
);

router.get(
  '/devices/:serial/screenshot.png',
  requireAuth,
  asyncHandler(async (req, res) => {
    const serial = parsePathParam(serialSchema, req.params.serial, 'serial');
    const screenshot = await builderBinaryRequest(
      `/api/devices/${encodeURIComponent(serial)}/screenshot.png`
    );
    res.setHeader('Content-Type', screenshot.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(screenshot.body.length));
    res.end(screenshot.body);
  })
);

router.get(
  '/devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const parsed = devicesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    const data = await loadSnapshot(parsed.data.sessionId, userId);
    res.json({ success: true, data });
  })
);

router.post(
  '/devices/reconnect-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId =
      typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
        ? req.query.sessionId.trim()
        : undefined;
    if (sessionId) requireSession(sessionId, userId);

    const result = await builderRequest<unknown>('POST', '/api/devices/reconnect-all');
    const devices = await loadSnapshot(sessionId, userId);
    res.json({ success: true, data: { result, devices } });
  })
);

router.post(
  '/devices/pair',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const parsed = pairSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    const {
      sessionId,
      host,
      port,
      pairingCode,
      friendlyName,
      connectAfterPair,
      connectPort,
      selectForSession,
    } = parsed.data;
    if (sessionId) requireSession(sessionId, userId);

    const pair = await builderRequest<unknown>('POST', '/api/devices/pair', {
      host,
      port,
      pairingCode,
      ...(friendlyName ? { friendlyName } : {}),
    });

    let connect: unknown | null = null;
    let connectError: string | undefined;
    let selectedSerial = readSerial(pair);

    if (connectAfterPair) {
      try {
        connect = await builderRequest<unknown>('POST', '/api/devices/connect', {
          host,
          port: connectPort,
          ...(friendlyName ? { friendlyName } : {}),
        });
        selectedSerial = readSerial(connect) || selectedSerial || `${host}:${connectPort}`;
      } catch (error) {
        connectError = error instanceof Error ? error.message : 'connect failed';
      }
    }

    if (sessionId && selectForSession && selectedSerial) {
      bindSessionSerial(sessionId, userId, selectedSerial);
    }

    const devices = await loadSnapshot(sessionId, userId);
    res.json({ success: true, data: { pair, connect, connectError, selectedSerial, devices } });
  })
);

router.post(
  '/devices/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    const { sessionId, host, port, friendlyName, selectForSession, replaceSerial } = parsed.data;
    if (sessionId) requireSession(sessionId, userId);

    const connect = await builderRequest<unknown>('POST', '/api/devices/connect', {
      host,
      port,
      ...(friendlyName ? { friendlyName } : {}),
    });
    const selectedSerial = readSerial(connect) || `${host}:${port}`;

    // Only after the new port answers, so a failed reconnect never loses the
    // entry the user would need to try again.
    let replacedSerial: string | undefined;
    if (replaceSerial && replaceSerial !== selectedSerial) {
      try {
        await builderRequest<unknown>(
          'DELETE',
          `/api/devices/known/${encodeURIComponent(replaceSerial)}`
        );
        replacedSerial = replaceSerial;
      } catch {
        // The stale entry is cosmetic; a live connection matters more.
      }
    }

    if (sessionId && selectForSession) {
      bindSessionSerial(sessionId, userId, selectedSerial);
    }

    const devices = await loadSnapshot(sessionId, userId);
    res.json({ success: true, data: { connect, selectedSerial, replacedSerial, devices } });
  })
);

router.put(
  '/sessions/:sessionId/device',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = parsePathParam(sessionIdSchema, req.params.sessionId, 'session id');
    const parsed = bindDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
    }

    bindSessionSerial(sessionId, userId, parsed.data.serial);
    const devices = await loadSnapshot(sessionId, userId);
    res.json({ success: true, data: devices });
  })
);

router.delete(
  '/sessions/:sessionId/device',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = parsePathParam(sessionIdSchema, req.params.sessionId, 'session id');
    bindSessionSerial(sessionId, userId, null);
    const devices = await loadSnapshot(sessionId, userId);
    res.json({ success: true, data: devices });
  })
);

router.post(
  '/devices/:serial/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    const serial = parsePathParam(serialSchema, req.params.serial, 'serial');
    const result = await builderRequest<unknown>('POST', '/api/devices/disconnect', { serial });
    res.json({ success: true, data: result });
  })
);

router.delete(
  '/devices/:serial',
  requireAuth,
  asyncHandler(async (req, res) => {
    const serial = parsePathParam(serialSchema, req.params.serial, 'serial');
    const result = await builderRequest<unknown>(
      'DELETE',
      `/api/devices/known/${encodeURIComponent(serial)}`
    );
    res.json({ success: true, data: result });
  })
);

export default router;
