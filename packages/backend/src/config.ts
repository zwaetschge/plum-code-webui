import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import { z } from 'zod';

// `dotenv/config` reads ./.env relative to the working directory, which is the
// container's /app in production but packages/backend when a script or a test
// is run from there — and the file lives at the repository root. Both are
// loaded, nearest first, and neither overrides a variable the environment
// already set.
dotenv.config();
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
});

const envSchema = z.object({
  PORT: z.string().default('3001'),
  HOST: z.string().default('0.0.0.0'), // Default to 0.0.0.0 for Docker compatibility
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SESSION_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  // Additional allowed CORS origins (comma-separated, for Docker/reverse proxy setups)
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  // WEBUI_-prefixed aliases. The shipped .env uses these names so the main
  // container and the repair-bot can be configured independently; without the
  // aliases they were parsed, accepted and then never read.
  WEBUI_FRONTEND_URL: z.string().url().optional(),
  WEBUI_CORS_ORIGINS: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  ALLOWED_BASE_PATHS: z.string().default('/home,/Users'),
  // Claude OAuth (uses official Claude Code client ID) - enabled by default
  CLAUDE_OAUTH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  PREVIEW_HOSTNAME: z.string().optional(),
  // Shared secret proving a request originates from the local permission-prompt
  // hook script (or any other in-process CLI caller). Auto-generated per-process
  // if not provided so a fresh container boot gets a fresh secret.
  WEBUI_HOOK_SECRET: z.string().optional(),
  // Express `trust proxy` setting. Default trusts one hop (the reverse proxy
  // directly in front, e.g. nginx). Spoofing X-Forwarded-For becomes trivial
  // if this is set to `true` without a guarding proxy, which defeats IP-based
  // rate limiting. Accepts: integer hop count, "loopback", "linklocal",
  // "uniquelocal", "true"/"false", or a comma-separated list of IPs/CIDRs.
  TRUST_PROXY: z.string().default('1'),
  // Comma-separated email allowlist. Self-hosted single-tenant deployments must
  // gate signup so a stranger who finds the OAuth callback URL can't create an
  // account on someone else's Anthropic credential. Empty = no allowlist
  // (anyone with valid OAuth + basic-auth bypass can sign in — only safe behind
  // a private network or Authelia).
  AUTH_ALLOWED_EMAILS: z.string().optional(),
  // Trust authenticated user identity from a reverse proxy / ForwardAuth layer
  // such as Authelia. Disabled by default because request headers are trivial to
  // spoof unless the app is only reachable through a trusted proxy.
  PROXY_AUTH_ENABLED: z.string().optional(),
  // Comma-separated IPs/CIDRs of the reverse proxies allowed to assert an
  // identity through PROXY_AUTH_* headers. Anything else reaching /auth/proxy
  // is rejected regardless of the headers it sends, because those headers are
  // free for anyone who can open a socket to the container.
  PROXY_AUTH_TRUSTED_IPS: z.string().optional(),
  PROXY_AUTH_EMAIL_HEADERS: z.string().optional(),
  PROXY_AUTH_USER_HEADERS: z.string().optional(),
  PROXY_AUTH_NAME_HEADERS: z.string().optional(),
});

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseHeaderList(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter((header) => header.length > 0);
  return parsed.length > 0 ? parsed : fallback;
}

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment variables:');
    console.error(parsed.error.format());
    process.exit(1);
  }

  const env = {
    ...parsed.data,
    // z.default() erases the difference between "unset" and "set to the
    // default", which the alias fallback below needs to know.
    FRONTEND_URL_EXPLICIT:
      typeof process.env.FRONTEND_URL === 'string' && process.env.FRONTEND_URL.length > 0,
  };

  // Normalize `trust proxy` value. Express accepts booleans, numbers, or
  // strings — we distinguish at parse time so the app's `app.set` call can
  // pass the right type without re-parsing env each request.
  const trustProxyRaw = env.TRUST_PROXY.trim();
  let trustProxy: boolean | number | string;
  if (trustProxyRaw === 'true') {
    trustProxy = true;
  } else if (trustProxyRaw === 'false') {
    trustProxy = false;
  } else if (/^\d+$/.test(trustProxyRaw)) {
    trustProxy = Number(trustProxyRaw);
  } else {
    trustProxy = trustProxyRaw;
  }

  // Build allowed origins list. The explicit key wins; the WEBUI_ alias is the
  // fallback so a .env that only defines WEBUI_FRONTEND_URL still works.
  const frontendUrl = env.FRONTEND_URL_EXPLICIT
    ? env.FRONTEND_URL
    : env.WEBUI_FRONTEND_URL || env.FRONTEND_URL;
  const corsOrigins = env.CORS_ALLOWED_ORIGINS || env.WEBUI_CORS_ORIGINS;
  const allowedOrigins = [frontendUrl.toLowerCase()];
  if (corsOrigins) {
    const additionalOrigins = corsOrigins
      .split(',')
      .map((o) => o.trim().toLowerCase())
      .filter((o) => o.length > 0);
    allowedOrigins.push(...additionalOrigins);
  }

  const allowedEmails = (env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  return {
    port: parseInt(env.PORT, 10),
    host: env.HOST,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    sessionSecret: env.SESSION_SECRET,
    jwtSecret: env.JWT_SECRET,
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      callbackUrl: env.GITHUB_CALLBACK_URL,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackUrl: env.GOOGLE_CALLBACK_URL,
    },
    frontendUrl,
    allowedOrigins, // List of allowed CORS origins
    trustProxy,
    encryptionKey: env.ENCRYPTION_KEY,
    hookSecret: env.WEBUI_HOOK_SECRET || randomBytes(32).toString('hex'),
    allowedBasePaths: env.ALLOWED_BASE_PATHS.split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0),
    previewHostname: env.PREVIEW_HOSTNAME?.toLowerCase(),
    auth: {
      // Empty array means "no allowlist" — every successful OAuth/basic-auth
      // login is accepted. Set AUTH_ALLOWED_EMAILS to lock down a public
      // deployment to known operators.
      allowedEmails,
    },
    proxyAuth: {
      enabled: parseBoolean(env.PROXY_AUTH_ENABLED),
      trustedIps: (env.PROXY_AUTH_TRUSTED_IPS || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      emailHeaders: parseHeaderList(env.PROXY_AUTH_EMAIL_HEADERS, [
        'remote-email',
        'x-forwarded-email',
        'x-auth-request-email',
      ]),
      userHeaders: parseHeaderList(env.PROXY_AUTH_USER_HEADERS, [
        'remote-user',
        'x-forwarded-user',
        'x-auth-request-user',
      ]),
      nameHeaders: parseHeaderList(env.PROXY_AUTH_NAME_HEADERS, [
        'remote-name',
        'x-forwarded-name',
        'x-auth-request-preferred-username',
      ]),
    },
    claude: {
      // Enabled by default (set CLAUDE_OAUTH_ENABLED=false to disable). The
      // OAuth client ID and endpoint constants live in utils/claudeOauth.ts.
      oauthEnabled: env.CLAUDE_OAUTH_ENABLED,
    },
  };
}

export const config = loadConfig();
