import type { SubagentRun } from '../types/session.js';

export function agentLifecycle(run: SubagentRun) {
  return (
    run.lifecycle ??
    (run.status === 'started' ? 'running' : run.status === 'error' ? 'failed' : 'completed')
  );
}
export function isActiveAgent(run: SubagentRun) {
  return agentLifecycle(run) === 'running';
}
export function agentVersion(run: SubagentRun) {
  return run.revision ?? run.updatedAt ?? run.completedAt ?? run.startedAt;
}
/** A run is an invocation, never a reusable worker identity. Terminal state cannot be undone by delayed start events. */
export function mergeSubagentRuns(existing: SubagentRun[], incoming: SubagentRun[]): SubagentRun[] {
  const byId = new Map(existing.map((run) => [run.id, run]));
  for (const run of incoming) {
    const old = byId.get(run.id);
    if (
      old &&
      (agentVersion(old) > agentVersion(run) ||
        (!isActiveAgent(old) && agentLifecycle(old) !== 'queued' && isActiveAgent(run)))
    )
      continue;
    byId.set(run.id, { ...old, ...run, startedAt: old?.startedAt ?? run.startedAt });
  }
  return [...byId.values()].sort(
    (a, b) =>
      Number(isActiveAgent(b)) - Number(isActiveAgent(a)) ||
      (isActiveAgent(a)
        ? a.startedAt - b.startedAt
        : (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt))
  );
}
export function reconcileSubagentSnapshot(
  existing: SubagentRun[],
  incoming: SubagentRun[],
  capturedAt: number,
  chatId: string | null
): SubagentRun[] {
  // Preserve events received after the server captured the snapshot, including newly started runs.
  const ids = new Set(incoming.map((run) => run.id));
  const retained = existing.filter(
    (run) =>
      (run.chatId ?? null) !== chatId ||
      ids.has(run.id) ||
      (run.updatedAt ?? run.startedAt) > capturedAt ||
      !isActiveAgent(run)
  );
  return mergeSubagentRuns(retained, incoming);
}
export function subagentCounts(runs: SubagentRun[]) {
  return {
    active: runs.filter(isActiveAgent).length,
    working: runs.filter((r) => isActiveAgent(r) && r.activity !== 'waiting').length,
    waiting: runs.filter((r) => isActiveAgent(r) && r.activity === 'waiting').length,
    queued: runs.filter((r) => agentLifecycle(r) === 'queued').length,
    completed: runs.filter((r) => agentLifecycle(r) === 'completed').length,
    failed: runs.filter((r) => agentLifecycle(r) === 'failed').length,
    interrupted: runs.filter((r) => ['interrupted', 'cancelled'].includes(agentLifecycle(r)))
      .length,
  };
}
