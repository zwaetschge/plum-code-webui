import { Router, type Request, type Response } from 'express';
import { existsSync } from 'fs';
import os from 'os';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  CLI_PROVIDERS,
  getCliModels,
  isProviderAvailable,
  type CLIProvider,
} from '../services/cli-providers.js';
import { getEnabledCliProvidersForUser, getZaiApiConfigForUser } from './settings.js';
import { readOpenCodeProvidersForUser } from '../utils/opencodeProviderKeys.js';
import fs from 'fs';
import path from 'path';
import { hasPiAntigravityExtension } from '../utils/piConfig.js';
import { getPiModelsForUser } from '../utils/piConfig.js';
import type { ApiResponse } from '@plum-code-webui/shared';

const router = Router();

/**
 * How an operator makes a harness usable. The wizard renders a different step
 * per kind, so this belongs next to the harness definition rather than being
 * re-derived in the client.
 */
type SetupKind = 'cli-login' | 'provider-keys' | 'endpoint';

const SETUP_KIND: Record<CLIProvider, SetupKind> = {
  codex: 'cli-login',
  claude: 'cli-login',
  kimi: 'cli-login',
  opencode: 'provider-keys',
  pi: 'provider-keys',
  zai: 'endpoint',
};

const SETUP_HINT: Record<SetupKind, string> = {
  'cli-login': 'Sign in once through the CLI login flow.',
  'provider-keys': 'Add at least one API endpoint and key.',
  endpoint: 'Point the harness at an Anthropic-compatible endpoint.',
};

function isInstalled(provider: CLIProvider): boolean {
  const command = CLI_PROVIDERS[provider].command;
  // An absolute path is the configured binary; a bare name is resolved from
  // PATH, which we cannot probe cheaply, so treat it as present and let the
  // credential check decide.
  if (!command.includes('/')) return true;
  return existsSync(command.replace('~', os.homedir()));
}

/**
 * Antigravity logs in through Pi's own `/login` inside a session — Pi has no
 * CLI-level login — so the only thing the UI can report is whether that already
 * happened. Pi stores every credential in the agent dir's auth.json.
 */
function readPiAntigravityState(userId: string): {
  available: boolean;
  authenticated: boolean;
} {
  const available = hasPiAntigravityExtension();
  if (!available) return { available: false, authenticated: false };

  const segment = userId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'default';
  const authFile = path.join(os.homedir(), '.pi', 'webui-users', segment, 'agent', 'auth.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8')) as Record<string, unknown>;
    return { available: true, authenticated: Object.keys(parsed).includes('antigravity') };
  } catch {
    return { available: true, authenticated: false };
  }
}

/**
 * GET /api/setup/status
 *
 * Everything the first-run wizard needs in one call: which harnesses this
 * account can already use, what each one still needs, and whether the instance
 * is usable at all. Exactly one ready harness is enough — the rest are optional
 * and stay that way.
 */
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const enabled = new Set(await getEnabledCliProvidersForUser(userId));
  const zaiConfig = await getZaiApiConfigForUser(userId);
  const registryProviders = await readOpenCodeProvidersForUser(userId);
  const configuredEndpoints = registryProviders.filter(
    (entry) => entry.enabled && entry.apiKey.trim().length > 0
  );

  const harnesses = await Promise.all(
    Object.values(CLI_PROVIDERS).map(async (provider) => {
      const kind = SETUP_KIND[provider.id];
      const credentials =
        provider.id === 'zai' ? zaiConfig !== null : await isProviderAvailable(provider.id, userId);

      const models =
        provider.id === 'pi'
          ? await getPiModelsForUser(userId)
          : provider.id === 'opencode'
            ? getCliModels('opencode')
            : (provider.models ?? []);

      return {
        id: provider.id,
        name: provider.name,
        icon: provider.icon,
        kind,
        hint: SETUP_HINT[kind],
        installed: isInstalled(provider.id),
        credentials,
        enabled: enabled.has(provider.id),
        modelCount: models.length,
        // Ready means "a turn would run", which is what the wizard ticks off.
        ready: credentials && enabled.has(provider.id) && models.length > 0,
      };
    })
  );

  const ready = harnesses.filter((harness) => harness.ready);
  // The endpoints themselves, so the logins page can list what is configured
  // without a second round trip. Keys never leave the server.
  const endpoints = registryProviders.map((entry) => ({
    id: entry.id,
    name: entry.name,
    baseUrl: entry.baseUrl ?? null,
    enabled: entry.enabled,
    hasKey: entry.apiKey.trim().length > 0,
    modelCount: entry.models?.length ?? 0,
  }));

  const response: ApiResponse<{
    ready: boolean;
    readyHarnesses: string[];
    configuredEndpoints: number;
    harnesses: typeof harnesses;
    endpoints: typeof endpoints;
    antigravity: ReturnType<typeof readPiAntigravityState>;
  }> = {
    success: true,
    data: {
      ready: ready.length > 0,
      readyHarnesses: ready.map((harness) => harness.id),
      configuredEndpoints: configuredEndpoints.length,
      harnesses,
      endpoints,
      antigravity: readPiAntigravityState(userId),
    },
  };
  res.json(response);
});

export default router;
