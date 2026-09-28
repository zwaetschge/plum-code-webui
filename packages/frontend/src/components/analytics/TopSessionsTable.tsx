import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, ScrollText } from 'lucide-react';
import { formatNumber } from '@/lib/analyticsFormat';
import type { UiProvider } from '@/lib/providers';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { AnalyticsPanel } from './AnalyticsPanel';
import {
  formatCurrency,
  formatRelativeTime,
  getProviderColor,
  type SessionUsage,
} from './analyticsModel';

type SortKey = 'cost' | 'total_tokens' | 'requests' | 'provider' | 'last_active';

const COLLAPSED_ROWS = 5;

const LOGO_BY_PROVIDER: Record<string, UiProvider> = {
  Claude: 'claude',
  Codex: 'codex',
  'Z.AI': 'zai',
  Kimi: 'kimi',
  Pi: 'pi',
  OpenCode: 'opencode',
  Vibe: 'vibe',
};

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'cost', label: 'Spend', numeric: true },
  { key: 'total_tokens', label: 'Tokens', numeric: true },
  { key: 'requests', label: 'Requests', numeric: true },
  { key: 'provider', label: 'Provider' },
  { key: 'last_active', label: 'Last active' },
];

/** Sessions ranked by spend; every column sorts, every row opens its session. */
export function TopSessionsTable({ sessions }: { sessions: SessionUsage[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'cost', desc: true });
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const value = (session: SessionUsage): number | string => {
      if (sort.key === 'provider') return session.provider ?? '';
      if (sort.key === 'last_active')
        return session.last_active ? Date.parse(session.last_active) : 0;
      return session[sort.key];
    };
    return [...sessions].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const order =
        typeof left === 'string' || typeof right === 'string'
          ? String(left).localeCompare(String(right))
          : left - right;
      return sort.desc ? -order : order;
    });
  }, [sessions, sort]);

  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: key !== 'provider' }
    );

  return (
    <AnalyticsPanel
      icon={ScrollText}
      color="#a78bfa"
      title="Top Sessions"
      subtitle="Sessions with the highest API activity"
      className="analytics-sessions-table-panel"
      actions={
        sessions.length > COLLAPSED_ROWS && (
          <button
            type="button"
            className="analytics-link"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show top 5' : `View all ${sessions.length} sessions →`}
          </button>
        )
      }
    >
      {sessions.length === 0 ? (
        <div className="analytics-empty h-[120px]">No session activity in this period</div>
      ) : (
        <div className="analytics-table-wrap">
          <table className="analytics-table">
            <thead>
              <tr>
                <th scope="col" className="w-10">
                  #
                </th>
                <th scope="col">Session</th>
                {COLUMNS.map((column) => {
                  const active = sort.key === column.key;
                  const Icon = active ? (sort.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={column.numeric ? 'is-numeric' : undefined}
                      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                    >
                      <button type="button" onClick={() => toggleSort(column.key)}>
                        {column.label}
                        <Icon className={active ? 'h-3 w-3' : 'h-3 w-3 opacity-40'} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((session, index) => {
                const provider = session.provider ?? null;
                const logo = provider ? LOGO_BY_PROVIDER[provider] : undefined;
                return (
                  <tr key={session.session_id}>
                    <td className="text-muted-foreground tabular-nums">{index + 1}</td>
                    <td className="max-w-0">
                      <Link
                        to={`/session/${session.session_id}`}
                        className="analytics-session-link"
                      >
                        <ProviderLogo provider={logo ?? 'plum'} className="h-5 w-5 shrink-0" />
                        <span className="truncate">
                          {session.session_name || 'Unnamed session'}
                        </span>
                      </Link>
                    </td>
                    <td className="is-numeric font-medium">{formatCurrency(session.cost)}</td>
                    <td className="is-numeric">{formatNumber(session.total_tokens)}</td>
                    <td className="is-numeric">{session.requests.toLocaleString('en-US')}</td>
                    <td>
                      {provider ? (
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: getProviderColor(provider) }}
                          />
                          {provider}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-muted-foreground">
                      {formatRelativeTime(session.last_active)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsPanel>
  );
}
