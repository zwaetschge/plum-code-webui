import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AssistantResource, AssistantApiImage } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { ChatImageStrip } from './ChatImages';
import { ImageEditTask } from './ImageEditTask';
export function TaskImages({
  task,
  onChanged,
  onBusy,
}: {
  task: AssistantResource;
  onChanged: (task: AssistantResource) => void;
  onBusy: (busy: boolean) => void;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    [pending, setPending] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(true),
    busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      busyCallback.current(false);
    };
  }, []);
  const ids = (task.body.inputImageIds ?? []) as string[];
  const tryOn = task.body.imageTryOn as
    | { personAssetId: string; productAssetId: string }
    | undefined;
  const [editImage, setEditImage] = useState<AssistantApiImage | null>(null);
  const images = useQuery({
    queryKey: ['assistant', 'task-images', owner, task.id, task.revision],
    queryFn: async () =>
      (
        await api.get<{ data: AssistantApiImage[] }>(
          `/api/assistant/tasks/${task.id}/images?revision=${task.revision}`
        )
      ).data.data,
  });
  const mutable = task.body.status === 'draft';
  async function upload(file: File) {
    const captured = owner;
    let confirmed = false;
    setBusy(true);
    busyCallback.current(true);
    setError('');
    setPending(file);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Ein Bild darf höchstens 5 MB gross sein');
      const form = new FormData();
      form.append('file', file);
      form.append('expectedRevision', String(task.revision));
      const result = (
        await api.post<{ data: { task: AssistantResource; image: AssistantApiImage } }>(
          `/api/assistant/tasks/${task.id}/images`,
          form
        )
      ).data.data;
      if (active.current && useAuthStore.getState().user?.id === captured) {
        onChanged(result.task);
        setPending(null);
        confirmed = true;
      }
    } catch (e) {
      if (active.current && useAuthStore.getState().user?.id === captured)
        setError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      if (active.current && useAuthStore.getState().user?.id === captured) {
        setBusy(false);
        busyCallback.current(!confirmed);
      }
    }
  }
  return (
    <section aria-label="Auftragsbilder" className="space-y-3 rounded-md border p-3">
      <h3 className="text-sm font-medium">Bilder für diesen Auftrag</h3>
      <ChatImageStrip chatId={task.id} ids={ids} source="task" revision={task.revision} />
      <div className="space-y-2">
        {images.data?.map((image) => (
          <div key={image.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words">
              {image.filename}
              {tryOn?.personAssetId === image.id
                ? ' · Personenreferenz'
                : tryOn?.productAssetId === image.id
                  ? ' · Produktreferenz'
                  : ''}
            </span>
            {image.id !==
              (task.body.imageEdit as { maskAssetId?: string } | undefined)?.maskAssetId && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setEditImage(image)}
              >
                Bild bearbeiten
              </Button>
            )}
            {mutable && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || Boolean(task.body.imageEdit) || Boolean(task.body.imageTryOn)}
                aria-label={`${image.filename} aus Auftrag entfernen`}
                onClick={async () => {
                  const captured = owner;
                  setBusy(true);
                  busyCallback.current(true);
                  setError('');
                  try {
                    const next = (
                      await api.delete<{ data: AssistantResource }>(
                        `/api/assistant/tasks/${task.id}/images/${image.id}?expectedRevision=${task.revision}`
                      )
                    ).data.data;
                    if (active.current && useAuthStore.getState().user?.id === captured)
                      onChanged(next);
                  } catch (e) {
                    if (active.current && useAuthStore.getState().user?.id === captured)
                      setError(e instanceof Error ? e.message : 'Entfernen fehlgeschlagen');
                  } finally {
                    if (active.current && useAuthStore.getState().user?.id === captured) {
                      setBusy(false);
                      busyCallback.current(false);
                    }
                  }
                }}
              >
                Entfernen
              </Button>
            )}
          </div>
        ))}
      </div>
      {editImage && (
        <ImageEditTask
          key={`${task.id}:${task.revision}:${editImage.id}`}
          task={task}
          image={editImage}
          onClose={() => setEditImage(null)}
          onCreated={(next) => {
            setEditImage(null);
            onChanged(next);
          }}
        />
      )}
      {mutable && (
        <label className="inline-flex cursor-pointer rounded-md border px-3 py-2 text-sm">
          Auftragsbild auswählen
          <input
            aria-label="Auftragsbild auswählen"
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={busy || ids.length >= 4}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
      )}
      {pending && !busy && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="break-words">{pending.name}: Zustellung unbestätigt</span>
          <Button size="sm" variant="outline" onClick={() => void upload(pending)}>
            Bild erneut zustellen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPending(null);
              setError('');
              busyCallback.current(false);
            }}
          >
            Lokale Auswahl verwerfen
          </Button>
        </div>
      )}
      {(error || images.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || images.error?.message}
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs">
          Bild wird übertragen …
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Bis zu vier Originalbilder à 5 MB. Nach der ersten Übermittlung bleiben die Eingaben
        gebunden. CLI-Agenten lesen die ausgewählten Bilder über das Auftragswerkzeug; native
        Agenten erhalten sie im Auftragsthread.
      </p>
    </section>
  );
}
