import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import './chat-workspace.css';

interface ManagedPage {
  entries: AssistantResource[];
  nextOffset: number | null;
  busyChats: Record<string, 'queued' | 'running'>;
}
export function ChatManagerPage() {
  const owner = useAuthStore((state) => state.user?.id);
  return <ChatManager key={owner} owner={owner} />;
}
function ChatManager({ owner }: { owner?: string }) {
  const cache = useQueryClient();
  const [archived, setArchived] = useState(false),
    [search, setSearch] = useState(''),
    [targetProject, setTargetProject] = useState('');
  const [selection, setSelection] = useState<Map<string, AssistantResource>>(new Map());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const chats = useInfiniteQuery({
    queryKey: ['assistant', 'chat-manager', owner, archived, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: ManagedPage }>(
          `/api/assistant/api-chats/manage?archived=${archived}&search=${encodeURIComponent(search)}&offset=${pageParam}`
        )
      ).data.data,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    refetchInterval: 10000,
  });
  const projects = useQuery({
    queryKey: ['assistant', 'resources', 'projects', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/projects?limit=100')).data.data,
  });
  useEffect(() => {
    setSelection(new Map());
    setError('');
  }, [archived, search]);
  const rows = [
    ...new Map(
      (chats.data?.pages.flatMap((page) => page.entries) ?? []).map((chat) => [chat.id, chat])
    ).values(),
  ];
  const busyChats = Object.assign(
    {},
    ...(chats.data?.pages.map((page) => page.busyChats) ?? [])
  ) as ManagedPage['busyChats'];
  const act = async (action: 'archive' | 'restore' | 'move') => {
    setBusy(true);
    setError('');
    try {
      await api.post('/api/assistant/api-chats/bulk', {
        commandId: crypto.randomUUID(),
        action,
        chats: [...selection.values()].map((chat) => ({
          id: chat.id,
          expectedRevision: chat.revision,
        })),
        ...(action === 'move' ? { projectId: targetProject || null } : {}),
      });
      if (useAuthStore.getState().user?.id !== owner) return;
      setSelection(new Map());
      await cache.invalidateQueries({ queryKey: ['assistant'] });
    } catch (failure) {
      if (useAuthStore.getState().user?.id === owner)
        setError(failure instanceof Error ? failure.message : 'Änderung fehlgeschlagen');
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  };
  return (
    <main className="chat-workspace-page h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold">Verlauf</h1>
          <Link to="/chat" className="text-sm underline">
            Neuer Chat
          </Link>
        </header>
        <nav aria-label="Verlaufsansicht" className="flex gap-2">
          <Button variant={archived ? 'ghost' : 'secondary'} onClick={() => setArchived(false)}>
            Gespräche
          </Button>
          <Button variant={archived ? 'secondary' : 'ghost'} onClick={() => setArchived(true)}>
            Archiv
          </Button>
        </nav>
        <input
          aria-label="Verlauf durchsuchen"
          className="workspace-field w-full rounded-2xl border p-3"
          placeholder="Gespräche suchen"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="workspace-panel flex flex-wrap items-center gap-3 rounded-2xl p-3">
          <span className="text-sm">{selection.size} ausgewählt</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              setSelection(
                new Map(
                  rows
                    .filter((chat) => !busyChats[chat.id])
                    .slice(0, 100)
                    .map((chat) => [chat.id, chat])
                )
              )
            }
          >
            Bis zu 100 auswählen
          </Button>
          {!!selection.size && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setSelection(new Map())}
            >
              Auswahl aufheben
            </Button>
          )}
          {archived ? (
            <Button disabled={busy || !selection.size} onClick={() => void act('restore')}>
              Wiederherstellen
            </Button>
          ) : (
            <>
              <select
                aria-label="Zielprojekt"
                className="min-w-0 rounded-lg border bg-background p-2 text-sm"
                value={targetProject}
                onChange={(e) => setTargetProject(e.target.value)}
              >
                <option value="">Ohne Projekt</option>
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
              <Button disabled={busy || !selection.size} onClick={() => void act('move')}>
                Verschieben
              </Button>
              <Button
                variant="outline"
                disabled={busy || !selection.size}
                onClick={() => void act('archive')}
              >
                Archivieren
              </Button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {chats.isPending && <p role="status">Verlauf wird geladen …</p>}
        {chats.isError && (
          <Button variant="outline" onClick={() => void chats.refetch()}>
            Verlauf erneut laden
          </Button>
        )}
        <div className="divide-y">
          {rows.map((chat) => (
            <div key={chat.id} className="flex min-w-0 items-center gap-3 py-3">
              <input
                type="checkbox"
                aria-label={`${chat.title} auswählen`}
                checked={selection.has(chat.id)}
                disabled={
                  busy ||
                  (!selection.has(chat.id) && (!!busyChats[chat.id] || selection.size >= 100))
                }
                onChange={(e) =>
                  setSelection((current) => {
                    const updated = new Map(current);
                    if (e.target.checked) updated.set(chat.id, chat);
                    else updated.delete(chat.id);
                    return updated;
                  })
                }
              />
              <div className="min-w-0 flex-1">
                {archived ? (
                  <h2 className="break-words font-medium">{chat.title}</h2>
                ) : (
                  <Link
                    className="break-words font-medium hover:underline"
                    to={`/chat/model/${chat.id}`}
                  >
                    {chat.title}
                  </Link>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {!!chat.body.projectId && (
                    <span>
                      {projects.data?.find((project) => project.id === chat.body.projectId)
                        ?.title ?? 'Projekt'}
                    </span>
                  )}
                  <span>{new Date(chat.updatedAt).toLocaleDateString('de-CH')}</span>
                  {busyChats[chat.id] && (
                    <span>
                      {busyChats[chat.id] === 'running' ? 'Antwort läuft' : 'Nachricht vorgemerkt'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {!chats.isPending && !chats.isError && !rows.length && (
          <p>{archived ? 'Archiv ist leer.' : 'Keine Gespräche.'}</p>
        )}
        {chats.hasNextPage && (
          <Button
            disabled={chats.isFetchingNextPage}
            variant="outline"
            onClick={() => void chats.fetchNextPage()}
          >
            Weitere Gespräche
          </Button>
        )}
      </div>
    </main>
  );
}
