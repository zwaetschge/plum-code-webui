import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssistantResource,
  MemoryTopic,
  MemoryTopicPage,
  MemoryTopicDocument,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ResourceRevisionDiff } from './ResourceRevisionDiff';

export function MemoryTopics() {
  const cache = useQueryClient();
  const owner = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState(''),
    [selected, setSelected] = useState<MemoryTopic | null>(null);
  const [editing, setEditing] = useState<AssistantResource | 'new' | null>(null),
    [title, setTitle] = useState(''),
    [text, setText] = useState('');
  const [creating, setCreating] = useState(false),
    [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [forget, setForget] = useState(false);
  const topics = useInfiniteQuery({
    queryKey: ['assistant', 'memory-topics', owner, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: MemoryTopicPage }>(
          `/api/assistant/memory-system/topics?search=${encodeURIComponent(search)}&offset=${pageParam}`
        )
      ).data.data,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    refetchInterval: 10000,
  });
  const document = useInfiniteQuery({
    queryKey: ['assistant', 'memory-topic', owner, selected?.id],
    initialPageParam: 0,
    enabled: !!selected,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: MemoryTopicDocument }>(
          `/api/assistant/memory-system/topics/${selected!.id}?offset=${pageParam}`
        )
      ).data.data,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    refetchInterval: editing ? false : 10000,
  });
  const projects = useQuery({
    queryKey: ['assistant', 'memory-topic-projects', owner],
    enabled: creating,
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/projects?limit=100')).data.data,
  });
  const current = () => owner === useAuthStore.getState().user?.id;
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (!current()) return;
      setEditing(null);
      setCreating(false);
      setForget(false);
      await topics.refetch();
      if (selected) await document.refetch();
    } catch (failure) {
      if (current())
        setError(failure instanceof Error ? failure.message : 'Änderung fehlgeschlagen');
    } finally {
      if (current()) setBusy(false);
    }
  };
  const save = () =>
    act(async () => {
      if (editing && editing !== 'new')
        await api.patch(`/api/assistant/memory/${editing.id}`, {
          expectedRevision: editing.revision,
          title: title.trim(),
          body: { ...editing.body, text: text.trim(), pinned: true, state: 'active' },
        });
      else {
        const topic = creating ? title.trim() : selected!.title;
        const scope = creating ? (projectId ? 'project' : 'personal') : selected!.scope;
        const scopeId = creating ? projectId : selected!.scopeId;
        await api.post('/api/assistant/memory', {
          title: title.trim(),
          body: {
            text: text.trim(),
            topic,
            scope,
            ...(scope === 'project'
              ? { projectId: scopeId }
              : scope === 'agent'
                ? { agentId: scopeId }
                : {}),
            pinned: true,
          },
        });
      }
    });
  return (
    <section aria-label="Themengedächtnis" className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Themen</h2>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setCreating(true);
            setEditing('new');
            setTitle('');
            setText('');
            setProjectId('');
          }}
        >
          Neues Thema
        </Button>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-[minmax(10rem,1fr)_minmax(0,3fr)]">
        <nav
          aria-label="Gedächtnisthemen"
          className={`space-y-2 ${selected ? 'hidden md:block' : ''}`}
        >
          <Input
            aria-label="Themen suchen"
            placeholder="Themen suchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {topics.isPending && <p role="status">Themen werden geladen …</p>}
          {topics.isError && (
            <Button variant="ghost" onClick={() => void topics.refetch()}>
              Themen erneut laden
            </Button>
          )}
          {topics.data?.pages
            .flatMap((page) => page.topics)
            .map((topic) => (
              <button
                type="button"
                key={topic.id}
                aria-current={selected?.id === topic.id ? 'page' : undefined}
                className={`block w-full rounded-lg p-3 text-left text-sm ${selected?.id === topic.id ? 'bg-muted' : 'hover:bg-muted/50'}`}
                onClick={() => {
                  setSelected(topic);
                  setEditing(null);
                  setError('');
                }}
              >
                <span className="block break-words font-medium">{topic.title}</span>
                <span className="text-xs text-muted-foreground">
                  {topic.scope === 'personal'
                    ? 'Persönlich'
                    : topic.scope === 'project'
                      ? 'Projekt'
                      : 'Agent'}{' '}
                  · {topic.count}
                </span>
              </button>
            ))}
          {!topics.isPending &&
            !topics.isError &&
            !topics.data?.pages.some((page) => page.topics.length) && <p>Keine Themen.</p>}
          {topics.hasNextPage && (
            <Button
              variant="ghost"
              disabled={topics.isFetchingNextPage}
              onClick={() => void topics.fetchNextPage()}
            >
              Weitere Themen
            </Button>
          )}
        </nav>
        {selected ? (
          <article className="min-w-0 space-y-4">
            <header className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="md:hidden"
                onClick={() => setSelected(null)}
              >
                Zurück
              </Button>
              <h3 className="min-w-0 flex-1 break-words text-xl font-medium">{selected.title}</h3>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setEditing('new');
                  setTitle('');
                  setText('');
                }}
              >
                Abschnitt ergänzen
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!document.data}
                onClick={() => setForget(true)}
              >
                Thema vergessen
              </Button>
            </header>
            {document.isPending && <p role="status">Wissensstand wird geladen …</p>}
            {document.isError && (
              <p role="alert">
                Thema konnte nicht geladen werden.{' '}
                <button className="underline" onClick={() => void document.refetch()}>
                  Erneut versuchen
                </button>
              </p>
            )}
            {document.data?.pages
              .flatMap((page) => page.entries)
              .map((entry) => (
                <section key={entry.id} className="space-y-2 border-b border-border/50 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="flex-1 font-medium">{entry.title}</h4>
                    <span className="text-xs text-muted-foreground">
                      Revision {entry.revision}
                      {entry.body.state === 'proposed' ? ' · Zur Prüfung' : ''}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{String(entry.body.text)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCreating(false);
                        setEditing(entry);
                        setTitle(entry.title);
                        setText(String(entry.body.text));
                      }}
                    >
                      Bearbeiten
                    </Button>
                    <ResourceRevisionDiff
                      collection="memory"
                      id={entry.id}
                      revision={entry.revision}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api.delete(`/api/assistant/memory-system/${entry.id}`, {
                            body: JSON.stringify({ expectedRevision: entry.revision }),
                          });
                          if (current()) {
                            cache.setQueryData<{
                              pages: MemoryTopicDocument[];
                              pageParams: number[];
                            }>(['assistant', 'memory-topic', owner, selected.id], (old) =>
                              old
                                ? {
                                    ...old,
                                    pages: old.pages.map((page) => ({
                                      ...page,
                                      entries: page.entries.filter((item) => item.id !== entry.id),
                                    })),
                                  }
                                : old
                            );
                            if (
                              document.data?.pages.flatMap((page) => page.entries).length === 1 &&
                              !document.hasNextPage
                            )
                              setSelected(null);
                            void cache.invalidateQueries({
                              queryKey: ['assistant', 'resources', 'memory', owner],
                            });
                          }
                        })
                      }
                    >
                      Vergessen
                    </Button>
                  </div>
                  {Array.isArray(entry.body.origins) && !!entry.body.origins.length && (
                    <details>
                      <summary className="cursor-pointer text-sm">Herkunft und Belege</summary>
                      {(
                        entry.body.origins as Array<{ type: string; id: string; quote: string }>
                      ).map((origin, index) => (
                        <blockquote key={index} className="my-2 border-l-2 pl-3 text-sm">
                          <p>{origin.quote}</p>
                          {origin.type === 'api' && (
                            <Link className="underline" to={`/chat/model/${origin.id}`}>
                              Ursprüngliches Gespräch
                            </Link>
                          )}
                        </blockquote>
                      ))}
                    </details>
                  )}
                </section>
              ))}
            {document.hasNextPage && (
              <Button
                variant="outline"
                disabled={document.isFetchingNextPage}
                onClick={() => void document.fetchNextPage()}
              >
                Weitere Abschnitte
              </Button>
            )}
          </article>
        ) : (
          <p className="hidden text-muted-foreground md:block">Thema auswählen</p>
        )}
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {creating
              ? 'Neues Thema'
              : editing === 'new'
                ? 'Abschnitt ergänzen'
                : 'Wissen korrigieren'}
          </DialogTitle>
          <label className="grid gap-2 text-sm">
            {creating ? 'Thema' : 'Titel'}
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          {creating && (
            <label className="grid gap-2 text-sm">
              Bereich
              <select
                className="rounded-md border bg-background p-2"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Persönlich</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="grid gap-2 text-sm">
            Wissensstand
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={50000}
              rows={8}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button disabled={busy || !title.trim() || !text.trim()} onClick={() => void save()}>
            Speichern
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={forget} onOpenChange={setForget}>
        <DialogContent>
          <DialogTitle>Thema vergessen?</DialogTitle>
          <p>{selected?.title}</p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api.delete(`/api/assistant/memory-system/topics/${selected!.id}`, {
                    body: JSON.stringify({ expectedVersion: document.data!.pages[0]!.version }),
                  });
                  if (current()) {
                    cache.removeQueries({
                      queryKey: ['assistant', 'memory-topic', owner, selected!.id],
                    });
                    setSelected(null);
                  }
                })
              }
            >
              Thema vergessen
            </Button>
            <Button variant="outline" onClick={() => setForget(false)}>
              Abbrechen
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
