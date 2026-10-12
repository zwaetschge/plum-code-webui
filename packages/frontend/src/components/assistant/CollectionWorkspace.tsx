import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssistantResource } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';
import { ResourcePicker, useResourceReferences, type ResourceReference } from './ResourcePicker';
import { api } from '@/services/api';
const pathFor = (resource: ResourceReference) =>
  resource.kind === 'api-chat'
    ? `/chat/model/${resource.id}`
    : `${resource.kind === 'task' ? '/assistant/tasks' : '/assistant/' + (resource.kind === 'memory' ? 'memory' : resource.kind + 's')}?resource=${encodeURIComponent(resource.id)}`;
export function CollectionWorkspace({
  collection,
  onSaved,
}: {
  collection: AssistantResource;
  onSaved: (resource: AssistantResource) => void;
}) {
  const [ids, setIds] = useState<string[]>((collection.body.resourceIds ?? []) as string[]),
    [favorites, setFavorites] = useState<string[]>((collection.body.favoriteIds ?? []) as string[]),
    [search, setSearch] = useState(''),
    [onlyFavorites, setOnlyFavorites] = useState(false),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setIds((collection.body.resourceIds ?? []) as string[]);
    setFavorites((collection.body.favoriteIds ?? []) as string[]);
    setError('');
  }, [collection.id, collection.revision, collection.body]);
  const references = useResourceReferences(ids);
  const changeIds = (next: string[]) => {
    setIds(next);
    setFavorites((old) => old.filter((id) => next.includes(id)));
  };
  const changed =
    JSON.stringify(ids) !== JSON.stringify(collection.body.resourceIds ?? []) ||
    JSON.stringify(favorites) !== JSON.stringify(collection.body.favoriteIds ?? []);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await api.patch<{ data: AssistantResource }>(
        `/api/assistant/collections/${collection.id}`,
        {
          title: collection.title,
          expectedRevision: collection.revision,
          body: { ...collection.body, resourceIds: ids, favoriteIds: favorites },
        }
      );
      onSaved(response.data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sammlung konnte nicht gespeichert werden');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Sammlung bearbeiten" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-0 basis-full text-sm sm:flex-1 sm:basis-auto">
          Sammlung durchsuchen
          <input
            aria-label="Sammlung durchsuchen"
            className="mt-1 w-full rounded-md border bg-background p-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyFavorites}
            onChange={(e) => setOnlyFavorites(e.target.checked)}
          />
          Nur Favoriten
        </label>
        <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Auswahl schliessen' : 'Einträge auswählen'}
        </Button>
        {changed && (
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Wird gespeichert …' : 'Sammlung speichern'}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {references.error && (
        <p role="alert" className="text-sm text-destructive">
          {references.error.message}
        </p>
      )}
      {adding && (
        <ResourcePicker
          label="Sammlungseinträge"
          value={ids}
          onChange={changeIds}
          maximum={1000}
          excludeId={collection.id}
        />
      )}
      <div className="grid gap-2">
        {ids.map((id, index) => {
          const ref = references.data?.find((item) => item.id === id),
            favorite = favorites.includes(id);
          if (
            (onlyFavorites && !favorite) ||
            (search && !ref?.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
          )
            return null;
          return (
            <article
              key={id}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-card p-3"
            >
              {ref ? (
                <Link
                  className="min-w-0 basis-full break-words font-medium underline sm:flex-1 sm:basis-auto"
                  to={pathFor(ref)}
                >
                  {ref.title}
                </Link>
              ) : (
                <span className="min-w-0 basis-full break-words text-sm text-muted-foreground sm:flex-1 sm:basis-auto">
                  {references.isLoading ? 'Wird geladen …' : 'Eintrag nicht mehr verfügbar'}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                aria-pressed={favorite}
                aria-label={`${ref?.title ?? 'Eintrag'} als Favorit`}
                onClick={() =>
                  setFavorites(
                    favorite ? favorites.filter((item) => item !== id) : [...favorites, id]
                  )
                }
              >
                {favorite ? '★ Favorit' : '☆ Favorit'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!index}
                aria-label={`${ref?.title ?? 'Eintrag'} nach vorne`}
                onClick={() => {
                  const next = [...ids];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  changeIds(next);
                }}
              >
                Nach vorne
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${ref?.title ?? 'Eintrag'} aus Sammlung entfernen`}
                onClick={() => changeIds(ids.filter((item) => item !== id))}
              >
                Entfernen
              </Button>
            </article>
          );
        })}
      </div>
      {!ids.length && (
        <p className="text-sm text-muted-foreground">
          Dokumente, Medien, Quellen, Gespräche und Aufgaben aus deiner Bibliothek auswählen.
        </p>
      )}
      {!!ids.length &&
        !references.isLoading &&
        !ids.some((id) => {
          const ref = references.data?.find((item) => item.id === id);
          return (
            (!onlyFavorites || favorites.includes(id)) &&
            (!search || ref?.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
          );
        }) && (
          <p className="text-sm text-muted-foreground">
            Keine passenden Einträge in dieser Sammlung.
          </p>
        )}
      <p className="text-xs text-muted-foreground">
        Die Sammlung enthält Verweise auf deine Bibliothek. Entfernen löscht keinen Originaleintrag;
        Änderungen und Favoriten werden erst mit Speichern übernommen.
      </p>
    </section>
  );
}
