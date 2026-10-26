import { NativeMemoryManagement } from './NativeMemoryManagement';
import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AssistantApiProvider, AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function MemoryModelChoice({
  providerId,
  model,
  onChange,
}: {
  providerId: string;
  model: string;
  onChange: (providerId: string, model: string) => void;
}) {
  const owner = useAuthStore((s) => s.user?.id);
  const providers = useQuery({
    queryKey: ['assistant', 'memory-models', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantApiProvider[] }>('/api/assistant/memory-system/models')).data
        .data,
  });
  const selected = providers.data?.find((p) => p.id === providerId);
  return (
    <div className="personalization-row memory-model">
      <div>
        <h3>Modell für das Gedächtnis</h3>
        <p>
          Neue Agentenchats lernen direkt mit deinem gewählten CLI-Modell und dessen Abo. Für
          nachträgliche Analysen und Modellchats wird die eigene API-Verbindung oder dein
          vorhandener Codex-Login verwendet. Hier kannst du Verbindung und Modell festlegen.
        </p>
        {providers.isError && <p role="alert">Modellverbindungen konnten nicht geladen werden.</p>}
      </div>
      <div>
        <label>
          Verbindung für Hintergrundanalysen
          <select value={providerId} onChange={(e) => onChange(e.target.value, '')}>
            <option value="">Automatisch</option>
            {providers.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modell
          <select
            value={model}
            onChange={(e) => onChange(providerId, e.target.value)}
            disabled={!providerId}
          >
            <option value="">Automatisch</option>
            {selected?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
interface MemoryStatus {
  backfill?: { status: string; considered: number } | null;
  semantic?: { model: string; indexed: number; memories: number };
  jobs: Array<{
    id: string;
    source_type: string;
    source_id: string;
    status: string;
    error: string | null;
    usage_json: string | null;
  }>;
  history: Array<{
    id: string;
    source_type: string;
    source_id: string;
    summary: string;
    writing_style: string;
    created_at: string;
  }>;
}
export function MemoryManagement({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const owner = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState('');
  const memories = useInfiniteQuery({
    queryKey: ['assistant', 'resources', 'memory', owner, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: AssistantResource[] }>(
          `/api/assistant/memory?limit=100&offset=${pageParam}&search=${encodeURIComponent(search)}`
        )
      ).data.data,
    getNextPageParam: (last, _pages, lastOffset) =>
      last.length === 100 ? lastOffset + 100 : undefined,
    refetchInterval: 10000,
  });
  const entries = memories.data?.pages.flat();
  const status = useQuery({
    queryKey: ['assistant', 'memory-status', owner],
    queryFn: async () =>
      (await api.get<{ data: MemoryStatus }>('/api/assistant/memory-system')).data.data,
    refetchInterval: 10000,
  });
  const [historySearch, setHistorySearch] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useInfiniteQuery({
    queryKey: ['assistant', 'memory-history', owner, historySearch],
    enabled: historyOpen,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: { entries: MemoryStatus['history']; nextOffset: number | null } }>(
          `/api/assistant/memory-system/history?offset=${pageParam}&search=${encodeURIComponent(historySearch)}`
        )
      ).data.data,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    refetchInterval: 10000,
  });
  const [editing, setEditing] = useState<AssistantResource | null>(null),
    [text, setText] = useState(''),
    [title, setTitle] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<'all' | 'history' | 'backfill' | null>(null),
    [transferNotice, setTransferNotice] = useState('');
  const invoke = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (useAuthStore.getState().user?.id !== owner) return;
      setEditing(null);
      setConfirm(null);
      await Promise.all([
        memories.refetch(),
        status.refetch(),
        ...(historyOpen ? [history.refetch()] : []),
      ]);
      onChanged();
    } catch (e) {
      if (useAuthStore.getState().user?.id === owner)
        setError(e instanceof Error ? e.message : 'Gedächtnis konnte nicht geändert werden.');
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  };
  const save = (m: AssistantResource, body: Record<string, unknown>, newTitle = m.title) =>
    invoke(() =>
      api.patch(`/api/assistant/memory/${m.id}`, {
        expectedRevision: m.revision,
        title: newTitle,
        body: { ...body, pinned: true, state: 'active' },
      })
    );
  return (
    <section className="memory-management" aria-label="Langzeitgedächtnis verwalten">
      <Link to="/assistant/memory-topics" className="inline-flex rounded-lg border px-3 py-2 font-medium">Themengedächtnis</Link>
      <label>
        Erinnerungen durchsuchen
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Vorlieben, Projekte, Entscheidungen …"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {memories.isPending ? (
        <p role="status">Gedächtnis laden …</p>
      ) : memories.isError ? (
        <p role="alert">Erinnerungen konnten nicht geladen werden.</p>
      ) : (
        entries?.map((m) => (
          <article className="memory-entry" key={m.id}>
            <div className="memory-entry-header">
              <h3>{m.title}</h3>
              <span>
                {m.body.scope === 'agent'
                  ? 'Agent'
                  : m.body.scope === 'project'
                    ? 'Projekt'
                    : 'Persönlich'}{' '}
                ·{' '}
                {m.body.state === 'proposed'
                  ? 'Zur Prüfung'
                  : m.body.learned
                    ? 'Gelernt'
                    : 'Von dir gespeichert'}
              </span>
            </div>
            {editing?.id === m.id ? (
              <>
                <label>
                  Titel bearbeiten
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                </label>
                <label>
                  Erinnerung bearbeiten
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={50000}
                  />
                </label>
                <Button
                  disabled={busy || !text.trim() || !title.trim()}
                  onClick={() => void save(m, { ...m.body, text: text.trim() }, title.trim())}
                >
                  Korrektur speichern
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Abbrechen
                </Button>
              </>
            ) : (
              <>
                <p>{String(m.body.text)}</p>
                {m.body.state === 'proposed' && (
                  <Button disabled={busy} onClick={() => void save(m, m.body)}>
                    Als Erinnerung bestätigen
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(m);
                    setTitle(m.title);
                    setText(String(m.body.text));
                  }}
                >
                  Bearbeiten
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void invoke(() =>
                      api.delete(`/api/assistant/memory-system/${m.id}`, {
                        body: JSON.stringify({ expectedRevision: m.revision }),
                      })
                    )
                  }
                >
                  Vergessen
                </Button>
                {m.body.scope === 'agent' && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void invoke(() =>
                        api.post('/api/assistant/memory-system/import', {
                          id: m.id,
                          expectedRevision: m.revision,
                        })
                      )
                    }
                  >
                    Ins persönliche Gedächtnis übernehmen
                  </Button>
                )}
              </>
            )}
            {Array.isArray(m.body.origins) && m.body.origins.length > 0 && (
              <details>
                <summary>Herkunft und Belege</summary>
                {(
                  m.body.origins as Array<{
                    type: string;
                    id: string;
                    turnId: string;
                    quote: string;
                  }>
                ).map((o, i) => (
                  <div key={i}>
                    <Link
                      to={
                        o.type === 'api'
                          ? `/chat/model/${o.id}`
                          : o.type === 'task'
                            ? `/assistant/tasks?resource=${o.id}`
                            : o.type === 'cli'
                              ? `/chat/session/${o.id}`
                              : /^(?:hermes:|swarm:)/.test(o.id)
                                ? '/chat/personalization?view=memory#native-memory'
                                : `/assistant/memory?resource=${o.id}`
                      }
                    >
                      {o.type === 'agent'
                        ? 'Agentenerinnerung'
                        : o.type === 'import'
                          ? `Import: ${o.turnId}`
                          : 'Ursprüngliches Gespräch'}
                    </Link>
                    <blockquote>{o.quote}</blockquote>
                  </div>
                ))}
              </details>
            )}
            <Link to={`/assistant/memory?resource=${m.id}`}>Versionen und Details</Link>
          </article>
        ))
      )}
      {!memories.isPending && !memories.isError && !entries?.length && (
        <p>Noch keine gespeicherten Erinnerungen.</p>
      )}
      {memories.hasNextPage && (
        <Button
          disabled={memories.isFetchingNextPage}
          onClick={() => void memories.fetchNextPage()}
        >
          Weitere Erinnerungen laden
        </Button>
      )}
      <NativeMemoryManagement
        onChanged={() => {
          void memories.refetch();
          onChanged();
        }}
      />
      <details>
        <summary>Gedächtnis importieren und exportieren</summary>
        <p>
          Plum-Memory-JSON oder kopierten Erinnerungstext eines anderen Assistenten importieren. Die
          Angaben werden als deine ausdrücklich gespeicherten Erinnerungen übernommen. Zugangsdaten
          werden abgewiesen.
        </p>
        <label>
          Erinnerungsdatei importieren
          <input
            type="file"
            accept=".json,.txt,.md"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 1000000) {
                setError('Die Datei darf höchstens 1 MB gross sein.');
                return;
              }
              void invoke(async () => {
                const result = (
                  await api.post<{
                    data: { created: number; duplicates: number; rejected: number };
                  }>('/api/assistant/memory-system/transfer', {
                    filename: file.name,
                    text: await file.text(),
                  })
                ).data.data;
                setTransferNotice(
                  `${result.created} übernommen, ${result.duplicates} bereits vorhanden, ${result.rejected} abgewiesen.`
                );
              });
            }}
          />
        </label>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void invoke(async () => {
              const result = await api.get('/api/assistant/memory-system/export');
              const blob = new Blob([JSON.stringify(result.data, null, 2)], {
                  type: 'application/json',
                }),
                url = URL.createObjectURL(blob),
                a = document.createElement('a');
              a.href = url;
              a.download = 'plum-memory.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })
          }
        >
          Alle Erinnerungen exportieren
        </Button>
        {transferNotice && <p role="status">{transferNotice}</p>}
      </details>
      <details onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
        <summary>Frühere Chats und gelernter Schreibstil</summary>
        <label>
          Gelernten Gesprächskontext durchsuchen
          <Input
            value={historySearch}
            maxLength={200}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
        </label>
        {history.isPending ? (
          <p>Laden …</p>
        ) : history.isError ? (
          <p role="alert">Gelernter Gesprächskontext konnte nicht geladen werden.</p>
        ) : !history.data?.pages.some((p) => p.entries.length) ? (
          <p>Noch kein gelernter Gesprächskontext.</p>
        ) : (
          history.data.pages
            .flatMap((p) => p.entries)
            .map((h) => (
              <article key={h.id}>
                <Link
                  to={
                    h.source_type === 'api'
                      ? `/chat/model/${h.source_id}`
                      : h.source_type === 'task'
                        ? `/assistant/tasks?resource=${h.source_id}`
                        : `/chat/session/${h.source_id}`
                  }
                >
                  Gespräch vom {new Date(h.created_at).toLocaleDateString('de-CH')}
                </Link>
                <p>{h.summary}</p>
                {h.writing_style && <p>Schreibstil: {h.writing_style}</p>}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void invoke(() =>
                      api.delete(`/api/assistant/memory-system/history/${h.id}`, {
                        body: JSON.stringify({ expectedRevision: revision }),
                      })
                    )
                  }
                >
                  Diesen Gesprächskontext vergessen
                </Button>
              </article>
            ))
        )}
        {history.hasNextPage && (
          <Button
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Weitere Gesprächskontexte laden
          </Button>
        )}
      </details>
      <details>
        <summary>Hintergrundverarbeitung</summary>
        {status.data?.semantic && (
          <p>
            Semantisches Gedächtnis: {status.data.semantic.indexed} Einträge mit{' '}
            {status.data.semantic.model} indexiert.
          </p>
        )}
        {status.data?.backfill && (
          <p>
            {status.data.backfill.considered} ältere Beiträge geprüft ·{' '}
            {status.data.backfill.status === 'running'
              ? 'Weiteres Einlesen läuft im Hintergrund'
              : status.data.backfill.status === 'completed'
                ? 'Alle erlaubten Beiträge vorgemerkt'
                : 'Einlesen angehalten'}
            . Vorgemerkte Beiträge werden anschliessend analysiert.
          </p>
        )}
        {status.data?.backfill?.status === 'running' && (
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() =>
              void invoke(() =>
                api.post('/api/assistant/memory-system/backfill/cancel', {
                  expectedRevision: revision,
                })
              )
            }
          >
            Einlesen anhalten
          </Button>
        )}
        {status.data?.jobs.map((j) => (
          <p key={j.id}>
            {(
              {
                queued: 'Wartet',
                running: 'Verarbeitet',
                completed: 'Verarbeitet',
                cancelled: 'Verworfen',
                skipped: 'Nicht übernommen',
                failed: 'Fehlgeschlagen',
              } as Record<string, string>
            )[j.status] ?? j.status}
            {j.error ? ` · ${j.error}` : ''}
            {j.usage_json &&
              (() => {
                const u = JSON.parse(j.usage_json);
                return ` · ${u.model ?? ''}${typeof u.costUsd === 'number' ? ` · $${u.costUsd.toFixed(5)}` : ''}`;
              })()}
          </p>
        ))}
        {!status.data?.jobs.length && (
          <p>Noch keine Analysen. Neue erlaubte Gespräche werden im Hintergrund verarbeitet.</p>
        )}
      </details>
      <div className="memory-clear">
        <Button variant="secondary" disabled={busy} onClick={() => setConfirm('backfill')}>
          Bestehende Chats einlesen
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setConfirm('history')}>
          Gelernten Chatverlauf und Schreibstil löschen
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => setConfirm('all')}>
          Persönliches und Projektgedächtnis löschen
        </Button>
      </div>
      {confirm && (
        <div role="alert">
          <p>
            {confirm === 'backfill'
              ? 'Alle erlaubten früheren Beiträge aus bestehenden Chats und Tasks mit deiner gewählten Verbindung analysieren? Dafür fallen Modellkosten an oder es wird CLI-Kontingent verwendet.'
              : confirm === 'all'
                ? 'Alle persönlichen und Projekt-Erinnerungen sowie gelernte Gesprächszusammenfassungen und Schreibstile dauerhaft löschen? Agentengedächtnisse bleiben separat.'
                : 'Gelernte Gesprächszusammenfassungen und Schreibstile dauerhaft löschen? Gespeicherte Erinnerungen bleiben erhalten.'}{' '}
            Deine Originalchats bleiben erhalten.
          </p>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void invoke(() =>
                confirm === 'backfill'
                  ? api.post('/api/assistant/memory-system/backfill', {
                      expectedRevision: revision,
                      limit: 50,
                    })
                  : api.delete('/api/assistant/memory-system', {
                      body: JSON.stringify({
                        expectedRevision: revision,
                        historyOnly: confirm === 'history',
                      }),
                    })
              )
            }
          >
            {confirm === 'backfill' ? 'Jetzt analysieren' : 'Jetzt dauerhaft löschen'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Abbrechen
          </Button>
        </div>
      )}
    </section>
  );
}
