import { orderChatApiProviders } from '@/lib/chatApiProviders';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  AssistantApiProvider,
  AssistantResource,
  AssistantDocumentPath,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { deliverAssistant } from '@/services/assistantOutbox';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { ResourcePicker } from './ResourcePicker';
import { AssistantOutbox } from './AssistantOutbox';
import { ChatImageInput, uploadChatAttachments } from './ChatImages';
import { LiveImageCapture } from './LiveImageCapture';

export function ApiChatStarter({
  artifactEdit,
  compact = false,
  chatPathPrefix = '/chat/model',
}: {
  compact?: boolean;
  chatPathPrefix?: '/chat/model' | '/mini/chat';
  artifactEdit?: {
    artifactId: string;
    revision: number;
    start: number;
    end: number;
    selectedText: string;
    documentPath?: AssistantDocumentPath;
  };
} = {}) {
  const account = useAuthStore((state) => state.user?.id),
    navigate = useNavigate();
  const providers = useQuery({
    queryKey: ['assistant', 'api-chat-providers', account],
    select: orderChatApiProviders,
    queryFn: async () =>
      (await api.get<{ data: AssistantApiProvider[] }>('/api/assistant/api-chat-providers')).data
        .data,
  });
  const [provider, setProvider] = useState(''),
    [model, setModel] = useState(''),
    [profile, setProfile] = useState<string[]>([]),
    [project, setProject] = useState<string[]>([]),
    [sources, setSources] = useState<string[]>([]),
    [prompt, setPrompt] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState<AssistantResource | null>(null);
  const [research, setResearch] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(!compact);
  const chosen = providers.data?.find((item) => item.id === provider) ?? providers.data?.[0];
  const actualModel = chosen?.models.includes(model) ? model : (chosen?.models[0] ?? '');
  const start = async () => {
    const captured = account;
    setBusy(true);
    setError('');
    try {
      if (!chosen || !actualModel)
        throw new Error('Zuerst eine persönliche API-Verbindung mit Modellen einrichten.');
      const resource =
        created ??
        (
          (await deliverAssistant(
            '/api/assistant/api-chats',
            {
              title: prompt.trim().slice(0, 80) || 'Neuer Modellchat',
              providerId: chosen.id,
              model: actualModel,
              profileId: profile[0] ?? null,
              projectId: temporary ? null : (project[0] ?? null),
              sourceIds: sources,
              ...(artifactEdit ? { artifactEdit } : {}),
              ...(research ? { workflow: 'research' } : {}),
              temporary,
            },
            'Modellchat erstellen'
          )) as { data: { data: AssistantResource } }
        ).data.data;
      if (useAuthStore.getState().user?.id !== captured) return;
      setCreated(resource);
      const { imageAssetIds, documentSourceIds } = await uploadChatAttachments(resource.id, images);
      if (useAuthStore.getState().user?.id !== captured) return;
      if (prompt.trim())
        await deliverAssistant(
          `/api/assistant/api-chats/${resource.id}/turns`,
          {
            expectedRevision: resource.revision,
            prompt: prompt.trim(),
            imageAssetIds,
            documentSourceIds,
          },
          'Erste Nachricht im Modellchat',
          { expiresAt: resource.body.temporary ? String(resource.body.expiresAt) : undefined }
        );
      if (useAuthStore.getState().user?.id !== captured) return;
      navigate(`${chatPathPrefix}/${resource.id}`);
    } catch (failure) {
      if (useAuthStore.getState().user?.id === captured)
        setError(
          failure instanceof Error ? failure.message : 'Modellchat konnte nicht gestartet werden'
        );
    } finally {
      if (useAuthStore.getState().user?.id === captured) setBusy(false);
    }
  };
  return (
    <form
      className="space-y-4 rounded-lg border bg-card p-4 md:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <h2 className="font-semibold">
        {artifactEdit ? 'Änderung für die Textauswahl vorschlagen' : 'Ein neues Modellgespräch'}
      </h2>
      {artifactEdit && (
        <p className="text-sm text-muted-foreground">
          Der Vorschlag ersetzt erst nach deiner Sichtprüfung genau diese Auswahl in Revision{' '}
          {artifactEdit.revision}. Andere Textstellen bleiben erhalten.
        </p>
      )}
      {compact && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {chosen
              ? `${chosen.name} · ${actualModel} · eigene API-Verbindung`
              : providers.isPending
                ? 'API-Verbindung wird geladen …'
                : providers.isError
                  ? 'API-Verbindungen konnten nicht geladen werden.'
                  : 'Keine API-Verbindung eingerichtet. Modelloptionen öffnen und Verbindung einrichten.'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            Modell, Profil und Dokumentquellen
          </Button>
        </div>
      )}
      {(!compact || optionsOpen) && (
        <>
          <p className="text-sm text-muted-foreground">
            Persönliche API-Verbindung, Profil und Dokumentquellen. Die Verbindung rechnet
            API-Nutzung gemäss deinem Anbieter ab. Für Browser-, Datei- und Gerätewerkzeuge wähle
            ein Agentengespräch.
          </p>
          {providers.isPending ? (
            <p role="status">API-Verbindungen werden geladen …</p>
          ) : providers.isError ? (
            <p role="alert">API-Verbindungen konnten nicht geladen werden.</p>
          ) : !chosen ? (
            <p>
              Unter{' '}
              <Link to="/settings" className="underline">
                Einstellungen → Provider
              </Link>{' '}
              eine API-Verbindung mit Schlüssel einrichten.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid min-w-0 gap-2 text-sm">
                API-Verbindung
                <select
                  disabled={!!created || busy}
                  className="min-w-0 max-w-full rounded-md border bg-background p-2"
                  value={chosen.id}
                  onChange={(event) => {
                    setProvider(event.target.value);
                    setModel('');
                  }}
                >
                  {providers.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid min-w-0 gap-2 text-sm">
                API-Modell
                <select
                  disabled={!!created || busy}
                  className="min-w-0 max-w-full rounded-md border bg-background p-2"
                  value={actualModel}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {chosen.models.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {!created && (
            <>
              <ResourcePicker
                label="Profil"
                kind="profile"
                value={profile}
                maximum={1}
                onChange={setProfile}
              />
              <ResourcePicker
                label="Projekt"
                kind="project"
                value={project}
                maximum={1}
                onChange={setProject}
              />
              <ResourcePicker
                label="Dokumentquellen"
                kind="source"
                value={sources}
                maximum={20}
                onChange={setSources}
              />
            </>
          )}
          {!artifactEdit && !created && (
            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={research}
                onChange={(event) => {
                  setResearch(event.target.checked);
                  if (event.target.checked) setTemporary(false);
                  if (event.target.checked) setImages([]);
                }}
              />
              Quellengebundene Dokumentrecherche
            </label>
          )}
          {!artifactEdit && !created && (
            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={temporary}
                onChange={(event) => {
                  setTemporary(event.target.checked);
                  if (event.target.checked) setResearch(false);
                }}
              />
              Temporäres Modellgespräch (24 Stunden)
            </label>
          )}
          {temporary && (
            <p className="text-sm text-muted-foreground">
              Ohne gespeicherte Erinnerungen oder Projektgedächtnis. Plum löscht den lokalen Verlauf
              und Profilkontext nach 24 Stunden; Browserentwürfe werden beim nächsten Öffnen
              bereinigt. Verbrauchszähler bleiben inhaltsfrei erhalten. Der API-Anbieter hat eigene
              Aufbewahrungsregeln.
            </p>
          )}
          {research && (
            <p className="text-sm text-muted-foreground">
              Mindestens eine Dokumentquelle auswählen. Plum vergleicht passende Textauszüge,
              erstellt einen Bericht und führt ein Belegregister mit exakten Zitaten. Für eine
              Webrecherche mit Browserwerkzeugen wähle ein Agentengespräch.
            </p>
          )}
        </>
      )}
      <label className="grid gap-2 text-sm">
        Deine Nachricht
        <textarea
          required
          maxLength={20000}
          className="min-h-32 rounded-md border bg-background p-3"
          value={prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={
            artifactEdit ? 'Wie soll sich diese Textstelle ändern?' : 'Wobei kann Plum helfen?'
          }
        />
      </label>
      {created && (
        <p>
          Gespräch angelegt. Eine erneute Zustellung verwendet dieses Gespräch und dieselbe
          Nachrichtenkennung.
        </p>
      )}
      {!artifactEdit && !research && (
        <div className="space-y-3">
          <ChatImageInput files={images} onChange={setImages} disabled={busy} />
          <LiveImageCapture
            scopeKey={`${account}:starter:${temporary}`}
            disabled={busy}
            remaining={4 - images.length}
            onCapture={(file) =>
              setImages((current) => (current.length < 4 ? [...current, file] : current))
            }
          />
        </div>
      )}
      <Button disabled={busy || !chosen || !actualModel || (research && !sources.length)}>
        {busy
          ? 'Gespräch startet …'
          : artifactEdit
            ? 'Änderung vorschlagen lassen'
            : research
              ? 'Dokumentrecherche starten'
              : 'Modellgespräch starten'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AssistantOutbox />
    </form>
  );
}
