import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import type { AssistantResource } from '@plum-code-webui/shared';

export function DatasetImport({ onCreated }: { onCreated: (artifact: AssistantResource) => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const owner = useAuthStore((s) => s.user?.id);
  return (
    <section className="space-y-2 rounded-md border p-3">
      <label className="inline-flex cursor-pointer rounded-md border px-3 py-2 text-sm">
        Datensatz importieren
        <input
          disabled={busy}
          className="sr-only"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setBusy(true);
            setError('');
            const captured = owner;
            try {
              if (file.size > 200000)
                throw new Error(
                  'Datensatz zu gross: höchstens 1000 Zeilen, 100 Spalten und 50 000 Zeichen.'
                );
              const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv',
                bytes = new Uint8Array(await file.arrayBuffer()),
                prefix = new TextEncoder().encode(`${captured}\0${file.name}\0${format}\0`),
                input = new Uint8Array(prefix.length + bytes.length);
              input.set(prefix);
              input.set(bytes, prefix.length);
              const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))]
                .map((n) => n.toString(16).padStart(2, '0'))
                .join('');
              const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
              if (useAuthStore.getState().user?.id !== captured) return;
              const form = new FormData();
              form.append('file', file);
              form.append('format', format);
              form.append('commandId', id);
              const result = (
                await api.post<{ data: AssistantResource }>('/api/assistant/datasets/import', form)
              ).data.data;
              if (useAuthStore.getState().user?.id === captured) onCreated(result);
            } catch (failure) {
              if (useAuthStore.getState().user?.id === captured)
                setError(
                  failure instanceof Error ? failure.message : 'Datensatzimport fehlgeschlagen'
                );
            } finally {
              if (useAuthStore.getState().user?.id === captured) setBusy(false);
            }
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        CSV mit eindeutiger Kopfzeile oder JSON mit columns/rows. Höchstens 1000 Zeilen, 100
        Spalten, 50 000 Zeichen. Originaldatei bleibt erhalten. Nach unklarer Antwort dieselbe Datei
        erneut auswählen.
      </p>
      {busy && (
        <p role="status" className="text-sm">
          Datensatz wird importiert …
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
