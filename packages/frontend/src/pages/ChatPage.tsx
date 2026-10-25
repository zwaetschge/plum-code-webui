import { ChatImport } from '@/components/assistant/ChatWorkbench';
import { usePersonalization } from '@/components/assistant/usePersonalization';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Paperclip, SlidersHorizontal, X, Mic, Loader2 } from 'lucide-react';
import type { AssistantApiProvider, AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { deliverAssistant } from '@/services/assistantOutbox';
import { uploadChatAttachments } from '@/components/assistant/ChatImages';
import { VoiceComposer } from '@/components/assistant/VoiceComposer';
import { ResourcePicker } from '@/components/assistant/ResourcePicker';
import { AssistantOutbox } from '@/components/assistant/AssistantOutbox';
import {
  ModelEffortPicker,
  effortPayload,
  useEffortChoice,
} from '@/components/assistant/ModelEffortPicker';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { orderChatApiProviders } from '@/lib/chatApiProviders';
import { ComposerPlusMenu } from '@/components/presets/ComposerPlusMenu';
import { WritingStyleMenu } from '@/components/presets/WritingStyleMenu';
import { useAmbientSeed } from '@/components/motion/AmbientBackdrop';
import { rememberComposer } from '@/lib/motion/flood';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { cn } from '@/lib/utils';
import { StartSuggestions } from '@/components/assistant/StartSuggestions';
import { RecentChats } from '@/components/assistant/RecentChats';
import { ChatWorkspace } from '@/components/assistant/ChatWorkspace';

export function ChatPage() {
  const owner = useAuthStore((s) => s.user?.id);
  const location = useLocation();
  const legacy = new URLSearchParams(location.search);
  if (legacy.has('workspace'))
    return (
      <Navigate
        replace
        to={
          legacy.get('workspace') === 'projects'
            ? '/chat/projects' + (legacy.get('project') ? '/' + legacy.get('project') : '')
            : '/chat/assistants'
        }
      />
    );
  return <ChatAccountPage key={`${owner}:${location.key}`} owner={owner} />;
}
function ChatAccountPage({ owner }: { owner?: string }) {
  const location = useLocation();
  const initial = new URLSearchParams(location.search);
  const user = useAuthStore((state) => state.user);
  const { preferences } = usePersonalization();
  const firstName = preferences.nickname || user?.name?.trim().split(/\s+/)[0];
  const navigate = useNavigate(),
    cache = useQueryClient(),
    input = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    composer = useRef<HTMLFormElement>(null);
  const [leaving, setLeaving] = useState(false);
  useAmbientSeed('plum-welcome');
  const [draft, setDraft] = useState(''),
    [selection, setSelection] = useState(''),
    [model, setModel] = useState(''),
    [profile, setProfile] = useState(initial.get('assistant') ?? ''),
    [project, setProject] = useState(initial.get('project') ?? '');
  const [options, setOptions] = useState(false),
    [voice, setVoice] = useState(false),
    [temporary, setTemporary] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [sources, setSources] = useState<string[]>([]),
    [research, setResearch] = useState(false);
  const [created, setCreated] = useState<AssistantResource | null>(null);
  const [effort, setEffort] = useEffortChoice();
  // undefined = account default from the personalisation, null = no style.
  const [writingStyle, setWritingStyle] = useState<string | null | undefined>(undefined);
  const activeWritingStyle =
    writingStyle === undefined ? preferences.defaultWritingStyle || null : writingStyle;
  const providers = useQuery({
    queryKey: ['assistant', 'api-chat-providers', owner],
    select: orderChatApiProviders,
    queryFn: async () =>
      (await api.get<{ data: AssistantApiProvider[] }>('/api/assistant/api-chat-providers')).data
        .data,
  });
  const profiles = useQuery({
    queryKey: ['assistant', 'resources', 'profiles', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/profiles')).data.data,
  });
  const upstream = providers.data?.find((p) => `api:${p.id}` === selection) ?? providers.data?.[0];
  const models = upstream?.models ?? [];
  const actualModel = models.includes(model) ? model : models[0];
  const chosenProfile = profiles.data?.find((p) => p.id === profile);
  const initialModelApplied = useRef(false);
  useEffect(() => {
    if (initialModelApplied.current || !chosenProfile || !providers.data) return;
    initialModelApplied.current = true;
    const preferred = providers.data.find((p) => p.id === chosenProfile.body.apiProviderId);
    if (preferred && !selection) {
      setSelection(`api:${preferred.id}`);
      setModel(String(chosenProfile.body.model || preferred.models[0] || ''));
    }
  }, [chosenProfile, providers.data, selection]);
  useEffect(() => {
    const element = input.current;
    if (element) {
      element.style.height = 'auto';
      element.style.height = `${Math.min(160, element.scrollHeight)}px`;
    }
  }, [draft]);
  const start = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      {
        if (!upstream || !actualModel)
          throw new Error('Eine verfügbare Modellverbindung auswählen.');
        const resource =
          created ??
          (
            (await deliverAssistant(
              '/api/assistant/api-chats',
              {
                title: draft.trim().slice(0, 80),
                providerId: upstream.id,
                model: actualModel,
                profileId: profile || null,
                projectId: temporary ? null : project || null,
                temporary,
                sourceIds: sources,
                ...(research ? { workflow: 'research' } : {}),
                ...(writingStyle !== undefined ? { writingStyleSkill: writingStyle } : {}),
              },
              'Gespräch erstellen'
            )) as { data: { data: AssistantResource } }
          ).data.data;
        if (useAuthStore.getState().user?.id !== owner) return;
        setCreated(resource);
        const { imageAssetIds, documentSourceIds } = await uploadChatAttachments(
          resource.id,
          files
        );
        if (useAuthStore.getState().user?.id !== owner) return;
        await deliverAssistant(
          `/api/assistant/api-chats/${resource.id}/turns`,
          {
            expectedRevision: resource.revision,
            prompt: draft.trim(),
            imageAssetIds,
            documentSourceIds,
            ...effortPayload(effort),
          },
          'Erste Nachricht',
          { expiresAt: resource.body.temporary ? String(resource.body.expiresAt) : undefined }
        );
        if (useAuthStore.getState().user?.id !== owner) return;
        void cache.invalidateQueries({ queryKey: ['assistant', 'api-chats'] });
        // Greeting and hints lift away first; the composer then glides into the new chat.
        setLeaving(true);
        if (!prefersReducedMotion()) await new Promise((resolve) => setTimeout(resolve, 170));
        if (useAuthStore.getState().user?.id !== owner) return;
        rememberComposer(composer.current);
        navigate(`/chat/model/${resource.id}`);
      }
    } catch (failure) {
      if (useAuthStore.getState().user?.id === owner)
        setError(
          failure instanceof Error ? failure.message : 'Gespräch konnte nicht gestartet werden.'
        );
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  };
  return (
    <div className="plum-chat-page plum-chat-start">
      <div className={cn('plum-chat-welcome', leaving && 'is-leaving')}>
        <h1>
          {firstName
            ? `Hallo ${firstName}, was beschäftigt dich heute?`
            : 'Was beschäftigt dich heute?'}
        </h1>
        {providers.isError && (
          <p role="alert" className="text-sm text-destructive">
            API-Verbindungen konnten nicht geladen werden.{' '}
            <button type="button" className="underline" onClick={() => void providers.refetch()}>
              Erneut versuchen
            </button>
          </p>
        )}
        {!providers.isPending && !providers.data?.length && (
          <Link className="text-sm underline" to="/settings">
            Anbieter in den Einstellungen verbinden
          </Link>
        )}
        {preferences.suggestedPrompts && (
          <>
            <p>
              Rechnungen, Vergleiche und Zahlen beantwortet Plum auf Wunsch mit einer interaktiven
              Ansicht.
            </p>
            <StartSuggestions
              disabled={busy}
              onPick={(suggestion) => {
                setDraft(suggestion.prompt);
                const element = input.current;
                if (!element) return;
                element.focus();
                // Open prompts end with ": " and wait for the user's own words.
                requestAnimationFrame(() =>
                  element.setSelectionRange(suggestion.prompt.length, suggestion.prompt.length)
                );
                composer.current?.classList.remove('is-primed');
                void composer.current?.offsetWidth;
                composer.current?.classList.add('is-primed');
              }}
            />
          </>
        )}
        <ChatWorkspace
          profileId={profile}
          projectId={project}
          disabled={busy || !!created}
          onProject={setProject}
          onProfile={(value) => {
            setProfile(value?.id ?? '');
            const provider = providers.data?.find((p) => p.id === value?.body.apiProviderId);
            if (provider) {
              setSelection(`api:${provider.id}`);
              setModel(String(value?.body.model || provider.models[0] || ''));
            }
          }}
        />
        <RecentChats />
        <ChatImport
          providers={providers.data ?? []}
          onImported={() => {
            void cache.invalidateQueries({ queryKey: ['assistant'] });
          }}
        />
        <AssistantOutbox />
      </div>
      <div className={cn('plum-api-footer plum-start-footer', leaving && 'is-leaving')}>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {voice && preferences.voiceChat && (
          <div className="plum-chat-options">
            <VoiceComposer
              scopeKey={`${owner}:new-chat`}
              text=""
              voice={preferences.voiceName || String(chosenProfile?.body.voice ?? 'Rufus Beck')}
              language={String(chosenProfile?.body.language ?? 'German')}
              onTranscription={(text) => {
                setDraft((old) => [old, text].filter(Boolean).join('\n'));
                input.current?.focus();
              }}
            />
          </div>
        )}
        <form
          ref={composer}
          className="plum-message-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          {!!files.length && (
            <div className="flex flex-wrap gap-2 p-3 pb-0">
              {files.map((file, index) => (
                <span key={`${file.name}:${index}`} className="plum-file-chip">
                  <Paperclip size={13} />
                  <span className="max-w-40 truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={`${file.name} entfernen`}
                    disabled={busy}
                    onClick={() => setFiles((old) => old.filter((_, i) => i !== index))}
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            aria-label="Deine Nachricht"
            placeholder="Frag Plum …"
            value={draft}
            disabled={busy}
            maxLength={20000}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                window.matchMedia('(min-width: 768px)').matches
              ) {
                e.preventDefault();
                void start();
              }
            }}
          />
          <div className="plum-composer-toolbar">
            <div className="flex min-w-0 items-center gap-1">
              <ComposerPlusMenu
                disabled={busy || !!created}
                attachDisabled={research}
                onAttach={() => fileInput.current?.click()}
              >
                <WritingStyleMenu value={activeWritingStyle} onChange={setWritingStyle} />
                <DropdownMenuItem onSelect={() => setOptions(true)}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  {chosenProfile?.title ?? 'Gesprächsoptionen'}
                </DropdownMenuItem>
              </ComposerPlusMenu>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.py,.html"
                hidden
                onChange={(e) => {
                  const selectedFiles = Array.from(e.target.files ?? []);
                  setFiles((old) => [...old, ...selectedFiles].slice(0, 4));
                  e.target.value = '';
                }}
              />
            </div>
            <div className="plum-composer-model-tools">
              <ModelEffortPicker
                providers={providers.data ?? []}
                providerId={upstream?.id}
                model={actualModel}
                disabled={busy || !!created}
                onSelect={(providerId, value) => {
                  setSelection(`api:${providerId}`);
                  setModel(value);
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
                aria-expanded={voice}
                onClick={() => setVoice(!voice)}
              >
                <Mic size={18} />
              </Button>
              <Button
                size="icon"
                type="submit"
                aria-label="Nachricht senden"
                disabled={
                  busy ||
                  !draft.trim() ||
                  !upstream ||
                  !actualModel ||
                  (research && !sources.length)
                }
                className="plum-send-button"
              >
                {busy ? <Loader2 className="animate-spin" size={18} /> : <ArrowUp size={19} />}
              </Button>
            </div>
          </div>
        </form>
        {/* Options live in the `+` menu; only active choices are hinted here. */}
        {(chosenProfile || temporary || research) && (
          <div className="plum-chat-context">
            {chosenProfile && (
              <button
                type="button"
                onClick={() => setOptions(true)}
                className="plum-context-button"
              >
                <SlidersHorizontal size={13} />
                {chosenProfile.title}
              </button>
            )}
            {temporary && <span>Temporär · 24 Stunden</span>}
            {research && <span>Dokumentrecherche</span>}
          </div>
        )}
      </div>
      <Dialog open={options} onOpenChange={setOptions}>
        <DialogContent className="plum-assistant-shell plum-chat-dialog">
          <DialogTitle>Gespräch personalisieren</DialogTitle>
          <DialogDescription>
            Profil, persönliche Anweisungen und Gesprächskontext.
          </DialogDescription>
          <section className="plum-chat-options" aria-label="Gespräch personalisieren">
            <div className="grid gap-3">
              <label>
                Profil
                <select
                  value={profile}
                  disabled={busy || !!created}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  <option value="">Standard</option>
                  {profiles.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link to="/assistant/profiles" className="text-sm underline">
                Profile und Systemanweisungen bearbeiten
              </Link>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={busy || !!created}
                  checked={temporary}
                  onChange={(e) => {
                    setTemporary(e.target.checked);
                    if (e.target.checked) setResearch(false);
                  }}
                />
                Temporäres Gespräch
              </label>
            </div>
            {temporary && (
              <p className="text-xs text-muted-foreground">
                Ohne persönliches Gedächtnis. Plum löscht den lokalen Verlauf nach 24 Stunden; beim
                Anbieter gelten eigene Aufbewahrungsregeln.
              </p>
            )}
            {
              <>
                <ResourcePicker
                  label="Dokumentquellen"
                  kind="source"
                  value={sources}
                  maximum={20}
                  onChange={setSources}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={research}
                    disabled={busy || !!created}
                    onChange={(e) => {
                      setResearch(e.target.checked);
                      if (e.target.checked) {
                        setTemporary(false);
                        setFiles([]);
                      }
                    }}
                  />
                  Quellengebundene Dokumentrecherche
                </label>
              </>
            }
            {!temporary &&
              !research &&
              Object.values(preferences.referencePhotos).some(Boolean) && (
                <div className="flex flex-wrap gap-2" aria-label="Gespeicherte Referenzfotos">
                  {(['portrait', 'fullBody'] as const)
                    .filter((slot) => preferences.referencePhotos[slot])
                    .map((slot) => (
                      <Button
                        key={slot}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || !!created}
                        onClick={() => {
                          void (async () => {
                            try {
                              const response = await api.download(
                                `/api/assistant/personalization/photos/${slot}`
                              );
                              const bytes = await response.blob();
                              if (useAuthStore.getState().user?.id !== owner) return;
                              const selected = preferences.referencePhotos[slot]!;
                              setFiles((old) =>
                                [
                                  ...old,
                                  new File([bytes], selected.filename, {
                                    type: selected.mimeType,
                                  }),
                                ].slice(0, 4)
                              );
                            } catch {
                              setError('Referenzfoto konnte nicht geladen werden.');
                            }
                          })();
                        }}
                      >
                        {slot === 'portrait' ? 'Referenzfoto anhängen' : 'Ganzkörperfoto anhängen'}
                      </Button>
                    ))}
                </div>
              )}
            {
              <p className="text-xs text-muted-foreground">
                Dieses Gespräch nutzt deine API-Verbindung und wird vom Anbieter abgerechnet.
                Bildanhänge: bis zu vier Bilder.
              </p>
            }
          </section>
          <Button onClick={() => setOptions(false)}>Fertig</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
