import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import authRouter from '../src/routes/auth.js';
import basicAuthRouter from '../src/routes/basic-auth.js';
import claudeConfigRouter from '../src/routes/claude-config.js';
import cliToolsRouter from '../src/routes/cli-tools.js';
import mcpRouter from '../src/routes/mcp.js';
import settingsRouter from '../src/routes/settings.js';
import { ensureBootstrapAdmin } from '../src/utils/adminBootstrap.js';
import { buildRestrictedChildEnv } from '../src/utils/childProcessEnv.js';
import { applyUntrustedFileHeaders, isActiveDocument } from '../src/utils/untrustedFile.js';
import { detectImageMime, isPathWithin } from '../src/services/comfyui/index.js';
import { permissionIdentityMatches } from '../src/routes/permissions.js';
import { permissionRequestBelongsToSession } from '../src/services/opencode/OpencodeServer.js';
import { MobileAuthCodeStore, createPkceChallenge } from '../src/services/mobileAuthCodes.js';
import { isMobileGatewayPublicRequest } from '../src/middleware/mobileGateway.js';

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name?: string } }>;
  };
};

function middlewareNames(router: unknown, routePath: string, method: string): string[] {
  const stack = (router as { stack?: RouterLayer[] }).stack ?? [];
  const layer = stack.find(
    (candidate) =>
      candidate.route?.path === routePath && candidate.route.methods[method.toLowerCase()]
  );
  assert.ok(layer?.route, `missing ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.map((entry) => entry.handle.name || '(anonymous)');
}

function assertAdminGuard(router: unknown, routePath: string, method: string): void {
  const names = middlewareNames(router, routePath, method);
  assert.ok(names.includes('requireAuth'), `${method} ${routePath} must require authentication`);
  assert.ok(names.includes('requireAdmin'), `${method} ${routePath} must require admin`);
  assert.ok(
    names.indexOf('requireAuth') < names.indexOf('requireAdmin'),
    `${method} ${routePath} must authenticate before checking admin role`
  );
}

function testAdminMutationBoundaries(): void {
  for (const [routePath, method] of [
    ['/style-library/design-md/import', 'post'],
    ['/agents', 'post'],
    ['/agent/:name', 'put'],
    ['/agent/:name/toggle', 'put'],
    ['/agent/:name', 'delete'],
    ['/skills', 'post'],
    ['/skill/:name', 'put'],
    ['/skill/:name/toggle', 'put'],
    ['/skill/:name', 'delete'],
    ['/skills/import', 'post'],
    ['/plugins', 'post'],
    ['/plugin/:name', 'put'],
    ['/plugin/:name/toggle', 'put'],
    ['/marketplaces', 'post'],
    ['/marketplace/:id/refresh', 'post'],
    ['/marketplace/:id', 'delete'],
    ['/plugins/install', 'post'],
    ['/plugin/:id', 'delete'],
  ] as const) {
    assertAdminGuard(claudeConfigRouter, routePath, method);
  }

  for (const [router, routePath, method] of [
    [mcpRouter, '/', 'post'],
    [mcpRouter, '/:id', 'put'],
    [mcpRouter, '/:id', 'delete'],
    [mcpRouter, '/:id/test', 'post'],
    [cliToolsRouter, '/', 'post'],
    [cliToolsRouter, '/:id', 'put'],
    [cliToolsRouter, '/:id', 'delete'],
    [cliToolsRouter, '/:id/execute', 'post'],
    [settingsRouter, '/integrations', 'put'],
    [basicAuthRouter, '/toggle', 'put'],
  ] as const) {
    assertAdminGuard(router, routePath, method);
  }
}

async function testCliProviderLoginNeedsIdentity(): Promise<void> {
  const stack = (authRouter as unknown as { stack: RouterLayer[] }).stack;
  for (const provider of ['claude', 'codex', 'opencode', 'pi']) {
    const layer = stack.find(
      (candidate) => candidate.route?.path === `/${provider}` && candidate.route.methods.get
    );
    assert.ok(layer?.route, `missing provider route ${provider}`);
    const handler = layer.route.stack.at(-1)?.handle as unknown as (
      req: Record<string, unknown>,
      res: Record<string, unknown>
    ) => Promise<void>;
    let redirected = '';
    await handler(
      { headers: {}, isAuthenticated: () => false },
      {
        redirect: (value: string) => {
          redirected = value;
        },
      }
    );
    assert.match(redirected, /error=identity_required$/, `${provider} accepted no identity`);
  }
}

function testRestrictedCommandEnvironment(): void {
  const env = buildRestrictedChildEnv(
    { TERM: 'xterm-256color' },
    {
      HOME: '/home/node',
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
      JWT_SECRET: 'must-not-leak',
      WEBUI_HOOK_SECRET: 'must-not-leak',
      OPENAI_API_KEY: 'must-not-leak',
      DOCKER_HOST: 'tcp://host.docker.internal:2375',
      DOCKER_TLS_VERIFY: '1',
    }
  );
  assert.deepEqual(env, {
    HOME: '/home/node',
    PATH: '/usr/bin',
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
  });
}

function testPermissionIdentityBinding(): void {
  assert.equal(
    permissionIdentityMatches({ userId: 'user-a', sessionId: 'session-a' }, 'user-a', 'session-a'),
    true
  );
  assert.equal(
    permissionIdentityMatches({ userId: 'user-a', sessionId: 'session-a' }, 'user-b', 'session-a'),
    false
  );
  assert.equal(
    permissionIdentityMatches({ userId: 'user-a', sessionId: 'session-a' }, 'user-a', 'session-b'),
    false
  );
  assert.equal(permissionRequestBelongsToSession('remote-a', 'remote-a'), true);
  assert.equal(permissionRequestBelongsToSession('remote-a', 'remote-b'), false);
  assert.equal(permissionRequestBelongsToSession(undefined, 'remote-a'), false);
}

function testUntrustedActiveDocuments(): void {
  assert.equal(isActiveDocument('/workspace/demo.svg'), true);
  assert.equal(isActiveDocument('/workspace/demo.HTML'), true);
  assert.equal(isActiveDocument('/workspace/demo.png'), false);

  const headers = new Map<string, string>();
  const response = {
    setHeader: (name: string, value: string | number | readonly string[]) => {
      headers.set(name.toLowerCase(), String(value));
    },
  };
  assert.equal(applyUntrustedFileHeaders(response as never, '/workspace/untrusted.svg'), true);
  assert.match(headers.get('content-disposition') || '', /^attachment;/);
  assert.equal(headers.get('content-type'), 'application/octet-stream');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.match(headers.get('content-security-policy') || '', /sandbox/);
}

function testComfyInputPrimitives(): void {
  assert.equal(
    isPathWithin('/workspace/project/attachments', '/workspace/project/attachments/a.png'),
    true
  );
  assert.equal(
    isPathWithin('/workspace/project/attachments', '/workspace/project/secrets/a.png'),
    false
  );
  assert.equal(
    isPathWithin('/workspace/project/attachments', '/workspace/project/attachments'),
    false
  );
  assert.equal(
    detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png'
  );
  assert.equal(detectImageMime(Buffer.from('not an image')), null);
}

function testBootstrapAdminIdentity(): void {
  const previous = process.env.SEED_ADMIN_EMAIL;
  process.env.SEED_ADMIN_EMAIL = 'owner@example.com';
  try {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, email) VALUES ('attacker', 'attacker@example.com');
      INSERT INTO users (id, email) VALUES ('owner', 'owner@example.com');
    `);
    assert.equal(ensureBootstrapAdmin(db, 'attacker', 'attacker@example.com'), false);
    assert.equal(ensureBootstrapAdmin(db, 'owner', 'owner@example.com'), true);
    const owner = db.prepare(`SELECT role FROM users WHERE id = 'owner'`).get() as { role: string };
    assert.equal(owner.role, 'admin');
    db.close();
  } finally {
    if (previous === undefined) delete process.env.SEED_ADMIN_EMAIL;
    else process.env.SEED_ADMIN_EMAIL = previous;
  }
}

