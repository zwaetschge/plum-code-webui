import { useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { socketService } from '@/services/socket';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { VoiceComposer } from './VoiceComposer';
import type { AssistantResource, Message, Session } from '@plum-code-webui/shared';

export function ConversationControls({
  session,
  messages,
  busy,
  onSend,
  onActivateBranch,
  chatId,
}: {
  session: Session;
  chatId?: string | null;
  messages: Message[];
  busy: boolean;
  onSend: (text: string) => Promise<unknown>;
  onActivateBranch: (chatId: string) => Promise<void>;
}) {
  const cache = useQueryClient();
  const account = useAuthStore((state) => state.user?.id);
  const profiles = useQuery({
    queryKey: ['assistant', 'resources', 'profiles', account],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/profiles')).data.data,
  });
  const binding = useQuery({
    queryKey: ['assistant', 'binding', session.id, account],
    queryFn: async () =>
      (
        await api.get<{
          data: {
            profileId: string | null;
            profileRevision: number | null;
            temporary?: number;
            expiresAt?: string;
          };
        }>('/api/assistant/sessions/' + session.id + '/profile')
      ).data.data,
  });
  const [error, setError] = useState(''),
    [working, setWorking] = useState(false),
    [draft, setDraft] = useState(''),
    [task, setTask] = useState<AssistantResource | null>(null),
    [messageId, setMessageId] = useState('');
  useEffect(() => {
    const expires =
      binding.data?.temporary && binding.data.expiresAt ? Date.parse(binding.data.expiresAt) : null;
    if (!expires) return;
    const expire = () => {
      setDraft('');
      useSessionStore.getState().setMessages(session.id, []);
      for (const entry of socketService.getOutboxEntries())
        if (entry.sessionId === session.id) socketService.discardOutboxEntry(entry.clientMessageId);
      for (const key of Object.keys(localStorage))
        if (key.startsWith('plum.chat.draft.v1:')) {
          try {
            const scope = JSON.parse(key.slice('plum.chat.draft.v1:'.length));
            if (scope[1] === session.id) localStorage.removeItem(key);
          } catch {
            /* unrelated browser data */
          }
        }
      setError(
        'Das temporäre Gespräch ist abgelaufen. Plum entfernt seinen Verlauf und Arbeitsbereich.'
      );
    };
    if (Date.now() >= expires) {
      expire();
      return;
    }
    const timer = setTimeout(expire, expires - Date.now());
    return () => clearTimeout(timer);
  }, [binding.data?.temporary, binding.data?.expiresAt, session.id]);
  const current = profiles.data?.find((profile) => profile.id === binding.data?.profileId);
  const invoke = async (action: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
    } finally {
      setWorking(false);
    }
  };
  const candidate = messages.find((message) => message.id === messageId) ?? messages.at(-1);
  return (
    <details
      className="shrink-0 border-b bg-card/90 px-4 py-2 text-sm"
      aria-label="Gespräch personalisieren"
    >
      <summary className="cursor-pointer font-medium">
        {session.surface === 'task' ? 'Plum Task' : 'Plum Chat'} · {current?.title || 'Ohne Profil'}
        {binding.data?.profileRevision ? ` · Revision ${binding.data.profileRevision}` : ''}
      </summary>
      <div className="mx-auto grid max-w-4xl gap-3 py-3">
        {binding.data?.temporary === 1 && (
          <p role="status">
            Temporär bis{' '}
            {binding.data.expiresAt
              ? new Date(binding.data.expiresAt).toLocaleString()
              : 'zur Löschung'}{' '}
            · persönliches Gedächtnis ausgeschaltet.
          </p>
        )}
        <label className="grid gap-1">
          Profil für die nächste Nachricht
          <select
            disabled={working || busy}
            value={binding.data?.profileId ?? ''}
            className="rounded-md border bg-background p-2"
            onChange={(event) =>
              void invoke(async () => {
                await api.post(`/api/assistant/sessions/${session.id}/profile`, {
                  profileId: event.target.value || null,
                });
                await cache.invalidateQueries({ queryKey: ['assistant', 'binding', session.id] });
              })
            }
          >
            <option value="">Ohne Profil</option>
            {profiles.data?.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title} · Revision {profile.revision}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Das ausgewählte Profil wird auf seine aktuelle Revision gebunden. Spätere Profiländerungen
          erfordern eine erneute Auswahl. Bereits gesendete Nachrichten bleiben im Verlauf.
        </p>
        <label className="grid gap-1">
          Auftrag oder diktierte Folgeanweisung
          <textarea
            className="min-h-20 rounded-md border bg-background p-2"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <VoiceComposer
          onSend={onSend}
          modelBusy={busy || working}
          answerKey={messages.filter((message) => message.role === 'assistant').at(-1)?.id}
          scopeKey={session.id + ':' + String(chatId ?? 'main')}
          voice={String(current?.body.voice ?? 'Rufus Beck')}
          language={String(current?.body.language ?? 'German')}
          text={messages.filter((message) => message.role === 'assistant').at(-1)?.content ?? ''}
          onTranscription={(text) => setDraft((old) => (old ? `${old}\n${text}` : text))}
        />
        <Button
          className="justify-self-start"
          size="sm"
          disabled={working || busy || !draft.trim()}
          onClick={() =>
            void invoke(async () => {
              const acknowledgement = (await onSend(draft.trim())) as
                | { status?: string; error?: string }
                | undefined;
              if (acknowledgement?.status === 'rejected')
                throw new Error(acknowledgement.error || 'Nachricht wurde abgelehnt');
              setDraft('');
            })
          }
        >
          Im Chat senden
        </Button>
        <Button
          className="justify-self-start"
          size="sm"
          disabled={working || !draft.trim()}
          onClick={() =>
            void invoke(async () => {
              const resource = (
                await api.post<{ data: AssistantResource }>('/api/assistant/tasks', {
                  title: draft.trim().slice(0, 100),
                  body: {
                    goal: draft,
                    provider: session.cliProvider || 'codex',
                    originSessionId: session.id,
                    ...(binding.data?.profileId ? { profileId: binding.data.profileId } : {}),
                  },
                })
              ).data.data;
              setTask(resource);
              setDraft('');
              await cache.invalidateQueries({ queryKey: ['assistant'] });
            })
          }
        >
          Als Task-Entwurf übernehmen
        </Button>
        {task && (
          <Link className="underline" to={`/assistant/tasks?resource=${task.id}`}>
            Auftrag öffnen und starten: {task.title}
          </Link>
        )}
        <label className="grid gap-1">
          Abzweigen bei Nachricht
          <select
            className="rounded-md border bg-background p-2"
            value={messageId}
            onChange={(event) => setMessageId(event.target.value)}
          >
            <option value="">Letzte Nachricht</option>
            {messages.slice(-40).map((message) => (
              <option key={message.id} value={message.id}>
                {message.role === 'user'
                  ? 'Du'
                  : message.role === 'assistant'
                    ? 'Assistent'
                    : message.role}
                : {message.content.slice(0, 100)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          {[true, false].map((includeMessage) => (
            <Button
              key={String(includeMessage)}
              size="sm"
              variant="outline"
              disabled={busy || working || !candidate}
              onClick={() =>
                void invoke(async () => {
                  const branch = (
                    await api.post<{ data: { chatId: string } }>(
                      `/api/assistant/sessions/${session.id}/branches`,
                      {
                        messageId: candidate!.id,
                        includeMessage,
                        title: includeMessage ? 'Abzweigung' : 'Neue Antwort / Bearbeitung',
                      }
                    )
                  ).data.data;
                  await onActivateBranch(branch.chatId);
                  await cache.invalidateQueries({ queryKey: ['session-chats', session.id] });
                  await cache.invalidateQueries({ queryKey: ['session', session.id] });
                })
              }
            >
              {includeMessage ? 'Mit Nachricht abzweigen' : 'Vor Nachricht abzweigen'}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Abzweigungen behalten den kopierten Verlauf samt Anhängen und beginnen mit frischem
          Provider-Kontext. Die Originalunterhaltung bleibt erhalten.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
