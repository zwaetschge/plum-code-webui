import { orderChatApiProviders } from '@/lib/chatApiProviders';
import { ComposerPlusMenu } from '@/components/presets/ComposerPlusMenu';
import { WritingStyleMenu } from '@/components/presets/WritingStyleMenu';
import { usePersonalization } from '@/components/assistant/usePersonalization';
import { ArrowUp, Copy, Mic, SlidersHorizontal } from 'lucide-react';
import { LiveImageCapture } from '@/components/assistant/LiveImageCapture';
import { ScreenHistoryDisclosure } from '@/components/assistant/ScreenHistory';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AssistantApiProvider,
  AssistantApiTurn,
  AssistantResource,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { deliverAssistant } from '@/services/assistantOutbox';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ResourcePicker } from '@/components/assistant/ResourcePicker';
import { VoiceComposer } from '@/components/assistant/VoiceComposer';
import { AssistantOutbox } from '@/components/assistant/AssistantOutbox';
import { ReadAloudButton } from '@/components/assistant/ReadAloud';
import {
  ModelEffortPicker,
  effortPayload,
  useEffortChoice,
} from '@/components/assistant/ModelEffortPicker';
import { SelectionReview } from '@/components/assistant/SelectionReview';
import { ResearchPreview } from '@/components/assistant/ResearchPreview';
import {
  ChatImageInput,
  ChatImageStrip,
  uploadChatImages,
} from '@/components/assistant/ChatImages';

