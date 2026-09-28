import { all, run } from '../db/pg.js';
import {
  agentLifecycle,
  isActiveAgent,
  subagentCounts,
  type SubagentRun,
} from '@plum-code-webui/shared';

const writes = new Map<string, Promise<void>>();

export function persistSubagentRun(sessionId: string, agent: SubagentRun): void {
  // Capture the payload now: callers may update the in-memory run before this write starts.
  const payload = JSON.stringify(agent);
  const pending = (writes.get(sessionId) ?? Promise.resolve())
    .then(async () => {
      await run(
        `INSERT INTO session_agent_runs (session_id,id,chat_id,updated_at,payload) VALUES (?,?,?,?,?::jsonb)
      ON CONFLICT (session_id,id) DO UPDATE SET chat_id=EXCLUDED.chat_id, updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload
      WHERE (session_agent_runs.payload->>'revision')::bigint <= (EXCLUDED.payload->>'revision')::bigint`,
        sessionId,
        agent.id,
        agent.chatId ?? null,
        agent.updatedAt ?? agent.startedAt,
        payload
      );
    })
    .catch((error) => console.error('[agents] Failed to persist run', error));
  writes.set(sessionId, pending);
  void pending.then(() => {
    if (writes.get(sessionId) === pending) writes.delete(sessionId);
  });
}

const stateSql = `COALESCE(payload->>'lifecycle', CASE payload->>'status' WHEN 'started' THEN 'running' WHEN 'error' THEN 'failed' ELSE 'completed' END)`;
const storedState = (state: string) =>
  state === 'running' || state === 'queued' ? 'interrupted' : state;

export async function getSubagentHistory(
  sessionId: string,
  chatId: string | null,
  readLive: () => SubagentRun[],
  offset = 0
) {
  await writes.get(sessionId);
  const rows = (await all(
    `SELECT payload FROM session_agent_runs WHERE session_id=? AND chat_id IS NOT DISTINCT FROM ? ORDER BY updated_at DESC, id LIMIT 51 OFFSET ?`,
    sessionId,
    chatId,
    offset
  )) as { payload: SubagentRun }[];
  const groups = (await all(
    `SELECT ${stateSql} AS state, COUNT(*)::int AS count FROM session_agent_runs WHERE session_id=? AND chat_id IS NOT DISTINCT FROM ? GROUP BY 1`,
    sessionId,
    chatId
  )) as { state: string; count: number }[];
  // Read process state after the awaited database work so newly emitted starts cannot be lost.
  const live = readLive().filter((r) => (r.chatId ?? null) === chatId);
  const storedLive = live.length
    ? ((await all(
        `SELECT id, ${stateSql} AS state FROM session_agent_runs WHERE session_id=? AND id = ANY(?::text[])`,
        sessionId,
        live.map((r) => r.id)
      )) as { id: string; state: string }[])
    : [];
  const currentLive = readLive().filter((r) => (r.chatId ?? null) === chatId);
  const capturedAt = Date.now();
  const liveById = new Map(currentLive.map((r) => [r.id, r]));
  const history = rows.slice(0, 50).map(
    ({ payload: r }) =>
      liveById.get(r.id) ??
      (isActiveAgent(r) || agentLifecycle(r) === 'queued'
        ? {
            ...r,
            status: 'error' as const,
            lifecycle: 'interrupted' as const,
            activitySummary: 'Prozess nicht mehr verbunden',
            completedAt: r.updatedAt ?? r.startedAt,
            updatedAt: capturedAt,
            revision: Math.max(capturedAt, (r.revision ?? 0) + 1),
          }
        : r)
  );
  const totals = subagentCounts(currentLive);
  const historyCounts: Record<string, number> = {};
  for (const group of groups)
    historyCounts[storedState(group.state)] =
      (historyCounts[storedState(group.state)] ?? 0) + group.count;
  for (const saved of storedLive)
    historyCounts[storedState(saved.state)] = Math.max(
      0,
      (historyCounts[storedState(saved.state)] ?? 0) - 1
    );
  totals.completed += historyCounts.completed ?? 0;
  totals.failed += historyCounts.failed ?? 0;
  totals.interrupted += (historyCounts.interrupted ?? 0) + (historyCounts.cancelled ?? 0);
  // Every live run survives history pagination; no active-agent cap.
  const runs = [...new Map([...history, ...currentLive].map((r) => [r.id, r])).values()];
  return { runs, totals, capturedAt, chatId, hasMore: rows.length > 50, nextOffset: offset + 50 };
}
