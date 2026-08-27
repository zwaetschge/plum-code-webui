import { get as pgGet, run as pgRun } from '../db/pg.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { config } from '../config.js';
import {
  requireAuth,
  resolveAuthenticatedUserId,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { rateLimiters } from '../middleware/rateLimiter.js';
import type { User } from '@plum-code-webui/shared';
import { isProviderAvailable } from '../services/cli-providers.js';
import { generateUserToken } from '../utils/authTokens.js';
import { upsertProxyUser } from '../utils/proxyUser.js';
import { stampLogin } from '../utils/auditLog.js';
import { requestClaudeOAuthTokenRefresh } from '../utils/claudeOauth.js';
import { mobileAuthCodes } from '../services/mobileAuthCodes.js';
import {
  EmailNotAllowedError,
  OAuthEmailCollisionError,
  isEmailAllowed,
} from '../auth/passport.js';

const router = Router();

const mobileProxyQuerySchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

const mobileExchangeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
});

async function getAuthenticatedCliLinkUser(req: Request): Promise<User | null> {
  const userId = await resolveAuthenticatedUserId(req);
  if (!userId) return null;

  const user = (await pgGet(
    `SELECT id, email, name, avatar_url as avatarUrl, provider,
              provider_id as providerId,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
       FROM users WHERE id = ?`,
    userId
  )) as unknown as User | undefined;

  if (!user || !isEmailAllowed(user.email)) return null;
  return user;
}

function redirectCliIdentityRequired(res: Response): void {
  res.redirect(`${config.frontendUrl}/connect?error=identity_required`);
}

// Wraps passport.authenticate so we can map OAuthEmailCollisionError to a user-friendly
// redirect instead of returning a 500.
function oauthCallbackHandler(
  strategy: 'github' | 'google'
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    passport.authenticate(strategy, (err: unknown, user: User | false) => {
      if (err) {
        if (err instanceof OAuthEmailCollisionError) {
          const params = new URLSearchParams({
            error: 'email_in_use',
            existing_provider: err.existingProvider,
          });
          return res.redirect(`${config.frontendUrl}/connect?${params.toString()}`);
        }
        if (err instanceof EmailNotAllowedError) {
          return res.redirect(`${config.frontendUrl}/connect?error=email_not_allowed`);
        }
        return res.redirect(`${config.frontendUrl}/connect?error=${strategy}`);
      }
      if (!user) {
        return res.redirect(`${config.frontendUrl}/connect?error=${strategy}`);
      }

      req.logIn(user, async (loginErr) => {
        if (loginErr) return next(loginErr);
        await stampLogin(user.id, strategy, req);
        const token = generateUserToken(user.id);
        res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
      });
    })(req, res, next);
  };
}

function getHeaderValue(req: Request, headers: string[]): string | null {
  for (const header of headers) {
    const value = req.headers[header.toLowerCase()];
    if (Array.isArray(value)) {
      const first = value.find((item) => item.trim().length > 0);
      if (first) return first.trim();
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function redirectProxyError(res: Response, error: string): void {
  const params = new URLSearchParams({ proxy_error: error });
  res.redirect(`${config.frontendUrl}/login?${params.toString()}`);
}

function redirectMobileAuth(res: Response, values: Record<string, string>): void {
  res.redirect(`claudewebui://auth/callback?${new URLSearchParams(values).toString()}`);
}

function getProxyIdentity(req: Request): {
  proxyUser: string | null;
  proxyName: string | null;
  proxyEmail: string | null;
} {
  const proxyUser = getHeaderValue(req, config.proxyAuth.userHeaders);
  const proxyName = getHeaderValue(req, config.proxyAuth.nameHeaders);
  const proxyEmail =
    getHeaderValue(req, config.proxyAuth.emailHeaders) ||
    (proxyUser?.includes('@') ? proxyUser : null);
  return { proxyUser, proxyName, proxyEmail };
}

async function establishProxyLogin(
  req: Request,
  proxyEmail: string,
  proxyName: string | null,
  proxyUser: string | null
): Promise<User> {
  const user = await upsertProxyUser(proxyEmail, proxyName, proxyUser);
  await new Promise<void>((resolve, reject) => {
    req.logIn(user, (err) => (err ? reject(err) : resolve()));
  });
  await stampLogin(user.id, 'proxy', req);
  return user;
}

router.get('/proxy/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      enabled: config.proxyAuth.enabled,
      emailHeaders: config.proxyAuth.emailHeaders,
      userHeaders: config.proxyAuth.userHeaders,
      nameHeaders: config.proxyAuth.nameHeaders,
    },
  });
});