const statuses = {
  running: 'Antwortet …',
  completed: 'Antwort abgeschlossen',
  cancelled: 'Gestoppt',
  failed: 'Fehlgeschlagen',
  interrupted: 'Unterbrochen',
};
export function ApiChatPage() {
  const { id } = useParams(),
    owner = useAuthStore((state) => state.user?.id),
    navigate = useNavigate(),
    location = useLocation(),
    cache = useQueryClient();
  const chatHome = location.pathname.startsWith('/mini/') ? '/mini' : '/chat';
  const chatPrefix = chatHome === '/mini' ? '/mini/chat' : '/chat/model';
  const scroll = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [tools, setTools] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false),
    [copied, setCopied] = useState('');
  const [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [older, setOlder] = useState<AssistantApiTurn[]>([]),
    [settings, setSettings] = useState(false),
    [images, setImages] = useState<File[]>([]),
    [existingImages, setExistingImages] = useState<string[]>([]),
    [configuration, setConfiguration] = useState<{
      providerId: string;
      model: string;
      profile: string[];
      sources: string[];
    } | null>(null);
  const scope = `${owner}:${id}`,
    scopeRef = useRef(scope);
  scopeRef.current = scope;
  const latest = useQuery({
    queryKey: ['assistant', 'api-chat', id, owner],
    enabled: !!id,
    queryFn: async () =>
      (
        await api.get<{ data: { chat: AssistantResource; turns: AssistantApiTurn[] } }>(
          `/api/assistant/api-chats/${id}/turns`
        )
      ).data.data,
    refetchInterval: (query) =>
      query.state.data?.turns.some((turn) => turn.status === 'running') ? 500 : 5000,
    retry: false,
  });
  useEffect(() => {
    if (followLatest.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [latest.data]);
  useEffect(() => {
    followLatest.current = true;
    setTools(false);
    setVoiceOpen(false);
    setCopied('');
  }, [scope]);
  const [effort, setEffort] = useEffortChoice();
  const speechVoice = (profileVoice: unknown) =>
    preferences.voiceName || String(profileVoice ?? 'Rufus Beck');
  const providers = useQuery({
    queryKey: ['assistant', 'api-chat-providers', owner],
    select: orderChatApiProviders,
    queryFn: async () =>
      (await api.get<{ data: AssistantApiProvider[] }>('/api/assistant/api-chat-providers')).data
        .data,
  });
  useEffect(() => {
    setDraft('');
    setError('');
    setBusy(false);
    setOlder([]);
    setSettings(false);
    setConfiguration(null);
    setImages([]);
    setExistingImages([]);
  }, [scope]);
  const chat = latest.data?.chat,
    turns = [
      ...new Map([...older, ...(latest.data?.turns ?? [])].map((turn) => [turn.id, turn])).values(),
    ].sort((a, b) => a.seq - b.seq),
    running = turns.find((turn) => turn.status === 'running');
  const { preferences } = usePersonalization();
  const spoken = turns.filter((turn) => turn.status === 'completed' && turn.response).at(-1);
  const profile = useQuery({
    queryKey: ['assistant', 'api-profile', chat?.body.profileId, chat?.body.profileRevision, owner],
    enabled: !!chat?.body.profileId,
    queryFn: async () =>
      (
        await api.get<{ data: AssistantResource }>(
          `/api/assistant/profiles/${chat?.body.profileId}?revision=${chat?.body.profileRevision}`
        )
      ).data.data,
  });
  const invoke = async (operation: () => Promise<void>) => {
    const captured = scope;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (scopeRef.current === captured) await latest.refetch();
    } catch (failure) {
      if (scopeRef.current === captured)
        setError(failure instanceof Error ? failure.message : 'Aktion fehlgeschlagen');
    } finally {
      if (scopeRef.current === captured) setBusy(false);
    }
  };
  const transmit = async (text: string) => {
    if (!chat) throw new Error('Gespräch ist nicht verfügbar');
    const captured = scope;
    const imageAssetIds = [...existingImages, ...(await uploadChatImages(chat.id, images))];
    if (scopeRef.current !== captured) throw new Error('Das Gespräch wurde gewechselt');
    const result = await deliverAssistant(
      `/api/assistant/api-chats/${chat.id}/turns`,
      {
        expectedRevision: chat.revision,
        prompt: text.trim(),
        imageAssetIds,
        ...effortPayload(effort),
      },
      'Nachricht im Modellchat',
      { expiresAt: chat.body.temporary ? String(chat.body.expiresAt) : undefined }
    );
    if (scopeRef.current !== captured) throw new Error('Das Gespräch wurde gewechselt');
    await latest.refetch();
    if (scopeRef.current === captured) {
      setImages([]);
      setExistingImages([]);
    }
    return result;
  };
  const send = async () => {
    if (!chat || !draft.trim() || running || busy) return;
    followLatest.current = true;
    const captured = scope,
      text = draft.trim();
    await invoke(async () => {
      await transmit(text);
      if (scopeRef.current === captured)
        setDraft((current) => (current.trim() === text ? '' : current));
    });
  };
  const branch = (item: AssistantApiTurn, includeAnswer: boolean) =>
    void invoke(async () => {
      const result = (
        (await deliverAssistant(
          `/api/assistant/api-chats/${id}/branches`,
          { turnId: item.id, includeAnswer },
          'Modellgespräch abzweigen'
        )) as {
          data: { data: { chat: AssistantResource; prompt: string; imageAssetIds?: string[] } };
        }
      ).data.data;
      if (scopeRef.current === scope)
        navigate(`${chatPrefix}/${result.chat.id}`, {
          state: { draft: result.prompt, imageAssetIds: result.imageAssetIds ?? [], owner },
        });
    });
  // An edit creates a distinct conversation; the original message is retained.
  useEffect(() => {
    if (location.state?.owner === owner && typeof location.state?.draft === 'string') {
      setDraft(location.state.draft);
      setExistingImages(
        Array.isArray(location.state.imageAssetIds)
          ? location.state.imageAssetIds
              .filter((value: unknown) => typeof value === 'string')
              .slice(0, 4)
          : []
      );
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, owner, navigate]);
  const saveAnswer = (item: AssistantApiTurn, kind: 'document' | 'task' | 'memory' | 'research') =>
    void invoke(async () => {
      const goal = kind === 'task' ? draft.trim() || item.prompt : undefined;
      const result = (
        (await deliverAssistant(
          `/api/assistant/api-chats/${id}/results`,
          { turnId: item.id, kind, ...(goal ? { goal } : {}) },
          kind === 'memory'
            ? 'Antwort bewusst als persönliche Erinnerung speichern'
            : 'Antwort übernehmen'
        )) as { data: { data: AssistantResource } }
      ).data.data;
      if (scopeRef.current === scope)
        navigate(
          `${kind === 'task' ? '/assistant/tasks' : `/assistant/${kind === 'memory' ? 'memory' : 'artifacts'}`}?resource=${result.id}`
        );
    });
  if (latest.isPending)
    return (
      <main className="p-4">
        <p role="status">Modellgespräch wird geladen …</p>
      </main>
    );
  if (latest.isError || !chat)
    return (
      <main className="space-y-3 p-4">
        <p role="alert">
          {latest.error instanceof Error
            ? latest.error.message
            : 'Dieses Modellgespräch ist nicht verfügbar.'}
        </p>
        <Link to={chatHome} className="underline">
          Zurück zu Plum Chat
        </Link>
      </main>
    );
  const chosen = providers.data?.find(
    (provider) => provider.id === (configuration?.providerId ?? chat.body.providerId)
  );
  const openPersonalization = () => {
    setSettings(true);
    setConfiguration({
      providerId: String(chat.body.providerId),
      model: String(chat.body.model),
      profile: chat.body.profileId ? [String(chat.body.profileId)] : [],
      sources: (chat.body.sourceIds ?? []) as string[],
    });
  };
  return (
    <main className="plum-api-conversation">
      <header className="plum-chat-header">
        <div>
          <Link to={chatHome} className="text-xs text-muted-foreground">
            Plum Chat
          </Link>
          <h1 className="max-w-[50vw] truncate text-base font-medium">{chat.title}</h1>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Gesprächsoptionen"
          disabled={!!running || busy}
          onClick={openPersonalization}
        >
          <SlidersHorizontal size={17} />
        </Button>
      </header>
      <div
        ref={scroll}
        className="plum-api-scroll"
        onScroll={() => {
          const el = scroll.current;
          if (el) followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        <div className="plum-api-content">
          {!!chat.body.temporary && (
            <p className="rounded-md border p-3 text-sm">
              Temporäres Gespräch · lokale Löschung ab{' '}
              {new Date(String(chat.body.expiresAt)).toLocaleString('de-CH')}. Dauerhafte
              Ergebnisse, Tasks und Erinnerungen sind deaktiviert. Externe Anbieter behalten ihre
              eigenen Aufbewahrungsregeln.
            </p>
          )}
          <Dialog open={settings} onOpenChange={setSettings}>
            <DialogContent className="plum-assistant-shell plum-chat-dialog">
              <DialogTitle>Gespräch personalisieren</DialogTitle>
              <DialogDescription>
                Modell, Profil und Quellen für neue Nachrichten.
              </DialogDescription>
              {configuration && (
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void invoke(async () => {
                      await api.patch(`/api/assistant/api-chats/${id}`, {
                        title: chat.title,
                        providerId: configuration.providerId,
                        model: configuration.model,
                        profileId: configuration.profile[0] ?? null,
                        sourceIds: configuration.sources,
                        expectedRevision: chat.revision,
                      });
                      if (scopeRef.current === scope) {
                        setSettings(false);
                        void cache.invalidateQueries({ queryKey: ['assistant', 'api-chats'] });
                      }
                    });
                  }}
                >
                  <label className="grid min-w-0 gap-2 text-sm">
                    API-Verbindung
                    <select
                      className="min-w-0 rounded-md border bg-background p-2"
                      value={configuration.providerId}
                      onChange={(event) => {
                        const provider = providers.data?.find(
                          (item) => item.id === event.target.value
                        );
                        setConfiguration({
                          ...configuration,
                          providerId: event.target.value,
                          model: provider?.models[0] ?? '',
                        });
                      }}
                    >
                      {providers.data?.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-2 text-sm">
                    API-Modell
                    <select
                      className="min-w-0 rounded-md border bg-background p-2"
                      value={configuration.model}
                      onChange={(event) =>
                        setConfiguration({ ...configuration, model: event.target.value })
                      }
                    >
                      {chosen?.models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ResourcePicker
                    label="Profil für neue Nachrichten"
                    kind="profile"
                    value={configuration.profile}
                    maximum={1}
                    onChange={(profile) => setConfiguration({ ...configuration, profile })}
                  />
                  <ResourcePicker
                    label="Dokumentquellen"
                    kind="source"
                    value={configuration.sources}
                    maximum={20}
                    onChange={(sources) => setConfiguration({ ...configuration, sources })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Speichern bindet die aktuelle Profilrevision für kommende Nachrichten. Frühere
                    Antworten behalten ihr damaliges Profil und ihren Quellenstand.
                  </p>
                  <Button disabled={busy || !configuration.model}>
                    Personalisierung speichern
                  </Button>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {(turns[0]?.seq ?? 1) > 1 && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void invoke(async () => {
                  const result = (
                    await api.get<{ data: { turns: AssistantApiTurn[] } }>(
                      `/api/assistant/api-chats/${id}/turns?beforeSeq=${turns[0]!.seq}`
                    )
                  ).data.data;
                  if (scopeRef.current === scope) {
                    setOlder((previous) => [...result.turns, ...previous]);
                  }
                })
              }
            >
              Ältere Beiträge laden
            </Button>
          )}
          <section className="space-y-6" aria-label="Gesprächsverlauf">
            {!turns.length && <p>Stelle deine erste Frage.</p>}
            {turns.map((item) => (
              <article key={item.id} className="min-w-0 space-y-3">
                <div className="plum-api-user">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Du</p>
                  <p className="whitespace-pre-wrap break-words">{item.prompt}</p>
                  {!!item.imageAssetIds?.length && (
                    <ChatImageStrip chatId={chat.id} ids={item.imageAssetIds} />
                  )}
                </div>
                <div className="plum-api-answer">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Plum{item.status !== 'completed' ? ` · ${statuses[item.status]}` : ''}
                  </p>
                  {chat.body.workflow === 'research' && item.status === 'completed' ? (
                    <ResearchPreview
                      response={item.response}
                      busy={busy}
                      onSave={() => saveAnswer(item, 'research')}
                    />
                  ) : (
                    <div className="prose prose-sm max-w-none break-words dark:prose-invert">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.response || (item.status === 'running' ? '…' : 'Keine Antwort')}
                      </ReactMarkdown>
                    </div>
                  )}
                  {item.error && (
                    <p
                      className="mt-3 text-sm"
                      role={item.status === 'failed' ? 'alert' : 'status'}
                    >
                      {item.error}
                    </p>
                  )}
                  {item.usage && (
                    <details className="text-xs text-muted-foreground mt-3">
                      <summary className="cursor-pointer">Modell und Verbrauch</summary>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {item.usage.input + item.usage.cached + item.usage.cacheWrite} Eingabetokens
                        · {item.usage.output} Ausgabetokens ·{' '}
                        {item.usage.costUsd === null
                          ? 'Preis unbekannt'
                          : `API-Äquivalent $${item.usage.costUsd.toFixed(5)}`}{' '}
                        · {item.model}
                      </p>
                    </details>
                  )}
                  {item.status === 'completed' && !!chat.body.artifactEdit && (
                    <SelectionReview
                      key={`${scope}:${item.id}`}
                      edit={
                        chat.body.artifactEdit as {
                          artifactId: string;
                          revision: number;
                          selectedText: string;
                        }
                      }
                      suggestion={item.response}
                      busy={busy}
                      onApply={(replacement) =>
                        void invoke(async () => {
                          const result = (
                            (await deliverAssistant(
                              `/api/assistant/api-chats/${id}/selection`,
                              { turnId: item.id, replacement },
                              'Geprüfte Textauswahl übernehmen'
                            )) as { data: { data: AssistantResource } }
                          ).data.data;
                          if (scopeRef.current === scope) {
                            void cache.invalidateQueries({ queryKey: ['assistant', 'artifacts'] });
                            navigate(`/assistant/artifacts?resource=${result.id}`);
                          }
                        })
                      }
                    />
                  )}
                  {item.status !== 'running' && !chat.body.temporary && (
                    <div className="plum-message-actions mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(item.response)
                            .then(() => setCopied(item.id))
                            .catch(() => setError('Kopieren fehlgeschlagen.'))
                        }
                      >
                        <Copy size={13} />
                        {copied === item.id ? 'Kopiert' : 'Kopieren'}
                      </Button>
                      {item.response && (
                        <ReadAloudButton
                          text={item.response}
                          voice={speechVoice(profile.data?.body.voice)}
                          language={String(profile.data?.body.language ?? 'German')}
                          onError={setError}
                        />
                      )}
                      <details>
                        <summary className="cursor-pointer rounded-md px-3 py-2 text-xs">
                          Weitere Aktionen
                        </summary>
                        <div className="flex flex-wrap gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => branch(item, false)}
                          >
                            Nachricht bearbeiten / neue Antwort
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => branch(item, true)}
                          >
                            Hier abzweigen
                          </Button>
                          {item.response && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => saveAnswer(item, 'document')}
                              >
                                Als Ergebnis speichern
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => saveAnswer(item, 'task')}
                              >
                                Als Task-Entwurf übernehmen
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => saveAnswer(item, 'memory')}
                              >
                                Als persönliche Erinnerung speichern
                              </Button>
                            </>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>
      <div className="plum-api-footer">
        <form
          className="plum-message-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="block">
            <span className="sr-only">Deine Nachricht</span>
            <textarea
              value={draft}
              maxLength={20000}
              disabled={busy}
              rows={2}
              placeholder="Frag Plum …"
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  window.matchMedia('(min-width: 768px)').matches
                ) {
                  event.preventDefault();
                  if (!running && !busy && draft.trim()) {
                    followLatest.current = true;
                    void send();
                  }
                }
              }}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          {!!existingImages.length && (
            <div className="space-y-2">
              <p className="text-sm">Bildanhänge aus der bearbeiteten Nachricht</p>
              <ChatImageStrip chatId={chat.id} ids={existingImages} />
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setExistingImages([])}
              >
                Übernommene Bilder entfernen
              </Button>
            </div>
          )}
          {tools && chat.body.workflow !== 'research' && !chat.body.artifactEdit && (
            <div className="space-y-3 px-4 pb-3">
              <ChatImageInput
                files={images}
                onChange={setImages}
                disabled={busy || !!running}
                remaining={4 - existingImages.length}
              />
              <LiveImageCapture
                scopeKey={scope}
                disabled={busy || !!running}
                remaining={4 - existingImages.length - images.length}
                onCapture={(file) =>
                  setImages((current) =>
                    current.length + existingImages.length < 4 ? [...current, file] : current
                  )
                }
              />
              <ScreenHistoryDisclosure
                key={scope}
                scopeKey={scope}
                disabled={busy || !!running}
                remaining={4 - existingImages.length - images.length}
                onUse={(files, context) => {
                  setImages((current) =>
                    [...current, ...files].slice(0, 4 - existingImages.length)
                  );
                  setDraft((current) => [current, context].filter(Boolean).join('\n\n'));
                }}
              />
            </div>
          )}
          {voiceOpen && preferences.voiceChat && (
            <div className="px-4 pb-3">
              <VoiceComposer
                scopeKey={scope}
                voice={speechVoice(profile.data?.body.voice)}
                language={String(profile.data?.body.language ?? 'German')}
                text={spoken?.response ?? ''}
                onSend={transmit}
                modelBusy={!!running || busy}
                answerKey={spoken?.id}
                onTranscription={(text) =>
                  setDraft((current) => (current ? current + '\n' + text : text))
                }
              />
            </div>
          )}
          <div className="plum-composer-toolbar">
            <div className="flex gap-1">
              <ComposerPlusMenu
                attachLabel={tools ? 'Anhänge ausblenden' : 'Anhänge und Kamera'}
                attachDisabled={chat.body.workflow === 'research' || !!chat.body.artifactEdit}
                onAttach={() => setTools(!tools)}
              >
                <WritingStyleMenu
                  value={
                    typeof chat.body.writingStyleSkill === 'string'
                      ? chat.body.writingStyleSkill
                      : null
                  }
                  disabled={!!running || busy}
                  onChange={(writingStyleSkill) =>
                    void invoke(async () => {
                      // Built from the stored chat so profile and sources stay as they are.
                      await api.patch(`/api/assistant/api-chats/${id}`, {
                        title: chat.title,
                        providerId: String(chat.body.providerId),
                        model: String(chat.body.model),
                        profileId: chat.body.profileId ? String(chat.body.profileId) : null,
                        sourceIds: (chat.body.sourceIds ?? []) as string[],
                        writingStyleSkill,
                        expectedRevision: chat.revision,
                      });
                      void cache.invalidateQueries({ queryKey: ['assistant', 'api-chats'] });
                    })
                  }
                />
              </ComposerPlusMenu>
            </div>
            <div className="plum-composer-model-tools">
              <ModelEffortPicker
                providers={providers.data ?? []}
                providerId={String(chat.body.providerId)}
                model={String(chat.body.model)}
                disabled={!!running || busy}
                onSelect={(providerId, value) => {
                  // Keep profile and sources as stored on the chat; the options dialog
                  // state is only loaded once it is opened.
                  const profileId = chat.body.profileId ? String(chat.body.profileId) : null;
                  const sourceIds = (chat.body.sourceIds ?? []) as string[];
                  void invoke(async () => {
                    await api.patch(`/api/assistant/api-chats/${id}`, {
                      title: chat.title,
                      providerId,
                      model: value,
                      profileId,
                      sourceIds,
                      expectedRevision: chat.revision,
                    });
                    void cache.invalidateQueries({ queryKey: ['assistant', 'api-chats'] });
                  });
                }}
                effort={effort}
                onEffort={setEffort}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Sprache"
                disabled={!preferences.voiceChat}
                aria-expanded={voiceOpen}
                onClick={() => setVoiceOpen(!voiceOpen)}
              >
                <Mic size={18} />
              </Button>
              {!!images.length && (
                <span className="self-center text-xs text-muted-foreground">
                  {images.length} Bilder
                </span>
              )}
              <Button
                className="plum-send-button"
                size="icon"
                aria-label="Senden"
                disabled={busy || !!running || !draft.trim()}
              >
                <ArrowUp size={18} />
              </Button>
            </div>
            {running && (
              <Button
                type="button"
                variant="outline"
                className="plum-stop-answer"
                disabled={busy}
                onClick={() =>
                  void invoke(async () => {
                    await api.post(`/api/assistant/api-chats/${id}/turns/${running.id}/stop`, {});
                  })
                }
              >
                Antwort stoppen
              </Button>
            )}
          </div>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AssistantOutbox />
      </div>
    </main>
  );
}
