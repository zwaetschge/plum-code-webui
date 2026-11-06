import { useRef, useState } from 'react';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';

export function OfficeSource({
  source,
  onCreated,
}: {
  source: AssistantResource;
  onCreated: (artifact: AssistantResource) => void;
}) {
  const [sheet, setSheet] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const command = useRef<{ key: string; id: string } | null>(null);
  const office = source.body.office as
    | { kind?: string; sheets?: Array<{ name: string }>; warnings?: string[] }
    | undefined;
  if (!office) return null;
  return (
    <section className="space-y-3 rounded-md border p-3" aria-label="Office-Original übernehmen">
      <h3 className="font-medium">Office-Original als bearbeitbare Kopie</h3>
      <p className="text-sm text-muted-foreground">
        Die Kopie verwendet das Original dieser Quellrevision. Dein Original wird dabei erhalten.
        Korrekturen an der Quelltextansicht verändern die Office-Datei nicht.
      </p>
      {office.kind === 'xlsx' && (
        <label className="grid min-w-0 gap-1 text-sm">
          Tabellenblatt
          <select
            className="min-w-0 w-full max-w-full rounded-md border bg-background p-2"
            value={sheet}
            onChange={(event) => setSheet(Number(event.target.value))}
          >
            {office.sheets?.map((item, index) => (
              <option key={index} value={index}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          const key = JSON.stringify([source.id, source.revision, sheet]);
          if (command.current?.key !== key) command.current = { key, id: crypto.randomUUID() };
          setBusy(true);
          setError('');
          try {
            const artifact = (
              await api.post<{ data: AssistantResource }>(
                `/api/assistant/sources/${source.id}/office-artifact`,
                { commandId: command.current.id, expectedRevision: source.revision, sheet }
              )
            ).data.data;
            onCreated(artifact);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : 'Office-Kopie konnte nicht erstellt werden'
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? 'Kopie wird erstellt …'
          : office.kind === 'xlsx'
            ? 'Als Plum-Tabelle bearbeiten'
            : office.kind === 'pptx'
              ? 'Als Plum-Folien bearbeiten'
              : 'Als Plum-Dokument bearbeiten'}
      </Button>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {office.warnings?.map((warning, index) => (
          <li key={index}>{warning}</li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
