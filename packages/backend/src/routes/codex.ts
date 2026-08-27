import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getCodexStatus, listCodexFeatures, setCodexFeature } from '../utils/codexCli.js';
import {
  installCodexPlugin,
  listCodexMarketplaces,
  listCodexPlugins,
  refreshCodexMarketplace,
  setCodexPluginEnabled,
} from '../utils/codexPlugins.js';

const router = Router();

const setFeatureSchema = z.object({
  enabled: z.boolean(),
});

const setPluginSchema = z.object({
  enabled: z.boolean(),
});

const installPluginSchema = z.object({
  pluginName: z.string().min(1),
  marketplaceId: z.string().min(1),
});

router.get('/status', requireAuth, async (_req, res) => {
  res.json({ success: true, data: await getCodexStatus() });
});

router.get('/features', requireAuth, async (_req, res) => {
  res.json({ success: true, data: await listCodexFeatures() });
});

router.post('/features/:name', requireAuth, requireAdmin, async (req, res) => {
  const parsed = setFeatureSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'enabled must be a boolean' },
    });
    return;
  }

  res.json({
    success: true,
    data: await setCodexFeature(req.params.name || '', parsed.data.enabled),
  });
});

router.get('/plugins', requireAuth, async (_req, res) => {
  res.json({ success: true, data: await listCodexPlugins() });
});

router.get('/marketplaces', requireAuth, async (_req, res) => {
  res.json({ success: true, data: await listCodexMarketplaces() });
});

router.post('/marketplace/:id/refresh', requireAuth, requireAdmin, async (req, res) => {
  res.json({ success: true, data: await refreshCodexMarketplace(req.params.id || '') });
});

router.post('/plugins/install', requireAuth, requireAdmin, async (req, res) => {
  const parsed = installPluginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'pluginName and marketplaceId are required',
      },
    });
    return;
  }

  res.json({
    success: true,
    data: await installCodexPlugin(parsed.data.pluginName, parsed.data.marketplaceId),
  });
});

router.post('/plugins/:id', requireAuth, requireAdmin, async (req, res) => {
  const parsed = setPluginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'enabled must be a boolean' },
    });
    return;
  }

  res.json({
    success: true,
    data: await setCodexPluginEnabled(req.params.id || '', parsed.data.enabled),
  });
});

export default router;
