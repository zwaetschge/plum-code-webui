import { randomUUID } from 'node:crypto';
import { get, run } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';

const OWNER_ID = randomUUID();
const LEASE_MS = 90000;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let epoch: number | null = null;
let onLoss: (() => void) | null = null;
export function onAssistantExecutorLoss(handler: () => void): void {
  onLoss = handler;
}
function loseLease(): void {
  if (epoch !== null) onLoss?.();
  epoch = null;
}
export async function acquireAssistantExecutor(): Promise<boolean> {
  if (process.env.PLUM_ASSISTANT_EXECUTOR === 'false') return false;
  const now = new Date().toISOString();
  const until = new Date(Date.now() + LEASE_MS).toISOString();
  const row = (await get(
    `INSERT INTO assistant_executor_leases (name, owner_id, expires_at) VALUES ('cli-tasks', ?, ?)
    ON CONFLICT(name) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at,
    epoch = assistant_executor_leases.epoch + 1
    WHERE assistant_executor_leases.expires_at < ? OR assistant_executor_leases.owner_id = ? RETURNING epoch`,
    OWNER_ID,
    until,
    now,
    OWNER_ID
  )) as { epoch: number } | undefined;
  if (!row) return false;
  epoch = Number(row.epoch);
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      void run(
        `UPDATE assistant_executor_leases SET expires_at = ? WHERE name = 'cli-tasks' AND owner_id = ? AND epoch = ? AND expires_at > ?`,
        new Date(Date.now() + LEASE_MS).toISOString(),
        OWNER_ID,
        epoch,
        new Date().toISOString()
      )
        .then((r) => {
          if (!r.changes) loseLease();
        })
        .catch(() => {
          loseLease();
        });
    }, 30000);
    heartbeat.unref();
  }
  return true;
}
export async function requireAssistantExecutor(): Promise<void> {
  const current = (await get(
    "SELECT owner_id, epoch, expires_at FROM assistant_executor_leases WHERE name = 'cli-tasks'"
  )) as { owner_id: string; epoch: number; expires_at: string } | undefined;
  if (
    epoch === null ||
    !current ||
    current.owner_id !== OWNER_ID ||
    Number(current.epoch) !== epoch ||
    current.expires_at <= new Date().toISOString()
  )
    throw new AppError(
      'Der Auftragsdienst ist in einer anderen Instanz aktiv oder noch nicht bereit',
      503,
      'EXECUTOR_UNAVAILABLE'
    );
}
