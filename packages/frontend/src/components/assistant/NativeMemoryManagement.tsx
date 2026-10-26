import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface NativeEntry {
  id: string;
  agentId: string;
  title: string;
  text: string;
  revision: string;
  runtime: string;
}
export function NativeMemoryManagement({ onChanged }: { onChanged: () => void }) {
  const owner = useAuthStore((s) => s.user?.id);
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [editing, setEditing] = useState<NativeEntry | null>(null),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [forget, setForget] = useState<NativeEntry | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['assistant', 'native-memory', owner, search],
    enabled: open,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<{
          data: { entries: NativeEntry[]; unavailable: string[]; hasMore: boolean };
        }>(
          `/api/assistant/memory-system/native?offset=${pageParam}&search=${encodeURIComponent(search)}`,
          { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) }
        )
      ).data.data,
    getNextPageParam: (last, _pages, lastOffset) => (last.hasMore ? lastOffset + 50 : undefined),
    retry: false,
  });
  const invoke = async (fn: () => Promise<unknown>, imported = false) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (useAuthStore.getState().user?.id !== owner) return;
      setEditing(null);
      setForget(null);
      await query.refetch();
      onChanged();
      setNotice(
        imported
          ? 'Als Agentenerinnerung in Plum übernommen.'
          : 'Originalgedächtnis geändert. Hermes verwendet geänderte Systemprompt-Erinnerungen beim nächsten neuen nativen Gespräch.'
      );
    } catch (e) {
      if (useAuthStore.getState().user?.id !== owner) return;
      setError(e instanceof Error ? e.message : 'Native Aktion fehlgeschlagen.');
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  };
  return (
    <details id="native-memory" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Originalgedächtnisse von Hermes und Schwarm</summary>
      <p>
        Direkter Zugriff auf den nativen Speicher mit deinem verbundenen Schwarm-Betreiberkonto.
        Eine Übernahme erstellt zunächst eine Agentenerinnerung in Plum.
      </p>
      <label>
        Native Erinnerungen durchsuchen
        <Input value={search} maxLength={200} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {query.isPending && open && <p role="status">Originalgedächtnisse laden …</p>}
      {query.isError && (
        <div>
          <p role="alert">
            {query.error.name === 'TimeoutError'
              ? 'Das Originalgedächtnis antwortet derzeit nicht.'
              : query.error.message}
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Erneut laden
          </Button>
        </div>
      )}
      {query.data?.pages[0]?.unavailable.length ? (
        <p>Derzeit nicht erreichbar: {query.data.pages[0].unavailable.join(', ')}.</p>
      ) : null}
      {query.data?.pages
        .flatMap((p) => p.entries)
        .map((entry) => (
          <article className="memory-entry" key={entry.id}>
            <h3>{entry.title}</h3>
            <small>
              {entry.agentId} ·{' '}
              {entry.runtime === 'hermes' ? 'Hermes-Original' : 'Schwarm-Original'}
            </small>
            {editing?.id === entry.id ? (
              <>
                <label>
                  Native Erinnerung bearbeiten
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={50000}
                  />
                </label>
                <Button
                  disabled={busy || !text.trim()}
                  onClick={() =>
                    void invoke(() =>
                      api.post('/api/assistant/memory-system/native/change', {
                        id: entry.id,
                        expectedRevision: entry.revision,
                        text: text.trim(),
                      })
                    )
                  }
                >
                  Im Original speichern
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
              </>
            ) : (
              <>
                <p>{entry.text}</p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void invoke(
                      () =>
                        api.post('/api/assistant/memory-system/native/import', {
                          id: entry.id,
                          expectedRevision: entry.revision,
                        }),
                      true
                    )
                  }
                >
                  In Plum übernehmen
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(entry);
                    setText(entry.text);
                  }}
                >
                  Original bearbeiten
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setForget(entry)}>
                  Im Original vergessen
                </Button>
              </>
            )}
          </article>
        ))}
      {query.hasNextPage && (
        <Button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Weitere native Erinnerungen laden
        </Button>
      )}
      {forget && (
        <div role="alert">
          <p>
            «{forget.title}» im nativen Speicher und in allen daraus übernommenen eigenen
            Plum-Erinnerungen dauerhaft vergessen?
          </p>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void invoke(() =>
                api.post('/api/assistant/memory-system/native/change', {
                  id: forget.id,
                  expectedRevision: forget.revision,
                })
              )
            }
          >
            Native Erinnerung dauerhaft löschen
          </Button>
          <Button variant="ghost" onClick={() => setForget(null)}>
            Abbrechen
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
