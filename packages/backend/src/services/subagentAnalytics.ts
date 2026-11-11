/**
 * What subagents spent in a period, for the analytics view.
 *
 * "Subagent" covers three things that are booked in three different ways:
 *
 * - `agent`: agents a session starts itself — Claude Code's Agent tool, and
 *   Codex's spawned threads. One row per agent and booking in
 *   `usage_subagent_turns`, with the agent's type and model.
 * - `worker`: whole other CLIs started through the CLI-subagent bridge
 *   (`run_subagent`): a Pi, Codex or Claude run of its own. One ledger row per
 *   run, turn id `cli-subagent-…`.
 * - `routed`: calls of an agent that the model router sent to another vendor
 *   (a GLM agent inside a Claude session). One ledger row per call, turn id
 *   `subagent-…`; these are requests, not runs.
 *
 * All of it is part of the ledger's totals, so the share is taken against
 * everything booked in the same period.
 */

import { getProviderLabelForUsage } from '@plum-code-webui/shared';

import { all as pgAll, get as pgGet } from '../db/pg.js';

export type SubagentKind = 'agent' | 'worker' | 'routed';

export interface SubagentUsageGroup {
  kind: SubagentKind;
  /** The harness that booked it (`claude`, `codex`, `pi`, …). */
  provider: string;
  providerLabel: string;
  /** Agent type for agents (`general-purpose`, `fork`, …); empty otherwise. */
  agentType: string;
  model: string;
  /** Agents, worker runs, or — for `routed` — single calls. */
  runs: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number;
  lastUsedAt: string | null;
}

export interface SubagentUsageSummary {
  groups: SubagentUsageGroup[];
  totals: {
    totalTokens: number;
    costUsd: number;
    runs: number;
    /** Everything booked in the period, subagents included. */
    windowTotalTokens: number;
    /** Subagents' part of that, in percent. */
    sharePercent: number;
  };
}

interface GroupRow {
  kind: SubagentKind;
  provider: string;
  agent_type: string | null;
  model: string | null;
  runs: string | number;
  sessions: string | number;
  input_tokens: string | number;
  output_tokens: string | number;
  cache_read_tokens: string | number;
  cache_creation_tokens: string | number;
  total_tokens: string | number;
  cost_usd: string | number;
  last_used_at: string | null;
}

/**
 * @param range ledger timestamps (`YYYY-MM-DD HH:MM:SS`, UTC); `from` inclusive,
 *   `to` exclusive, either may be left open.
 */
export async function summariseSubagentUsage(
  userId: string,
  range: { from?: string | null; to?: string | null } = {}
): Promise<SubagentUsageSummary> {
  const period: string[] = [];
  const periodParams: string[] = [];
  if (range.from) {
    period.push('AND created_at >= ?');
    periodParams.push(range.from);
  }
  if (range.to) {
    period.push('AND created_at < ?');
    periodParams.push(range.to);
  }
  const within = period.join(' ');
  const sums = `COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
                COALESCE(SUM(total_tokens), 0) AS total_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd,
                MAX(created_at) AS last_used_at`;

  // Codex gives each spawned thread a name of its own ("Hypatia", "Nash"), not
  // a type: grouping by it would list every single run.
  const agentType = `CASE WHEN provider = 'codex' THEN '' ELSE COALESCE(agent_type, '') END`;

  const rows = (await pgAll(
    `SELECT 'agent' AS kind, provider, ${agentType} AS agent_type, model,
            COUNT(DISTINCT agent_id) AS runs, COUNT(DISTINCT session_id) AS sessions, ${sums}
       FROM usage_subagent_turns
      WHERE user_id = ? ${within}
      GROUP BY provider, ${agentType}, model
     UNION ALL
     SELECT 'worker' AS kind, provider, '' AS agent_type, model,
            COUNT(*) AS runs, COUNT(DISTINCT session_id) AS sessions, ${sums}
       FROM usage_history
      WHERE user_id = ? AND turn_id LIKE 'cli-subagent-%' ${within}
      GROUP BY provider, model
     UNION ALL
     SELECT 'routed' AS kind, provider, '' AS agent_type, model,
            COUNT(*) AS runs, COUNT(DISTINCT session_id) AS sessions, ${sums}
       FROM usage_history
      WHERE user_id = ? AND turn_id LIKE 'subagent-%' ${within}
      GROUP BY provider, model`,
    userId,
    ...periodParams,
    userId,
    ...periodParams,
    userId,
    ...periodParams
  )) as unknown as GroupRow[];

  const groups: SubagentUsageGroup[] = rows
    .map((row) => ({
      kind: row.kind,
      provider: row.provider,
      providerLabel: getProviderLabelForUsage(row.provider, row.model),
      agentType: row.agent_type ?? '',
      model: row.model ?? '',
      runs: Number(row.runs),
      sessions: Number(row.sessions),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheCreationTokens: Number(row.cache_creation_tokens),
      totalTokens: Number(row.total_tokens),
      costUsd: Number(row.cost_usd),
      lastUsedAt: row.last_used_at,
    }))
    .filter((group) => group.totalTokens > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens);

  const window = (await pgGet(
    `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens FROM usage_history
      WHERE user_id = ? ${within}`,
    userId,
    ...periodParams
  )) as unknown as { total_tokens: string | number } | undefined;
  const windowTotalTokens = Number(window?.total_tokens ?? 0);
  const totalTokens = groups.reduce((sum, group) => sum + group.totalTokens, 0);

  return {
    groups,
    totals: {
      totalTokens,
      // Micro-dollars, like the rows it is summed from.
      costUsd: Math.round(groups.reduce((sum, group) => sum + group.costUsd, 0) * 1e6) / 1e6,
      runs: groups.reduce((sum, group) => sum + group.runs, 0),
      windowTotalTokens,
      sharePercent:
        windowTotalTokens > 0
          ? Math.min(100, Math.round((totalTokens / windowTotalTokens) * 1000) / 10)
          : 0,
    },
  };
}
