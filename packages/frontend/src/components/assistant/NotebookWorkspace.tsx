import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  parseAssistantNotebook,
  parseAssistantDataset,
  type AssistantAnalysisOutput,
  type AssistantAnalysisStep,
  type AssistantNotebook,
  type AssistantResource,
} from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { deliverAssistant } from '@/services/assistantOutbox';
import { AssistantOutbox } from './AssistantOutbox';
import { Button } from '@/components/ui/button';

const kinds: Record<AssistantAnalysisStep['kind'], string> = {
  summary: 'Statistik',
  group: 'Pivot / Gruppen',
  histogram: 'Histogramm',
  correlation: 'Korrelation',
  filter: 'Zeilen filtern',
};
export function CreateNotebook({ dataset }: { dataset: AssistantResource }) {
  const navigate = useNavigate(),
    owner = useAuthStore((s) => s.user?.id);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="space-y-2 rounded-md border p-3">
      <h3 className="font-medium">Daten analysieren</h3>
      <p className="text-sm text-muted-foreground">
        CSV mit Kopfzeile oder JSON mit columns/rows. Original und Eingaberevision bleiben erhalten.
      </p>
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          const captured = owner;
          try {
            const result = (await deliverAssistant(
              `/api/assistant/artifacts/${dataset.id}/notebook`,
              { expectedRevision: dataset.revision },
              'Notebook erstellen'
            )) as { data: { data: AssistantResource } };
            if (useAuthStore.getState().user?.id === captured)
              navigate(`/assistant/artifacts?resource=${result.data.data.id}`);
          } catch (failure) {
            if (useAuthStore.getState().user?.id === captured)
              setError(
                failure instanceof Error ? failure.message : 'Notebook konnte nicht erstellt werden'
              );
          } finally {
            if (useAuthStore.getState().user?.id === captured) setBusy(false);
          }
        }}
      >
        Analyse im Notebook
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AssistantOutbox />
    </section>
  );
}

