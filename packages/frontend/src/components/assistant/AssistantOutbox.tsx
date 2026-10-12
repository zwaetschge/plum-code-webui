import { useAuthStore } from '@/stores/authStore';
import { useEffect, useState } from 'react';
import {
  assistantDeliveries,
  retryAssistantDelivery,
  discardAssistantDelivery,
  type AssistantDelivery,
} from '@/services/assistantOutbox';
import { Button } from '@/components/ui/button';
export function AssistantOutbox() {
  const [entries, setEntries] = useState<AssistantDelivery[]>(assistantDeliveries),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const update = () => setEntries(assistantDeliveries());
    const unsubscribe = useAuthStore.subscribe(update);
    window.addEventListener('plum:assistant-outbox', update);
    window.addEventListener('storage', update);
    const expiry = window.setInterval(update, 30000);
    return () => {
      unsubscribe();
      window.removeEventListener('plum:assistant-outbox', update);
      window.removeEventListener('storage', update);
      window.clearInterval(expiry);
    };
  }, []);
  if (!entries.length) return null;
  return (
    <details className="rounded-md border border-warning/40 bg-card p-3">
      <summary className="cursor-pointer font-medium">
        {entries.length} unbestätigte Assistenz-Zustellungen
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Wiederholen verwendet dieselbe Befehlskennung. Ein Eintrag kann bereits beim Zieldienst
        angekommen sein. Entfernen zieht ihn dort nicht zurück.
      </p>
      {entries.map((entry) => (
        <div className="mt-3 flex flex-wrap items-center gap-2" key={entry.id}>
          <div className="min-w-0 w-full space-y-1 text-sm">
            <p>
              {entry.label} · {new Date(entry.createdAt).toLocaleString()}
            </p>
            <details>
              <summary className="cursor-pointer">Inhalt und Ziel prüfen</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
              <p className="break-all text-xs text-muted-foreground">{entry.path}</p>
            </details>
            {entry.error && <p className="text-destructive">{entry.error}</p>}
          </div>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() => {
              setBusy(entry.id);
              setError('');
              void retryAssistantDelivery(entry)
                .catch((failure) =>
                  setError(failure instanceof Error ? failure.message : 'Zustellung fehlgeschlagen')
                )
                .finally(() => setBusy(''));
            }}
          >
            Zustellung prüfen / wiederholen
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => discardAssistantDelivery(entry.id)}
          >
            Eintrag entfernen
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
