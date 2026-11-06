import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
type Proposal = { title: string; goal: string };
type Packet = Proposal & { commandId: string; revision: number };
/** Widgets can propose a draft. Only a visible, deliberate host action writes it. */
export function AppTaskProposal({
  frame,
  channel,
  artifact,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  channel: string;
  artifact: AssistantResource;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true),
    occupied = useRef(false);
  const [proposal, setProposal] = useState<Proposal | null>(null),
    [packet, setPacket] = useState<Packet | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [task, setTask] = useState<AssistantResource | null>(null);
  useEffect(() => {
    active.current = true;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        event.data?.channel !== channel ||
        !Number.isSafeInteger(event.data.id) ||
        event.data.action !== 'propose-task' ||
        useAuthStore.getState().user?.id !== owner
      )
        return;
      const value = event.data.state;
      if (
        occupied.current ||
        !value ||
        typeof value.title !== 'string' ||
        !value.title.trim() ||
        value.title.length > 200 ||
        typeof value.goal !== 'string' ||
        !value.goal.trim() ||
        value.goal.length > 4000
      ) {
        (event.source as Window).postMessage(
          {
            channel,
            id: event.data.id,
            error: 'Einen gültigen Vorschlag senden und zuerst den offenen Vorschlag prüfen.',
          },
          '*'
        );
        return;
      }
      occupied.current = true;
      setProposal({ title: value.title.trim(), goal: value.goal.trim() });
      setTask(null);
      setError('');
      (event.source as Window).postMessage(
        { channel, id: event.data.id, result: { status: 'review' } },
        '*'
      );
    };
    window.addEventListener('message', receive);
    return () => {
      active.current = false;
      window.removeEventListener('message', receive);
    };
  }, [frame, channel, owner]);
  async function confirm(value: Packet) {
    setPacket(value);
    setBusy(true);
    setError('');
    try {
      const created = (
        await api.post<{ data: AssistantResource }>(
          `/api/assistant/artifacts/${artifact.id}/app-task`,
          value
        )
      ).data.data;
      if (active.current && useAuthStore.getState().user?.id === owner) {
        setTask(created);
        setProposal(null);
        setPacket(null);
        occupied.current = false;
      }
    } catch (failure) {
      if (active.current && useAuthStore.getState().user?.id === owner) {
        if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
          setPacket(null);
        setError(
          failure instanceof Error ? failure.message : 'Task-Entwurf wurde nicht bestätigt.'
        );
      }
    } finally {
      if (active.current && useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-md border p-3" aria-label="App-Vorschläge prüfen">
      <p className="text-xs text-muted-foreground">
        Die App darf einen Task vorschlagen. Prüfe und bearbeite ihn hier; erst deine Übernahme
        erstellt einen Entwurf. Konto-, Provider- und Werkzeugzugänge bleiben im Host.
      </p>
      {proposal && (
        <>
          <label className="grid gap-1 text-sm">
            Vorgeschlagener Tasktitel
            <input
              aria-label="Vorgeschlagener Tasktitel"
              maxLength={200}
              disabled={busy || !!packet}
              value={proposal.title}
              onChange={(e) => setProposal({ ...proposal, title: e.target.value })}
              className="rounded-md border bg-background p-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Vorgeschlagenes Taskziel
            <textarea
              aria-label="Vorgeschlagenes Taskziel"
              maxLength={4000}
              disabled={busy || !!packet}
              value={proposal.goal}
              onChange={(e) => setProposal({ ...proposal, goal: e.target.value })}
              className="min-h-24 rounded-md border bg-background p-2"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !proposal.title.trim() || !proposal.goal.trim()}
              className="h-auto min-h-9 max-w-full whitespace-normal"
              onClick={() =>
                void confirm(
                  packet ?? {
                    ...proposal,
                    revision: artifact.revision,
                    commandId: crypto.randomUUID(),
                  }
                )
              }
            >
              {packet ? 'Denselben App-Task bestätigen' : 'Geprüften Vorschlag als Task übernehmen'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setProposal(null);
                setPacket(null);
                occupied.current = false;
                setError('');
              }}
            >
              Lokalen Vorschlag verwerfen
            </Button>
          </div>
        </>
      )}
      {task && (
        <p className="text-sm">
          Task-Entwurf erstellt:{' '}
          <Link
            className="underline"
            to={`/assistant/tasks?resource=${encodeURIComponent(task.id)}`}
          >
            {task.title}
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
