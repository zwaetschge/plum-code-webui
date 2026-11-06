import { ChatMemoryControls } from '@/components/assistant/ChatMemoryControls';
import { RealtimeVoice } from '@/components/assistant/RealtimeVoice';
import { ChatWorkbench, ChatTurnDetails } from '@/components/assistant/ChatWorkbench';
import { ChatRichText } from '@/components/assistant/ChatRichText';
import { ChatWebActivity } from '@/components/assistant/ChatWebSources';
import { webToolRunning } from '@/components/assistant/webSources';
import { DynamicUiStateStore } from '@/components/assistant/dynamic-ui/state';
import { orderChatApiProviders } from '@/lib/chatApiProviders';
import { ComposerPlusMenu } from '@/components/presets/ComposerPlusMenu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StepOutContent } from '@/components/motion/StepOutContent';
import { useAmbientSeed } from '@/components/motion/AmbientBackdrop';
import { composerHandoffPending, playComposerHandoff } from '@/lib/motion/flood';
import { transitionArea } from '@/lib/motion/navigation';
import { onFrame, SpringValue } from '@/lib/motion/spring';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { SPRINGS } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils';
import { WritingStyleMenu } from '@/components/presets/WritingStyleMenu';
import { usePersonalization } from '@/components/assistant/usePersonalization';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Mic,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { LiveImageCapture } from '@/components/assistant/LiveImageCapture';
import { ScreenHistoryDisclosure } from '@/components/assistant/ScreenHistory';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import '@/components/assistant/dynamic-ui/dynamic-ui.css';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  uploadChatAttachments,
} from '@/components/assistant/ChatImages';
import { PROJECT_MEMORY, projectMemoryMode } from '@/components/assistant/projectMemory';

// Interactive views pull in the chart library; only messages that have one load it.
const DynamicUi = lazy(() => import('@/components/assistant/dynamic-ui/DynamicUi'));

const statuses = {
  queued: 'Vorgemerkt',
  running: 'Antwortet …',
  completed: 'Antwort abgeschlossen',
  cancelled: 'Gestoppt',
  failed: 'Fehlgeschlagen',
  interrupted: 'Unterbrochen',
};

/** Where each conversation was left when the reader scrolled up; restored on return. */
const scrollMemory = new Map<string, number>();