export function NotebookWorkspace({
  artifact,
  onSaved,
  readOnly = false,
}: {
  artifact: AssistantResource;
  onSaved: () => void;
  readOnly?: boolean;
}) {
  const owner = useAuthStore((s) => s.user?.id);
  const navigate = useNavigate();
  const [instructions, setInstructions] = useState('');
  const active = useRef({ mounted: true, owner, id: artifact.id });
  active.current.owner = owner;
  active.current.id = artifact.id;
  useEffect(() => {
    const state = active.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
    };
  }, []);
  const [content, setContent] = useState(String(artifact.body.content)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setContent(String(artifact.body.content));
    setError('');
  }, [artifact.id, artifact.revision, artifact.body.content]);
  useEffect(() => {
    setInstructions('');
  }, [artifact.id, owner]);
  let notebook: AssistantNotebook | null = null,
    malformed = '';
  try {
    notebook = parseAssistantNotebook(content);
  } catch (failure) {
    malformed = failure instanceof Error ? failure.message : 'Ungültiges Notebook';
  }
  const dataset = useQuery({
    queryKey: [
      'assistant',
      'notebook-input',
      owner,
      notebook?.datasetId,
      notebook?.datasetRevision,
    ],
    enabled: !!notebook && !readOnly,
    queryFn: async () => {
      const source = (
        await api.get<{ data: AssistantResource }>(
          `/api/assistant/artifacts/${notebook!.datasetId}?revision=${notebook!.datasetRevision}`
        )
      ).data.data;
      return {
        resource: source,
        data: parseAssistantDataset(String(source.body.content), String(source.body.format)),
      };
    },
  });
  if (!notebook)
    return (
      <p role="alert" className="text-destructive">
        {malformed}
      </p>
    );
  const n = notebook,
    dirty = content !== String(artifact.body.content),
    columns = dataset.data?.data.columns ?? [
      ...new Set(n.steps.flatMap((s) => [s.column, ...(s.other ? [s.other] : [])])),
    ];
  const update = (next: AssistantNotebook) => {
    const { run: _discard, ...draft } = next;
    void _discard;
    setContent(JSON.stringify(draft));
  };
  const step = (index: number, patch: Partial<AssistantAnalysisStep>) =>
    update({ ...n, steps: n.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const save = async () => {
    const captured = owner;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/assistant/artifacts/${artifact.id}`, {
        title: artifact.title,
        expectedRevision: artifact.revision,
        body: { ...artifact.body, content, format: 'json' },
      });
      if (useAuthStore.getState().user?.id === captured) onSaved();
    } catch (failure) {
      if (useAuthStore.getState().user?.id === captured)
        setError(failure instanceof Error ? failure.message : 'Speichern fehlgeschlagen');
    } finally {
      if (useAuthStore.getState().user?.id === captured) setBusy(false);
    }
  };
  return (
    <section aria-label="Datenworkspace" className="space-y-4 min-w-0">
      <div>
        <h3 className="font-semibold">Versioniertes Analyse-Notebook</h3>
        <p className="text-sm text-muted-foreground">
          {dataset.data?.resource.title ?? 'Datensatz'} · Eingaberevision {n.datasetRevision}.
          Filter verändern die Eingabe der folgenden Schritte; Auswertungen erhalten sie.
        </p>
      </div>
      {dataset.error && (
        <p role="alert" className="text-sm text-destructive">
          Eingabe nicht verfügbar: {dataset.error.message}. Gespeicherte Ergebnisse bleiben lesbar.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !dirty} onClick={() => void save()}>
            Berechnung speichern
          </Button>
          <Button
            variant="outline"
            disabled={busy || dirty || !dataset.data || !n.steps.length}
            onClick={async () => {
              const captured = owner;
              setBusy(true);
              setError('');
              try {
                await deliverAssistant(
                  `/api/assistant/artifacts/${artifact.id}/run`,
                  { expectedRevision: artifact.revision },
                  'Notebook ausführen'
                );
                if (useAuthStore.getState().user?.id === captured) onSaved();
              } catch (failure) {
                if (useAuthStore.getState().user?.id === captured)
                  setError(
                    failure instanceof Error ? failure.message : 'Berechnung fehlgeschlagen'
                  );
              } finally {
                if (useAuthStore.getState().user?.id === captured) setBusy(false);
              }
            }}
          >
            {busy ? 'Wird ausgeführt …' : 'Gespeicherte Schritte ausführen'}
          </Button>
          <AssistantOutbox />
        </div>
      )}
      {!readOnly && (
        <section className="space-y-2 rounded-md border p-3" aria-label="Freie Python-Analyse">
          <h4 className="font-medium">Freie Python-Analyse</h4>
          <p className="text-sm text-muted-foreground">
            Erstellt einen Task-Entwurf mit dieser gespeicherten Notebook- und Datensatzrevision. Du
            startest den Auftrag anschliessend mit dem gewählten Agenten. Skript, tatsächliche
            Ergebnisse und Bericht gehören zum Task.
          </p>
          <label className="grid gap-1 text-sm">
            Analyseauftrag
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={10000}
              rows={3}
              disabled={busy}
              className="w-full min-w-0 rounded-md border bg-background p-2"
              placeholder="Welche Auswertung, Berechnung oder Visualisierung brauchst du?"
            />
          </label>
          <Button
            variant="outline"
            disabled={busy || dirty || !dataset.data || !instructions.trim()}
            onClick={async () => {
              const captured = { owner, id: artifact.id };
              const accepted = () =>
                active.current.mounted &&
                active.current.owner === captured.owner &&
                active.current.id === captured.id &&
                useAuthStore.getState().user?.id === captured.owner;
              setBusy(true);
              setError('');
              try {
                const result = (await deliverAssistant(
                  `/api/assistant/artifacts/${artifact.id}/analysis-task`,
                  { expectedRevision: artifact.revision, instructions: instructions.trim() },
                  'Python-Analyseauftrag erstellen'
                )) as { data: { data: AssistantResource } };
                if (accepted()) {
                  onSaved();
                  navigate(`/assistant/tasks?resource=${result.data.data.id}`);
                }
              } catch (failure) {
                if (accepted())
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Analyseauftrag konnte nicht erstellt werden'
                  );
              } finally {
                if (accepted()) setBusy(false);
              }
            }}
          >
            Python-Task erstellen
          </Button>
        </section>
      )}
      {!readOnly &&
        Array.isArray(artifact.body.analysisTaskIds) &&
        artifact.body.analysisTaskIds.length > 0 && (
          <nav aria-label="Analyseaufträge" className="flex flex-wrap gap-2 text-sm">
            {(artifact.body.analysisTaskIds as string[]).map((id, index) => (
              <Link
                className="rounded border px-2 py-1 underline focus-visible:outline"
                key={id}
                to={`/assistant/tasks?resource=${id}`}
              >
                Python-Task {index + 1}
              </Link>
            ))}
          </nav>
        )}
      {n.steps.map((s, i) => (
        <fieldset
          key={s.id}
          disabled={busy || readOnly}
          className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
        >
          <legend className="px-1 text-sm font-medium">
            Schritt {i + 1}: {kinds[s.kind]}
          </legend>
          <label className="grid min-w-0 gap-1 text-sm">
            Berechnung
            <select
              className="min-w-0 w-full rounded-md border bg-background p-2"
              value={s.kind}
              onChange={(e) =>
                step(i, {
                  kind: e.target.value as AssistantAnalysisStep['kind'],
                  other: columns.find((c) => c !== s.column) ?? s.column,
                })
              }
            >
              {Object.entries(kinds).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            Spalte
            <select
              className="min-w-0 w-full rounded-md border bg-background p-2"
              value={s.column}
              onChange={(e) => step(i, { column: e.target.value })}
            >
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {s.kind === 'group' && (
            <label className="grid min-w-0 gap-1 text-sm">
              Aggregation
              <select
                className="min-w-0 w-full rounded-md border bg-background p-2"
                value={s.aggregate ?? 'count'}
                onChange={(e) =>
                  step(i, {
                    aggregate: e.target.value as AssistantAnalysisStep['aggregate'],
                    other: s.other ?? columns.find((c) => c !== s.column) ?? s.column,
                  })
                }
              >
                <option value="count">Zeilen zählen</option>
                <option value="sum">Summe</option>
                <option value="mean">Mittelwert</option>
              </select>
            </label>
          )}
          {(s.kind === 'correlation' ||
            (s.kind === 'group' && s.aggregate && s.aggregate !== 'count')) && (
            <label className="grid min-w-0 gap-1 text-sm">
              Wertespalte
              <select
                className="min-w-0 w-full rounded-md border bg-background p-2"
                value={s.other ?? ''}
                onChange={(e) => step(i, { other: e.target.value })}
              >
                <option value="">Bitte wählen</option>
                {columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          {s.kind === 'histogram' && (
            <label className="grid min-w-0 gap-1 text-sm">
              Intervalle
              <input
                type="number"
                min={1}
                max={30}
                className="min-w-0 w-full rounded-md border bg-background p-2"
                value={s.bins ?? 10}
                onChange={(e) => step(i, { bins: Number(e.target.value) })}
              />
            </label>
          )}
          {s.kind === 'filter' && (
            <>
              <label className="grid min-w-0 gap-1 text-sm">
                Vergleich
                <select
                  className="min-w-0 w-full rounded-md border bg-background p-2"
                  value={s.operator ?? 'eq'}
                  onChange={(e) =>
                    step(i, { operator: e.target.value as AssistantAnalysisStep['operator'] })
                  }
                >
                  <option value="eq">Gleich</option>
                  <option value="contains">Enthält</option>
                  <option value="gt">Grösser als</option>
                  <option value="lt">Kleiner als</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                Filterwert
                <input
                  className="min-w-0 w-full rounded-md border bg-background p-2"
                  value={s.value ?? ''}
                  onChange={(e) => step(i, { value: e.target.value })}
                />
              </label>
            </>
          )}
          {!readOnly && (
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!i}
                onClick={() => {
                  const steps = [...n.steps];
                  [steps[i - 1], steps[i]] = [steps[i]!, steps[i - 1]!];
                  update({ ...n, steps });
                }}
              >
                Nach oben
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update({ ...n, steps: n.steps.filter((_, at) => at !== i) })}
              >
                Schritt entfernen
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      {!readOnly && (
        <Button
          variant="outline"
          disabled={busy || n.steps.length >= 20 || !columns.length}
          onClick={() =>
            update({
              ...n,
              steps: [
                ...n.steps,
                { id: crypto.randomUUID(), kind: 'summary', column: columns[0]! },
              ],
            })
          }
        >
          Berechnungsschritt hinzufügen
        </Button>
      )}
      <label className="grid min-w-0 gap-1 text-sm">
        Interpretation / Bericht
        <textarea
          readOnly={readOnly}
          disabled={busy}
          className="min-h-32 rounded-md border bg-background p-3"
          maxLength={10000}
          value={n.report}
          onChange={(e) => setContent(JSON.stringify({ ...n, report: e.target.value }))}
        />
      </label>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{n.report}</ReactMarkdown>
      </div>
      {n.run ? (
        <>
          <p className="break-all text-xs text-muted-foreground">
            Bestätigter Lauf {n.run.id} · {new Date(n.run.at).toLocaleString()} · {n.run.inputRows}{' '}
            Eingabezeilen
            <br />
            SHA-256: {n.run.datasetHash}
          </p>
          {n.run.outputs.map((output) => (
            <AnalysisOutput key={output.stepId} output={output} />
          ))}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Noch kein bestätigter Lauf für diese Schritte.
        </p>
      )}
    </section>
  );
}
function AnalysisOutput({ output }: { output: AssistantAnalysisOutput }) {
  const values = output.series ?? [],
    min = Math.min(0, ...values.map((v) => v.value)),
    max = Math.max(0, ...values.map((v) => v.value)),
    range = max - min || 1,
    zero = 220 + (320 * (0 - min)) / range;
  return (
    <section className="space-y-2 rounded-md border p-3">
      <h4 className="break-words font-medium">{output.title}</h4>
      {!!values.length && (
        <div className="max-h-96 overflow-auto">
          <svg
            role="img"
            aria-label={`Balkendiagramm ${output.title}`}
            viewBox={`0 0 600 ${values.length * 32 + 40}`}
            className="w-full min-w-72"
          >
            <title>{output.title}</title>
            <line x1={zero} x2={zero} y1={10} y2={values.length * 32 + 10} stroke="currentColor" />
            {values.map((v, i) => {
              const x = 220 + (320 * (v.value - min)) / range;
              return (
                <g key={i}>
                  <title>
                    {v.label}: {v.value}
                  </title>
                  <text x={5} y={i * 32 + 28} fill="currentColor" fontSize={12}>
                    {v.label.length > 28 ? v.label.slice(0, 25) + '…' : v.label}
                  </text>
                  <rect
                    x={Math.min(zero, x)}
                    y={i * 32 + 12}
                    width={Math.max(1, Math.abs(x - zero))}
                    height={20}
                    fill="currentColor"
                    className="text-primary"
                  />
                  <text
                    x={Math.min(550, Math.max(x, zero) + 5)}
                    y={i * 32 + 27}
                    fill="currentColor"
                    fontSize={12}
                  >
                    {Number(v.value.toPrecision(5))}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{output.title}</caption>
          <thead>
            <tr>
              {output.columns.map((c, i) => (
                <th key={i} scope="col" className="border-b p-2">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {output.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className="border-b p-2">
                    {v === null ? '–' : typeof v === 'number' ? Number(v.toPrecision(8)) : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
