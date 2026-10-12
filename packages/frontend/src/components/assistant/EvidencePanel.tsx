import { Link } from 'react-router-dom';
import type { AssistantResource } from '@plum-code-webui/shared';
interface Evidence {
  claim: string;
  sourceId: string;
  sourceRevision: number;
  quote: string;
  note?: string;
  reviewed?: boolean;
}
export function EvidencePanel({
  artifact,
  onReview,
}: {
  artifact: AssistantResource;
  onReview?: (index: number, reviewed: boolean) => void;
}) {
  const entries = (artifact.body.evidence ?? []) as Evidence[];
  if (!entries.length) return null;
  return (
    <section className="space-y-3" aria-label="Recherchebelege">
      <h3 className="font-semibold">Belegregister ({entries.length})</h3>
      <p className="text-xs text-muted-foreground">
        Auszüge sind an die gespeicherte Quellrevision gebunden. Ob der Auszug die Aussage trägt,
        prüfst du selbst.
      </p>
      {entries.map((entry, index) => (
        <article key={index} className="space-y-2 rounded-md border p-3 text-sm">
          <h4 className="font-medium">{entry.claim}</h4>
          <blockquote className="border-l-2 pl-3">{entry.quote}</blockquote>
          {entry.note && <p>{entry.note}</p>}
          <Link
            className="underline"
            to={`/assistant/sources?resource=${encodeURIComponent(entry.sourceId)}&revision=${entry.sourceRevision}`}
          >
            Quelle · Revision {entry.sourceRevision}
          </Link>
          {onReview ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={entry.reviewed === true}
                onChange={(event) => onReview(index, event.target.checked)}
              />
              Von mir geprüft
            </label>
          ) : (
            <p className="text-muted-foreground">
              {entry.reviewed ? 'Vom Ersteller geprüft' : 'Noch nicht vom Ersteller geprüft'}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
