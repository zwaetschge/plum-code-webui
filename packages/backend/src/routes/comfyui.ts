import { get as pgGet, run as pgRun } from '../db/pg.js';
/**
 * REST API for ComfyUI image generation.
 *
 *   GET  /api/comfyui/workflows        — list available templates + params
 *   GET  /api/comfyui/settings         — current ComfyUI URL + enabled flag
 *   PUT  /api/comfyui/settings         — admin: change URL / enable / disable
 *   GET  /api/comfyui/test             — ping ComfyUI (returns version on success)
 *   POST /api/comfyui/upload-image     — upload reference image for edit workflow
 *   POST /api/comfyui/generate         — submit a generation job, returns id
 *   GET  /api/comfyui/generation/:id   — poll job state + final image URL
 *
 * The actual ComfyUI HTTP communication lives in `services/comfyui/`.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import path from 'node:path';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/auth.js';
import { requireHookSecret } from '../middleware/hookSecret.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import {
  comfyui,
  listWorkflows,
  VALID_ASPECTS,
  VALID_MEGAPIXELS,
  type WorkflowId,
} from '../services/comfyui/index.js';

const router = Router();

// Apply requireAuth only to non-internal paths. /internal/* uses hook-secret auth.
router.use((req, res, next) => {
  if (req.path.startsWith('/internal/')) return next();
  return requireAuth(req, res, next);
});

const WORKFLOW_IDS = [
  'z-image-turbo',
  'flux2-klein-t2i',
  'flux2-klein-edit',
  'krea2-t2i',
  'f2k-edit',
] as const;

const paramsSchema = z.object({
  prompt: z.string().min(3).max(4000),
  negative_prompt: z.string().max(2000).optional(),
  seed: z.number().int().nonnegative().optional(),
  steps: z.number().int().min(1).max(60).optional(),
  cfg: z.number().min(0).max(20).optional(),
  sampler_name: z.string().max(64).optional(),
  scheduler: z.string().max(64).optional(),
  megapixel: z.enum(VALID_MEGAPIXELS).optional(),
  aspect_ratio: z.enum(VALID_ASPECTS).optional(),
  unet: z.string().max(256).optional(),
  clip: z.string().max(256).optional(),
  vae: z.string().max(256).optional(),
  lora_name: z.string().max(256).optional(),
  lora_strength: z.number().min(0).max(2).optional(),
  teacache_threshold: z.number().min(0).max(1).optional(),
  input_image: z.string().max(512).optional(),
  filename_prefix: z.string().max(128).optional(),
});

const generateSchema = z.object({
  workflow: z.enum(WORKFLOW_IDS),
  params: paramsSchema,
});

const settingsSchema = z.object({
  url: z.string().url().optional(),
  enabled: z.boolean().optional(),
});

// In-memory temp storage for image uploads — files land in OS tmp, get
// forwarded to ComfyUI's /input, then deleted locally. 25 MB cap (ComfyUI's
// own LoadImage handles up to ~50MB for typical RGB PNGs).
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), 'webui-comfyui-uploads');
      await mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err) => cb(err, dir));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '.png').toLowerCase() || '.png';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`unsupported mime type: ${file.mimetype}`));
  },
});

// ── GET /workflows ─────────────────────────────────────────────────────
router.get('/workflows', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      workflows: listWorkflows(),
      validation: {
        aspect_ratios: VALID_ASPECTS,
        megapixels: VALID_MEGAPIXELS,
      },
    },
  });
});

// ── GET /settings ──────────────────────────────────────────────────────
router.get('/settings', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      url: await comfyui.getBaseUrl(),
      enabled: await comfyui.isEnabled(),
      output_dir_public: '/generated',
    },
  });
});

// ── PUT /settings (admin only) ──────────────────────────────────────────
router.put('/settings', requireAdmin, async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } });
  }
  try {
    if (parsed.data.url) {
      await comfyui.setBaseUrl(parsed.data.url);
    }
    if (parsed.data.enabled !== undefined) {
      await pgRun(
        `INSERT INTO app_config (key, value) VALUES ('comfyui_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        parsed.data.enabled ? 'true' : 'false'
      );
    }
    res.json({
      success: true,
      data: { url: await comfyui.getBaseUrl(), enabled: await comfyui.isEnabled() },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        code: 'COMFYUI_SETTINGS_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
});

// ── GET /test ──────────────────────────────────────────────────────────
router.get('/test', async (_req: Request, res: Response) => {
  const probe = await (await comfyui.client()).ping();
  if (probe.ok) {
    res.json({ success: true, data: { reachable: true, version: probe.version || null } });
  } else {
    res.status(502).json({
      success: false,
      data: { reachable: false },
      error: { code: 'UNREACHABLE', message: probe.error },
    });
  }
});

// ── POST /upload-image ─────────────────────────────────────────────────
router.post(
  '/upload-image',
  rateLimiters.upload,
  upload.single('image'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: { code: 'NO_FILE', message: 'image field required' } });
    }
    try {
      const authReq = req as AuthenticatedRequest;
      const bytes = await readFile(req.file.path);
      const uploaded = await comfyui.uploadInputImage(
        authReq.userId,
        req.file.originalname || req.file.filename,
        bytes,
        req.file.mimetype
      );
      await unlink(req.file.path).catch(() => undefined);
      res.json({ success: true, data: uploaded });
    } catch (err) {
      await unlink(req.file.path).catch(() => undefined);
      res.status(502).json({
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
);

// ── POST /generate ─────────────────────────────────────────────────────
router.post('/generate', rateLimiters.imageGeneration, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } });
  }
  try {
    const job = await comfyui.generate(
      authReq.userId!,
      parsed.data.workflow as WorkflowId,
      parsed.data.params
    );
    res.json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        workflow: job.workflowId,
        createdAt: job.createdAt,
      },
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: {
        code: 'GENERATE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
});

// ── GET /generation/:id ────────────────────────────────────────────────
router.get('/generation/:id', (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const job = comfyui.getJob(req.params.id!, authReq.userId);
  if (!job) {
    return res
      .status(404)
      .json({ success: false, error: { code: 'NOT_FOUND', message: 'unknown generation id' } });
  }
  res.json({
    success: true,
    data: {
      id: job.id,
      status: job.status,
      workflow: job.workflowId,
      promptId: job.promptId ?? null,
      seed: job.seed ?? null,
      outputUrl: job.outputUrl ?? null,
      outputFilename: job.outputFilename ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
});

// ── Internal MCP endpoint — hook-secret auth, synchronous wait ─────────
// Mounted on a sub-router so it bypasses the user-auth applied above. The
// caller (comfyui MCP server inside the same container) supplies the secret
// in X-Webui-Hook-Secret and the WebUI session id in X-Webui-Session-Id; we
// resolve the latter to a user id for attribution.
const internalRouter = Router();

// Discovery for the MCP bridge (mirrors the official Comfy MCP's template
// tools): ids, defaults and accepted params, so agents pick a workflow
// instead of hardcoding one.
internalRouter.get('/workflows', requireHookSecret, (_req: Request, res: Response) => {
  res.json({ success: true, data: { workflows: listWorkflows() } });
});

internalRouter.post('/generate', requireHookSecret, async (req: Request, res: Response) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } });
  }
  const sessionId = req.header('x-webui-session-id') || '';
  if (!sessionId) {
    return res.status(403).json({
      success: false,
      error: { code: 'SESSION_REQUIRED', message: 'WebUI session identity is required' },
    });
  }
  const row = (await pgGet('SELECT user_id FROM sessions WHERE id = ?', sessionId)) as unknown as
    | { user_id: string }
    | undefined;
  if (!row?.user_id) {
    return res.status(403).json({
      success: false,
      error: { code: 'INVALID_SESSION', message: 'Unknown WebUI session identity' },
    });
  }
  const userId = row.user_id;
  try {
    const job = await comfyui.generateAndWait(
      userId,
      parsed.data.workflow as WorkflowId,
      parsed.data.params,
      { timeoutMs: 5 * 60 * 1000 }
    );
    res.json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        seed: job.seed ?? null,
        outputUrl: job.outputUrl ?? null,
        outputFilename: job.outputFilename ?? null,
        error: job.error ?? null,
      },
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: {
        code: 'GENERATE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
});

router.use('/internal', internalRouter);

export default router;
