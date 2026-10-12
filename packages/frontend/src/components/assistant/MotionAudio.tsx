import { useEffect, useRef, useState } from 'react';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
type Command = { commandId: string; expectedRevision: number; file: File | null };
export function MotionAudio({
  artifact,
  shareToken,
  readOnly,
  disabled,
  onSaved,
  onPending,
}: {
  artifact: AssistantResource;
  shareToken?: string;
  readOnly: boolean;
  disabled: boolean;
  onSaved: () => void;
  onPending: (value: boolean) => void;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true),
    callback = useRef(onPending),
    player = useRef<HTMLAudioElement>(null);
  callback.current = onPending;
  const [pending, setPending] = useState<Command | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [url, setUrl] = useState('');
  const metadata = artifact.body.audio as { filename: string; duration: number } | undefined;
  const endpoint = metadata
    ? shareToken
      ? `/api/assistant/shared/${encodeURIComponent(shareToken)}/audio`
      : `/api/assistant/artifacts/${artifact.id}/audio?revision=${artifact.revision}`
    : '';
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      callback.current(false);
    };
  }, []);
  useEffect(() => {
    setUrl('');
    if (!endpoint) return;
    const controller = new AbortController();
    let blobUrl = '';
    const audio = player.current;
    void api
      .download(endpoint, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => {
        if (controller.signal.aborted || useAuthStore.getState().user?.id !== owner) return;
        blobUrl = URL.createObjectURL(blob);
        setUrl(blobUrl);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : 'Audio konnte nicht geladen werden'
          );
      });
    return () => {
      controller.abort();
      audio?.pause();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [endpoint, owner]);
  async function deliver(command: Command) {
    setPending(command);
    setBusy(true);
    setError('');
    callback.current(true);
    try {
      if (command.file) {
        if (!command.file.size || command.file.size > 5 * 1024 * 1024)
          throw new Error('Die WAV-Datei darf höchstens 5 MB gross sein');
        const form = new FormData();
        form.append('file', command.file);
        form.append('commandId', command.commandId);
        form.append('expectedRevision', String(command.expectedRevision));
        await api.post(`/api/assistant/artifacts/${artifact.id}/audio`, form);
      } else
        await api.post(`/api/assistant/artifacts/${artifact.id}/audio/remove`, {
          commandId: command.commandId,
          expectedRevision: command.expectedRevision,
        });
      if (active.current && useAuthStore.getState().user?.id === owner) {
        setPending(null);
        callback.current(false);
        onSaved();
      }
    } catch (failure) {
      if (!active.current || useAuthStore.getState().user?.id !== owner) return;
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) {
        setPending(null);
        callback.current(false);
      }
      setError(failure instanceof Error ? failure.message : 'Audioübernahme wurde nicht bestätigt');
    } finally {
      if (active.current && useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  return (
    <section
      className="space-y-3 rounded-md border bg-card p-3"
      aria-label="Audiospur der Animation"
    >
      <h3 className="text-sm font-medium">Audiospur</h3>
      {metadata && (
        <>
          <p className="break-all text-sm text-muted-foreground">
            {metadata.filename} ·{' '}
            {metadata.duration.toLocaleString('de-CH', { maximumFractionDigits: 2 })} s
          </p>
          <audio
            ref={player}
            aria-label="Originale Audiospur"
            controls
            preload="none"
            src={url || undefined}
            className="w-full"
          />
          {url && (
            <a href={url} download={metadata.filename} className="text-sm underline">
              Audiooriginal herunterladen
            </a>
          )}
        </>
      )}
      {!readOnly && (
        <>
          <p className="text-xs text-muted-foreground">
            Eine eigene WAV-Spur wählen, zum Beispiel aus Vocarium/OmniVoice. Maximal 5 MB, zehn
            Sekunden und höchstens so lang wie die Animation. MP4 enthält diese Spur; PNG/SVG
            bleiben Einzelbilder. Das Original bleibt auch in älteren Revisionen erhalten.
          </p>
          <label className="grid gap-1 text-sm">
            WAV an gespeicherte Animation binden
            <input
              type="file"
              accept=".wav,audio/wav"
              disabled={disabled || busy || !!pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file)
                  void deliver({
                    file,
                    commandId: crypto.randomUUID(),
                    expectedRevision: artifact.revision,
                  });
              }}
            />
          </label>
          {metadata && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || busy || !!pending}
              onClick={() =>
                void deliver({
                  file: null,
                  commandId: crypto.randomUUID(),
                  expectedRevision: artifact.revision,
                })
              }
            >
              Audiospur in neuer Revision entfernen
            </Button>
          )}
          {pending && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void deliver(pending)}>
                Dieselbe Audioübernahme bestätigen
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  callback.current(false);
                  onSaved();
                }}
              >
                Gespeicherten Stand prüfen
              </Button>
            </div>
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
