import { all, get, type TransactionScope } from '../../db/pg.js';
import { resolveModelPricing, type AssistantTaskLimits } from '@plum-code-webui/shared';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource } from './resources.js';
/** CLI costs are API-equivalent completed-turn costs, not subscription charges or a per-token hard cap. */
export async function taskLimits(
  userId: string,
  taskId: string,
  tx?: TransactionScope
): Promise<AssistantTaskLimits> {
  const task = await findResource(userId, taskId, tx);
  if (task.kind !== 'task') throw new AppError('Auftrag nicht gefunden', 404, 'NOT_FOUND');
  if (String(task.body.agentId ?? '').startsWith('matrix:'))
    return {
      budgetUsd: typeof task.body.budgetUsd === 'number' ? task.body.budgetUsd : null,
      knownCostUsd: null,
      unpricedTurns: 0,
      exhausted: false,
      deadline: typeof task.body.dueAt === 'string' ? task.body.dueAt : null,
      deadlineExpired: false,
      scope: 'native-coordinator',
    };
  const rows = await (tx ?? { all }).all(
    `SELECT u.model,u.cost_usd,u.total_tokens FROM usage_history u WHERE u.user_id=? AND u.session_id IN (SELECT DISTINCT session_id FROM assistant_attempts WHERE task_id=? AND session_id IS NOT NULL)`,
    userId,
    taskId
  );
  let knownCostUsd = 0,
    unpricedTurns = 0;
  for (const row of rows) {
    if (Number(row.total_tokens) > 0 && !resolveModelPricing(String(row.model ?? '')))
      unpricedTurns++;
    else if (Number.isFinite(Number(row.cost_usd)))
      knownCostUsd += Math.max(0, Number(row.cost_usd));
  }
  const budgetUsd = typeof task.body.budgetUsd === 'number' ? task.body.budgetUsd : null;
  const deadline = typeof task.body.dueAt === 'string' ? task.body.dueAt : null;
  return {
    budgetUsd,
    knownCostUsd,
    unpricedTurns,
    exhausted: budgetUsd !== null && knownCostUsd >= budgetUsd,
    deadline,
    deadlineExpired: deadline !== null && Date.parse(deadline) <= Date.now(),
    scope: 'api-equivalent-completed-turns' as const,
  };
}
export async function assertTaskTurnAllowed(sessionId: string, userId: string) {
  const row = await get(
    `SELECT r.id FROM assistant_resources r JOIN sessions s ON s.id=? AND s.user_id=r.user_id AND s.surface='task' WHERE r.user_id=? AND r.kind='task' AND r.archived=0 AND (r.body_json::jsonb)->>'sessionId'=s.id`,
    sessionId,
    userId
  );
  if (!row) return;
  const limits = await taskLimits(userId, String(row.id));
  if (limits.deadlineExpired)
    throw new AppError(
      'Die Task-Frist ist abgelaufen. Vor weiterer Arbeit die Frist ausdrücklich ändern.',
      409,
      'TASK_DEADLINE_EXPIRED'
    );
  if (limits.exhausted)
    throw new AppError(
      'Das Task-Budget für API-equivalente abgeschlossene Beiträge ist erreicht. Vor weiterer Arbeit das Budget ausdrücklich ändern.',
      409,
      'TASK_BUDGET_EXHAUSTED'
    );
  if (limits.budgetUsd !== null && limits.unpricedTurns)
    throw new AppError(
      'Für diesen Task fehlen bestätigte Modellpreise. Das Budget kann weitere Beiträge nicht verlässlich freigeben.',
      409,
      'TASK_COST_UNKNOWN'
    );
}
