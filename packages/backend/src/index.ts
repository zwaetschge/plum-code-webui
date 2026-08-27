import express from 'express';
import fs from 'fs';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { initDatabase } from './db/index.js';
import { setupPassport } from './auth/passport.js';
import { setupWebSocket } from './websocket/index.js';
import { errorHandler, requestIdMiddleware } from './middleware/errorHandler.js';
import { modelRouter } from './services/modelRouterInstance.js';
import { mobileGatewayAuth } from './middleware/mobileGateway.js';
import {
  previewVhostMiddleware,
  handlePreviewUpgrade,
  previewVhostEnabled,
} from './middleware/preview-vhost.js';
import { ensureCliPath } from './utils/cliPaths.js';
import {
  ensureDefaultClaudeMcpServers,
  sanitizeClaudeSettingsProviderEnv,
} from './utils/mcpDefaults.js';
import { syncProviderLinks } from './utils/providerLinks.js';
import { resolveConfigHome } from './utils/configPaths.js';
import { listSkillLibrary } from './utils/skillLibrary.js';
import { buildSessionCookieOptions } from './utils/sessionCookie.js';
import type { CLIProvider } from '@plum-code-webui/shared';
import { CLI_UPDATE_PROVIDERS, runCliUpdates } from './services/cli-updates.js';
import { resetDiscovery } from './services/cli-providers.js';

// Routes
import authRoutes from './routes/auth.js';
import basicAuthRoutes from './routes/basic-auth.js';
import sessionRoutes from './routes/sessions.js';
import filesRoutes from './routes/files.js';
import gitRoutes from './routes/git.js';
import settingsRoutes from './routes/settings.js';
import mcpRoutes from './routes/mcp.js';
import claudeRoutes from './routes/claude.js';
import claudeConfigRoutes from './routes/claude-config.js';
import permissionsRoutes from './routes/permissions.js';
import usageRoutes from './routes/usage.js';
import cliToolsRoutes from './routes/cli-tools.js';
import projectsRoutes from './routes/projects.js';
import githubRoutes from './routes/github.js';
import commandsRoutes from './routes/commands.js';
import analyticsRoutes from './routes/analytics.js';
import checkpointsRoutes from './routes/checkpoints.js';
import agentsRoutes from './routes/agents.js';
import notesRoutes from './routes/notes.js';
import categoriesRoutes from './routes/categories.js';
import cliProvidersRoutes from './routes/cli-providers.js';
import cliLoginRoutes from './routes/cli-login.js';
import codexRoutes from './routes/codex.js';
import opencodeRoutes from './routes/opencode.js';
import setupRoutes from './routes/setup.js';
import gatewayRoutes from './routes/gateway.js';
import memoriesRoutes from './routes/memories.js';
import androidRoutes from './routes/android.js';
import appRoutes from './routes/app.js';
import workspaceRoutes from './routes/workspace.js';
import transcribeRoutes from './routes/transcribe.js';
import previewRoutes from './routes/preview.js';
import adminRoutes from './routes/admin.js';
import comfyuiRoutes from './routes/comfyui.js';
import oracleRoutes from './routes/oracle.js';
import dockerRoutes from './routes/docker.js';
import watchdogRoutes from './routes/watchdogs.js';
import sessionMeshRoutes from './routes/session-mesh.js';
import discordRoutes from './routes/discord.js';
import homeAssistantRoutes from './routes/home-assistant.js';
import { initDiscordOutboxWorker } from './services/discord/index.js';
import { attachNotificationIo } from './services/notifications/notificationCenter.js';
import { buildReadinessReport } from './services/readiness.js';
import { getProviderStatuses } from './services/cli-providers.js';
import { startBackupSchedule } from './services/backup.js';
import { SqliteSessionStore } from './services/SqliteSessionStore.js';
import { initUsageLimitHistoryCollector } from './services/usage-limit-history-collector.js';
import { cleanupExpiredChatUploads } from './services/chatUploads.js';

function parseBooleanEnv(value?: string): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseCliUpdateProviders(value?: string): CLIProvider[] | undefined {
  if (!value) return undefined;
  const allowed = new Set<CLIProvider>(CLI_UPDATE_PROVIDERS);
  const providers = value
    .split(',')
    .map((provider) => provider.trim())
    .filter((provider): provider is CLIProvider => allowed.has(provider as CLIProvider));
  return providers.length > 0 ? providers : undefined;
}

function logUpdateSummary(results: { provider: CLIProvider; status: string }[]): void {
  if (!results.length) {
    console.log('[CLI UPDATE] No results returned.');
    return;
  }
  const summary = results.map((result) => `${result.provider}:${result.status}`).join(', ');
  console.log(`[CLI UPDATE] ${summary}`);
}

