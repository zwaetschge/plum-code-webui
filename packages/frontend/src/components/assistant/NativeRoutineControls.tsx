import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AssistantAgent, AssistantResource } from '@plum-code-webui/shared';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { deliverAssistant } from '@/services/assistantOutbox';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';

interface NativeRoutine {
  name: string;
  zeitplan: string;
  agent: string;
  ziel: string;
  pausiert: boolean;
  naechster?: string | null;
  fehler?: string;
  letzter?: { auftrag: string; zustand: string; zeit?: string };
}
interface Room {
  id: string;
  alias: string | null;
  agents: AssistantAgent[];
  state: Array<{
    type: string;
    sender: string;
    content: { v?: number; routinen?: NativeRoutine[] };
  }>;
}
export function NativeRoutineControls({ routine }: { routine: AssistantResource }) {
  const owner = useAuthStore((s) => s.user?.id),
    mounted = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [delivered, setDelivered] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const status = useQuery({
    queryKey: ['assistant', 'matrix-status', owner],
    queryFn: async () =>
      (
        await api.get<{ data: { connected: boolean; userId?: string; epoch?: string } }>(
          '/api/assistant/matrix/status'
        )
      ).data.data,
  });
  const rooms = useQuery({
    queryKey: ['assistant', 'matrix-rooms', owner, status.data?.epoch],
    queryFn: async () => (await api.get<{ data: Room[] }>('/api/assistant/matrix/rooms')).data.data,
    enabled: Boolean(status.data?.connected),
    refetchInterval: 5000,
  });
  const lobby = rooms.data?.find((room) => room.alias?.startsWith('#schwarm-lobby:'));
  const name = `plum-${routine.id.replace(/-/g, '')}`;
  const hub = `@schwarm:${status.data?.userId?.split(':').slice(1).join(':')}`;
  const native = lobby?.state
    .filter(
      (event) =>
        event.type === 'ch.zwaetschge.swarm.routinen' &&
        event.sender === hub &&
        (event.content.v === undefined || event.content.v === 1)
    )
    .flatMap((event) => event.content.routinen ?? [])
    .filter(
      (item) =>
        item &&
        typeof item.name === 'string' &&
        typeof item.zeitplan === 'string' &&
        typeof item.agent === 'string' &&
        typeof item.ziel === 'string' &&
        typeof item.pausiert === 'boolean'
    )
    .find((item) => item.name === name);
  const agentId = String(routine.body.agentId ?? '');
  const agent = rooms.data
    ?.flatMap((room) => room.agents)
    .find(
      (item) =>
        item.id === agentId &&
        !item.retired &&
        item.schemaVersion === 1 &&
        ['native', 'worker'].includes(item.mode ?? '')
    );
  const schedule = String(routine.body.schedule ?? '').trim();
  const goal = String(routine.body.goal ?? '').trim();
  const canCreate = Boolean(
    lobby &&
    agent?.nativeId &&
    /^[-a-zA-Z0-9_/]+$/.test(agent.nativeId) &&
    schedule &&
    !/[\r\n@]/.test(schedule) &&
    routine.body.timezone === 'Europe/Zurich' &&
    goal
  );
  const changed = Boolean(
    native &&
    (routine.body.timezone !== 'Europe/Zurich' ||
      native.zeitplan !== schedule ||
      native.agent !== agent?.nativeId ||
      native.ziel.replace(/\s+/g, ' ') !== goal.replace(/\s+/g, ' '))
  );
  async function command(action: 'neu' | 'pause' | 'weiter' | 'jetzt') {
    if (!lobby || !status.data?.userId) return;
    setBusy(true);
    setError('');
    setDelivered(false);
    const content =
      action === 'neu'
        ? `!routine neu ${name} ${schedule} @${agent!.nativeId} ${goal}`
        : `!routine ${action} ${name}`;
    try {
      await deliverAssistant(
        `/api/assistant/matrix/rooms/${encodeURIComponent(lobby.id)}/events`,
        {
          type: 'm.room.message',
          nativeUserId: status.data.userId,
          content: { msgtype: 'm.text', body: content },
        },
        `${routine.title}: Routine ${action}`
      );
      if (mounted.current && useAuthStore.getState().user?.id === owner) {
        setDelivered(true);
        await rooms.refetch();
      }
    } catch (failure) {
      if (mounted.current && useAuthStore.getState().user?.id === owner)
        setError(
          failure instanceof Error ? failure.message : 'Zustellung unbestätigt; Outbox prüfen.'
        );
    } finally {
      if (mounted.current && useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  return (
    <section aria-label="Native Routine" className="space-y-3 rounded-md border bg-card p-3">
      <h3 className="font-medium">Zeitplan im Schwarm</h3>
      <p className="text-sm">
        {native
          ? native.pausiert
            ? 'Vom Hub bestätigt: pausiert'
            : 'Vom Hub bestätigt: aktiv'
          : 'Gespeicherte Vorlage; noch kein bestätigter nativer Zeitplan.'}
      </p>
      <p className="text-xs text-muted-foreground">
        Native Kennung: {name}. Der bestehende Koordinator plant die Läufe in Europe/Zurich. Ein
        lokales Vorlagenfeld bestätigt keine Aktivierung.
      </p>
      {!status.data?.connected && (
        <Link to="/swarm" className="text-sm underline">
          Schwarm verbinden
        </Link>
      )}
      {!native && !canCreate && status.data?.connected && (
        <p className="text-sm">
          Vorlage bearbeiten: registrierten nativen Agenten, Zeitplan und Europe/Zurich wählen.
          Beispielsweise „werktags 07:00“, „mo,do 18:00“ oder „alle 30 min“.
        </p>
      )}
      {native && (
        <>
          <p className="text-sm">
            {native.zeitplan} · {native.agent}
          </p>
          <p className="whitespace-pre-wrap text-sm">{native.ziel}</p>
          {native.naechster && (
            <p className="text-sm">
              Nächster Lauf:{' '}
              {new Date(native.naechster).toLocaleString('de-CH', { timeZone: 'Europe/Zurich' })}
            </p>
          )}
          {native.letzter && (
            <Link className="text-sm underline" to={`/swarm?room=${encodeURIComponent(lobby!.id)}`}>
              Letzter Auftrag: {native.letzter.auftrag} · {native.letzter.zustand}
            </Link>
          )}
          {native.fehler && (
            <p role="alert" className="text-sm text-destructive">
              {native.fehler}
            </p>
          )}
          {changed && (
            <p className="text-sm">
              Der bestätigte Zeitplan verwendet eine andere Vorlage. Lokale Änderungen ersetzen ihn
              nicht automatisch; bestehende Routine im Schwarm bearbeiten.
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!native ? (
          <Button size="sm" disabled={busy || !canCreate} onClick={() => void command('neu')}>
            Im Schwarm aktivieren
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void command(native.pausiert ? 'weiter' : 'pause')}
            >
              {native.pausiert ? 'Fortsetzen' : 'Pausieren'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void command('jetzt')}
            >
              Jetzt einmal ausführen
            </Button>
          </>
        )}
        <Link
          to={`/swarm${lobby ? `?room=${encodeURIComponent(lobby.id)}` : ''}`}
          className="self-center text-sm underline"
        >
          Hub-Rückmeldung öffnen
        </Link>
      </div>
      {delivered && (
        <p role="status" className="text-sm">
          Befehl zugestellt. Erst ein neuer Hub-Stand bestätigt die Änderung.
        </p>
      )}
      {(error || status.error || rooms.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || status.error?.message || rooms.error?.message}
        </p>
      )}
    </section>
  );
}
