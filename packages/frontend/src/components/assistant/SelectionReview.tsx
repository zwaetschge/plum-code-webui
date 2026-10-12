import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function SelectionReview({
  edit,
  suggestion,
  busy,
  onApply,
}: {
  edit: { artifactId: string; revision: number; selectedText: string };
  suggestion: string;
  busy: boolean;
  onApply: (replacement: string) => void;
}) {
  const [replacement, setReplacement] = useState(suggestion);
  return (
    <section className="mt-4 space-y-3 rounded-md border p-4" aria-label="Textänderung prüfen">
      <h3 className="font-semibold">Änderungsvorschlag prüfen</h3>
      <p className="text-sm">
        Auswahl aus Revision {edit.revision} ·{' '}
        <Link className="underline" to={`/assistant/artifacts?resource=${edit.artifactId}`}>
          Ergebnis öffnen
        </Link>
      </p>
      <details>
        <summary className="cursor-pointer text-sm">Bisherige Textstelle</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{edit.selectedText}</pre>
      </details>
      <label className="grid gap-2 text-sm">
        Neue Textstelle
        <textarea
          className="min-h-32 rounded-md border bg-background p-3"
          value={replacement}
          maxLength={50000}
          onChange={(event) => setReplacement(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Du kannst den Vorschlag hier korrigieren. Übernehmen ersetzt ausschliesslich die markierte
        Stelle und speichert eine neue Revision. Bei zwischenzeitlichen Änderungen bleibt das
        Ergebnis erhalten und du erstellst eine neue Auswahl.
      </p>
      <Button disabled={busy} onClick={() => onApply(replacement)}>
        Geprüfte Auswahl übernehmen
      </Button>
    </section>
  );
}