router.get('/proxy', async (req, res, next) => {
  if (!config.proxyAuth.enabled) {
    return redirectProxyError(res, 'disabled');
  }

  const { proxyUser, proxyName, proxyEmail } = getProxyIdentity(req);

  if (!proxyEmail) {
    return redirectProxyError(res, 'missing_email_header');
  }

  if (!isEmailAllowed(proxyEmail)) {
    return redirectProxyError(res, 'email_not_allowed');
  }

  try {
    const user = await establishProxyLogin(req, proxyEmail, proxyName, proxyUser);

    const params = new URLSearchParams({
      token: generateUserToken(user.id),
      returnTo: safeReturnTo(req.query.returnTo),
    });
    res.redirect(`${config.frontendUrl}/auth/callback?${params.toString()}`);
  } catch (err) {
    next(err);
  }
});

// Native Android login handoff. Traefik keeps this single route behind
// Authelia, while the rest of /mobile is protected by Plum JWTs.
router.get('/proxy/mobile', rateLimiters.strict, async (req, res, next) => {
  const query = mobileProxyQuerySchema.safeParse(req.query);
  if (!query.success) return redirectMobileAuth(res, { error: 'invalid_request' });
  if (!config.proxyAuth.enabled) return redirectMobileAuth(res, { error: 'proxy_disabled' });

  const { proxyUser, proxyName, proxyEmail } = getProxyIdentity(req);
  if (!proxyEmail) return redirectMobileAuth(res, { error: 'missing_identity' });
  if (!isEmailAllowed(proxyEmail)) {
    return redirectMobileAuth(res, { error: 'email_not_allowed' });
  }

  try {
    const user = await establishProxyLogin(req, proxyEmail, proxyName, proxyUser);
    const code = mobileAuthCodes.issue(user.id, query.data.code_challenge);
    return redirectMobileAuth(res, { code, state: query.data.state });
  } catch (err) {
    next(err);
  }
});

router.post('/mobile/exchange', rateLimiters.strict, async (req, res) => {
  const parsed = mobileExchangeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_MOBILE_AUTH', message: 'Invalid mobile authentication response' },
    });
  }

  const userId = mobileAuthCodes.exchange(parsed.data.code, parsed.data.codeVerifier);
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_MOBILE_AUTH', message: 'Mobile authentication expired or invalid' },
    });
  }

  const user = (await pgGet(
    `SELECT id, email, name, avatar_url as avatarUrl, provider,
              provider_id as providerId, role, status,
              strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
              strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
       FROM users WHERE id = ?`,
    userId
  )) as unknown as User | undefined;

  if (!user || user.status === 'suspended' || !isEmailAllowed(user.email)) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_MOBILE_AUTH', message: 'Mobile authentication expired or invalid' },
    });
  }

  return res.json({
    success: true,
    data: {
      token: generateUserToken(user.id),
      user,
    },
  });
});

// GitHub OAuth (only if configured)
if (config.github.clientId && config.github.clientSecret && config.github.callbackUrl) {
  router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));
  router.get('/github/callback', oauthCallbackHandler('github'));
} else {
  router.get('/github', (_req, res) => {
    res.redirect(`${config.frontendUrl}/connect?error=github`);
  });
}

// Google OAuth (only if configured)
if (config.google.clientId && config.google.clientSecret && config.google.callbackUrl) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/google/callback', oauthCallbackHandler('google'));
} else {
  router.get('/google', (_req, res) => {
    res.redirect(`${config.frontendUrl}/connect?error=google`);
  });
}

// Claude CLI credentials login (uses existing ~/.claude/.credentials.json)
interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    refreshTokenExpiresAt?: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');

