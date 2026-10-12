import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import type { AssistantDocumentAccess } from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { api, ApiError } from '@/services/api';
import { Button } from '@/components/ui/button';
import { DocumentWorkspace } from '@/components/assistant/DocumentWorkspace';
import { ArtifactImage } from '@/components/assistant/ArtifactImage';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
type Command = { commandId: string; expectedRevision: number; title: string; content: string };
export function CollaborativeDocumentPage() {
  const { id } = useParams(),
    owner = useAuthStore((s) => s.user?.id);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 font-sans sm:p-8">
      <h1 className="text-2xl font-semibold">Gemeinsame Dokumente</h1>
      <Link className="text-sm underline" to="/assistant/artifacts">
        Eigene Ergebnisse öffnen
      </Link>
      {id ? <Document key={`${owner}:${id}`} id={id} /> : <DocumentList key={owner} />}
    </main>
  );
}
function DocumentList() {
  const owner = useAuthStore((s) => s.user?.id);
  const rows = useInfiniteQuery({
    queryKey: ['assistant', 'shared-documents', owner],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: AssistantDocumentAccess[] }>(
          `/api/assistant/documents/shared?offset=${pageParam}`
        )
      ).data.data,
    getNextPageParam: (page, pages) => (page.length === 20 ? pages.length * 20 : undefined),
    retry: false,
  });
  if (rows.isPending) return <p role="status">Gemeinsame Dokumente werden geladen …</p>;
  if (rows.isError) return <p role="alert">Gemeinsame Dokumente konnten nicht geladen werden.</p>;
  const items = rows.data.pages.flat();
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Hier erscheinen Dokumente, deren Besitzer dir ausdrücklich Zugriff erteilt hat.
      </p>
      {!items.length ? (
        <p>Noch keine Dokumente für dich freigegeben.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.resource.id} className="rounded-md border bg-card p-3">
              <Link className="font-medium underline" to={`/collaborate/${item.resource.id}`}>
                {item.resource.title}
              </Link>
              <p className="break-all text-sm text-muted-foreground">
                {item.ownerEmail} · {item.role === 'editor' ? 'Bearbeiten' : 'Lesen'} · Revision{' '}
                {item.resource.revision}
              </p>
            </li>
          ))}
        </ul>
      )}
      {rows.hasNextPage && (
        <Button
          variant="outline"
          disabled={rows.isFetchingNextPage}
          onClick={() => void rows.fetchNextPage()}
        >
          Weitere gemeinsame Dokumente laden
        </Button>
      )}
    </>
  );
}
function Document({ id }: { id: string }) {
  const owner = useAuthStore((s) => s.user?.id),
    key = ['assistant', 'document-access', owner, id];
  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<{ data: AssistantDocumentAccess }>(`/api/assistant/documents/${id}/access`))
        .data.data,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <p role="status">Dokument wird geladen …</p>;
  if (query.isError)
    return <p role="alert">Dieses Dokument oder dein Zugriff ist nicht mehr verfügbar.</p>;
  return (
    <DocumentEditor
      key={`${owner}:${id}:${query.data.resource.revision}`}
      access={query.data}
      onReload={async () => {
        const result = await query.refetch();
        if (result.isError) throw new Error('Dokument konnte nicht neu geladen werden.');
        return result.data;
      }}
    />
  );
}
function DocumentEditor({
  access,
  onReload,
}: {
  access: AssistantDocumentAccess;
  onReload: () => Promise<AssistantDocumentAccess | undefined>;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true),
    cache = useQueryClient(),
    resource = access.resource;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && useAuthStore.getState().user?.id === owner;
  const [content, setContent] = useState(String(resource.body.content)),
    [title, setTitle] = useState(resource.title),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<Command | null>(null);
  const canEdit = access.role !== 'viewer',
    locked = busy || !!pending;
  async function save(command: Command) {
    setBusy(true);
    setError('');
    setPending(command);
    try {
      const saved = (
        await api.post<{ data: AssistantDocumentAccess }>(
          `/api/assistant/documents/${resource.id}/edits`,
          command
        )
      ).data.data;
      if (!current()) return;
      cache.setQueryData(['assistant', 'document-access', owner, resource.id], saved);
      setPending(null);
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
        setPending(null);
      setError(failure instanceof Error ? failure.message : 'Speicherung wurde nicht bestätigt');
    } finally {
      if (current()) setBusy(false);
    }
  }
  const image = (src?: string, alt?: string) => (
    <ArtifactImage src={src} alt={alt} artifact={resource} documentAccess />
  );
  return (
    <section className="space-y-4">
      <p className="break-all text-sm text-muted-foreground">
        {access.ownerEmail} ·{' '}
        {access.role === 'owner' ? 'Besitzer' : canEdit ? 'Bearbeiten' : 'Lesen'} · Revision{' '}
        {resource.revision}
      </p>
      {canEdit ? (
        <label className="grid gap-1 text-sm">
          Dokumenttitel
          <input
            className="rounded-md border bg-background p-2"
            value={title}
            maxLength={200}
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      ) : (
        <h2 className="text-xl font-semibold">{title}</h2>
      )}
      {resource.body.format === 'json' ? (
        <DocumentWorkspace
          content={content}
          editing={canEdit && !locked}
          onChange={setContent}
          renderImage={(item) => (
            <figure>
              {image(`/assistant-images/${item.assetId}`, item.alt)}
              {item.caption && (
                <figcaption className="text-sm text-muted-foreground">{item.caption}</figcaption>
              )}
            </figure>
          )}
        />
      ) : canEdit ? (
        <label className="grid gap-1 text-sm">
          Gemeinsamer Dokumenttext
          <textarea
            rows={14}
            maxLength={50000}
            disabled={locked}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="w-full rounded-md border bg-background p-3"
          />
        </label>
      ) : resource.body.format === 'markdown' ? (
        <div className="prose max-w-none dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ img: ({ src, alt }) => image(src, alt) }}
          >
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="whitespace-pre-wrap">{content}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button
            disabled={
              locked ||
              !title.trim() ||
              (title === resource.title && content === resource.body.content)
            }
            onClick={() =>
              void save({
                commandId: crypto.randomUUID(),
                expectedRevision: resource.revision,
                title,
                content,
              })
            }
          >
            Neue Dokumentrevision speichern
          </Button>
        )}
        {pending && (
          <Button disabled={busy} onClick={() => void save(pending)}>
            Dieselbe Speicherung bestätigen
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          className="h-auto min-h-10 max-w-full whitespace-normal"
          onClick={() => {
            setPending(null);
            setBusy(true);
            void onReload()
              .then((saved) => {
                if (!current() || !saved) return;
                setContent(String(saved.resource.body.content));
                setTitle(saved.resource.title);
                setError('');
              })
              .catch((failure) => {
                if (current())
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Dokument konnte nicht neu geladen werden'
                  );
              })
              .finally(() => {
                if (current()) setBusy(false);
              });
          }}
        >
          Aktuellen Stand laden und lokale Änderungen verwerfen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Speicherung erhält ältere Versionen. Gleichzeitige Änderungen überschreiben deinen Entwurf
        nicht; bei einem Konflikt prüfe den aktuellen Stand. Bildoriginale bleiben beim Besitzer.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
