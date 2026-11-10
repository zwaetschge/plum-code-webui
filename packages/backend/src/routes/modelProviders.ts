import { Router } from 'express';
import {
  refreshProviderModels,
  refreshProviderModelsInBackground,
} from '../utils/providerModelDiscovery.js';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { providerBaseUrlProblem } from '../utils/providerUrlGuard.js';
import { getRunnerAccessDecision } from '../utils/runnerAccess.js';
import {
  getModelProviderCatalog,
  resetModelProviderCatalogCache,
  type ModelProviderCatalog,
} from '../utils/modelCatalog.js';
import {
  buildModelProviderCredentialEnv,
  encryptModelProviderKey,
  getModelProviderCredentialEnvVars,
  maskModelProvider,
  overlayModelProviderStatus,
  readModelProvidersForUser,
  writeModelProvidersForUser,
  type ModelProvider,
} from '../utils/modelProviderKeys.js';

/**
 * Per-user model provider registry („Modellanbieter“): API key, base URL and
 * model list per endpoint. Pi, model chat, voice and Mistral plan usage read it.
 */
const router = Router();

router.get('/providers', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const catalog = getModelProviderCatalog();
    const providers = await readModelProvidersForUser(userId);
    const safeProviders = providers.map((provider) => maskModelProvider(provider, catalog));
    refreshProviderModelsInBackground(userId);
    res.json({ success: true, data: safeProviders });
  } catch (error) {
    console.error('Error fetching model providers:', error);
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
  /** False keeps the provider out of Pi; omitted keeps the stored choice. */
  pi: z.boolean().optional(),
});

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

    const { id, name, apiKey, baseUrl, enabled = true, models, pi } = result.data;
    const normalizedModels = models
      ? [...new Set(models.map((model) => model.trim()).filter((model) => model.length > 0))]
      : undefined;
    const catalogProvider = getModelProviderCatalog()[id];
    const finalBaseUrl = baseUrl && baseUrl.trim() !== '' ? baseUrl.trim() : catalogProvider?.api;
    if (baseUrl && baseUrl.trim() !== '') {
      const problem = providerBaseUrlProblem(baseUrl, {
        allowPrivateNetwork: (await getRunnerAccessDecision(userId)).allowed,
      });
      if (problem) {
        return res
          .status(400)
          .json({ success: false, error: { code: 'INVALID_BASE_URL', message: problem } });
      }
    }

    const providers = await readModelProvidersForUser(userId);
    const now = new Date().toISOString();
    const existingIndex = providers.findIndex((p) => p.id === id);
    const encryptedKey = encryptModelProviderKey(apiKey);

    let stored: ModelProvider;
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
        // A list the provider reported stays live until the user edits it.
        ...(existing.modelsSource === 'live' &&
        (!normalizedModels || normalizedModels.join('\n') === (existing.models ?? []).join('\n'))
          ? { modelsSource: 'live' as const, modelsCheckedAt: existing.modelsCheckedAt }
          : {}),
        ...((pi ?? existing.pi) === false ? { pi: false } : {}),
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
        ...(pi === false ? { pi: false } : {}),
        createdAt: now,
        updatedAt: now,
      };
      providers.push(stored);
    }

    await writeModelProvidersForUser(userId, providers);
    resetModelProviderCatalogCache();
    // A new provider or key: fetch what it actually serves right away.
    if (apiKey || existingIndex < 0) {
      void refreshProviderModels(userId, { only: id }).catch((error) =>
        console.warn(`[MODEL-PROVIDERS] Live model list for ${id} failed:`, error)
      );
    }

    res.json({
      success: true,
      data: maskModelProvider(stored),
    });
  } catch (error) {
    console.error('Error saving model provider:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'ERROR', message: 'Failed to save provider' } });
  }
});

router.delete('/providers/:id', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id } = req.params;
  try {
    const providers = (await readModelProvidersForUser(userId)).filter((p) => p.id !== id);
    await writeModelProvidersForUser(userId, providers);
    resetModelProviderCatalogCache();
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('Error deleting model provider:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'ERROR', message: 'Failed to delete provider' } });
  }
});

// Checks that a usable key is stored for the provider and how many models the
// registry and catalog know for it. No harness runs here.
router.post('/providers/:id/test', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { id } = req.params;
  if (!id) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'ERROR', message: 'Provider id required' } });
  }
  try {
    const providers = await readModelProvidersForUser(userId);
    const provider = providers.find((p) => p.id === id);

    if (!provider) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'ERROR', message: 'Provider not found' } });
    }

    const env = await buildModelProviderCredentialEnv(userId);
    const catalog = getModelProviderCatalog();
    const modelCount = provider.models?.length || catalog[id]?.models.length || 0;
    const envVars = getModelProviderCredentialEnvVars(id, catalog);
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

    // Ask the provider itself: that both tests the key and refreshes the list.
    const [live] = await refreshProviderModels(userId, { only: id });
    if (live && (live.status === 'updated' || live.status === 'unchanged') && live.models) {
      const changes = [
        live.added?.length ? `neu: ${live.added.join(', ')}` : '',
        live.removed?.length ? `entfernt: ${live.removed.join(', ')}` : '',
      ].filter(Boolean);
      return res.json({
        success: true,
        data: {
          connected: true,
          message:
            `Verbunden: ${live.models.length} Modelle laut Anbieter` +
            (changes.length ? ` (${changes.join('; ')}).` : '.'),
          envVars,
          modelCount: live.models.length,
        },
      });
    }

    const connected = modelCount > 0;
    res.json({
      success: true,
      data: {
        connected,
        message:
          live?.status === 'failed'
            ? `API-Key vorhanden, aber der Anbieter hat keine Modellliste geliefert; ${modelCount} bekannte Modelle bleiben.`
            : connected
              ? `API key is present for ${envVars.join(', ')}; ${modelCount} catalog models available.`
              : 'API key is present, but no models are known for this provider.',
        envVars,
        modelCount,
      },
    });
  } catch (error) {
    console.error('Error testing model provider:', error);
    res.status(500).json({ success: false, error: { code: 'ERROR', message: 'Test failed' } });
  }
});

let providerCache: { data: ModelProviderCatalog; expiresAt: number } | null = null;
const PROVIDER_CACHE_TTL_MS = 60_000;

function discoverProviders(): ModelProviderCatalog {
  if (providerCache && providerCache.expiresAt > Date.now()) {
    return providerCache.data;
  }

  try {
    const catalog = getModelProviderCatalog();
    providerCache = { data: catalog, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS };
    return catalog;
  } catch (error) {
    console.warn('[model-providers] discoverProviders failed:', error);
  }

  providerCache = { data: {}, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS };
  return {};
}

// Available providers and their models: the models.dev catalog plus the
// built-in fallback list, overlaid with the user's registered endpoints so
// self-hosted providers still appear.
router.get('/available-providers', requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    res.json({
      success: true,
      data: await overlayModelProviderStatus(discoverProviders(), userId),
    });
  } catch (error) {
    console.error('Error fetching available providers:', error);
    res
      .status(500)
      .json({ success: false, error: { code: 'ERROR', message: 'Failed to fetch providers' } });
  }
});

export default router;
