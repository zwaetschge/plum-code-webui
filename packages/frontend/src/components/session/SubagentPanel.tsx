import { Virtuoso } from 'react-virtuoso';
import { useEffect, useState } from 'react';
import {
  agentLifecycle,
  isActiveAgent,
  subagentCounts,
  type SubagentRun,
} from '@plum-code-webui/shared';

const labels = {
  queued: 'Geplant',
  running: 'Aktiv',
  completed: 'Fertig',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
  interrupted: 'Unterbrochen',
};
const elapsed = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
};

export function SubagentPanel({
  runs,
  hasMore = false,
  onLoadMore,
  loading = false,
  error,
  capturedAt,
  totals,
}: {
  runs: SubagentRun[];
  hasMore?: boolean;
  onLoadMore?: () => void;
  loading?: boolean;
  error?: boolean;
  capturedAt?: number;
  totals?: ReturnType<typeof subagentCounts>;
}) {
  const [now, setNow] = useState(Date.now);
  const [filter, setFilter] = useState<'all' | 'active' | 'history'>('all');
  const counts = subagentCounts(runs);
  useEffect(() => {
    if (!counts.active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counts.active]);
  const historyCounts = totals ?? counts;
  const visible = runs.filter(
    (run) => filter === 'all' || (filter === 'active' ? isActiveAgent(run) : !isActiveAgent(run))
  );
  const renderRun = (run: SubagentRun) => (
    <details
      key={run.id}
      className="rounded-lg border border-border bg-background p-3 open:ring-1 open:ring-primary/30"
    >
      <summary className="cursor-pointer list-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold break-words min-w-0">{run.agentType}</span>
          <span className="shrink-0 text-xs">
            {isActiveAgent(run) && run.activity === 'waiting'
              ? 'Wartet'
              : labels[agentLifecycle(run)]}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 break-words">
          {run.description || 'Aufgabe nicht übermittelt'}
        </p>
        <p className="mt-2 text-xs text-muted-foreground break-words">
          {run.provider || 'Provider nicht übermittelt'} · {run.model || 'Modell nicht übermittelt'}
          {run.background ? ' · Hintergrund' : ''}
        </p>
        <p className="mt-1 text-xs break-words">
          {run.activitySummary ||
            (isActiveAgent(run)
              ? 'Gestartet · keine Detailaktivität übermittelt'
              : labels[agentLifecycle(run)])}
        </p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          Dauer {elapsed((run.completedAt ?? now) - run.startedAt)} · Letztes Ereignis{' '}
          {elapsed(now - (run.updatedAt ?? run.completedAt ?? run.startedAt))} her
        </p>
      </summary>
      <div className="mt-3 space-y-3 border-t border-border pt-3 text-xs break-words">
        <p className="whitespace-pre-wrap">{run.description}</p>
        {run.waitingReason && <p>Wartet auf: {run.waitingReason}</p>}
        {run.parentRunId && <p>Übergeordneter Agent: {run.parentRunId}</p>}
        <ol className="space-y-1">
          {run.activities?.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <time className="text-muted-foreground">
                {new Date(entry.at).toLocaleTimeString()}
              </time>{' '}
              {entry.text}
            </li>
          ))}
        </ol>
        {(run.result || run.error) && (
          <div>
            <strong>{run.error ? 'Fehler' : 'Ergebnis'}</strong>
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans">
              {run.error || run.result}
            </pre>
          </div>
        )}
        <p className="text-muted-foreground">Lauf {run.id}</p>
      </div>
    </details>
  );
  return (
    <section aria-label="Subagenten" className="h-full overflow-auto p-3 text-sm space-y-3">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="font-semibold" aria-live="polite">
          {counts.active} aktiv{' '}
          <span className="font-normal text-muted-foreground">
            · {counts.waiting} wartend · {counts.queued} geplant
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {historyCounts.completed} fertig · {historyCounts.failed} fehlgeschlagen ·{' '}
          {historyCounts.interrupted} abgebrochen / unterbrochen
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Subagenten dieses Chats. Hauptagent und konfigurierte Ziele werden nicht mitgezählt.
          Verlauf: {totals ? 'gesamter Chat' : 'geladene Läufe'}.
        </p>
        {capturedAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            Stand: {new Date(capturedAt).toLocaleTimeString()}
          </p>
        )}
        {error && (
          <p role="status" className="mt-2 text-xs text-destructive">
            Verbindung unterbrochen oder Aktualisierung fehlgeschlagen. Letzter bekannter Stand.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Agenten filtern">
        {(['all', 'active', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-md border px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${filter === value ? 'border-primary bg-primary/10' : 'border-border'}`}
          >
            {value === 'all' ? 'Alle' : value === 'active' ? `Aktiv (${counts.active})` : 'Verlauf'}
          </button>
        ))}
      </div>
      {visible.length === 0 && (
        <p className="py-4 text-muted-foreground">
          {loading ? 'Agenten werden geladen…' : 'Keine Agenten in dieser Ansicht.'}
        </p>
      )}
      {visible.length > 60 ? (
        <Virtuoso
          style={{ height: '65vh', minHeight: 320 }}
          data={visible}
          computeItemKey={(_, run) => run.id}
          itemContent={(_, run) => <div className="pb-3">{renderRun(run)}</div>}
        />
      ) : (
        visible.map(renderRun)
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="w-full rounded-md border border-border p-2"
        >
          {loading ? 'Lädt…' : 'Älteren Verlauf laden'}
        </button>
      )}
    </section>
  );
}
