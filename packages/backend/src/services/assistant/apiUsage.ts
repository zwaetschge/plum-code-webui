import type { AssistantApiUsage } from '@plum-code-webui/shared';
import { all } from '../../db/pg.js';

/** Separate API ledger: no CLI subscription attribution, prompt text or duplicated branch usage. */
export async function apiUsage(
  userId: string,
  from?: string,
  to?: string
): Promise<AssistantApiUsage> {
  const where = ['user_id=?'],
    args = [userId];
  if (from) {
    where.push('created_at>=?');
    args.push(from);
  }
  if (to) {
    where.push('created_at<?');
    args.push(to);
  }
  const rows = await all(
    `SELECT provider_id,model,COUNT(*) AS calls,
    COUNT(*) FILTER (WHERE status='running') AS running,
    COUNT(*) FILTER (WHERE status<>'running' AND usage_json IS NULL) AS missing,
    COUNT(*) FILTER (WHERE status<>'running' AND (usage_json IS NULL OR usage_json::jsonb->>'costUsd' IS NULL)) AS unpriced,
    COALESCE(SUM((usage_json::jsonb->>'input')::numeric),0) AS input,
    COALESCE(SUM((usage_json::jsonb->>'output')::numeric),0) AS output,
    COALESCE(SUM((usage_json::jsonb->>'cached')::numeric),0) AS cached,
    COALESCE(SUM((usage_json::jsonb->>'cacheWrite')::numeric),0) AS cache_write,
    COALESCE(SUM((usage_json::jsonb->>'costUsd')::numeric),0) AS cost
    FROM assistant_api_usage WHERE ${where.join(' AND ')} GROUP BY provider_id,model ORDER BY cost DESC,provider_id,model`,
    ...args
  );
  const result: AssistantApiUsage = {
    calls: 0,
    running: 0,
    input: 0,
    output: 0,
    cached: 0,
    cacheWrite: 0,
    knownCostUsd: 0,
    unpriced: 0,
    missingUsage: 0,
    byModel: [],
  };
  for (const row of rows) {
    const input = Number(row.input),
      output = Number(row.output),
      cached = Number(row.cached),
      cacheWrite = Number(row.cache_write),
      calls = Number(row.calls),
      cost = Number(row.cost),
      unpriced = Number(row.unpriced);
    result.calls += calls;
    result.running += Number(row.running);
    result.input += input;
    result.output += output;
    result.cached += cached;
    result.cacheWrite += cacheWrite;
    result.knownCostUsd += cost;
    result.unpriced += unpriced;
    result.missingUsage += Number(row.missing);
    result.byModel.push({
      providerId: String(row.provider_id),
      model: String(row.model),
      calls,
      tokens: input + output + cached + cacheWrite,
      knownCostUsd: cost,
      unpriced,
    });
  }
  return result;
}