function installProcessGuards(): void {
  // Global guards: without these, a stray unhandled rejection from any long-running service
  // (ClaudeProcessManager, task runners, etc.) crashes the server silently.
  process.on('unhandledRejection', (reason, promise) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error(
      '[CRITICAL] Unhandled Rejection at:',
      promise,
      'reason:',
      err.stack || err.message
    );
  });

  process.on('uncaughtException', (err, origin) => {
    console.error(`[CRITICAL] Uncaught Exception (${origin}):`, err.stack || err.message);
    // After an uncaught exception the process may be in an undefined state — exit so a supervisor restarts us.
    process.exit(1);
  });
}

/**
 * Register graceful shutdown hooks. Closes the HTTP server first (so inbound
 * traffic stops), then kills all Claude child processes, then forces exit.
 * A hard timeout prevents a wedged process from lingering forever.
 */
function registerGracefulShutdown(
  httpServer: import('http').Server,
  io: import('socket.io').Server
): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] Received ${signal}, draining.`);

    const forceExit = setTimeout(() => {
      console.error('[SHUTDOWN] Grace period elapsed, forcing exit.');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      // Stop accepting new HTTP connections / upgrades.
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      // Disconnect all WebSocket clients so they reconnect to the new instance.
      io.disconnectSockets(true);
      // Dynamically import to avoid circular load if shutdown fires before setup.
      const { getProcessManager } = await import('./websocket/index.js');
      try {
        await getProcessManager().shutdownAll();
      } catch (err) {
        console.warn('[SHUTDOWN] processManager shutdown skipped:', err);
      }
    } catch (err) {
      console.error('[SHUTDOWN] Drain error:', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main() {
  installProcessGuards();

  // Initialize database
  initDatabase();
  try {
    const removedUploads = await cleanupExpiredChatUploads();
    if (removedUploads > 0) {
      console.log(`[UPLOAD] Removed ${removedUploads} expired/orphaned staged upload(s).`);
    }
  } catch (error) {
    console.warn('[UPLOAD] Startup cleanup skipped:', error);
  }
  ensureCliPath();
  try {
    const providerEnv = await sanitizeClaudeSettingsProviderEnv();
    if (providerEnv.updated) {
      console.log(
        `[provider-isolation] Removed shared Claude endpoint overrides: ${providerEnv.removed.join(', ')}`
      );
    }
    const mcpDefaults = await ensureDefaultClaudeMcpServers();
    if (mcpDefaults.updated) {
      console.log(
        `[mcp-defaults] Added ${mcpDefaults.added.join(', ')} to ${mcpDefaults.settingsPath}`
      );
    }
  } catch (err) {
    console.warn('[mcp-defaults] sync skipped:', err);
  }
  try {
    const skills = await listSkillLibrary(resolveConfigHome());
    const active = skills.filter((skill) => skill.entryType === 'skill' && skill.enabled).length;
    const onDemand = skills.filter((skill) => skill.entryType === 'skill' && !skill.enabled).length;
    console.log(`[skills] Catalog reconciled (${active} active, ${onDemand} on demand)`);
  } catch (err) {
    console.warn('[skills] startup reconciliation skipped:', err);
  }
  await syncProviderLinks();

  const app = express();

  // Trust proxy headers when behind nginx/reverse proxy. `true` is dangerous
  // without a guard proxy — any client can spoof X-Forwarded-For and defeat
  // IP-based rate limiting. Configure via TRUST_PROXY (default: 1 hop).
  app.set('trust proxy', config.trustProxy);

  const httpServer = createServer(app);

  // Setup WebSocket
  const io = setupWebSocket(httpServer);
  attachNotificationIo(io);

  // Initialize task delegation system
  initDiscordOutboxWorker();

  // Preview vhost — must run BEFORE any other middleware so helmet/CORS/body-parsers
  // don't rewrite or consume proxied traffic. Authelia (Traefik ForwardAuth) guards the
  // subdomain at the edge, so only authenticated users reach this handler.
  if (previewVhostEnabled()) {
    app.use(previewVhostMiddleware);
    httpServer.on('upgrade', (req, socket, head) => {
      handlePreviewUpgrade(req, socket as import('net').Socket, head);
    });
    console.log(`[PREVIEW] Proxy vhost enabled for ${config.previewHostname}`);
  }

  // Middleware
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      // The Vite build emits no inline scripts, so `script-src 'self'` is a strict
      // policy without needing per-request nonce injection. Style injection from
      // Radix UI and the inline <style> block in index.html requires
      // 'unsafe-inline' on style-src — style-based attacks have a much smaller
      // blast radius than script-based ones, so this tradeoff is acceptable.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          // Socket.IO upgrades same-origin XHR to WebSocket. Browsers differ on
          // whether 'self' implicitly covers ws:/wss:, so we list both explicitly.
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
    })
  );
  app.use((req, res, next) => {
    const host = (req.hostname || '').toLowerCase();
    const isTrustedOrigin =
      req.secure || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isTrustedOrigin) {
      res.removeHeader('Cross-Origin-Opener-Policy');
      res.removeHeader('Origin-Agent-Cluster');
    }
    next();
  });
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin requests (no origin header)
        if (!origin) {
          return callback(null, true);
        }
        // Check if origin is in the allowed list
        const normalizedOrigin = origin.toLowerCase();
        if (config.allowedOrigins.includes(normalizedOrigin)) {
          return callback(null, true);
        }
        // Reject unauthorized origins
        console.warn(`CORS: Rejected request from unauthorized origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );
  // Raw proxy for per-request model routing in Claude sessions. Mounted before
  // compression and body parsing on purpose: it forwards bodies byte-for-byte
  // and pipes SSE, so nothing in this file may touch either. Requests carry a
  // per-session token and are accepted from loopback only.
  app.use('/model-router', modelRouter.handler);

  // Nothing else compresses: there is no compress middleware on the Traefik
  // router either, so the frontend bundle went out at its full size — the entry
  // chunk alone is 178 kB raw against 53 kB gzipped, paid on every cold load
  // over the internet.
  //
  // Streaming responses are excluded. Socket.IO has its own permessage-deflate,
  // and buffering an SSE stream to compress it would defeat the point of the
  // gateway's event feed.
  app.use(
    compression({
      filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (type.includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    })
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      store: new SqliteSessionStore(),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: buildSessionCookieOptions(config.isProduction),
    })
  );

  // Passport
  setupPassport();
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(mobileGatewayAuth);

  // Make io available in routes
  app.set('io', io);

  const frontendPath = config.isProduction
    ? path.join(__dirname, '../../frontend/dist')
    : undefined;

  // Liveness only proves that the event loop can answer. Readiness additionally
  // verifies the local state required to accept user traffic.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.get('/health/ready', async (_req, res) => {
    // Provider status is attached for visibility only; a signed-out harness
    // must never make the container look unhealthy.
    const providers = await getProviderStatuses().catch(() => undefined);
    const report = await buildReadinessReport(frontendPath, providers);
    res.status(report.status === 'ready' ? 200 : 503).json(report);
  });

  // Routes
  app.use('/auth', authRoutes);
  app.use('/api/basic-auth', basicAuthRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/git', gitRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/oracle', oracleRoutes);
  app.use('/api/mcp-servers', mcpRoutes);
  app.use('/api/claude', claudeRoutes);
  app.use('/api/claude-config', claudeConfigRoutes);
  app.use('/api/permissions', permissionsRoutes);
  app.use('/api/usage', usageRoutes);
  app.use('/api/cli-tools', cliToolsRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/github', githubRoutes);
  app.use('/api/commands', commandsRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/checkpoints', checkpointsRoutes);
  app.use('/api/agents', agentsRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/cli-providers', cliProvidersRoutes);
  app.use('/api/cli-login', cliLoginRoutes);
  app.use('/api/setup', setupRoutes);
  app.use('/api/gateway', gatewayRoutes);
  app.use('/api/codex', codexRoutes);
  app.use('/api/opencode', opencodeRoutes);
  app.use('/api/memories', memoriesRoutes);
  app.use('/api/android', androidRoutes);
  app.use('/api/app', appRoutes);
  app.use('/api/workspace', workspaceRoutes);
  app.use('/api/transcribe', transcribeRoutes);
  app.use('/api/preview', previewRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/comfyui', comfyuiRoutes);
  app.use('/api/docker', dockerRoutes);
  app.use('/api/watchdogs', watchdogRoutes);
  app.use('/api/discord', discordRoutes);
  app.use('/api/home-assistant', homeAssistantRoutes);
  app.use('/api', sessionMeshRoutes);

  const logosDir = process.env.LOGOS_DIR || path.join(process.cwd(), 'logos');
  if (fs.existsSync(logosDir)) {
    app.use('/logos', express.static(logosDir));
  }

  // Generated images from the ComfyUI MCP tool. Session-cookie-gated so <img>
  // tags in chat bubbles work (Authorization headers aren't sent with images).
  // Filenames are UUIDs, but we still require a session to avoid leaking generated
  // content to unauthenticated users on the same origin.
  const generatedDir =
    process.env.COMFYUI_OUTPUT_DIR || path.join(process.cwd(), 'packages/backend/data/generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }
  app.use(
    '/generated',
    (req, res, next) => {
      if (req.isAuthenticated && req.isAuthenticated()) return next();
      res.status(401).send('unauthorized');
    },
    express.static(generatedDir, {
      fallthrough: false,
      maxAge: '1h',
      index: false,
      dotfiles: 'deny',
    })
  );

  // Serve frontend static files in production
  if (config.isProduction) {
    const productionFrontendPath = frontendPath as string;
    const designPreviewPath = path.join(productionFrontendPath, 'design-previews');
    app.use(
      '/design-previews',
      (_req, res, next) => {
        res.setHeader(
          'Content-Security-Policy',
          [
            "default-src 'self'",
            "script-src 'none'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'self'",
          ].join('; ')
        );
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        next();
      },
      express.static(designPreviewPath, {
        fallthrough: false,
        index: false,
        maxAge: 0,
        dotfiles: 'deny',
      })
    );

    app.use(
      express.static(productionFrontendPath, {
        setHeaders: (res, filePath) => {
          if (filePath.startsWith(path.join(productionFrontendPath, 'assets') + path.sep)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    // Backend auth routes that should NOT be handled by SPA
    const backendAuthRoutes = [
      '/auth/github',
      '/auth/google',
      '/auth/claude',
      '/auth/codex',
      '/auth/pi',
      '/auth/dev',
      '/auth/dev-login',
      '/auth/me',
      '/auth/logout',
      '/auth/providers',
    ];

    const staticAssetPrefixes = [
      '/assets/',
      '/claude-logo.png',
      '/favicon.svg',
      '/design-previews/',
      '/manifest.json',
      '/sw.js',
      '/service-worker.js',
    ];

    // Handle SPA routing - serve index.html for all non-API routes.
    //
    // `/{*splat}` rather than Express 4's `*`: path-to-regexp v8 rejects a bare
    // wildcard, and the braces matter. `/*splat` alone does not match `/` —
    // every deep link would work while the root 404s, which is the one route
    // nobody would think to test.
    app.get('/{*splat}', (req, res, next) => {
      // Skip API routes and backend auth routes
      if (
        req.path.startsWith('/api') ||
        backendAuthRoutes.some((r) => req.path.startsWith(r)) ||
        staticAssetPrefixes.some((prefix) => req.path.startsWith(prefix))
      ) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(productionFrontendPath, 'index.html'));
    });
  }

  // Error handler
  app.use(errorHandler);

  // Start server
  httpServer.listen(config.port, config.host, () => {
    console.log(`Server running on http://${config.host}:${config.port}`);
    console.log(`Frontend URL: ${config.frontendUrl}`);
    initUsageLimitHistoryCollector();
    // In-process, over the connection this server already owns. See
    // services/backup.ts for why a second connection is what corrupts the file.
    startBackupSchedule();
  });

  registerGracefulShutdown(httpServer, io);

  // Bootstrap Codex CLI config — generates ~/.codex/config.toml with WebUI defaults
  // and mirrors MCP servers from ~/.claude/settings.json so Codex sessions get the
  // same tool surface. Idempotent; runs once per boot. Best-effort, errors logged.
  void import('./utils/codexConfigSync.js')
    .then(async ({ syncCodexConfig }) => await syncCodexConfig())
    .then((status) => console.log(`[codex-config] ${status}`))
    .catch((err) => console.warn('[codex-config] sync skipped:', err));

  const autoUpdateEnabled = parseBooleanEnv(process.env.CLI_AUTO_UPDATE);
  const intervalHours = Number(process.env.CLI_AUTO_UPDATE_INTERVAL_HOURS || 0);
  const providers = parseCliUpdateProviders(process.env.CLI_AUTO_UPDATE_PROVIDERS);

  if (autoUpdateEnabled) {
    const runUpdate = async () => {
      await runCliUpdates(providers)
        .then((data) => {
          logUpdateSummary(data.results);
          if (data.results.some((result) => result.status === 'updated')) {
            resetDiscovery();
          }
        })
        .catch((error) => console.error('[CLI UPDATE] Failed:', error));
    };

    await runUpdate();

    if (Number.isFinite(intervalHours) && intervalHours > 0) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      setInterval(runUpdate, intervalMs);
      console.log(`[CLI UPDATE] Scheduled every ${intervalHours} hour(s).`);
    }
  }
}

main().catch(console.error);