async function getClaudeCredentials(): Promise<ClaudeCredentials | null> {
  try {
    const content = await fs.readFile(credentialsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function refreshClaudeToken(refreshToken: string): Promise<ClaudeCredentials | null> {
  try {
    const tokens = await requestClaudeOAuthTokenRefresh(refreshToken);
    const existing = await getClaudeCredentials();
    const now = Date.now();
    const updated: ClaudeCredentials = {
      claudeAiOauth: {
        ...existing?.claudeAiOauth,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresAt: now + tokens.expiresIn * 1000,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresIn
          ? now + tokens.refreshTokenExpiresIn * 1000
          : existing?.claudeAiOauth?.refreshTokenExpiresAt,
        scopes: existing?.claudeAiOauth?.scopes || [],
        subscriptionType: existing?.claudeAiOauth?.subscriptionType || 'unknown',
        rateLimitTier: existing?.claudeAiOauth?.rateLimitTier || 'unknown',
      },
    };

    await fs.writeFile(credentialsPath, JSON.stringify(updated, null, 2));
    console.log('Claude token refreshed successfully');
    return updated;
  } catch (err) {
    console.error('Token refresh error:', err);
    return null;
  }
}

if (config.claude.oauthEnabled) {
  // Login using existing Claude CLI credentials
  router.get('/claude', async (req, res) => {
    try {
      const user = await getAuthenticatedCliLinkUser(req);
      if (!user) return redirectCliIdentityRequired(res);

      let credentials = await getClaudeCredentials();

      if (!credentials?.claudeAiOauth?.accessToken) {
        return res.redirect(`${config.frontendUrl}/connect?error=claude_not_logged_in`);
      }

      // Check if token is expired and refresh if needed
      const { expiresAt, refreshToken } = credentials.claudeAiOauth;
      if (expiresAt && Date.now() > expiresAt - 60000) {
        // Refresh 1 min before expiry
        console.log('Token expired, refreshing...');
        const refreshed = await refreshClaudeToken(refreshToken);
        if (refreshed) {
          credentials = refreshed;
        }
      }

      await stampLogin(user.id, 'claude', req);
      const token = generateUserToken(user.id);
      res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (error) {
      console.error('Claude CLI auth error:', error);
      res.redirect(`${config.frontendUrl}/connect?error=claude`);
    }
  });
} else {
  router.get('/claude', (_req, res) => {
    res.redirect(`${config.frontendUrl}/connect?error=claude`);
  });
}

// Codex CLI credentials login (uses ~/.codex presence)
router.get('/codex', async (req, res) => {
  try {
    const user = await getAuthenticatedCliLinkUser(req);
    if (!user) return redirectCliIdentityRequired(res);

    const available = await isProviderAvailable('codex');
    if (!available) {
      return res.redirect(`${config.frontendUrl}/connect?error=codex_not_logged_in`);
    }

    await stampLogin(user.id, 'codex', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error('Codex CLI auth error:', error);
    res.redirect(`${config.frontendUrl}/connect?error=codex`);
  }
});

// OpenCode CLI credentials login (uses ~/.config/opencode presence)
router.get('/opencode', async (req, res) => {
  try {
    const user = await getAuthenticatedCliLinkUser(req);
    if (!user) return redirectCliIdentityRequired(res);

    const available = await isProviderAvailable('opencode');
    if (!available) {
      return res.redirect(`${config.frontendUrl}/connect?error=opencode_not_logged_in`);
    }

    await stampLogin(user.id, 'opencode', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error('OpenCode CLI auth error:', error);
    res.redirect(`${config.frontendUrl}/connect?error=opencode`);
  }
});

// Pi shares the OpenCode API connections and therefore the same local login.
router.get('/pi', async (req, res) => {
  try {
    const user = await getAuthenticatedCliLinkUser(req);
    if (!user) return redirectCliIdentityRequired(res);

    const available = await isProviderAvailable('pi');
    if (!available) {
      return res.redirect(`${config.frontendUrl}/connect?error=pi_not_available`);
    }

    await stampLogin(user.id, 'pi', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error('Pi auth error:', error);
    res.redirect(`${config.frontendUrl}/connect?error=pi`);
  }
});

// Kimi Code CLI credentials login (uses ~/.kimi-code OAuth presence).
router.get('/kimi', async (req, res) => {
  try {
    const user = await getAuthenticatedCliLinkUser(req);
    if (!user) return redirectCliIdentityRequired(res);

    const available = await isProviderAvailable('kimi');
    if (!available) {
      return res.redirect(`${config.frontendUrl}/connect?error=kimi_not_logged_in`);
    }

    await stampLogin(user.id, 'kimi', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    console.error('Kimi auth error:', error);
    res.redirect(`${config.frontendUrl}/connect?error=kimi`);
  }
});

// Dev login (only in development mode)
if (config.isDevelopment) {
  router.post('/dev-login', rateLimiters.strict, async (req, res) => {
    const { email = 'dev@localhost', name = 'Dev User' } = req.body;

    // Find or create dev user
    let user = (await pgGet(
      `SELECT id, email, name, avatar_url as avatarUrl, provider, provider_id as providerId,
                strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
         FROM users WHERE provider = ? AND provider_id = ?`,
      'dev',
      'dev-user'
    )) as unknown as User | undefined;

    if (!user) {
      const userId = nanoid();
      await pgRun(
        `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
         VALUES (?, ?, ?, ?, 'dev', 'dev-user')`,
        userId,
        email,
        name,
        null
      );

      // Create default settings
      await pgRun(
        `INSERT INTO user_settings (user_id, theme, allowed_tools)
         VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`,
        userId
      );

      user = {
        id: userId,
        email,
        name,
        avatarUrl: null,
        provider: 'dev',
        providerId: 'dev-user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as User;
    }

    await stampLogin(user.id, 'dev', req);
    const token = generateUserToken(user.id);
    res.json({ success: true, data: { token, user } });
  });

  // Quick dev login redirect
  router.get('/dev', async (req, res) => {
    // Find or create dev user
    let user = (await pgGet(
      'SELECT id FROM users WHERE provider = ? AND provider_id = ?',
      'dev',
      'dev-user'
    )) as unknown as { id: string } | undefined;

    if (!user) {
      const userId = nanoid();
      await pgRun(
        `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
         VALUES (?, 'dev@localhost', 'Dev User', NULL, 'dev', 'dev-user')`,
        userId
      );

      await pgRun(
        `INSERT INTO user_settings (user_id, theme, allowed_tools)
         VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`,
        userId
      );

      user = { id: userId };
    }

    await stampLogin(user.id, 'dev', req);
    const token = generateUserToken(user.id);
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  });
}

// Get current user
router.get('/me', requireAuth, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  const user = (await pgGet(
    `
    SELECT id, email, name, avatar_url as avatarUrl, provider, provider_id as providerId,
           role, status,
           strftime('%Y-%m-%dT%H:%M:%fZ', last_login_at) as lastLoginAt,
           strftime('%Y-%m-%dT%H:%M:%fZ', created_at) as createdAt,
           strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
    FROM users WHERE id = ?
  `,
    userId
  )) as unknown as (User & { status?: string }) | undefined;

  if (!user) {
    return res
      .status(404)
      .json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
  }

  // Suspended users can authenticate but can't use the app — surface the status
  // here so the frontend can redirect them to a "suspended" screen instead of rendering
  // normal UI that'll just throw 403s on every subsequent request.
  if (user.status === 'suspended') {
    return res.status(403).json({
      success: false,
      error: { code: 'ACCOUNT_SUSPENDED', message: 'Account suspended' },
    });
  }

  res.json({ success: true, data: user });
});

// Logout
router.post('/logout', requireAuth, (req, res) => {
  req.logout(() => {
    res.json({ success: true });
  });
});

// Auth providers info
router.get('/providers', async (req, res) => {
  let cliLinkAuthorized = false;
  try {
    cliLinkAuthorized = Boolean(await getAuthenticatedCliLinkUser(req));
  } catch {
    cliLinkAuthorized = false;
  }
  const [codexAvailable, opencodeAvailable, piAvailable, kimiAvailable] = cliLinkAuthorized
    ? await Promise.all([
        isProviderAvailable('codex'),
        isProviderAvailable('opencode'),
        isProviderAvailable('pi'),
        isProviderAvailable('kimi'),
      ])
    : [false, false, false, false];
  res.json({
    success: true,
    data: {
      github: !!(config.github.clientId && config.github.clientSecret),
      google: !!(config.google.clientId && config.google.clientSecret),
      claude: config.claude.oauthEnabled && cliLinkAuthorized,
      codex: codexAvailable && cliLinkAuthorized,
      opencode: opencodeAvailable && cliLinkAuthorized,
      pi: piAvailable && cliLinkAuthorized,
      kimi: kimiAvailable && cliLinkAuthorized,
      proxy: config.proxyAuth.enabled,
    },
  });
});

export default router;
