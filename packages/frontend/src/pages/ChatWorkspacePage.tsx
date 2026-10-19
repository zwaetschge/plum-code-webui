import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, Bot, FolderOpen, Plus, Settings2 } from 'lucide-react';
import type { AssistantApiProvider, AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button, buttonVariants } from '@/components/ui/button';
import { ResourcePicker } from '@/components/assistant/ResourcePicker';

type Collection = 'profiles' | 'projects' | 'sources';
const field = 'w-full rounded-xl border bg-background p-3 text-base';
const action = buttonVariants({ variant: 'outline' });
function useResources(collection: Collection | 'api-chats', owner?: string) {
  return useQuery({
    queryKey: [
      'assistant',
      ...(collection === 'api-chats' ? ['api-chats'] : ['resources', collection]),
      owner,
    ],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/' + collection + '?limit=100'))
        .data.data,
  });
}
function startHref(profile = '', project = '') {
  return (
    '/chat?' +
    new URLSearchParams({
      ...(profile ? { assistant: profile } : {}),
      ...(project ? { project } : {}),
    })
  );
}
export function ChatWorkspacePage() {
  const owner = useAuthStore((s) => s.user?.id),
    location = useLocation();
  return <WorkspaceAccount key={String(owner) + ':' + location.pathname} owner={owner} />;
}
function WorkspaceAccount({ owner }: { owner?: string }) {
  const { id } = useParams(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  const isProject = location.pathname.startsWith('/chat/projects');
  const collection = isProject ? 'projects' : 'profiles',
    base = isProject ? '/chat/projects' : '/chat/assistants';
  const projects = useResources('projects', owner),
    profiles = useResources('profiles', owner);
  const chats = useResources('api-chats', owner),
    sources = useResources('sources', owner);
  const rows = isProject ? projects : profiles,
    resource = rows.data?.find((r) => r.id === id);
  const editor = id === 'new' || location.pathname.endsWith('/edit');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const selectedProfile = isProject ? (params.get('expert') ?? '') : (id ?? '');
  const selectedProject = isProject ? (id ?? '') : (params.get('project') ?? '');
  const related =
    chats.data?.filter(
      (c) =>
        (isProject ? c.body.projectId === id : c.body.profileId === id) &&
        (!isProject || !selectedProfile || c.body.profileId === selectedProfile) &&
        (isProject || !selectedProject || c.body.projectId === selectedProject) &&
        c.title.toLocaleLowerCase().includes(query)
    ) ?? [];
  const source = params.get('source'),
    tab = params.get('tab') === 'sources' ? 'sources' : 'chats';
  const projectSources = sources.data?.filter((s) => s.body.projectId === id) ?? [];
  const sourceResource = projectSources.find((s) => s.id === source);
  return (
    <main className="h-full overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto w-full max-w-4xl space-y-7 pb-10">
        <nav aria-label="Chat-Arbeitsbereiche" className="flex flex-wrap gap-4 text-sm">
          <Link to="/chat" className="flex items-center gap-1 text-muted-foreground">
            <ArrowLeft size={15} /> Chat
          </Link>
          <Link
            aria-current={!isProject ? 'page' : undefined}
            className={!isProject ? 'font-semibold' : 'text-muted-foreground'}
            to="/chat/assistants"
          >
            Assistenten
          </Link>
          <Link
            aria-current={isProject ? 'page' : undefined}
            className={isProject ? 'font-semibold' : 'text-muted-foreground'}
            to="/chat/projects"
          >
            Projekte
          </Link>
        </nav>
        {rows.isPending ? (
          <p role="status">Arbeitsbereich wird geladen …</p>
        ) : rows.isError ? (
          <p role="alert">
            Arbeitsbereich konnte nicht geladen werden.{' '}
            <button className="underline" onClick={() => void rows.refetch()}>
              Erneut versuchen
            </button>
          </p>
        ) : id && id !== 'new' && !resource ? (
          <p role="alert">
            Dieser Arbeitsbereich ist nicht mehr verfügbar.{' '}
            <Link className="underline" to={base}>
              Zur Übersicht
            </Link>
          </p>
        ) : editor ? (
          <WorkspaceEditor
            key={collection + ':' + id + ':' + resource?.revision}
            collection={collection}
            resource={resource}
            back={resource ? base + '/' + resource.id : base}
            owner={owner}
          />
        ) : !resource ? (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">
                  {isProject ? 'Deine Projekte' : 'Deine Assistenten'}
                </h1>
                <p className="max-w-xl text-muted-foreground">
                  {isProject
                    ? 'Ein Ort für deine Gespräche, Experten und Quellen. Du entscheidest, ob Chats ihren Kontext teilen.'
                    : 'Prompt-Experten mit eigenen Anweisungen, Wissen und gemeinsamen Erinnerungen. In jedem Projekt einsetzbar.'}
                </p>
              </div>
              <Link className={buttonVariants()} to={base + '/new'}>
                <Plus size={16} className="mr-2" />
                {isProject ? 'Neues Projekt' : 'Neuer Assistent'}
              </Link>
            </header>
            <label className="block">
              <span className="sr-only">Arbeitsbereiche durchsuchen</span>
              <input
                className={field}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isProject ? 'Projekt suchen …' : 'Assistent suchen …'}
              />
            </label>
            <div className="divide-y rounded-2xl border px-4">
              {rows.data
                ?.filter((r) => r.title.toLocaleLowerCase().includes(query))
                .map((r) => {
                  const Icon = isProject ? FolderOpen : Bot;
                  return (
                    <Link
                      key={r.id}
                      to={base + '/' + r.id}
                      className="flex min-h-24 items-center gap-4 py-4 hover:text-primary"
                    >
                      <Icon className="h-6 w-6 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <h2 className="break-words text-lg font-medium">{r.title}</h2>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {isProject
                            ? String(
                                r.body.description ||
                                  (r.body.contextMode === 'separate'
                                    ? 'Getrennte Chatverläufe'
                                    : 'Gemeinsamer Projektkontext')
                              )
                            : String(r.body.instructions || 'Eigener Prompt-Experte')}
                        </p>
                      </div>
                      <ArrowUpRight size={18} className="shrink-0" />
                    </Link>
                  );
                })}
              {!rows.data?.filter((r) => r.title.toLocaleLowerCase().includes(query)).length && (
                <p className="py-10 text-muted-foreground">
                  {query
                    ? 'Keine passenden Arbeitsbereiche.'
                    : isProject
                      ? 'Lege dein erstes Projekt an und sammle seine Gespräche an einem Ort.'
                      : 'Lege deinen ersten Prompt-Experten an.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <header className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="flex min-w-0 items-center gap-3 break-words text-3xl font-semibold tracking-tight">
                  {isProject ? <FolderOpen className="shrink-0" /> : <Bot className="shrink-0" />}
                  {resource.title}
                </h1>
                <Link to={base + '/' + id + '/edit'} className={action}>
                  <Settings2 size={15} className="mr-2" />
                  Bearbeiten
                </Link>
              </div>
              <p className="text-muted-foreground">
                {isProject
                  ? String(
                      resource.body.description || 'Deine Gespräche und Experten an einem Ort.'
                    )
                  : 'Wähle ein Projekt und starte ein Gespräch mit diesem Experten.'}
              </p>
              {isProject && (
                <p className="text-sm">
                  <strong>
                    {resource.body.contextMode === 'separate'
                      ? 'Getrennte Chatverläufe'
                      : 'Gemeinsamer Projektkontext'}
                  </strong>
                  <span className="text-muted-foreground">
                    {' '}
                    ·{' '}
                    {resource.body.contextMode === 'separate'
                      ? 'Projektanweisungen, Quellen und explizite Experten-Erinnerungen gelten weiterhin.'
                      : 'Chats können begrenzte Auszüge aus anderen Gesprächen dieses Projekts nutzen.'}
                  </span>
                </p>
              )}
              <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-muted/40 p-4">
                <label className="grid min-w-0 flex-1 basis-full gap-2 text-sm sm:basis-auto">
                  {isProject ? 'Assistent' : 'Projekt'}
                  <select
                    className={field}
                    value={isProject ? selectedProfile : selectedProject}
                    onChange={(e) => {
                      const next = new URLSearchParams(params);
                      next.set(isProject ? 'expert' : 'project', e.target.value);
                      setParams(next, { replace: true });
                    }}
                  >
                    <option value="">
                      {isProject ? 'Alle · neuer Chat mit Plum' : 'Ohne Projekt'}
                    </option>
                    {(isProject ? profiles.data : projects.data)?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Link
                  className={buttonVariants() + ' w-full sm:w-auto'}
                  to={startHref(selectedProfile, selectedProject)}
                >
                  <Plus size={16} className="mr-2" />
                  Neuer Chat
                </Link>
              </div>
            </header>
            <nav aria-label="Projektinhalt" className="flex gap-5 border-b pb-3">
              <Link
                aria-current={tab === 'chats' ? 'page' : undefined}
                className={tab === 'chats' ? 'font-semibold' : 'text-muted-foreground'}
                to={
                  base +
                  '/' +
                  id +
                  '?' +
                  new URLSearchParams({
                    ...(selectedProfile && isProject ? { expert: selectedProfile } : {}),
                    ...(selectedProject && !isProject ? { project: selectedProject } : {}),
                  })
                }
              >
                Gespräche
              </Link>
              {isProject && (
                <Link
                  aria-current={tab === 'sources' ? 'page' : undefined}
                  className={tab === 'sources' ? 'font-semibold' : 'text-muted-foreground'}
                  to={base + '/' + id + '?tab=sources'}
                >
                  Quellen
                </Link>
              )}
            </nav>
            {tab === 'sources' && isProject ? (
              <>
                {source ? (
                  source === 'new' || sourceResource ? (
                    <WorkspaceEditor
                      key={'source:' + source + ':' + sourceResource?.revision}
                      collection="sources"
                      resource={sourceResource}
                      projectId={id}
                      back={base + '/' + id + '?tab=sources'}
                      owner={owner}
                    />
                  ) : (
                    <p role="alert">Quelle nicht mehr verfügbar.</p>
                  )
                ) : (
                  <>
                    <Link className={action} to={base + '/' + id + '?tab=sources&source=new'}>
                      Neue Projektquelle
                    </Link>
                    {projectSources.map((s) => (
                      <Link
                        className="block border-b py-4"
                        key={s.id}
                        to={base + '/' + id + '?tab=sources&source=' + s.id}
                      >
                        <h2 className="font-medium">{s.title}</h2>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {String(s.body.text || '')}
                        </p>
                      </Link>
                    ))}
                    {!projectSources.length && !sources.isPending && !sources.isError && (
                      <p className="text-muted-foreground">
                        Noch keine Quellen. Projektquellen stehen allen Chats im Projekt zur
                        Verfügung.
                      </p>
                    )}
                  </>
                )}
                {sources.isPending && <p role="status">Quellen werden geladen …</p>}
                {sources.isError && <p role="alert">Quellen konnten nicht geladen werden.</p>}
              </>
            ) : (
              <>
                <label className="block">
                  <span className="sr-only">Gespräche durchsuchen</span>
                  <input
                    className={field}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Gespräch suchen …"
                  />
                </label>
                {chats.isPending && <p role="status">Gespräche werden geladen …</p>}
                {chats.isError && <p role="alert">Gespräche konnten nicht geladen werden.</p>}
                <div className="divide-y">
                  {related.map((c) => (
                    <Link
                      key={c.id}
                      to={'/chat/model/' + c.id}
                      className="flex items-center justify-between gap-3 py-4 hover:text-primary"
                    >
                      <div className="min-w-0">
                        <h2 className="break-words font-medium">{c.title}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {profiles.data?.find((p) => p.id === c.body.profileId)?.title ?? 'Plum'} ·{' '}
                          {new Date(c.updatedAt).toLocaleDateString('de-CH')}
                        </p>
                      </div>
                      <ArrowUpRight size={16} className="shrink-0" />
                    </Link>
                  ))}
                </div>
                {!related.length && !chats.isPending && !chats.isError && (
                  <div className="space-y-3 py-8 text-center">
                    <h2 className="text-lg font-medium">
                      {query ? 'Kein passendes Gespräch' : 'Hier beginnen deine Gespräche'}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {query
                        ? 'Versuche einen anderen Suchbegriff.'
                        : 'Wähle oben deinen Experten und starte einen neuen Chat.'}
                    </p>
                  </div>
                )}
                {!isProject && (
                  <details className="space-y-3 rounded-xl border p-4">
                    <summary className="cursor-pointer font-medium">
                      Anweisungen und gemeinsame Erinnerungen
                    </summary>
                    <p className="whitespace-pre-wrap text-sm">
                      {String(resource.body.instructions || 'Noch keine Anweisungen.')}
                    </p>
                    <h3 className="font-medium">Gemeinsame Erinnerungen</h3>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {String(
                        resource.body.sharedMemories ||
                          'Noch keine gemeinsamen Erinnerungen. Im Editor kannst du Notizen für alle Gespräche dieses Experten festhalten.'
                      )}
                    </p>
                  </details>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function WorkspaceEditor({
  collection,
  resource,
  projectId,
  back,
  owner,
}: {
  collection: Collection;
  resource?: AssistantResource;
  projectId?: string;
  back: string;
  owner?: string;
}) {
  const cache = useQueryClient(),
    navigate = useNavigate();
  const [title, setTitle] = useState(resource?.title ?? '');
  const [instructions, setInstructions] = useState(
    String(resource?.body[collection === 'sources' ? 'text' : 'instructions'] ?? '')
  );
  const [description, setDescription] = useState(String(resource?.body.description ?? ''));
  const [sharedMemories, setSharedMemories] = useState(String(resource?.body.sharedMemories ?? ''));
  const [contextMode, setContextMode] = useState(String(resource?.body.contextMode ?? 'shared'));
  const [sourceIds, setSourceIds] = useState<string[]>(
    (resource?.body.sourceIds ?? []) as string[]
  );
  const [provider, setProvider] = useState(String(resource?.body.apiProviderId ?? ''));
  const [model, setModel] = useState(String(resource?.body.model ?? ''));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const providers = useQuery({
    queryKey: ['assistant', 'api-chat-providers', owner],
    enabled: collection === 'profiles',
    queryFn: async () =>
      (await api.get<{ data: AssistantApiProvider[] }>('/api/assistant/api-chat-providers')).data
        .data,
  });
  const isOwner = () => useAuthStore.getState().user?.id === owner;
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = {
        ...resource?.body,
        ...(collection === 'sources' ? { text: instructions, projectId } : { instructions }),
        ...(collection === 'projects' ? { description, contextMode } : {}),
        ...(collection === 'profiles'
          ? {
              sharedMemories,
              sourceIds,
              apiProviderId: provider || undefined,
              model: model || null,
            }
          : {}),
      };
      const payload = {
        title: title.trim(),
        body,
        ...(resource ? { expectedRevision: resource.revision } : {}),
      };
      const path = '/api/assistant/' + collection;
      const result = resource
        ? await api.patch<{ data: AssistantResource }>(path + '/' + resource.id, payload)
        : await api.post<{ data: AssistantResource }>(path, payload);
      if (!isOwner()) return;
      await cache.invalidateQueries({ queryKey: ['assistant'] });
      if (isOwner())
        navigate(
          collection === 'sources'
            ? back
            : '/chat/' +
                (collection === 'projects' ? 'projects' : 'assistants') +
                '/' +
                result.data.data.id
        );
    } catch (failure) {
      if (isOwner())
        setError(failure instanceof Error ? failure.message : 'Speichern fehlgeschlagen.');
    } finally {
      if (isOwner()) setBusy(false);
    }
  };
  const archive = async () => {
    if (!resource) return;
    setBusy(true);
    setError('');
    try {
      await api.delete('/api/assistant/' + collection + '/' + resource.id, {
        body: JSON.stringify({ expectedRevision: resource.revision }),
      });
      if (!isOwner()) return;
      await cache.invalidateQueries({ queryKey: ['assistant'] });
      if (isOwner())
        navigate(
          collection === 'sources'
            ? back
            : '/chat/' + (collection === 'projects' ? 'projects' : 'assistants')
        );
    } catch (failure) {
      if (isOwner())
        setError(failure instanceof Error ? failure.message : 'Archivieren fehlgeschlagen.');
    } finally {
      if (isOwner()) setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-5"
    >
      <header className="space-y-2">
        <Link to={back} className="text-sm text-muted-foreground">
          ← Zurück
        </Link>
        <h1 className="text-2xl font-semibold">
          {collection === 'projects'
            ? resource
              ? 'Projekt bearbeiten'
              : 'Neues Projekt'
            : collection === 'profiles'
              ? resource
                ? 'Assistent bearbeiten'
                : 'Neuer Assistent'
              : resource
                ? 'Quelle bearbeiten'
                : 'Neue Projektquelle'}
        </h1>
      </header>
      <fieldset disabled={busy} className="space-y-5">
        <label className="grid gap-2 text-sm">
          Name
          <input
            className={field}
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {collection === 'projects' && (
          <>
            <label className="grid gap-2 text-sm">
              Beschreibung
              <input
                className={field}
                maxLength={30000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Kontext zwischen Gesprächen</legend>
              {[
                [
                  'shared',
                  'Gemeinsamer Projektkontext',
                  'Chats dürfen begrenzte Auszüge aus anderen Gesprächen dieses Projekts nutzen.',
                ],
                [
                  'separate',
                  'Getrennte Chatverläufe',
                  'Jeder Chat behält seinen eigenen Verlauf. Projektanweisungen, Quellen und explizite Experten-Erinnerungen gelten weiterhin.',
                ],
              ].map(([value, label, hint]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border p-4"
                >
                  <input
                    type="radio"
                    name="contextMode"
                    className="mt-1"
                    checked={contextMode === value}
                    onChange={() => setContextMode(value!)}
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        <label className="grid gap-2 text-sm">
          {collection === 'sources' ? 'Quellentext' : 'Anweisungen'}
          <textarea
            className={field + ' min-h-44'}
            required={collection === 'sources'}
            maxLength={collection === 'sources' ? 50000 : 30000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={
              collection === 'profiles'
                ? 'Welche Aufgabe hat dieser Experte? Wie soll er antworten?'
                : undefined
            }
          />
        </label>
        {collection === 'profiles' && (
          <>
            <label className="grid gap-2 text-sm">
              Gemeinsame Erinnerungen
              <textarea
                className={field + ' min-h-28'}
                maxLength={30000}
                value={sharedMemories}
                onChange={(e) => setSharedMemories(e.target.value)}
                placeholder="Wichtige Fakten und Vereinbarungen für alle Gespräche dieses Experten"
              />
              <span className="text-xs text-muted-foreground">
                Von dir gepflegte Notizen. Änderungen gelten auch für bestehende, dauerhafte Chats
                dieses Experten.
              </span>
            </label>
            <details
              className="space-y-4 rounded-xl border p-4"
              open={!!provider || !!sourceIds.length}
            >
              <summary className="cursor-pointer font-medium">Modell und Wissen</summary>
              <label className="grid gap-2 text-sm">
                Bevorzugte API-Verbindung
                <select
                  className={field}
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setModel('');
                  }}
                >
                  <option value="">Aktuelle Auswahl behalten</option>
                  {providers.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {provider && (
                <label className="grid gap-2 text-sm">
                  Bevorzugtes Modell
                  <select
                    className={field}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">Standardmodell</option>
                    {providers.data
                      ?.find((p) => p.id === provider)
                      ?.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <ResourcePicker
                label="Wissen des Assistenten"
                kind="source"
                value={sourceIds}
                onChange={setSourceIds}
                maximum={20}
              />
            </details>
            <p className="text-xs text-muted-foreground">
              Anweisungen, Modell und zugewiesenes Wissen gelten für neue Chats. Bestehende Chats
              behalten ihre Profilrevision, bis du sie dort aktualisierst.
            </p>
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!title.trim()}>Speichern</Button>
          <Link className={action} to={back}>
            Abbrechen
          </Link>
          {resource && (
            <Button type="button" variant="ghost" onClick={() => void archive()}>
              Archivieren
            </Button>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
