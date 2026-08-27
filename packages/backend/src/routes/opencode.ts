import { Router } from 'express';
import { z } from 'zod';
import { execFileSync } from 'child_process';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  buildOpenCodeCommandEnv,
  getOpenCodeProviderCatalog,
  resetOpenCodeProviderCatalogCache,
  resolveOpenCodeBinary,
  type OpenCodeProviderCatalog,
} from '../utils/opencodeCatalog.js';
import {
  buildOpenCodeProviderCredentialEnv,
  encryptOpenCodeProviderKey,
  getOpenCodeCredentialEnvVars,
  maskOpenCodeProvider,
  overlayOpenCodeProviderStatus,
  readOpenCodeProvidersForUser,
  writeOpenCodeProvidersForUser,
  type OpenCodeProvider,
} from '../utils/opencodeProviderKeys.js';
import {
  buildOpenCodeServerProcessEnv,
  opencodeServer,
} from '../services/opencode/OpencodeServer.js';
import {
  ensureOpenCodeTenantDirectories,
  resolveOpenCodeTenantPaths,
} from '../services/opencode/tenantPaths.js';
import { syncProviderLinks } from '../utils/providerLinks.js';

const router = Router();

// Get all OpenCode providers for the current user
router.get('/providers', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const catalog = getOpenCodeProviderCatalog();
    const providers = await readOpenCodeProvidersForUser(userId);
    const safeProviders = providers.map((provider) => maskOpenCodeProvider(provider, catalog));
    res.json({ success: true, data: safeProviders });
  } catch (error) {
    console.error('Error fetching OpenCode providers:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'ERROR', message: 'Failed to fetch providers' } });
  }
});

const upsertProviderSchema = z.object({
  id: z.string().min(1, 'Provider ID is required'),
  name: z.string().min(1, 'Provider name is required'),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  enabled: z.boolean().optional(),
  /** Omitted keeps the stored list; the harnesses read models from here. */
  models: z.array(z.string()).optional(),
});

const questionRespondSchema = z.object({
  requestId: z.string().min(1),
  providerSessionId: z.string().optional(),
  answers: z.array(z.array(z.string())),
});

const questionRejectSchema = z.object({
  requestId: z.string().min(1),
  providerSessionId: z.string().optional(),
});

// Save or update an OpenCode provider
router.put('/providers', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const result = upsertProviderSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: JSON.stringify(result.error.flatten()) },
      });
    }

    const { id, name, apiKey, baseUrl, enabled = true, models } = result.data;
    const normalizedModels = models
      ? [...new Set(models.map((model) => model.trim()).filter((model) => model.length > 0))]
      : undefined;
    const catalogProvider = getOpenCodeProviderCatalog()[id];
    const finalBaseUrl = baseUrl && baseUrl.trim() !== '' ? baseUrl.trim() : catalogProvider?.api;

    const providers = await readOpenCodeProvidersForUser(userId);
    const now = new Date().toISOString();
    const existingIndex = providers.findIndex((p) => p.id === id);
    const encryptedKey = encryptOpenCodeProviderKey(apiKey);

    let stored: OpenCodeProvider;
    if (existingIndex >= 0) {
      const existing = providers[existingIndex]!;
      stored = {
        id,
        name,
        apiKey: apiKey ? encryptedKey : existing.apiKey,
        baseUrl: finalBaseUrl,
        enabled,
        // Editing a key must not silently empty the model list the harnesses
        // resolve from.
        ...((normalizedModels ?? existing.models)
          ? { models: normalizedModels ?? existing.models }
          : {}),
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      providers[existingIndex] = stored;
    } else {
      stored = {
        id,
        name,
        apiKey: encryptedKey,
        baseUrl: finalBaseUrl,
        enabled,
        ...(normalizedModels ? { models: normalizedModels } : {}),
        createdAt: now,
        updatedAt: now,
      };
      providers.push(stored);
    }

    await writeOpenCodeProvidersForUser(userId, providers);
    resetOpenCodeProviderCatalogCache();
    awaitRestartOpenCodeServer(userId);

    res.json({
      success: true,
      data: maskOpenCodeProvider(stored),
    });
  } catch (error) {
    console.error('Error saving OpenCode provider:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'ERROR', message: 'Failed to save provider' } });
  }
});

// Delete an OpenCode provider
router.delete('/providers/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id } = req.params;
  try {
    const providers = (await readOpenCodeProvidersForUser(userId)).filter((p) => p.id !== id);
    await writeOpenCodeProvidersForUser(userId, providers);
    resetOpenCodeProviderCatalogCache();
    awaitRestartOpenCodeServer(userId);
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('Error deleting OpenCode provider:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'ERROR', message: 'Failed to delete provider' } });
  }
});

