import { Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import { recordAudit } from '../utils/auditLog.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('app');

/**
 * Android in-app update channel. The client's AppUpdateChecker has called
 * GET /api/app/version since day one — this router finally answers it.
 *
 * Publishing a release means dropping two files into `<data>/android/`:
 *   claude-webui.apk   — the signed (or debug) APK
 *   version.json       — { "version": "1.1.0", "versionCode": 2, "releaseNotes": "…" }
 *
 * The download URL carries a short-lived HMAC token because Android's
 * DownloadManager fetches without the Authorization header.
 */
const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIRECTORY = process.env.WEBUI_DATA_DIR
  ? path.resolve(process.env.WEBUI_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const ANDROID_DIR = path.join(DATA_DIRECTORY, 'android');
const APK_PATH = path.join(ANDROID_DIR, 'claude-webui.apk');
const METADATA_PATH = path.join(ANDROID_DIR, 'version.json');

const DOWNLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', config.jwtSecret).update(payload).digest('hex');
}

function readMetadata(): { version: string; versionCode: number; releaseNotes?: string } | null {
  try {
    if (!fs.existsSync(APK_PATH) || !fs.existsSync(METADATA_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
    if (typeof parsed.version !== 'string' || typeof parsed.versionCode !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

router.get('/version', requireAuth, (req: Request, res: Response) => {
  const metadata = readMetadata();
  if (!metadata) {
    return res.status(404).json({
      success: false,
      error: { message: 'No Android release published' },
    });
  }
  const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const sig = sign(`apk.${metadata.versionCode}.${exp}`);
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    success: true,
    data: {
      version: metadata.version,
      versionCode: metadata.versionCode,
      releaseNotes: metadata.releaseNotes ?? null,
      downloadUrl: `${base}/api/app/download?vc=${metadata.versionCode}&exp=${exp}&sig=${sig}`,
    },
  });
});

router.get('/download', (req: Request, res: Response) => {
  const vc = String(req.query.vc ?? '');
  const exp = Number(req.query.exp ?? 0);
  const sig = String(req.query.sig ?? '');
  const expected = sign(`apk.${vc}.${exp}`);
  const valid =
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) &&
    exp > Date.now();
  if (!valid) {
    return res.status(403).json({ success: false, error: { message: 'Invalid download token' } });
  }
  if (!fs.existsSync(APK_PATH)) {
    return res.status(404).json({ success: false, error: { message: 'APK not found' } });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="claude-webui.apk"');
  fs.createReadStream(APK_PATH).pipe(res);
});

/**
 * Crash sink for the Android client.
 *
 * A crash on a phone left no trace anywhere: no Crashlytics, no local record,
 * nothing on the server. The client writes the stack trace to disk in its
 * uncaught-exception handler and posts it here on the next start, so a report
 * survives the process that produced it.
 *
 * Stored as an audit entry rather than a new table: it is low volume, already
 * has retention and an admin viewer, and a crash is exactly the kind of event
 * that log is for.
 */
const crashReportSchema = z.object({
  platform: z.string().max(40).default('android'),
  appVersion: z.string().max(80).optional(),
  osVersion: z.string().max(80).optional(),
  device: z.string().max(120).optional(),
  // Bounded so a pathological stack cannot fill the database.
  stackTrace: z.string().min(1).max(20_000),
  occurredAt: z.string().max(40).optional(),
});

router.post('/crash-report', requireAuth, (req: Request, res: Response) => {
  const parsed = crashReportSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Invalid crash report', 400, 'VALIDATION_ERROR');
  }
  const userId = (req as AuthenticatedRequest).userId;
  const report = parsed.data;

  log.error('Client crash reported', {
    platform: report.platform,
    appVersion: report.appVersion,
    device: report.device,
    // Only the first line here; the full trace goes to the audit entry.
    reason: report.stackTrace.split('\n')[0],
  });

  recordAudit({
    actorUserId: userId,
    action: 'client.crash',
    resourceType: report.platform,
    resourceId: report.appVersion ?? null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    metadata: {
      osVersion: report.osVersion ?? null,
      device: report.device ?? null,
      occurredAt: report.occurredAt ?? null,
      stackTrace: report.stackTrace,
    },
  });

  res.json({ success: true });
});

export default router;
