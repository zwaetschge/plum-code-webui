import type { ChatCompaction } from '@plum-code-webui/shared';
export function ChatCompactionReceipt({ compaction }: { compaction?: ChatCompaction }) {
  if (!compaction) return null;
  return (
    <details className="rounded-lg border border-border/60 text-sm">
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground">
        {compaction.status === 'running'
          ? 'Verlauf wird verdichtet …'
          : compaction.status === 'failed'
            ? 'Verdichtung nicht verfügbar'
            : `Verlauf · ${compaction.coveredTurns} ${compaction.coveredTurns === 1 ? 'Beitrag' : 'Beiträge'} verdichtet`}
      </summary>
      <div className="space-y-2 border-t border-border/60 p-3">
        {!!compaction.coveredTurns && (
          <p>
            {compaction.coveredTurns} von {compaction.olderTurns} früheren Beiträgen · bis Beitrag{' '}
            {compaction.throughSeq}
          </p>
        )}
        {!!compaction.remainingTurns && (
          <p>
            {compaction.remainingTurns === 1
              ? 'Ein weiterer Beitrag fehlt in dieser Verdichtung.'
              : `${compaction.remainingTurns} weitere Beiträge fehlen in dieser Verdichtung.`}
          </p>
        )}
        {!!compaction.truncatedTurnIds.length && (
          <p>
            {compaction.truncatedTurnIds.length === 1
              ? 'Ein Beitrag mit gekürztem Auszug'
              : `${compaction.truncatedTurnIds.length} Beiträge mit gekürzten Auszügen`}
          </p>
        )}
        {compaction.summary && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans">
            {compaction.summary}
          </pre>
        )}
        {compaction.error && <p role="status">{compaction.error}</p>}
      </div>
    </details>
  );
}