function testMobileAuthBoundary(): void {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.equal(createPkceChallenge(verifier), challenge);

  let now = 1_000;
  const codes = ['A'.repeat(43), 'B'.repeat(43), 'C'.repeat(43)];
  const store = new MobileAuthCodeStore(
    () => now,
    () => codes.shift() || 'D'.repeat(43),
    1_000,
    3
  );

  const validCode = store.issue('user-a', challenge);
  assert.equal(store.exchange(validCode, verifier), 'user-a');
  assert.equal(store.exchange(validCode, verifier), null, 'mobile code must be one-time');

  const wrongVerifierCode = store.issue('user-a', challenge);
  assert.equal(store.exchange(wrongVerifierCode, 'x'.repeat(43)), null);
  assert.equal(store.exchange(wrongVerifierCode, verifier), null, 'failed PKCE burns the code');

  const expiredCode = store.issue('user-a', challenge);
  now += 1_001;
  assert.equal(store.exchange(expiredCode, verifier), null);

  for (const [method, route] of [
    ['GET', '/health'],
    ['GET', '/auth/providers'],
    ['GET', '/auth/proxy/mobile'],
    ['POST', '/auth/mobile/exchange'],
    ['POST', '/api/basic-auth/login'],
  ]) {
    assert.equal(isMobileGatewayPublicRequest(method, route), true, `${method} ${route}`);
  }
  assert.equal(isMobileGatewayPublicRequest('GET', '/api/sessions'), false);
  assert.equal(isMobileGatewayPublicRequest('GET', '/auth/me'), false);
  assert.equal(isMobileGatewayPublicRequest('POST', '/auth/mobile/exchange/extra'), false);
}

async function testPermissionHookCarriesSessionIdentity(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const source = await fs.readFile(
    path.resolve(scriptDir, '../src/cli/permission-prompt.ts'),
    'utf8'
  );
  assert.match(source, /'X-Webui-Session-Id': webuiSessionId/);
}

async function testCustomCommandsUseRestrictedEnvironment(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  for (const relativePath of [
    '../src/routes/cli-tools.ts',
    '../src/routes/mcp.ts',
    '../src/routes/preview.ts',
  ]) {
    const source = await fs.readFile(path.resolve(scriptDir, relativePath), 'utf8');
    assert.match(source, /buildRestrictedChildEnv/);
    assert.doesNotMatch(source, /env:\s*\{\s*\.\.\.process\.env/);
  }
}

testAdminMutationBoundaries();
await testCliProviderLoginNeedsIdentity();
testRestrictedCommandEnvironment();
testPermissionIdentityBinding();
testUntrustedActiveDocuments();
testComfyInputPrimitives();
testBootstrapAdminIdentity();
testMobileAuthBoundary();
await testPermissionHookCarriesSessionIdentity();
await testCustomCommandsUseRestrictedEnvironment();

console.log('security boundary regression tests passed');
