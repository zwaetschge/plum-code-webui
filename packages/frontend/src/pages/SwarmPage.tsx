import { deliverAssistant, assistantDeliveries } from '@/services/assistantOutbox';
import { AssistantOutbox } from '@/components/assistant/AssistantOutbox';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { AssistantAgent } from '@plum-code-webui/shared';
import { SwarmControlPanel } from '@/components/assistant/SwarmControlPanel';
import { RoomMembership } from '@/components/assistant/RoomMembership';
import { NativePreferences } from '@/components/assistant/NativePreferences';
import { VoiceComposer } from '@/components/assistant/VoiceComposer';
import { useNativeOrderDelay } from '@/components/assistant/useNativeOrderDelay';

interface Event {
  event_id?: string;
  type: string;
  sender?: string;
  origin_server_ts?: number;
  redacts?: string;
  content: Record<string, unknown>;
  state_key?: string;
}
interface Room {
  id: string;
  name: string;
  alias: string | null;
  encrypted: boolean;
  agents: AssistantAgent[];
  state: Event[];
}
const COMMANDS = [
  ['!board', 'Aufträge'],
  ['!agenten', 'Agenten'],
  ['!budget', 'Budgets'],
  ['!routine', 'Routinen'],
  ['!ablauf', 'Abläufe'],
  ['!kennzahlen', 'Kennzahlen'],
  ['!erinnern ', 'Gedächtnis'],
  ['!geraet', 'Geräte'],
  ['!alarme', 'Alarme'],
  ['!release', 'Hub-Stand'],
  ['!sperren', 'Türsteher'],
  ['!rat ', 'Rat'],
  ['!aktion ', 'Betrieb'],
  ['!stand', 'Stand'],
  ['!plum', 'Plum-Sitzungen'],
  ['!absprachen', 'Absprachen'],
  ['!entsperren ', 'IP entsperren'],
  ['!tokens', 'Tokens'],
  ['!abo', 'Abonnements'],
  ['!profil ', 'Agentenprofil'],
  ['!selbsttest', 'Selbsttest'],
  ['!pruefen ', 'Prüfung'],
  ['!audit ', 'Audit'],
  ['!auftrag ', 'Auftrag vergeben'],
  ['!hilfe', 'Hilfe'],
] as const;

/** Preserve native edits and redactions; an edit cannot replace another sender's message. */
export function visibleMatrixMessages(events: Event[]): Event[] {
  const originals = new Map(
    events
      .filter((event) => event.type === 'm.room.message')
      .map((event) => [event.event_id, event])
  );
  const redacted = new Set(
    events.filter((e) => e.type === 'm.room.redaction').map((e) => e.redacts ?? e.content.redacts)
  );
  const edits = new Map<string, Event>();
  for (const e of [...events].sort(
    (a, b) => (a.origin_server_ts ?? 0) - (b.origin_server_ts ?? 0)
  )) {
    const relation = e.content['m.relates_to'] as Record<string, unknown> | undefined;
    if (
      e.type === 'm.room.message' &&
      relation?.rel_type === 'm.replace' &&
      typeof relation.event_id === 'string' &&
      originals.get(relation.event_id)?.sender === e.sender &&
      !redacted.has(e.event_id)
    )
      edits.set(relation.event_id, e);
  }
  return events
    .filter(
      (e) =>
        e.type === 'm.room.message' &&
        !redacted.has(e.event_id) &&
        (e.content['m.relates_to'] as Record<string, unknown> | undefined)?.rel_type !== 'm.replace'
    )
    .map((e) => {
      const edit = edits.get(e.event_id ?? '');
      return edit && edit.sender === e.sender
        ? { ...e, content: (edit.content['m.new_content'] as Record<string, unknown>) ?? e.content }
        : e;
    })
    .sort((a, b) => (a.origin_server_ts ?? 0) - (b.origin_server_ts ?? 0));
}

