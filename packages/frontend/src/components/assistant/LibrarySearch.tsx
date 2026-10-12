import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AssistantLibraryHit } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
const kinds: Record<string, string> = {
  source: 'Quelle',
  artifact: 'Ergebnis',
  profile: 'Profil',
  task: 'Auftrag',
  project: 'Wissensprojekt',
  memory: 'Erinnerung',
  meeting: 'Meeting',
  course: 'Kurs',
  collection: 'Sammlung',
  routine: 'Routine',
  'event-subscription': 'Quellenabo',
  'api-chat': 'Modellgespräch',
  session: 'Agentengespräch',
};
export function LibrarySearch() {
  const owner = useAuthStore((state) => state.user?.id);
  const [draft, setDraft] = useState(''),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState<'all' | 'library' | 'chats' | 'code'>('all');
  const result = useInfiniteQuery({
    queryKey: ['assistant', 'library-search', owner, query, category],
    initialPageParam: 0,
    enabled: query.length >= 2 && !!owner,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api.get<{ data: { hits: AssistantLibraryHit[]; hasMore: boolean } }>(
          `/api/assistant/library-search?${new URLSearchParams({ query, category, offset: String(pageParam) })}`,
          { signal }
        )
      ).data.data,
    getNextPageParam: (last, _pages, offset) => (last.hasMore ? offset + 30 : undefined),
  });
  const hits = [
    ...new Map(
      (result.data?.pages.flatMap((page) => page.hits) ?? []).map((hit) => [
        `${hit.entryType}:${hit.id}`,
        hit,
      ])
    ).values(),
  ];
  return (
    <section
      aria-label="Gemeinsame Suche"
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4 md:p-6"
    >
      <h2 className="font-semibold">In Plum suchen</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <label className="grid w-full min-w-0 flex-1 gap-1 text-sm">
          Suchtext
          <input
            className="min-w-0 rounded-md border bg-background p-2"
            required
            minLength={2}
            maxLength={200}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Bereich
          <select
            aria-label="Bereich"
            className="rounded-md border bg-background p-2"
            value={category}
            onChange={(event) => setCategory(event.target.value as typeof category)}
          >
            <option value="all">Alles</option>
            <option value="library">Bibliothek</option>
            <option value="chats">Gespräche</option>
            <option value="code">Plum Code</option>
          </select>
        </label>
        <Button disabled={draft.trim().length < 2}>Suchen</Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Eigene Bibliothek und gespeicherte Gespräche. Temporäre Gespräche und archivierte Inhalte
        sind ausgeschlossen. Agenten behalten die Quellenrechte ihres jeweiligen Profils.
      </p>
      {result.isFetching && !result.data && query && <p role="status">Suche läuft …</p>}
      {result.isError && (
        <p role="alert" className="text-sm text-destructive">
          Suche fehlgeschlagen.{' '}
          <Button variant="ghost" size="sm" onClick={() => void result.refetch()}>
            Erneut versuchen
          </Button>
        </p>
      )}
      {result.data && !hits.length && <p>Keine passenden Einträge.</p>}
      <ul className="space-y-3">
        {hits.map((hit) => (
          <li key={`${hit.entryType}:${hit.id}`} className="min-w-0 rounded-md border p-3">
            <Link to={hit.href} className="break-words font-medium underline focus-visible:outline">
              {hit.title}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {hit.category === 'code' ? 'Plum Code' : (kinds[hit.kind] ?? 'Bibliothek')}
              {hit.entryType === 'cli-message' || hit.entryType === 'api-turn'
                ? ' · Nachricht'
                : ''}
              {hit.revision !== null ? ` · Revision ${hit.revision}` : ''}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{hit.excerpt}</p>
          </li>
        ))}
      </ul>
      {result.hasNextPage && (
        <Button
          variant="outline"
          disabled={result.isFetchingNextPage}
          onClick={() => void result.fetchNextPage()}
        >
          Weitere Treffer
        </Button>
      )}
    </section>
  );
}
