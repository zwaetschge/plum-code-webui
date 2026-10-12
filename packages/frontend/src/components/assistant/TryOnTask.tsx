import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssistantResource } from '@plum-code-webui/shared';
import { parseAssistantComparison } from '@plum-code-webui/shared';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
type Packet = {
  commandId: string;
  sourceRevision: number;
  offerId: string;
  instructions: string;
  person: File;
  product: File;
};
function LocalImage({ file }: { file: File | null }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) {
      setUrl('');
      return;
    }
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return url ? (
    <img
      src={url}
      alt="Lokal ausgewähltes Anprobeoriginal"
      className="max-h-40 max-w-full rounded-md object-contain"
    />
  ) : null;
}
/** Explicit draft conversion, no hidden generation or purchase. */
export function TryOnTask({ artifact }: { artifact: AssistantResource }) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true);
  const [offerId, setOfferId] = useState(''),
    [person, setPerson] = useState<File | null>(null),
    [product, setProduct] = useState<File | null>(null),
    [instructions, setInstructions] = useState(''),
    [pending, setPending] = useState<Packet | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [task, setTask] = useState<AssistantResource | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const comparison = parseAssistantComparison(String(artifact.body.content));
  async function deliver(packet: Packet) {
    setPending(packet);
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      for (const key of ['commandId', 'sourceRevision', 'offerId', 'instructions'] as const)
        form.append(key, String(packet[key]));
      form.append('person', packet.person);
      form.append('product', packet.product);
      const result = (
        await api.post<{ data: AssistantResource }>(
          `/api/assistant/artifacts/${artifact.id}/try-on`,
          form
        )
      ).data.data;
      if (active.current && useAuthStore.getState().user?.id === owner) {
        setTask(result);
        setPending(null);
        setPerson(null);
        setProduct(null);
      }
    } catch (failure) {
      if (active.current && useAuthStore.getState().user?.id === owner) {
        if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
          setPending(null);
        setError(
          failure instanceof Error ? failure.message : 'Anprobeauftrag wurde nicht bestätigt.'
        );
      }
    } finally {
      if (active.current && useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  return (
    <details
      className="space-y-3 rounded-md border bg-card p-3"
      aria-label="Illustrative Bildanprobe"
    >
      <summary className="cursor-pointer text-sm font-medium">
        Bildanprobe als Task vorbereiten
      </summary>
      <p className="text-xs text-muted-foreground">
        Angebot, ein eigenes Personenbild und ein Produktbild auswählen. Die Vorschau bleibt lokal
        bis zur Übernahme. Ein Task-Entwurf bindet beide Originale und diesen Vergleichsstand; du
        wählst danach den Agenten und startest ihn. Das Bild zeigt eine Illustration, keine
        bestätigte Passform.
      </p>
      <label className="grid gap-1 text-sm">
        Angebot für die Bildanprobe
        <select
          aria-label="Angebot für die Bildanprobe"
          disabled={busy || !!pending}
          className="min-w-0 rounded-md border bg-background p-2"
          value={offerId}
          onChange={(e) => setOfferId(e.target.value)}
        >
          <option value="">Angebot wählen</option>
          {comparison.offers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.price}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['person', 'Personenbild', person, setPerson],
            ['product', 'Produktbild', product, setProduct],
          ] as const
        ).map(([key, label, file, setter]) => (
          <label key={key} className="grid min-w-0 gap-2 text-sm">
            {label}
            <input
              aria-label={label}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={busy || !!pending}
              className="min-w-0 max-w-full"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  if (!file.size || file.size > 5 * 1024 * 1024) {
                    setError('Ein Bild darf höchstens 5 MB gross sein.');
                    return;
                  }
                  setter(file);
                  setError('');
                }
              }}
            />
            <LocalImage file={file} />
            {file && <span className="break-all text-xs">{file.name}</span>}
          </label>
        ))}
      </div>
      <label className="grid gap-1 text-sm">
        Darstellungswunsch
        <textarea
          aria-label="Darstellungswunsch"
          maxLength={4000}
          value={instructions}
          disabled={busy || !!pending}
          onChange={(e) => setInstructions(e.target.value)}
          className="min-h-20 rounded-md border bg-background p-2"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !!pending || !person || !product || !offerId}
          onClick={() => {
            if (person && product)
              void deliver({
                commandId: crypto.randomUUID(),
                sourceRevision: artifact.revision,
                offerId,
                instructions,
                person,
                product,
              });
          }}
        >
          Anprobeauftrag vorbereiten
        </Button>
        {pending && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            className="h-auto min-h-9 max-w-full whitespace-normal"
            onClick={() => void deliver(pending)}
          >
            Denselben Anprobeauftrag bestätigen
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setPerson(null);
            setProduct(null);
            setPending(null);
            setError('');
          }}
        >
          Lokale Bilder verwerfen
        </Button>
      </div>
      {task && (
        <p className="text-sm">
          Task-Entwurf erstellt:{' '}
          <Link className="underline" to={`/assistant/tasks?resource=${encodeURIComponent(task.id)}`}>
            {task.title}
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
