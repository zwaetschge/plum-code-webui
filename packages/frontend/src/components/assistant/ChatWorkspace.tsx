import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantResource, AssistantApiProvider } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ResourcePicker } from './ResourcePicker';

type Collection = 'profiles' | 'projects' | 'sources';
export function ChatWorkspace({
  profileId,
  projectId,
  onProfile,
  onProject,
  disabled,
  providers = [],
  initialOpen = false,
}: {
  profileId: string;
  projectId: string;
  onProfile: (profile: AssistantResource | null) => void;
  onProject: (id: string) => void;
  disabled?: boolean;
  providers?: AssistantApiProvider[];
  initialOpen?: boolean;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    cache = useQueryClient();
  const load = (collection: Collection | 'api-chats') => async () =>
    (await api.get<{ data: AssistantResource[] }>(`/api/assistant/${collection}?limit=100`)).data
      .data;
  const profiles = useQuery({
    queryKey: ['assistant', 'resources', 'profiles', owner],
    queryFn: load('profiles'),
  });
  const projects = useQuery({
    queryKey: ['assistant', 'resources', 'projects', owner],
    queryFn: load('projects'),
  });
  const [open, setOpen] = useState(initialOpen),
    [tab, setTab] = useState<Collection>(
      new URLSearchParams(window.location.search).get('workspace') === 'projects'
        ? 'projects'
        : 'profiles'
    );
  const sources = useQuery({
    queryKey: ['assistant', 'resources', 'sources', owner],
    queryFn: load('sources'),
    enabled: open,
  });
  const chats = useQuery({
    queryKey: ['assistant', 'api-chats', owner],
    queryFn: load('api-chats'),
    enabled: open,
  });
  const [editing, setEditing] = useState<AssistantResource | null>(null),
    [creating, setCreating] = useState(false);
  const [title, setTitle] = useState(''),
    [instructions, setInstructions] = useState(''),
    [description, setDescription] = useState('');
  const [sourceIds, setSourceIds] = useState<string[]>([]),
    [provider, setProvider] = useState(''),
    [model, setModel] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const chosenProject = projects.data?.find((p) => p.id === projectId);
  const edit = (resource: AssistantResource | null) => {
    setEditing(resource);
    setCreating(true);
    setTitle(resource?.title ?? '');
    setInstructions(String(resource?.body[tab === 'sources' ? 'text' : 'instructions'] ?? ''));
    setDescription(String(resource?.body.description ?? ''));
    setSourceIds((resource?.body.sourceIds ?? []) as string[]);
    setProvider(String(resource?.body.apiProviderId ?? ''));
    setModel(String(resource?.body.model ?? ''));
    setError('');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = {
        ...editing?.body,
        ...(tab === 'sources' ? { text: instructions, projectId } : { instructions }),
        ...(tab === 'projects' ? { description } : {}),
        ...(tab === 'profiles'
          ? { sourceIds, model: model || null, apiProviderId: provider || undefined }
          : {}),
      };
      const payload = {
        title: title.trim(),
        body,
        ...(editing ? { expectedRevision: editing.revision } : {}),
      };
      const response = editing
        ? await api.patch<{ data: AssistantResource }>(
            `/api/assistant/${tab}/${editing.id}`,
            payload
          )
        : await api.post<{ data: AssistantResource }>(`/api/assistant/${tab}`, payload);
      if (useAuthStore.getState().user?.id !== owner) return;
      await cache.invalidateQueries({ queryKey: ['assistant'] });
      if (tab === 'profiles') onProfile(response.data.data);
      if (tab === 'projects') onProject(response.data.data.id);
      setCreating(false);
    } catch (e) {
      if (useAuthStore.getState().user?.id === owner)
        setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  };
  const archive = async () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/assistant/${tab}/${editing.id}`, {
        body: JSON.stringify({ expectedRevision: editing.revision }),
      });
      if (useAuthStore.getState().user?.id !== owner) return;
      if (editing.id === profileId) onProfile(null);
      if (editing.id === projectId) onProject('');
      await cache.invalidateQueries({ queryKey: ['assistant'] });
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archivieren fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };
  const rows = tab === 'profiles' ? profiles : tab === 'projects' ? projects : sources;
  return (
    <section aria-label="Assistent und Projekt" className="w-full max-w-3xl space-y-3 text-left">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-[9rem] flex-1 gap-1 text-sm">
          Assistent
          <select
            className="w-full rounded-md border bg-background p-2"
            value={profileId}
            disabled={disabled}
            onChange={(e) => onProfile(profiles.data?.find((p) => p.id === e.target.value) ?? null)}
          >
            <option value="">Plum · Standard</option>
            {profiles.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[9rem] flex-1 gap-1 text-sm">
          Projekt
          <select
            className="w-full rounded-md border bg-background p-2"
            value={projectId}
            disabled={disabled}
            onChange={(e) => onProject(e.target.value)}
          >
            <option value="">Ohne Projekt</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            setCreating(false);
          }}
        >
          Verwalten
        </Button>
      </div>
      {chosenProject && (
        <p className="text-xs text-muted-foreground">
          {chosenProject.title}: Projektanweisungen und zugeordnete Quellen gelten für dieses
          Gespräch.
        </p>
      )}
      {(profiles.isError || projects.isError) && (
        <p role="alert">
          Assistenten oder Projekte konnten nicht geladen werden.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void profiles.refetch();
              void projects.refetch();
            }}
          >
            Erneut versuchen
          </button>
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="plum-assistant-shell plum-chat-dialog content-start gap-4 sm:max-w-2xl">
          <DialogTitle>Assistenten und Projekte</DialogTitle>
          <DialogDescription>
            Eigene Assistenten wie Gems oder Custom GPTs: Anweisungen, Modell und Wissen. Projekte
            bündeln mehrere Gespräche und gemeinsame Quellen.
          </DialogDescription>
          <div className="flex flex-wrap gap-2">
            {(['profiles', 'projects', ...(projectId ? ['sources'] : [])] as Collection[]).map(
              (key) => (
                <Button
                  type="button"
                  variant={tab === key ? 'default' : 'outline'}
                  disabled={busy}
                  key={key}
                  onClick={() => {
                    setTab(key);
                    setCreating(false);
                    setError('');
                  }}
                >
                  {key === 'profiles'
                    ? 'Assistenten'
                    : key === 'projects'
                      ? 'Projekte'
                      : 'Projektquellen'}
                </Button>
              )
            )}
          </div>
          {creating ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label className="grid gap-1 text-sm">
                Name
                <input
                  className="rounded-md border bg-background p-2"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
              </label>
              {tab === 'projects' && (
                <label className="grid gap-1 text-sm">
                  Beschreibung
                  <input
                    className="rounded-md border bg-background p-2"
                    maxLength={30000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={busy}
                  />
                </label>
              )}
              <label className="grid gap-1 text-sm">
                {tab === 'sources' ? 'Quellentext' : 'Anweisungen'}
                <textarea
                  className="min-h-36 rounded-md border bg-background p-2"
                  required={tab === 'sources'}
                  maxLength={tab === 'sources' ? 50000 : 30000}
                  value={instructions}
                  disabled={busy}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </label>
              {tab === 'profiles' && (
                <>
                  <label className="grid gap-1 text-sm">
                    Bevorzugte API-Verbindung
                    <select
                      className="rounded-md border bg-background p-2"
                      value={provider}
                      disabled={busy}
                      onChange={(e) => {
                        setProvider(e.target.value);
                        setModel('');
                      }}
                    >
                      <option value="">Aktuelle Auswahl behalten</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {provider && (
                    <label className="grid gap-1 text-sm">
                      Bevorzugtes Modell
                      <select
                        className="rounded-md border bg-background p-2"
                        value={model}
                        disabled={busy}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <option value="">Standardmodell</option>
                        {providers
                          .find((p) => p.id === provider)
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
                    maximum={20}
                    onChange={setSourceIds}
                  />
                  <p className="text-xs text-muted-foreground">
                    Änderungen gelten für neue Gespräche. Bestehende Gespräche behalten ihre
                    Profilrevision, bis du sie dort aktualisierst.
                  </p>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !title.trim()}>Speichern</Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setCreating(false)}
                >
                  Zurück
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void archive()}
                  >
                    Archivieren
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <>
              <Button type="button" className="justify-self-start" onClick={() => edit(null)}>
                {tab === 'profiles'
                  ? 'Neuer Assistent'
                  : tab === 'projects'
                    ? 'Neues Projekt'
                    : 'Neue Projektquelle'}
              </Button>
              {rows.isPending && <p role="status">Wird geladen …</p>}
              {rows.isError && <p role="alert">Einträge konnten nicht geladen werden.</p>}
              {!rows.isPending &&
                !rows.data?.filter((r) => tab !== 'sources' || r.body.projectId === projectId)
                  .length && (
                  <p className="text-sm text-muted-foreground">
                    Noch keine Einträge. Lege den ersten an.
                  </p>
                )}
              {rows.data
                ?.filter((r) => tab !== 'sources' || r.body.projectId === projectId)
                .map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 border-b py-2">
                    <span className="min-w-0 break-words">{r.title}</span>
                    <div className="flex shrink-0 gap-2">
                      {tab !== 'sources' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (tab === 'profiles') onProfile(r);
                            else onProject(r.id);
                            setOpen(false);
                          }}
                        >
                          Wählen
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`${r.title} bearbeiten`}
                        onClick={() => edit(r)}
                      >
                        Bearbeiten
                      </Button>
                    </div>
                  </div>
                ))}
              {tab === 'projects' && chosenProject && (
                <div className="grid gap-2">
                  <h3 className="font-medium">Gespräche in {chosenProject.title}</h3>
                  {chats.data
                    ?.filter((c) => c.body.projectId === projectId)
                    .map((c) => (
                      <Link
                        className="text-sm underline"
                        to={`/chat/model/${c.id}`}
                        key={c.id}
                        onClick={() => setOpen(false)}
                      >
                        {c.title}
                      </Link>
                    ))}
                  {!chats.data?.some((c) => c.body.projectId === projectId) && (
                    <p className="text-sm text-muted-foreground">
                      Noch keine Gespräche. Wähle das Projekt und sende deine erste Nachricht.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
