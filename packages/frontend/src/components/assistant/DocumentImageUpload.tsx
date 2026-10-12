import { useEffect, useRef, useState } from 'react';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';

export function DocumentImageUpload({
  artifact,
  disabled,
  onSaved,
  onPending,
}: {
  artifact: AssistantResource;
  disabled: boolean;
  onSaved: () => void;
  onPending: (pending: boolean) => void;
}) {
  const owner = useAuthStore((s) => s.user?.id);
  const [pending, setPending] = useState<{
    file: File;
    commandId: string;
    revision: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const active = useRef(true),
    callback = useRef(onPending);
  callback.current = onPending;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      callback.current(false);
    };
  }, []);
  async function send(item: NonNullable<typeof pending>) {
    const captured = owner;
    setPending(item);
    setBusy(true);
    setError('');
    callback.current(true);
    try {
      if (!item.file.size || item.file.size > 5 * 1024 * 1024)
        throw new Error('Ein Bild darf höchstens 5 MB gross sein');
      const form = new FormData();
      form.append('file', item.file);
      form.append('commandId', item.commandId);
      form.append('expectedRevision', String(item.revision));
      await api.post(`/api/assistant/artifacts/${artifact.id}/images`, form);
      if (active.current && useAuthStore.getState().user?.id === captured) {
        setPending(null);
        callback.current(false);
        onSaved();
      }
    } catch (failure) {
      if (active.current && useAuthStore.getState().user?.id === captured)
        setError(failure instanceof Error ? failure.message : 'Bildübernahme nicht bestätigt');
    } finally {
      if (active.current && useAuthStore.getState().user?.id === captured) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Dokumentbild hinzufügen"
      className="space-y-2 rounded-md border bg-card p-3"
    >
      <label className="grid gap-1 text-sm">
        Eigenes Bild am Dokumentende einfügen
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={disabled || busy || !!pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file)
              void send({ file, commandId: crypto.randomUUID(), revision: artifact.revision });
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Zuerst Textänderungen speichern. Bis zu vier Originalbilder, je höchstens 5 MB. Nach dem
        Einfügen lassen sich Position und Bildunterschrift bearbeiten.
      </p>
      {pending && !busy && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void send(pending)}>
            Bildübernahme erneut bestätigen
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPending(null);
              setError('');
              callback.current(false);
              onSaved();
            }}
          >
            Gespeicherten Stand neu laden
          </Button>
        </div>
      )}
      {busy && <p role="status">Bildoriginal wird gespeichert …</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
