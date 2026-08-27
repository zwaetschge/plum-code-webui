import { all as pgAll } from '../db/pg.js';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const DEFAULT_POLL_MS = 15 * 60 * 1000;
const MIN_POLL_MS = 60 * 1000;
const PROVIDERS = ['codex', 'claude', 'zai', 'kimi'] as const;

let initialized = false;
let collectionRunning = false;

function pollIntervalMs(): number {
  const configured = Number(process.env.USAGE_LIMIT_HISTORY_POLL_MS || DEFAULT_POLL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return 0;
  return Math.max(MIN_POLL_MS, configured);
}

function localBackendUrl(): string {
  return `http://127.0.0.1:${config.port}`;
}

export async function collectProviderLimitSnapshots(): Promise<{
  users: number;
  requests: number;
  failures: number;
}> {
  if (collectionRunning) return { users: 0, requests: 0, failures: 0 };
  collectionRunning = true;
  try {
    const users = (await pgAll(
      `SELECT id FROM users WHERE status = 'active' ORDER BY created_at ASC`
    )) as unknown as Array<{ id: string }>;
    let requests = 0;
    let failures = 0;

    await Promise.all(
      users.flatMap((user) => {
        const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '5m' });
        return PROVIDERS.map(async (provider) => {
          requests += 1;
          try {
            const response = await fetch(
              `${localBackendUrl()}/api/usage/limits?provider=${encodeURIComponent(provider)}`,
              {
                headers: {
                  Accept: 'application/json',
                  Authorization: `Bearer ${token}`,
                },
              }
            );
            if (!response.ok) failures += 1;
            // Consume the body so the connection can be reused.
            await response.arrayBuffer();
          } catch {
            failures += 1;
          }
        });
      })
    );

    return { users: users.length, requests, failures };
  } finally {
    collectionRunning = false;
  }
}

export function initUsageLimitHistoryCollector(): void {
  if (initialized) return;
  initialized = true;
  const intervalMs = pollIntervalMs();
  if (intervalMs === 0) {
    console.log('[USAGE LIMITS] Background history collection disabled.');
    return;
  }

  const collect = () => {
    void collectProviderLimitSnapshots()
      .then(({ users, requests, failures }) => {
        console.log(
          `[USAGE LIMITS] Collected account quotas for ${users} user(s): ` +
            `${requests - failures}/${requests} provider checks succeeded.`
        );
      })
      .catch((error) => console.error('[USAGE LIMITS] Background collection failed:', error));
  };

  const initial = setTimeout(collect, 5_000);
  initial.unref();
  const interval = setInterval(collect, intervalMs);
  interval.unref();
}
