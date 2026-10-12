import { useRef, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { deliverAssistant } from '@/services/assistantOutbox';
import { Button } from '@/components/ui/button';
type Review = { index: number; label: string; artifactId: string; revision: number };
type Candidate = { id: string; title: string; revision: number; type: string };
export function taskResultsReviewed(task: AssistantResource, owner?: string) {
  const labels = (task.body.deliverables ?? []) as string[],
    reviews = (task.body.deliverableReviews ?? []) as Review[];
  return (
    !labels.length ||
    (task.body.deliverableReviewedBy === owner &&
      reviews.length === labels.length &&
      new Set(reviews.map((r) => r.index)).size === labels.length &&
      reviews.every(
        (r) =>
          Number.isInteger(r.index) &&
          r.index >= 0 &&
          r.index < labels.length &&
          r.label === labels[r.index]
      ))
  );
}
export function TaskResults({
  task,
  onChanged,
}: {
  task: AssistantResource;
  onChanged: (task: AssistantResource) => void;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const labels = (task.body.deliverables ?? []) as string[],
    reviews = (task.body.deliverableReviews ?? []) as Review[];
  const [choices, setChoices] = useState<Record<number, string>>(() =>
      Object.fromEntries(reviews.map((r) => [r.index, `${r.artifactId}:${r.revision}`]))
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const files = useQuery({
    queryKey: ['assistant', 'task-results', owner, task.id, task.revision],
    queryFn: async () =>
      (await api.get<{ data: Candidate[] }>(`/api/assistant/tasks/${task.id}/results`)).data.data,
  });
  const editable =
    task.body.status === 'waiting_input' && !String(task.body.agentId ?? '').startsWith('matrix:');
  return (
    <section aria-label="Auftragsergebnisse" className="min-w-0 space-y-3 rounded-md border p-3">
      <h3 className="font-medium">Gespeicherte Auftragsergebnisse</h3>
      {files.isError && <p role="alert">Ergebnisse konnten nicht geladen werden.</p>}
      {files.isLoading && <p role="status">Ergebnisse werden geladen …</p>}
      {!!files.data?.length && (
        <ul className="space-y-2 text-sm">
          {files.data.map((file) => (
            <li key={file.id}>
              <Link
                className="break-words text-primary underline"
                to={`/assistant/artifacts?resource=${file.id}&revision=${file.revision}`}
                target="_blank"
                rel="noreferrer"
              >
                {file.title} · {file.type} · Revision {file.revision}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {files.data && !files.data.length && (
        <p className="text-sm text-muted-foreground">
          Für diesen Task sind noch keine Artefakte gespeichert.
        </p>
      )}
      {labels.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            Öffne die Ergebnisse und ordne jeder Anforderung eine geprüfte Artefaktrevision zu.
            Danach kannst du den CLI-Auftrag abschliessen.
          </p>
          {labels.map((label, index) => (
            <label key={`${index}:${label}`} className="grid min-w-0 gap-1 text-sm">
              {label}
              <select
                aria-label={`Ergebnis ${index + 1}: ${label}`}
                disabled={!editable || busy || files.isLoading || files.isError}
                value={choices[index] ?? ''}
                className="w-full min-w-0 rounded-md border bg-background p-2"
                onChange={(event) => setChoices((old) => ({ ...old, [index]: event.target.value }))}
              >
                <option value="">Artefakt auswählen</option>
                {files.data?.map((file) => (
                  <option key={file.id} value={`${file.id}:${file.revision}`}>
                    {file.title} · Revision {file.revision}
                  </option>
                ))}
                {reviews
                  .filter(
                    (r) =>
                      r.index === index &&
                      !files.data?.some(
                        (file) => `${file.id}:${file.revision}` === `${r.artifactId}:${r.revision}`
                      )
                  )
                  .map((r) => (
                    <option key={r.artifactId} value={`${r.artifactId}:${r.revision}`}>
                      Geprüfter Stand · Revision {r.revision}
                    </option>
                  ))}
              </select>
              {reviews.find((r) => r.index === index) && (
                <Link
                  className="text-primary underline"
                  to={`/assistant/artifacts?resource=${reviews.find((r) => r.index === index)!.artifactId}&revision=${reviews.find((r) => r.index === index)!.revision}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Geprüfte Revision öffnen
                </Link>
              )}
            </label>
          ))}
          {editable && (
            <Button
              variant="outline"
              size="sm"
              disabled={
                busy || labels.some((_, i) => !choices[i]) || files.isError || files.isLoading
              }
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const items = labels.map((_, index) => {
                    const [artifactId, revision] = choices[index]!.split(':');
                    return { index, artifactId, revision: Number(revision) };
                  });
                  const result = (await deliverAssistant(
                    `/api/assistant/tasks/${task.id}/results`,
                    { expectedRevision: task.revision, items },
                    'Auftragsergebnisse geprüft speichern'
                  )) as { data: { data: AssistantResource } };
                  if (active.current && useAuthStore.getState().user?.id === owner)
                    onChanged(result.data.data);
                } catch (failure) {
                  if (active.current && useAuthStore.getState().user?.id === owner)
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Ergebnisprüfung konnte nicht gespeichert werden'
                    );
                } finally {
                  if (active.current && useAuthStore.getState().user?.id === owner) setBusy(false);
                }
              }}
            >
              Auswahl geprüft speichern
            </Button>
          )}
          {taskResultsReviewed(task, owner) && (
            <p role="status" className="text-sm">
              Alle gewünschten Artefakte sind an geprüfte Revisionen gebunden.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