// Test an OpenCode provider connection
router.post('/providers/:id/test', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id } = req.params;
  if (!id) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'ERROR', message: 'Provider id required' } });
  }
  try {
    const providers = await readOpenCodeProvidersForUser(userId);
    const provider = providers.find((p) => p.id === id);

    if (!provider) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'ERROR', message: 'Provider not found' } });
    }

    const tenantPaths = resolveOpenCodeTenantPaths(userId);
    ensureOpenCodeTenantDirectories(tenantPaths);
    await syncProviderLinks({
      quiet: true,
      userId,
      opencodeConfigPath: `${tenantPaths.configDir}/opencode.json`,
      opencodeAgentsDir: `${tenantPaths.configDir}/agents`,
    });
    const commandEnv = buildOpenCodeCommandEnv();
    const env: NodeJS.ProcessEnv = {
      ...buildOpenCodeServerProcessEnv(commandEnv),
      ...(await buildOpenCodeProviderCredentialEnv(userId)),
      OPENCODE_CONFIG_DIR: tenantPaths.configDir,
      OPENCODE_DATA_DIR: tenantPaths.dataDir,
    };
    const catalog = getOpenCodeProviderCatalog();
    const modelCount = catalog[id]?.models.length || 0;
    const envVars = getOpenCodeCredentialEnvVars(id, catalog);
    const hasEnvKey = envVars.some((envVar) => Boolean(env[envVar]));

    if (!hasEnvKey) {
      return res.json({
        success: true,
        data: {
          connected: false,
          message: `No API key available. Expected ${envVars.join(' or ')}.`,
          envVars,
        },
      });
    }

    try {
      const output = execFileSync(resolveOpenCodeBinary(), ['models'], {
        encoding: 'utf-8',
        timeout: 10_000,
        env,
        maxBuffer: 10 * 1024 * 1024,
      });
      const providerAppears = output.includes(`${id}/`) || modelCount > 0;

      res.json({
        success: true,
        data: {
          connected: providerAppears,
          message: providerAppears
            ? `API key is present for ${envVars.join(', ')}; ${modelCount} catalog models available.`
            : 'API key is present, but OpenCode did not report models for this provider.',
          envVars,
          modelCount,
        },
      });
    } catch (testError) {
      const err = testError as { stdout?: string; message?: string };
      const output = err.stdout || err.message || '';
      const isAuthError = /auth|key|401|403/.test(output);
      res.json({
        success: true,
        data: {
          connected: false,
          message: isAuthError
            ? 'Authentication failed - check API key'
            : `Provider not reachable: ${output.substring(0, 100)}`,
          envVars,
          modelCount,
        },
      });
    }
  } catch (error) {
    console.error('Error testing OpenCode provider:', error);
    res.status(500).json({ success: false, error: { code: 'ERROR', message: 'Test failed' } });
  }
});

let providerCache: { data: OpenCodeProviderCatalog; expiresAt: number } | null = null;
const PROVIDER_CACHE_TTL_MS = 60_000;

function discoverProviders(): OpenCodeProviderCatalog {
  if (providerCache && providerCache.expiresAt > Date.now()) {
    return providerCache.data;
  }

  try {
    const catalog = getOpenCodeProviderCatalog();
    providerCache = { data: catalog, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS };
    return catalog;
  } catch (error) {
    console.warn('[opencode] discoverProviders failed:', error);
  }

  providerCache = { data: {}, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS };
  return {};
}

// Get available OpenCode providers and their models. The full provider surface
// comes from OpenCode's models.dev cache; configured/custom providers from the
// CLI are overlaid so local endpoints still appear.
router.get('/available-providers', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    res.json({
      success: true,
      data: await overlayOpenCodeProviderStatus(discoverProviders(), userId),
    });
  } catch (error) {
    console.error('Error fetching available providers:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'ERROR', message: 'Failed to fetch providers' } });
  }
});

router.post('/questions/respond', requireAuth, async (req, res) => {
  const result = questionRespondSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: JSON.stringify(result.error.flatten()) },
    });
  }

  try {
    const userId = (req as AuthenticatedRequest).userId;
    const handled = await opencodeServer.replyQuestion(
      result.data.requestId,
      result.data.answers,
      result.data.providerSessionId,
      userId
    );
    if (!handled) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'ERROR', message: 'Question request not found' } });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[opencode] failed to respond to question:', error);
    res.status(502).json({
      success: false,
      error: { code: 'ERROR', message: 'Failed to respond to OpenCode question' },
    });
  }
});

router.post('/questions/reject', requireAuth, async (req, res) => {
  const result = questionRejectSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: JSON.stringify(result.error.flatten()) },
    });
  }

  try {
    const userId = (req as AuthenticatedRequest).userId;
    const handled = await opencodeServer.rejectQuestion(
      result.data.requestId,
      result.data.providerSessionId,
      userId
    );
    if (!handled) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'ERROR', message: 'Question request not found' } });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[opencode] failed to reject question:', error);
    res.status(502).json({
      success: false,
      error: { code: 'ERROR', message: 'Failed to reject OpenCode question' },
    });
  }
});

// Debug endpoint without auth to verify discovery
router.get('/available-providers-debug', (_req, res) => {
  res.json({
    success: true,
    data: discoverProviders(),
    meta: {
      binary: resolveOpenCodeBinary(),
      envPath: buildOpenCodeCommandEnv().PATH,
    },
  });
});

function awaitRestartOpenCodeServer(userId: string): void {
  void opencodeServer.restart(userId).catch((error) => {
    console.warn('[opencode] failed to restart server after provider key change:', error);
  });
}

export default router;
