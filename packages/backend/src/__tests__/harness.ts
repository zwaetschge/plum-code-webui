import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Boots the real server against a throwaway database and talks to it over HTTP.
 *
 * There were no integration tests: 49 regression suites, and not one of them
 * called `POST /api/sessions` and checked what landed in the database. That gap
 * is what makes the Postgres port dangerous — the type checker catches a missing
 * `await` only where a type actually collides, and an `await` in the wrong place
 * compiles cleanly while writing in the wrong order.
 *
 * These tests run against SQLite today and are meant to survive the port
 * unchanged, so the same assertions prove Postgres behaves identically.
 *
 * The server runs as a child process rather than being imported, because
 * importing index.ts starts provider managers, watchdogs and file watchers in
 * the test process. Authentication uses a gateway token: it resolves to a real
 * user and then takes the same path as a browser session, so the routes are
 * exercised exactly as they are in production.
 */

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));

export interface TestServer {
  url: string;
  dataDir: string;
  /** Authenticated as the seeded user. */
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  /** Without credentials, for checking that a route is actually guarded. */
  anonymous(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  userId: string;
  stop(): Promise<void>;
}

async function waitForHealth(url: string, child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become healthy: ${lastError}`);
}

export async function startTestServer(): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-it-'));
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plum-it-cfg-'));
  // Port 0 would be ideal, but the server logs its port rather than returning
  // it; a high random port collides rarely enough and fails loudly if it does.
  const port = 34000 + Math.floor(Math.random() * 4000);
  const url = `http://127.0.0.1:${port}`;

  const userId = 'integration-user';
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    WEBUI_DATA_DIR: dataDir,
    WEBUI_CONFIG_HOME: configHome,
    PORT: String(port),
    HOST: '127.0.0.1',
    SESSION_SECRET: 'i'.repeat(32),
    JWT_SECRET: 'j'.repeat(32),
    FRONTEND_URL: url,
    ALLOWED_BASE_PATHS: `${dataDir},${os.tmpdir()}`,
    CLI_AUTO_UPDATE: 'false',
    LOG_LEVEL: 'error',
  };

  // Seed the user and a token before boot, so the first request is authenticated.
  // Written to a file rather than passed with -e: node treats -e input as
  // CommonJS unless told otherwise, and these are ESM imports.
  const seedScript = path.join(dataDir, 'seed.mts');
  fs.writeFileSync(
    seedScript,
    `
    import { initDatabase, getDatabase } from '${path.join(backendRoot, 'src/db/index.js')}';
    import { createGatewayToken } from '${path.join(backendRoot, 'src/services/gateway/tokens.js')}';
    initDatabase();
    getDatabase()
      .prepare('INSERT OR IGNORE INTO users (id,email,name,provider,provider_id,role) VALUES (?,?,?,?,?,?)')
      .run('${userId}', 'it@example.test', 'IT', 'local', '${userId}', 'admin');
    process.stdout.write(createGatewayToken('${userId}', 'integration', 'write').token);
    `
  );
  const seed = spawn(process.execPath, ['--import', 'tsx', seedScript], {
    cwd: backendRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let seedOut = '';
  seed.stdout.on('data', (chunk) => (seedOut += String(chunk)));
  let seedError = '';
  seed.stderr.on('data', (chunk) => (seedError += String(chunk)));
  const seedCode: number = await new Promise((resolve) => seed.on('close', resolve));
  // initDatabase prints a first-run credentials banner to stdout, so the token
  // is picked out rather than assumed to be the whole output.
  const token = seedOut.match(/plum_gw_[A-Za-z0-9_-]+/)?.[0] ?? '';
  if (seedCode !== 0 || !token) {
    throw new Error(`seeding failed (${seedCode}): ${(seedError || seedOut).slice(-500)}`);
  }

  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: backendRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (chunk) => (serverLog += String(chunk)));
  child.stderr.on('data', (chunk) => (serverLog += String(chunk)));

  try {
    await waitForHealth(url, child);
  } catch (error) {
    child.kill('SIGKILL');
    throw new Error(
      `${(error as Error).message}\n--- server output ---\n${serverLog.slice(-2000)}`
    );
  }

  const call = async (method: string, route: string, body: unknown, authed: boolean) => {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authed ? { Authorization: `Bearer ${token}` } : {}),
      },
      // GET and HEAD must not carry a body; fetch rejects it outright.
      ...(body === undefined || method === 'GET' || method === 'HEAD'
        ? {}
        : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON responses are returned as text */
    }
    return { status: response.status, body: parsed as any };
  };

  return {
    url,
    dataDir,
    userId,
    request: (method, route, body) => call(method, route, body, true),
    anonymous: (method, route, body) => call(method, route, body, false),
    async stop() {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve(null);
        }, 5_000);
        child.on('close', () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(configHome, { recursive: true, force: true });
    },
  };
}
