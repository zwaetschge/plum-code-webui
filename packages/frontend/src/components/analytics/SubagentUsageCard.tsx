import { useMemo, useState } from 'react';
import { AlertCircle, Bot, Loader2 } from 'lucide-react';
import { formatNumber } from '@/lib/analyticsFormat';
import {
  figures,
  formatShare,
  groupTitle,
  runsLabel,
  scopeGroups,
  sortGroups,
  readGroups,
  type SubagentResponse,
} from '@/lib/subagentUsage';
import { AnalyticsPanel } from './AnalyticsPanel';
import { formatCurrency, getProviderColor } from './analyticsModel';

const VISIBLE = 6;

/**
 * What subagents spent in the period: agents a session started itself, whole
 * CLI runs from the subagent bridge, and calls the router sent elsewhere.
 */
export function SubagentUsageCard({
  data,
  providerFilter,
  loading,
  error,
}: {
  data: SubagentResponse | undefined;
  /** Provider label the page is filtered to, if any. */
  providerFilter: string | null;
  loading: boolean;
  error: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo(
    () => sortGroups(scopeGroups(readGroups(data), providerFilter)),
    [data, providerFilter]
  );
  const summary = useMemo(
    () => figures(data, groups, providerFilter !== null),
    [data, groups, providerFilter]
  );

  const shown = expanded ? groups : groups.slice(0, VISIBLE);
  const peak = groups[0]?.totalTokens ?? 0;

  return (
    <AnalyticsPanel
      icon={Bot}
      title="Subagents"
      subtitle={
        providerFilter ? `Spent by ${providerFilter} subagents` : 'What agents and CLI runs spent'
      }
      className="analytics-subagent-panel"
    >
      {loading ? (
        <div className="analytics-empty">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading subagents…
        </div>
      ) : error ? (
        <div className="analytics-empty text-destructive">
          <AlertCircle className="h-5 w-5" />
          Failed to load subagents
        </div>
      ) : groups.length === 0 ? (
        <div className="analytics-empty">No subagents in this period</div>
      ) : (
        <>
          <div className="analytics-subagent-figures">
            {summary.sharePercent !== null && (
              <span className="analytics-subagent-share">
                <strong>{formatShare(summary.sharePercent)}%</strong> of usage
              </span>
            )}
            <span>{formatNumber(summary.tokens)} tokens</span>
            <span>{formatCurrency(summary.costUsd)}</span>
          </div>
          <ol className="analytics-subagent-list">
            {shown.map((group) => (
              <li
                key={`${group.kind}:${group.provider}:${group.agentType}:${group.model}`}
                title={`${groupTitle(group)} · ${group.model || 'unknown model'} · ${group.sessions} sessions`}
              >
                <span className="analytics-subagent-name">
                  <span className="analytics-subagent-title">{groupTitle(group)}</span>
                  <span className="analytics-subagent-meta">
                    {group.model || 'unknown model'} · {runsLabel(group)}
                  </span>
                </span>
                <span className="analytics-rank-bar">
                  <span
                    style={{
                      width: `${peak > 0 ? Math.max(3, (group.totalTokens / peak) * 100) : 0}%`,
                      backgroundColor: getProviderColor(group.providerLabel),
                    }}
                  />
                </span>
                <span className="analytics-rank-value">{formatNumber(group.totalTokens)}</span>
                <span className="analytics-rank-share">{formatCurrency(group.costUsd)}</span>
              </li>
            ))}
          </ol>
          {groups.length > VISIBLE && (
            <button
              type="button"
              className="analytics-link mt-3"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Show fewer' : `All ${groups.length} groups →`}
            </button>
          )}
        </>
      )}
    </AnalyticsPanel>
  );
}