export function SwarmPage() {
  const account = useAuthStore((state) => state.user?.id);
  const cache = useQueryClient();
  const [params] = useSearchParams();
  const [roomId, setRoomId] = useState(params.get('room') ?? '');
  const [threadId, setThreadId] = useState<string | undefined>(params.get('thread') ?? undefined);
  const importStop = useRef(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [text, setText] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [older, setOlder] = useState<Event[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [voice, setVoice] = useState('');
  const status = useQuery({
    queryKey: ['assistant', 'matrix-status', account],
    queryFn: async () =>
      (
        await api.get<{
          data: { configured: boolean; connected: boolean; userId?: string; epoch?: string };
        }>('/api/assistant/matrix/status')
      ).data.data,
  });
  const rooms = useQuery({
    queryKey: ['assistant', 'matrix-rooms', account, status.data?.epoch],
    queryFn: async () => (await api.get<{ data: Room[] }>('/api/assistant/matrix/rooms')).data.data,
    enabled: !!status.data?.connected,
    refetchInterval: 30000,
  });
  const messages = useQuery({
    queryKey: ['assistant', 'matrix-messages', roomId, threadId, account, status.data?.epoch],
    queryFn: async () =>
      (
        await api.get<{ data: { chunk: Event[]; end?: string; next_batch?: string } }>(
          `/api/assistant/matrix/rooms/${encodeURIComponent(roomId)}/messages${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''}`
        )
      ).data.data,
    enabled: !!roomId && !!status.data?.connected,
    refetchInterval: 5000,
  });
  useEffect(() => {
    setOlder([]);
    setNext(undefined);
    setExhausted(false);
  }, [roomId, threadId]);
  useEffect(() => {
    if (!roomId && rooms.data?.length) {
      const lobby = rooms.data.find((r) => r.alias?.includes('#schwarm-lobby:'));
      setRoomId(lobby?.id ?? rooms.data[0]?.id ?? '');
    }
  }, [rooms.data, roomId]);
  const selected = rooms.data?.find((r) => r.id === roomId);
  const deliveryScope = `${account}:${status.data?.userId}:${status.data?.epoch}:${roomId}:${threadId ?? ''}`;
  const scopeRef = useRef(deliveryScope);
  scopeRef.current = deliveryScope;
  const orderDelay = useNativeOrderDelay(deliveryScope);
  const prepareCommand = (command: string) => {
    orderDelay.cancel();
    const lobby = rooms.data?.find((room) => room.alias?.startsWith('#schwarm-lobby:'));
    if (lobby) {
      setRoomId(lobby.id);
      setThreadId(undefined);
    }
    setText(command);
  };
  const allEvents = useMemo(
    () =>
      Array.from(
        new Map([...older, ...(messages.data?.chunk ?? [])].map((e) => [e.event_id, e])).values()
      ),
    [older, messages.data]
  );
  const visible = useMemo(() => visibleMatrixMessages(allEvents), [allEvents]);
  const hub = `@schwarm:${status.data?.userId?.split(':').slice(1).join(':')}`;
  const voiceState = rooms.data
    ?.flatMap((room) => room.state)
    .find(
      (event) =>
        event.type === 'ch.zwaetschge.swarm.stimmen' &&
        event.sender === hub &&
        (event.content.v ?? 1) === 1
    )?.content;
  const voices = (Array.isArray(voiceState?.stimmen) ? voiceState.stimmen : []).filter(
    (item): item is { id: string; name?: string; engine: string } =>
      !!item &&
      typeof item === 'object' &&
      item.engine === 'omnivoice' &&
      typeof item.id === 'string'
  );
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['assistant'] });
  };
  const login = useMutation({
    mutationFn: () => api.post('/api/assistant/matrix/connect', { username, password }),
    onSuccess: () => {
      setPassword('');
      setError('');
      refresh();
    },
    onError: (e) => {
      setPassword('');
      setError(e.message);
    },
  });
  const openBrian = useMutation({
    mutationFn: async () =>
      (await api.post<{ data: { roomId: string } }>('/api/assistant/matrix/brian/conversation'))
        .data.data,
    onSuccess: ({ roomId: id }) => {
      setRoomId(id);
      setThreadId(undefined);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const send = useMutation({
    mutationFn: async (packet: {
      body: string;
      root?: string;
      file: File | null;
      room: string;
      nativeUserId?: string;
      epoch?: string;
      scope: string;
      commandId: string;
      replyTo?: string;
    }) => {
      if (scopeRef.current !== packet.scope || useAuthStore.getState().user?.id !== account)
        throw new Error('Ziel oder Konto wurde geändert. Nachricht erneut prüfen.');
      const { body, root, file } = packet;
      const destination = `/api/assistant/matrix/rooms/${encodeURIComponent(packet.room)}/events`;
      if (file && assistantDeliveries().some((entry) => entry.path === destination))
        throw new Error(
          'Für diesen Raum ist eine Zustellung unbestätigt. Prüfe zuerst die Assistenz-Outbox; das Originalmedium ist dort bereits gebunden.'
        );
      let media: { url: string; filename: string; mimeType: string; size: number } | undefined;
      if (file) {
        const data = new FormData();
        data.append('file', file);
        media = (
          await api.post<{ data: typeof media }>(
            `/api/assistant/matrix/rooms/${encodeURIComponent(packet.room)}/media`,
            data
          )
        ).data.data;
      }
      if (scopeRef.current !== packet.scope || useAuthStore.getState().user?.id !== account)
        throw new Error(
          'Ziel oder Konto wurde während des Uploads geändert. Nachricht erneut prüfen.'
        );
      return deliverAssistant(
        `/api/assistant/matrix/rooms/${encodeURIComponent(packet.room)}/events`,
        {
          commandId: packet.commandId,
          type: 'm.room.message',
          nativeUserId: packet.nativeUserId,
          identityEpoch: packet.epoch,
          content: {
            msgtype: media
              ? media.mimeType.startsWith('image/')
                ? 'm.image'
                : media.mimeType.startsWith('audio/')
                  ? 'm.audio'
                  : media.mimeType.startsWith('video/')
                    ? 'm.video'
                    : 'm.file'
              : 'm.text',
            body: body || media?.filename || '',
            ...(media
              ? {
                  url: media.url,
                  info: { mimetype: media.mimeType, size: media.size },
                  filename: media.filename,
                }
              : {}),
            ...(root
              ? {
                  'm.relates_to': {
                    rel_type: 'm.thread',
                    event_id: root,
                    is_falling_back: true,
                    'm.in_reply_to': { event_id: packet.replyTo ?? root },
                  },
                }
              : {}),
          },
        },
        body.slice(0, 80) || media?.filename || 'Schwarm-Nachricht'
      );
    },
    onSuccess: (_data, packet) => {
      if (scopeRef.current !== packet.scope) return;
      setText((current) => (current.trim() === packet.body ? '' : current));
      setAttachment((current) => (current === packet.file ? null : current));
      setError('');
      refresh();
    },
    onError: (e, packet) => {
      if (scopeRef.current === packet.scope) setError(e.message);
    },
  });
  const react = useMutation({
    mutationFn: ({ eventId, key }: { eventId: string; key: string }) =>
      deliverAssistant(
        `/api/assistant/matrix/rooms/${encodeURIComponent(roomId)}/events`,
        {
          commandId: crypto.randomUUID(),
          type: 'm.reaction',
          nativeUserId: status.data?.userId,
          content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key } },
        },
        `Reaktion ${key}`
      ),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!(text.trim() || attachment) || send.isPending || orderDelay.remaining) return;
    const packet = {
      body: text.trim(),
      root: threadId,
      file: attachment,
      room: roomId,
      nativeUserId: status.data?.userId,
      epoch: status.data?.epoch,
      scope: deliveryScope,
      commandId: crypto.randomUUID(),
      replyTo: visible.at(-1)?.event_id,
    };
    if (/^!auftrag(?:\s|$)/i.test(packet.body)) orderDelay.stage(() => send.mutate(packet));
    else send.mutate(packet);
  };
  const loadOlder = async () => {
    const cursor = next ?? messages.data?.end ?? messages.data?.next_batch;
    if (!cursor || exhausted) return;
    setLoadingOlder(true);
    try {
      const query = new URLSearchParams({ from: cursor, ...(threadId ? { threadId } : {}) });
      const result = (
        await api.get<{ data: { chunk: Event[]; end?: string; next_batch?: string } }>(
          `/api/assistant/matrix/rooms/${encodeURIComponent(roomId)}/messages?${query}`
        )
      ).data.data;
      setOlder((old) => [...old, ...result.chunk]);
      setNext(result.end ?? result.next_batch);
      setExhausted(
        !result.chunk.length ||
          !(result.end ?? result.next_batch) ||
          (result.end ?? result.next_batch) === cursor
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verlauf nicht erreichbar');
    } finally {
      setLoadingOlder(false);
    }
  };
  const importHistory = async () => {
    importStop.current = false;
    setImporting(true);
    setError('');
    try {
      for (const room of rooms.data ?? []) {
        if (room.encrypted || importStop.current) continue;
        let complete = false;
        while (!complete && !importStop.current) {
          setImportProgress(`Historie: ${room.name}`);
          complete = (
            await api.post<{ data: { complete: boolean } }>(
              `/api/assistant/matrix/rooms/${encodeURIComponent(room.id)}/import`,
              { pages: 2 }
            )
          ).data.data.complete;
        }
      }
      setImportProgress(
        importStop.current
          ? 'Import pausiert; beim nächsten Start geht es weiter.'
          : 'Zugängliche unverschlüsselte Raumhistorien übernommen.'
      );
      refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Import unterbrochen; Fortschritt bleibt erhalten.'
      );
    } finally {
      setImporting(false);
    }
  };
  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-8">
      <AssistantOutbox />
      <header>
        <Link to="/" className="text-sm text-primary">
          Plum
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Dein Schwarm</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Native Agenten, Räume und Aufträge mit ihrer bestehenden Identität und Historie.
        </p>
      </header>
      {(error || status.error || rooms.error || messages.error) && (
        <p role="alert" className="rounded-md border border-destructive bg-card p-3">
          {error || status.error?.message || rooms.error?.message || messages.error?.message}
        </p>
      )}
      {status.isLoading ? (
        <p role="status">Verbindung wird geprüft …</p>
      ) : !status.data?.connected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
          className="max-w-xl space-y-4 rounded-lg border bg-card p-5"
        >
          <h2 className="font-semibold">Bestehendes Schwarm-Konto verbinden</h2>
          {!status.data?.configured && (
            <p className="text-sm text-muted-foreground">
              Der Homeserver muss für diese Installation noch eingerichtet werden.
            </p>
          )}
          <label className="grid gap-2 text-sm">
            Matrix-Benutzer
            <Input
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Passwort
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button disabled={login.isPending || !status.data?.configured}>
            {login.isPending ? 'Wird verbunden …' : 'Verbinden'}
          </Button>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{status.data.userId}</span>
            <Button variant="outline" disabled={importing} onClick={() => void importHistory()}>
              Historie übernehmen
            </Button>
            {importing && (
              <Button
                variant="outline"
                onClick={() => {
                  importStop.current = true;
                }}
              >
                Import pausieren
              </Button>
            )}
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await api.delete('/api/assistant/matrix/connection');
                  setRoomId('');
                  refresh();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : 'Verbindung konnte nicht getrennt werden'
                  );
                }
              }}
            >
              Plum-Verbindung trennen
            </Button>
          </div>
          {importProgress && (
            <p role="status" className="text-sm">
              {importProgress}
            </p>
          )}
          <SwarmControlPanel
            events={(rooms.data ?? []).flatMap((room) => room.state)}
            userId={status.data.userId ?? ''}
            onCommand={prepareCommand}
          />
          <RoomMembership
            key={status.data.epoch ?? status.data.userId}
            roomId={roomId}
            nativeUserId={status.data.userId ?? ''}
            epoch={status.data.epoch}
            onJoined={(id) => {
              setRoomId(id);
              setThreadId(undefined);
            }}
            onLeft={() => {
              setRoomId('');
              setThreadId(undefined);
            }}
          />
          {status.data.userId && status.data.epoch && (
            <NativePreferences
              key={`${account}:${status.data.epoch}`}
              nativeUserId={status.data.userId}
              epoch={status.data.epoch}
              onCommand={prepareCommand}
            />
          )}
          <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <Button
                variant="outline"
                disabled={openBrian.isPending}
                onClick={() => openBrian.mutate()}
              >
                Mit Brian sprechen
              </Button>
              <label className="grid gap-2 text-sm">
                Raum
                <select
                  className="w-full rounded-md border bg-background p-3"
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value);
                    setThreadId(undefined);
                  }}
                >
                  {rooms.data?.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>
              <h2 className="font-semibold">Agenten</h2>
              {rooms.data
                ?.flatMap((r) => r.agents)
                .map((agent) => (
                  <article key={agent.id} className="rounded-md border bg-card p-3">
                    <h3 className="font-medium">{agent.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {agent.state} · {agent.nativeId}
                    </p>
                    <p className="mt-2 text-sm">{agent.capabilities.join(' · ')}</p>
                  </article>
                ))}
              <h2 className="font-semibold">Befehle</h2>
              <div className="flex flex-wrap gap-2">
                {COMMANDS.map(([command, label]) => (
                  <Button
                    key={command}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const lobby = rooms.data?.find((r) => r.alias?.includes('#schwarm-lobby:'));
                      if (lobby) {
                        setRoomId(lobby.id);
                        setThreadId(undefined);
                      }
                      setText(command);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Der Hub entscheidet weiterhin über Rechte, Auftragszustand und Freigaben.
              </p>
            </aside>
            <section className="min-w-0 space-y-4">
              <header className="flex flex-wrap justify-between gap-3">
                <h2 className="text-lg font-semibold">{selected?.name ?? 'Raum'}</h2>
                {threadId && (
                  <Button variant="outline" size="sm" onClick={() => setThreadId(undefined)}>
                    Zum Raum zurück
                  </Button>
                )}
              </header>
              {selected?.encrypted ? (
                <p>Dieser Raum benötigt einen Client mit Ende-zu-Ende-Verschlüsselung.</p>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      loadingOlder ||
                      exhausted ||
                      !(next ?? messages.data?.end ?? messages.data?.next_batch)
                    }
                    onClick={() => void loadOlder()}
                  >
                    {loadingOlder ? 'Wird geladen …' : 'Ältere Nachrichten'}
                  </Button>
                  <div className="space-y-3">
                    {messages.isLoading ? (
                      <p role="status">Verlauf wird geladen …</p>
                    ) : (
                      visible.map((event) => (
                        <article key={event.event_id} className="rounded-md border bg-card p-4">
                          <div className="mb-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                            <span>{event.sender}</span>
                            <time>
                              {new Date(event.origin_server_ts ?? 0).toLocaleString('de-CH')}
                            </time>
                          </div>
                          {event.event_id &&
                            typeof event.content.url === 'string' &&
                            event.content.url.startsWith('mxc://') && (
                              <MatrixMedia roomId={roomId} event={event} />
                            )}
                          <div className="prose prose-sm max-w-none break-words dark:prose-invert">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {String(event.content.body ?? '')}
                            </ReactMarkdown>
                          </div>
                          {event.event_id && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setThreadId(
                                    (
                                      event.content['m.relates_to'] as
                                        | { rel_type?: string; event_id?: string }
                                        | undefined
                                    )?.event_id ?? event.event_id
                                  )
                                }
                              >
                                Thread öffnen
                              </Button>
                              {['✅', '❌', '👍', '👎', '🔕', '🔔', '🛑'].map((key) => (
                                <Button
                                  key={key}
                                  size="sm"
                                  variant="ghost"
                                  disabled={react.isPending}
                                  aria-label={`Reaktion ${key}`}
                                  onClick={() => react.mutate({ eventId: event.event_id!, key })}
                                >
                                  {key}
                                </Button>
                              ))}
                            </div>
                          )}
                        </article>
                      ))
                    )}
                  </div>
                  <form
                    onSubmit={submit}
                    className="sticky bottom-0 space-y-3 rounded-lg border bg-card p-4"
                  >
                    <label className="grid gap-2 text-sm">
                      {threadId ? 'Antwort im Thread' : 'Neue Nachricht'}
                      <textarea
                        disabled={send.isPending || !!orderDelay.remaining}
                        required={!attachment}
                        className="min-h-24 rounded-md border bg-background p-3"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      Datei hinzufügen
                      <input
                        type="file"
                        disabled={send.isPending || !!orderDelay.remaining}
                        onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {attachment && (
                      <p className="text-sm">
                        {attachment.name}{' '}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setAttachment(null)}
                        >
                          Entfernen
                        </Button>
                      </p>
                    )}
                    <label className="grid gap-1 text-sm">
                      Stimme zum Vorlesen
                      <select
                        className="rounded-md border bg-background p-2"
                        value={voice}
                        onChange={(event) => setVoice(event.target.value)}
                      >
                        <option value="">OmniVoice-Standard</option>
                        {voices.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name ?? item.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <VoiceComposer
                      text={String(
                        visible.filter((event) => event.sender !== status.data?.userId).at(-1)
                          ?.content.body ?? ''
                      )}
                      voice={
                        voice ||
                        voices.find((item) => item.id === voiceState?.standard)?.id ||
                        voices[0]?.id ||
                        'Rufus Beck'
                      }
                      scopeKey={`${account}:${status.data.epoch}:${roomId}:${threadId ?? ''}`}
                      onTranscription={(draft) =>
                        setText((previous) => (previous ? `${previous}\n${draft}` : draft))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={send.isPending || !!orderDelay.remaining || !roomId}>
                        {send.isPending ? 'Wird gesendet …' : 'Senden'}
                      </Button>
                      {!!orderDelay.remaining && (
                        <div role="status" className="grid gap-2 text-sm">
                          <p>
                            Auftrag wird in {orderDelay.remaining} s versendet. Beim Wechseln oder
                            Verlassen wird die Bedenkzeit verworfen.
                          </p>
                          <Button type="button" variant="outline" onClick={orderDelay.cancel}>
                            Auftrag zurücknehmen
                          </Button>
                        </div>
                      )}
                      {threadId && selected?.name.toLowerCase().includes('brian') && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={send.isPending}
                          onClick={() => {
                            orderDelay.cancel();
                            send.mutate({
                              body: '/stop',
                              root: threadId,
                              file: null,
                              room: roomId,
                              nativeUserId: status.data?.userId,
                              epoch: status.data?.epoch,
                              scope: deliveryScope,
                              commandId: crypto.randomUUID(),
                              replyTo: visible.at(-1)?.event_id,
                            });
                          }}
                        >
                          Brian stoppen
                        </Button>
                      )}
                    </div>
                  </form>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function MatrixMedia({ roomId, event }: { roomId: string; event: Event }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let created = '';
    void api
      .download(
        `/api/assistant/matrix/rooms/${encodeURIComponent(roomId)}/events/${encodeURIComponent(event.event_id!)}/media`
      )
      .then((response) => response.blob())
      .then((response) => {
        if (active) {
          created = URL.createObjectURL(response);
          setUrl(created);
        }
      })
      .catch(() => {
        if (active) setError('Datei nicht erreichbar');
      });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [roomId, event.event_id]);
  if (error)
    return (
      <p role="status" className="text-sm">
        {error}
      </p>
    );
  if (!url)
    return (
      <p role="status" className="text-sm">
        Datei wird geladen …
      </p>
    );
  const type = String(event.content.msgtype ?? '');
  return (
    <div className="mt-3 space-y-2">
      {type === 'm.image' && (
        <img
          src={url}
          alt={String(event.content.body ?? 'Bild')}
          className="max-h-96 max-w-full rounded-md object-contain"
        />
      )}
      {type === 'm.audio' && <audio controls preload="metadata" src={url} className="max-w-full" />}
      {type === 'm.video' && (
        <video controls preload="metadata" src={url} className="max-h-96 max-w-full" />
      )}
      <a
        href={url}
        download={String(event.content.filename ?? event.content.body ?? 'Datei')}
        className="text-sm text-primary underline"
      >
        Datei herunterladen
      </a>
    </div>
  );
}