function ThinkingDots() {
  return (
    <span className="plum-thinking" role="status">
      <span />
      <span />
      <span />
      <span className="sr-only">Plum denkt nach</span>
    </span>
  );
}

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('textarea, input, select, [contenteditable="true"]');

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
  const [away, setAway] = useState(false);
  const awaySeq = useRef(0);
  const restored = useRef('');
  const scrollStop = useRef<(() => void) | null>(null);
  const [tools, setTools] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false),
    [copied, setCopied] = useState(''),
    [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
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
      project: string[];
      sources: string[];
      memoryRead: boolean;
      memoryLearn: boolean;
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
      query.state.data?.turns.some((turn) => turn.status === 'running' || turn.status === 'queued')
        ? 500
        : 5000,
    retry: false,
  });
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !latest.data) return;
    if (restored.current !== scope) {
      // First paint of this conversation: back to where the reader left it, else the end.
      restored.current = scope;
      const saved = scrollMemory.get(scope);
      followLatest.current = saved === undefined;
      setAway(saved !== undefined);
      awaySeq.current = latest.data.turns.at(-1)?.seq ?? 0;
      if (saved !== undefined) {
        element.scrollTop = saved;
        return;
      }
    }
    if (followLatest.current) element.scrollTop = element.scrollHeight;
  }, [latest.data, scope]);
  useEffect(() => {
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
    running = turns.find((turn) => turn.status === 'running' || turn.status === 'queued');
  // The store lifetime follows the conversation, independent of its revisions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dynamicUiState = useMemo(() => new DynamicUiStateStore(), [chat?.id]);
  // Turns already there when a conversation opens stay still; later ones rise in.
  // After the start-page handoff the first turn rises too.
  const baseline = useRef<{ scope: string; ids: Set<string> } | null>(null);
  if (latest.data && baseline.current?.scope !== scope)
    baseline.current = {
      scope,
      ids: new Set(composerHandoffPending() ? [] : latest.data.turns.map((turn) => turn.id)),
    };
  const fresh = (turnId: string) =>
    baseline.current?.scope === scope && !baseline.current.ids.has(turnId);
  // A cached conversation is swapped by the view transition; one that loads gets an entrance.
  const entrance = useRef<{ scope: string; animate: boolean } | null>(null);
  if (entrance.current?.scope !== scope) entrance.current = { scope, animate: !latest.data };
  const statusSeen = useRef<{ scope: string; statuses: Map<string, string> }>({
    scope,
    statuses: new Map(),
  });
  const [shine, setShine] = useState('');
  useEffect(() => {
    const seen = statusSeen.current;
    if (seen.scope !== scope) {
      seen.scope = scope;
      seen.statuses = new Map();
    }
    for (const turn of latest.data?.turns ?? []) {
      if (seen.statuses.get(turn.id) === 'running' && turn.status === 'completed')
        setShine(turn.id);
      seen.statuses.set(turn.id, turn.status);
    }
  }, [latest.data, scope]);
  useEffect(() => {
    if (!shine) return;
    const timer = window.setTimeout(() => setShine(''), 1000);
    return () => window.clearTimeout(timer);
  }, [shine]);
  const unseen = away ? turns.filter((turn) => turn.seq > awaySeq.current).length : 0;
  const stopScroll = () => {
    scrollStop.current?.();
    scrollStop.current = null;
  };
  const scrollToLatest = () => {
    const element = scroll.current;
    if (!element) return;
    followLatest.current = true;
    setAway(false);
    scrollMemory.delete(scope);
    stopScroll();
    if (prefersReducedMotion()) {
      element.scrollTop = element.scrollHeight;
      return;
    }
    const position = new SpringValue(element.scrollTop);
    const cancel = () => stopScroll();
    element.addEventListener('wheel', cancel, { once: true, passive: true });
    element.addEventListener('touchstart', cancel, { once: true, passive: true });
    const unsubscribe = onFrame((dt) => {
      // The answer may keep growing; aim at the current end every frame.
      position.setTarget(element.scrollHeight - element.clientHeight, SPRINGS.scroll);
      element.scrollTop = position.step(dt);
      if (position.settled) {
        scrollStop.current = null;
        return false;
      }
    });
    scrollStop.current = () => {
      unsubscribe();
      element.removeEventListener('wheel', cancel);
      element.removeEventListener('touchstart', cancel);
    };
  };
  useEffect(() => () => scrollStop.current?.(), []);
  const composerRef = useCallback((node: HTMLFormElement | null) => playComposerHandoff(node), []);
  // Alt+↑/↓ walks the turns; Enter reaches a turn's actions, Escape returns to the composer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (isTextField(event.target)) return;
      const articles = Array.from(
        scroll.current?.querySelectorAll<HTMLElement>('article[data-turn]') ?? []
      );
      if (!articles.length) return;
      event.preventDefault();
      const current = articles.findIndex((article) => article.contains(document.activeElement));
      const next =
        current < 0
          ? event.key === 'ArrowUp'
            ? articles.length - 1
            : 0
          : Math.max(
              0,
              Math.min(articles.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1))
            );
      const target = articles[next]!;
      target.focus({ preventScroll: true });
      target.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const { preferences } = usePersonalization();
  useAmbientSeed(String(latest.data?.chat.body.profileId ?? id ?? 'plum-welcome'));
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
  const workspaceProject = useQuery({
    queryKey: ['assistant', 'workspace-project', chat?.body.projectId, owner],
    enabled: !!chat?.body.projectId,
    queryFn: async () =>
      (
        await api.get<{ data: AssistantResource }>(
          '/api/assistant/projects/' + chat?.body.projectId
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
  // Voice-mode turns tell Plum it is being spoken to; the server picks the model.
  const transmit = async (text: string, voice = false) => {
    if (!chat) throw new Error('Gespräch ist nicht verfügbar');
    const captured = scope;
    const attachments = await uploadChatAttachments(chat.id, images);
    const imageAssetIds = [...existingImages, ...attachments.imageAssetIds];
    if (scopeRef.current !== captured) throw new Error('Das Gespräch wurde gewechselt');
    const result = await deliverAssistant(
      `/api/assistant/api-chats/${chat.id}/turns`,
      {
        expectedRevision: chat.revision,
        prompt: text.trim(),
        imageAssetIds,
        documentSourceIds: attachments.documentSourceIds,
        ...(voice ? { voice: true } : effortPayload(effort)),
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
  // ChatGPT semantics: a new answer (or an edited question) replaces this turn in the
  // same chat; the previous version stays reachable through the version switcher.
  const regenerate = (item: AssistantApiTurn, prompt = item.prompt) => {
    if (!chat || running || busy || !prompt.trim()) return;
    followLatest.current = true;
    void invoke(async () => {
      await deliverAssistant(
        `/api/assistant/api-chats/${chat.id}/turns`,
        {
          expectedRevision: chat.revision,
          prompt: prompt.trim(),
          imageAssetIds: item.imageAssetIds ?? [],
          regenerate: item.id,
          ...effortPayload(effort),
        },
        prompt === item.prompt ? 'Antwort neu generieren' : 'Nachricht bearbeiten',
        { expiresAt: chat.body.temporary ? String(chat.body.expiresAt) : undefined }
      );
      setEditing(null);
      setOlder([]);
    });
  };
  const showVersion = (versionId: string) =>
    void invoke(async () => {
      await api.post(`/api/assistant/api-chats/${id}/turns/${versionId}/activate`, {});
      setOlder([]);
    });
  const send = async () => {
    if (!chat || !draft.trim() || busy) return;
    followLatest.current = true;
    const captured = scope,
      text = draft.trim();
    await invoke(async () => {
      await transmit(text);
      if (scopeRef.current === captured)
        setDraft((current) => (current.trim() === text ? '' : current));
    });
  };
  /** A Dynamic UI button asking a follow-up: sent like a typed message. */
  const sendText = (text: string) => {
    if (!chat || running || busy || !text.trim()) return;
    followLatest.current = true;
    void invoke(async () => {
      await transmit(text);
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
      if (scopeRef.current !== scope) return;
      const target = `${kind === 'task' ? '/assistant/tasks' : `/assistant/${kind === 'memory' ? 'memory' : 'artifacts'}`}?resource=${result.id}`;
      // Leaving the chat for another area moves forward, like the mode pill would.
      if (!transitionArea('forward', () => navigate(target))) navigate(target);
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
      project: chat.body.projectId ? [String(chat.body.projectId)] : [],
      sources: (chat.body.sourceIds ?? []) as string[],
      memoryRead: chat.body.memoryRead !== false,
      memoryLearn: chat.body.memoryLearn !== false,
    });
  };
  return (
    <main className="plum-api-conversation">
      {(!!chat.body.projectId || !!chat.body.profileId) && (
        <nav
          aria-label="Gesprächs-Arbeitsbereich"
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground"
        >
          {!!chat.body.projectId && (
            <Link
              className="underline underline-offset-4"
              to={'/chat/projects/' + chat.body.projectId}
            >
              {workspaceProject.data?.title ?? 'Zum Projekt'}
            </Link>
          )}
          {!!chat.body.profileId && (
            <Link
              className="underline underline-offset-4"
              to={'/chat/assistants/' + chat.body.profileId}
            >
              {profile.data?.title ?? 'Zum Assistenten'}
            </Link>
          )}
          {workspaceProject.data && (
            <span>{PROJECT_MEMORY[projectMemoryMode(workspaceProject.data.body)].label}</span>
          )}
        </nav>
      )}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-1">
        <h1 className="truncate text-sm font-medium">{chat.title}</h1>
        <ChatWorkbench
          chat={chat}
          providers={providers.data ?? []}
          disabled={busy || !!running}
          onSaved={() => latest.refetch()}
        />
      </div>
      <div
        ref={scroll}
        className="plum-api-scroll"
        onScroll={() => {
          const el = scroll.current;
          if (!el) return;
          const follow = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          followLatest.current = follow;
          if (follow) scrollMemory.delete(scope);
          else scrollMemory.set(scope, el.scrollTop);
          if (!follow && !away) awaySeq.current = turns.at(-1)?.seq ?? 0;
          if (follow !== !away) setAway(!follow);
        }}
      >
        <div
          key={scope}
          className={cn('plum-api-content', entrance.current?.animate && 'plum-chat-enter')}
        >
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
                        projectId: configuration.project[0] ?? null,
                        sourceIds: configuration.sources,
                        memoryRead: configuration.memoryRead,
                        memoryLearn: configuration.memoryLearn,
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
                  {!chat.body.temporary && (
                    <ResourcePicker
                      label="Projekt"
                      kind="project"
                      value={configuration.project}
                      maximum={1}
                      onChange={(project) => setConfiguration({ ...configuration, project })}
                    />
                  )}
                  {!chat.body.temporary && (
                    <ChatMemoryControls
                      read={configuration.memoryRead}
                      learn={configuration.memoryLearn}
                      onRead={(memoryRead) => setConfiguration({ ...configuration, memoryRead })}
                      onLearn={(memoryLearn) => setConfiguration({ ...configuration, memoryLearn })}
                      disabled={busy || !!running}
                    />
                  )}
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
                    for (const turn of result.turns) baseline.current?.ids.add(turn.id);
                    setOlder((previous) => [...result.turns, ...previous]);
                  }
                })
              }
            >
              Ältere Beiträge laden
            </Button>
          )}
          <section
            className="space-y-6"
            aria-label="Gesprächsverlauf"
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          >
            {!turns.length && <p>Stelle deine erste Frage.</p>}
            {turns.map((item) => (
              <article
                key={item.id}
                data-turn={item.seq}
                tabIndex={-1}
                aria-label={`Beitrag ${item.seq}`}
                className={cn('min-w-0 space-y-3', fresh(item.id) && 'plum-rise')}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget
                      .querySelector<HTMLElement>('.plum-message-actions button')
                      ?.focus();
                  } else if (event.key === 'Escape') {
                    event.currentTarget
                      .closest('.plum-api-conversation')
                      ?.querySelector<HTMLTextAreaElement>('.plum-message-composer textarea')
                      ?.focus();
                  }
                }}
              >
                {editing?.id === item.id ? (
                  <form
                    className="plum-api-user plum-api-user-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      regenerate(item, editing.text);
                    }}
                  >
                    <label className="block">
                      <span className="sr-only">Nachricht bearbeiten</span>
                      <textarea
                        autoFocus
                        value={editing.text}
                        maxLength={20000}
                        rows={Math.min(10, Math.max(2, editing.text.split('\n').length))}
                        onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setEditing(null);
                        }}
                      />
                    </label>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(null)}
                      >
                        Abbrechen
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || !!running || !editing.text.trim()}
                      >
                        Senden
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="plum-api-user-row">
                    {item.status !== 'running' && !running && (
                      <button
                        type="button"
                        className="plum-api-user-edit-button"
                        aria-label="Nachricht bearbeiten"
                        title="Nachricht bearbeiten"
                        disabled={busy}
                        onClick={() => setEditing({ id: item.id, text: item.prompt })}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <div className="plum-api-user">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">Du</p>
                      <p className="whitespace-pre-wrap break-words">{item.prompt}</p>
                      {!!item.imageAssetIds?.length && (
                        <ChatImageStrip chatId={chat.id} ids={item.imageAssetIds} />
                      )}
                    </div>
                  </div>
                )}
                <div
                  className={cn(
                    'plum-api-answer',
                    item.status === 'running' && !!item.response && 'is-streaming'
                  )}
                >
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    <span className={cn('plum-answer-label', shine === item.id && 'is-shine')}>
                      Plum
                    </span>
                    {item.status !== 'completed' ? ` · ${statuses[item.status]}` : ''}
                  </p>
                  <ChatWebActivity turn={item} />
                  {chat.body.workflow === 'research' && item.status === 'completed' ? (
                    <ResearchPreview
                      response={item.response}
                      busy={busy}
                      onSave={() => saveAnswer(item, 'research')}
                    />
                  ) : item.status === 'running' && !item.response && !item.uiPending ? (
                    webToolRunning(item) ? null : (
                      <ThinkingDots />
                    )
                  ) : item.response || (!item.ui && !item.uiPending) ? (
                    <ChatRichText
                      text={item.response || 'Keine Antwort'}
                      sourceVersions={item.sourceVersions}
                      webSources={item.webSources}
                    />
                  ) : null}
                  {item.uiPending && !item.ui && (
                    <div className="dui-pending" role="status">
                      <span>Interaktive Ansicht wird erstellt …</span>
                      <div className="dui-pending-bars" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                  {item.ui && (
                    <Suspense fallback={null}>
                      <DynamicUi
                        spec={item.ui}
                        stateStore={dynamicUiState}
                        stateKey={item.id}
                        busy={busy || !!running}
                        onSendMessage={sendText}
                      />
                    </Suspense>
                  )}
                  {item.uiError && item.status !== 'running' && (
                    <p className="dui-note">{item.uiError}</p>
                  )}
                  {item.error && (
                    <p
                      className="mt-3 text-sm"
                      role={item.status === 'failed' ? 'alert' : 'status'}
                    >
                      {item.error}
                    </p>
                  )}
                  <ChatTurnDetails
                    chatId={chat.id}
                    turn={item}
                    disabled={busy || !!running}
                    onMerge={() =>
                      void invoke(async () => {
                        await deliverAssistant(
                          `/api/assistant/api-chats/${chat.id}/turns`,
                          {
                            expectedRevision: chat.revision,
                            prompt: item.prompt,
                            mergeTurnId: item.id,
                            ...effortPayload(effort),
                          },
                          'Antworten zusammenführen'
                        );
                      })
                    }
                  />
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
                  {item.status === 'queued' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void invoke(async () => {
                          await api.post(
                            `/api/assistant/api-chats/${id}/turns/${item.id}/stop`,
                            {}
                          );
                        })
                      }
                    >
                      Wartende Nachricht entfernen
                    </Button>
                  )}
                  {item.status !== 'running' && item.status !== 'queued' && (
                    <div className="plum-message-actions mt-3">
                      {(item.versions?.length ?? 0) > 1 && (
                        <VersionSwitcher
                          versions={item.versions!}
                          current={item.id}
                          disabled={busy || !!running}
                          onSelect={showVersion}
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(item.response)
                            .then(() => {
                              setCopied(item.id);
                              window.setTimeout(
                                () => setCopied((current) => (current === item.id ? '' : current)),
                                1600
                              );
                            })
                            .catch(() => setError('Kopieren fehlgeschlagen.'))
                        }
                      >
                        {copied === item.id ? (
                          <span key="copied" className="plum-pop">
                            <Check size={13} />
                          </span>
                        ) : (
                          <Copy size={13} />
                        )}
                        {copied === item.id ? 'Kopiert' : 'Kopieren'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        disabled={busy || !!running}
                        onClick={() => regenerate(item)}
                      >
                        <RefreshCw size={13} />
                        Neu generieren
                      </Button>
                      {item.response && (
                        <ReadAloudButton
                          text={item.response}
                          voice={speechVoice(profile.data?.body.voice)}
                          language={String(profile.data?.body.language ?? 'German')}
                          onError={setError}
                        />
                      )}
                      {!chat.body.temporary && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" type="button">
                              <MoreHorizontal size={13} />
                              Mehr
                            </Button>
                          </DropdownMenuTrigger>
                          <StepOutContent align="start" side="bottom" className="w-72">
                            {!chat.body.temporary && (
                              <DropdownMenuItem disabled={busy} onSelect={() => branch(item, true)}>
                                In neuem Chat abzweigen
                              </DropdownMenuItem>
                            )}
                            {item.response && !chat.body.temporary && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={busy}
                                  onSelect={() => saveAnswer(item, 'document')}
                                >
                                  Als Ergebnis speichern
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={busy}
                                  onSelect={() => saveAnswer(item, 'task')}
                                >
                                  Als Task-Entwurf übernehmen
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={busy}
                                  onSelect={() => saveAnswer(item, 'memory')}
                                >
                                  Als persönliche Erinnerung speichern
                                </DropdownMenuItem>
                              </>
                            )}
                          </StepOutContent>
                        </DropdownMenu>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>
      <div className="plum-api-footer">
        {away && (
          <button type="button" className="plum-scroll-latest" onClick={scrollToLatest}>
            <ArrowDown size={14} aria-hidden />
            Zum Ende
            {unseen > 0 && (
              <span key={unseen} className="plum-scroll-latest-badge" aria-label={`${unseen} neu`}>
                {unseen}
              </span>
            )}
          </button>
        )}
        <form
          ref={composerRef}
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
                  if (!busy && draft.trim()) {
                    followLatest.current = true;
                    void send();
                  }
                }
              }}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                // Screenshots and copied images arrive as clipboard files; a text
                // paste carries none and stays native.
                const pasted = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => file !== null);
                if (!pasted.length) return;
                event.preventDefault();
                if (chat.body.workflow === 'research' || chat.body.artifactEdit) {
                  setError('In diesem Modus sind keine Anhänge möglich.');
                  return;
                }
                if (images.length + existingImages.length + pasted.length > 4) {
                  setError('Höchstens vier Dateien pro Nachricht.');
                  return;
                }
                if (pasted.some((file) => file.size > 5 * 1024 * 1024)) {
                  setError('Bilder: höchstens 5 MB.');
                  return;
                }
                // Clipboard images are all called "image.png"; give each its own name.
                const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
                const named = pasted.map(
                  (file, index) =>
                    new File(
                      [file],
                      `Eingefügt-${stamp}${pasted.length > 1 ? `-${index + 1}` : ''}.${file.type.split('/')[1] || 'png'}`,
                      { type: file.type }
                    )
                );
                setError('');
                setImages((current) => [...current, ...named]);
                setTools(true);
              }}
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
                disabled={busy}
                remaining={4 - existingImages.length}
              />
              <LiveImageCapture
                scopeKey={scope}
                disabled={busy}
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
            <div className="px-4 pb-3 space-y-2">
              <RealtimeVoice
                chatId={chat.id}
                onSaved={() => {
                  void latest.refetch();
                }}
              />
              <VoiceComposer
                scopeKey={scope}
                voice={speechVoice(profile.data?.body.voice)}
                language={String(profile.data?.body.language ?? 'German')}
                text={spoken?.response ?? ''}
                onSend={(text) => transmit(text, true)}
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
                <DropdownMenuItem disabled={!!running || busy} onSelect={openPersonalization}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Gesprächsoptionen
                </DropdownMenuItem>
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
              {running && !!draft.trim() && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  aria-label="Antwort stoppen"
                  onClick={() =>
                    void invoke(async () => {
                      await api.post(`/api/assistant/api-chats/${id}/turns/${running.id}/stop`, {});
                    })
                  }
                >
                  <Square size={12} fill="currentColor" />
                </Button>
              )}
              <Button
                className="plum-send-button"
                size="icon"
                type={running && !draft.trim() ? 'button' : 'submit'}
                data-mode={running && !draft.trim() ? 'stop' : 'send'}
                aria-label={
                  running && !draft.trim()
                    ? 'Antwort stoppen'
                    : running
                      ? 'Nachricht vormerken'
                      : 'Senden'
                }
                title={running && !draft.trim() ? 'Antwort stoppen' : undefined}
                disabled={running && !draft.trim() ? busy : busy || !draft.trim()}
                onClick={
                  running && !draft.trim()
                    ? () =>
                        void invoke(async () => {
                          await api.post(
                            `/api/assistant/api-chats/${id}/turns/${running.id}/stop`,
                            {}
                          );
                        })
                    : undefined
                }
              >
                <span className="plum-send-icon is-send" aria-hidden>
                  <ArrowUp size={18} />
                </span>
                <span className="plum-send-icon is-stop" aria-hidden>
                  <Square size={12} fill="currentColor" />
                </span>
              </Button>
            </div>
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

/** ChatGPT-style «‹ 2/3 ›» between regenerated or edited versions of one turn. */
function VersionSwitcher({
  versions,
  current,
  disabled,
  onSelect,
}: {
  versions: string[];
  current: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const index = versions.indexOf(current);
  return (
    <span className="plum-version-switcher" role="group" aria-label="Antwortversionen">
      <button
        type="button"
        aria-label="Vorherige Version"
        disabled={disabled || index <= 0}
        onClick={() => onSelect(versions[index - 1]!)}
      >
        <ChevronLeft size={14} />
      </button>
      <span aria-live="polite">
        {index + 1}/{versions.length}
      </span>
      <button
        type="button"
        aria-label="Nächste Version"
        disabled={disabled || index >= versions.length - 1}
        onClick={() => onSelect(versions[index + 1]!)}
      >
        <ChevronRight size={14} />
      </button>
    </span>
  );
}
