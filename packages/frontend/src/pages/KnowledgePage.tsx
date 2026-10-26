import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { ResourcePicker } from '@/components/assistant/ResourcePicker';
import './chat-workspace.css';

interface Access {
  resource: AssistantResource;
  role: 'owner' | 'viewer' | 'editor';
  ownerEmail: string;
}
export function KnowledgePage() {
  const owner = useAuthStore((state) => state.user?.id);
  return <Knowledge key={owner} owner={owner} />;
}
function Knowledge({ owner }: { owner?: string }) {
  const [params, setParams] = useSearchParams();
  const id = params.get('resource');
  const [title, setTitle] = useState(''),
    [sources, setSources] = useState<string[]>([]);
  const [creating, setCreating] = useState(false),
    [error, setError] = useState('');
  const cache = useQueryClient();
  const rows = useInfiniteQuery({
    queryKey: ['assistant', 'knowledge', owner],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<{ data: AssistantResource[] }>(
          `/api/assistant/collections?limit=50&offset=${pageParam}`
        )
      ).data.data,
    getNextPageParam: (last, _pages, offset) => (last.length === 50 ? offset + 50 : undefined),
  });
  const shared = useInfiniteQuery({
    queryKey: ['assistant', 'shared-libraries', owner],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (await api.get<{ data: Access[] }>(`/api/assistant/libraries/shared?offset=${pageParam}`))
        .data.data,
    getNextPageParam: (last, _pages, offset) => (last.length === 50 ? offset + 50 : undefined),
  });
  async function create() {
    setError('');
    try {
      const result = await api.post<{ data: AssistantResource }>('/api/assistant/collections', {
        title,
        body: { knowledge: true, resourceIds: sources, notes: '', description: '' },
      });
      if (useAuthStore.getState().user?.id !== owner) return;
      setParams({ resource: result.data.data.id });
      setCreating(false);
      setTitle('');
      setSources([]);
      void cache.invalidateQueries({ queryKey: ['assistant'] });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Notebook konnte nicht erstellt werden'
      );
    }
  }
  return (
    <main className="chat-workspace-page h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <Link to="/collaborate" className="text-sm underline">
          Gemeinsame Dokumente
        </Link>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold">Wissen</h1>
          <Button onClick={() => setCreating(!creating)}>Neues Notebook</Button>
        </header>
        {error && <p role="alert">{error}</p>}
        {creating && (
          <section className="workspace-panel space-y-3 rounded-2xl p-4">
            <input
              aria-label="Notebooktitel"
              placeholder="Notebooktitel"
              className="workspace-field w-full rounded-xl border p-3"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
            <ResourcePicker
              label="Notebookquellen"
              kind="source"
              value={sources}
              onChange={setSources}
              maximum={100}
            />
            <Button disabled={!title.trim()} onClick={() => void create()}>
              Notebook erstellen
            </Button>
          </section>
        )}
        {id ? (
          <>
            <Button variant="ghost" onClick={() => setParams({})}>
              Alle Notebooks
            </Button>
            <Notebook key={`${owner}:${id}`} id={id} owner={owner} />
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Eigene Sammlungen</h2>
            <div className="divide-y">
              {rows.data?.pages.flat().map((item) => (
                <button
                  className="block w-full py-4 text-left"
                  key={item.id}
                  onClick={() => setParams({ resource: item.id })}
                >
                  {item.title}
                </button>
              ))}
            </div>
            {rows.hasNextPage && (
              <Button onClick={() => void rows.fetchNextPage()}>Weitere Sammlungen</Button>
            )}
            <h2 className="text-lg font-semibold">Mit mir geteilt</h2>
            <div className="divide-y">
              {shared.data?.pages.flat().map((item) => (
                <button
                  className="block w-full py-4 text-left"
                  key={item.resource.id}
                  onClick={() => setParams({ resource: item.resource.id })}
                >
                  {item.resource.title}
                  <span className="ml-3 text-sm text-muted-foreground">
                    {item.ownerEmail} · {item.role === 'viewer' ? 'Lesen' : 'Bearbeiten'}
                  </span>
                </button>
              ))}
            </div>
            {shared.hasNextPage && (
              <Button onClick={() => void shared.fetchNextPage()}>Weitere Freigaben</Button>
            )}
            {(rows.error || shared.error) && (
              <p role="alert">Bibliothek konnte nicht vollständig geladen werden.</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
function Notebook({ id, owner }: { id: string; owner?: string }) {
  const navigate = useNavigate(),
    cache = useQueryClient();
  const key = ['assistant', 'library-access', owner, id];
  const access = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get<{ data: Access }>(`/api/assistant/libraries/${id}/access`)).data.data,
    retry: false,
    refetchInterval: 10000,
  });
  const [title, setTitle] = useState(''),
    [text, setText] = useState(''),
    [base, setBase] = useState<AssistantResource | null>(null);
  const [sourceIds, setSourceIds] = useState<string[]>([]),
    [prompt, setPrompt] = useState('');
  const [email, setEmail] = useState(''),
    [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const models = useQuery({
    queryKey: ['api-chat-providers', owner],
    queryFn: async () =>
      (
        await api.get<{ data: { id: string; name: string; models: string[] }[] }>(
          '/api/assistant/api-chat-providers'
        )
      ).data.data,
  });
  const [model, setModel] = useState('');
  const members = useQuery({
    queryKey: ['assistant', 'library-members', owner, id],
    queryFn: async () =>
      (
        await api.get<{ data: { email: string; role: string }[] }>(
          `/api/assistant/libraries/${id}/members`
        )
      ).data.data,
    enabled: access.data?.role === 'owner',
  });
  const resource = access.data?.resource;
  const dirty =
    !!base &&
    (title !== base.title ||
      text !== String(base.body[base.kind === 'source' ? 'text' : 'notes'] ?? ''));
  useEffect(() => {
    if (!resource || dirty) return;
    setBase(resource);
    setTitle(resource.title);
    setText(String(resource.body[resource.kind === 'source' ? 'text' : 'notes'] ?? ''));
  }, [resource, dirty]);
  const availableSourceIds = JSON.stringify(resource?.body.resourceIds ?? []);
  useEffect(() => {
    setSourceIds(
      resource?.kind === 'source' ? [id] : (JSON.parse(availableSourceIds) as string[]).slice(0, 20)
    );
  }, [id, resource?.kind, availableSourceIds]);
  if (access.isPending) return <p role="status">Notebook wird geladen …</p>;
  if (access.isError || !resource)
    return <p role="alert">Notebook oder Zugriff nicht mehr verfügbar.</p>;
  const editable = access.data.role !== 'viewer';
  const ids = resource.kind === 'source' ? [id] : ((resource.body.resourceIds ?? []) as string[]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (useAuthStore.getState().user?.id === owner)
        await cache.invalidateQueries({ queryKey: ['assistant'] });
    } catch (failure) {
      if (useAuthStore.getState().user?.id === owner)
        setError(failure instanceof Error ? failure.message : 'Änderung fehlgeschlagen');
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  const availableModels = (models.data ?? []).flatMap((provider) =>
    provider.models.map((name) => ({
      value: provider.id + '\n' + name,
      title: provider.name + ' · ' + name,
    }))
  );
  const selectedModel =
    model ||
    availableModels.find((entry) => /glm-5[.]3-flash/i.test(entry.value))?.value ||
    availableModels[0]?.value ||
    '';
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {access.data.ownerEmail} ·{' '}
        {access.data.role === 'owner' ? 'Besitzer' : editable ? 'Bearbeiten' : 'Lesen'} · Revision{' '}
        {resource.revision}
      </p>
      <input
        aria-label="Wissenstitel"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={!editable || busy}
        className="workspace-field w-full rounded-xl border p-3 text-xl"
      />
      <textarea
        aria-label={resource.kind === 'source' ? 'Quellentext' : 'Notebooknotizen'}
        placeholder={resource.kind === 'source' ? 'Quellentext' : 'Notizen'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!editable || busy}
        rows={8}
        className="workspace-field w-full rounded-xl border p-3"
      />
      {editable && (
        <Button
          disabled={busy || !dirty || !title.trim()}
          onClick={() =>
            void action(async () => {
              const result = await api.put<{ data: Access }>(
                `/api/assistant/libraries/${id}/content`,
                {
                  title,
                  expectedRevision: base?.revision,
                  ...(resource.kind === 'source' ? { text } : { notes: text }),
                }
              );
              setBase(result.data.data.resource);
              cache.setQueryData(key, result.data.data);
            })
          }
        >
          Änderungen speichern
        </Button>
      )}
      {base && resource.revision !== base.revision && dirty && (
        <p role="status">Inzwischen geändert · Dein Entwurf bleibt erhalten.</p>
      )}
      <h2 className="font-semibold">Quellen für die nächste Frage · {sourceIds.length}/20</h2>
      <SourceSelection ids={ids} value={sourceIds} onChange={setSourceIds} />
      {access.data.role === 'owner' && resource.kind === 'collection' && (
        <details>
          <summary className="cursor-pointer">Quellen bearbeiten</summary>
          <ResourcePicker
            label="Quellensammlung"
            kind="source"
            value={ids}
            maximum={100}
            onChange={(next) =>
              void action(async () => {
                await api.patch(`/api/assistant/collections/${id}`, {
                  title: resource.title,
                  expectedRevision: resource.revision,
                  body: { ...resource.body, resourceIds: next, favoriteIds: [] },
                });
              })
            }
          />
        </details>
      )}
      <select
        aria-label="Notebookmodell"
        value={selectedModel}
        onChange={(e) => setModel(e.target.value)}
        className="workspace-field w-full rounded-xl border p-3"
      >
        {availableModels.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.title}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          aria-label="Frage an das Notebook"
          placeholder="Frage an deine Quellen"
          className="workspace-field min-w-0 flex-1 rounded-xl border p-3"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Button
          disabled={busy || !prompt.trim() || !sourceIds.length || !selectedModel}
          onClick={() =>
            void action(async () => {
              const [providerId, chosenModel] = selectedModel.split('\n');
              const response = await api.post<{ data: AssistantResource }>(
                `/api/assistant/libraries/${id}/chat`,
                {
                  commandId: crypto.randomUUID(),
                  providerId,
                  model: chosenModel,
                  sourceIds,
                  prompt,
                }
              );
              if (useAuthStore.getState().user?.id === owner)
                navigate(`/chat/model/${response.data.data.id}`);
            })
          }
        >
          Fragen
        </Button>
      </div>
      <Link to="/assistant/sources" className="text-sm underline">
        Quellen importieren
      </Link>
      {access.data.role === 'owner' && (
        <details>
          <summary className="cursor-pointer">Zugriff verwalten</summary>
          <div className="space-y-3 py-3">
            {members.data?.map((member) => (
              <div className="flex flex-wrap items-center gap-2" key={member.email}>
                <span className="min-w-0 break-all">
                  {member.email} · {member.role === 'editor' ? 'Bearbeiten' : 'Lesen'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      api.put(`/api/assistant/libraries/${id}/members`, {
                        expectedRevision: resource.revision,
                        email: member.email,
                        role: null,
                      })
                    )
                  }
                >
                  Entziehen
                </Button>
              </div>
            ))}
            <input
              aria-label="Plum-Konto freigeben"
              placeholder="E-Mail-Adresse"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="workspace-field w-full rounded-xl border p-3"
            />
            <select
              aria-label="Bibliotheksrolle"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="workspace-field rounded-xl border p-3"
            >
              <option value="viewer">Lesen</option>
              <option value="editor">Bearbeiten</option>
            </select>
            <Button
              disabled={busy || !email.includes('@')}
              onClick={() =>
                void action(async () => {
                  await api.put(`/api/assistant/libraries/${id}/members`, {
                    expectedRevision: resource.revision,
                    email,
                    role,
                  });
                  setEmail('');
                })
              }
            >
              Freigeben
            </Button>
          </div>
        </details>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
function SourceSelection({
  ids,
  value,
  onChange,
}: {
  ids: string[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const owner = useAuthStore((state) => state.user?.id);
  const refs = useQuery({
    queryKey: ['assistant', 'notebook-source-titles', owner, ids],
    queryFn: async () =>
      (
        await api.post<{ data: { id: string; title: string; kind: string }[] }>(
          '/api/assistant/references',
          { ids }
        )
      ).data.data,
    enabled: !!ids.length,
  });
  return (
    <div className="max-h-64 space-y-2 overflow-auto">
      {refs.data
        ?.filter((item) => item.kind === 'source')
        .map((source) => (
          <label className="flex items-start gap-3" key={source.id}>
            <input
              type="checkbox"
              className="mt-1"
              checked={value.includes(source.id)}
              disabled={!value.includes(source.id) && value.length >= 20}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...value, source.id] : value.filter((id) => id !== source.id)
                )
              }
            />
            <span className="min-w-0 break-words">
              {source.title}{' '}
              <Link to={`/assistant/knowledge?resource=${source.id}`} className="text-xs underline">
                Öffnen
              </Link>
            </span>
          </label>
        ))}
    </div>
  );
}
