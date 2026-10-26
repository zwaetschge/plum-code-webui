import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import './chat-workspace.css';
interface Plan {
  frequency: string;
  timezone: string;
  time: string;
  days: number[];
  intervalMinutes: number;
  runAt?: string;
  endAt?: string | null;
}
interface Schedule {
  id: string;
  chatId: string;
  title: string;
  prompt: string;
  revision: number;
  plan: Plan;
  paused: boolean;
  nextAt: string | null;
  error?: string;
  runs: { id: string; slotAt: string; status: string; error?: string }[];
}
const initial: Plan = {
  frequency: 'daily',
  timezone: 'Europe/Zurich',
  time: '07:00',
  days: [1, 2, 3, 4, 5],
  intervalMinutes: 60,
};
export function ChatSchedulesPage() {
  const owner = useAuthStore((state) => state.user?.id);
  return <Schedules key={owner} owner={owner} />;
}
function Schedules({ owner }: { owner?: string }) {
  const [params] = useSearchParams(),
    cache = useQueryClient();
  const [chatId, setChatId] = useState(params.get('chat') ?? '');
  const [title, setTitle] = useState(''),
    [prompt, setPrompt] = useState(''),
    [plan, setPlan] = useState<Plan>(initial);
  const [editing, setEditing] = useState<Schedule | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const chats = useQuery({
    queryKey: ['assistant', 'schedule-chats', owner],
    queryFn: async () =>
      (await api.get<{ data: AssistantResource[] }>('/api/assistant/api-chats?limit=100')).data
        .data,
  });
  const schedules = useQuery({
    queryKey: ['assistant', 'chat-schedules', owner],
    queryFn: async () =>
      (await api.get<{ data: Schedule[] }>('/api/assistant/chat-schedules')).data.data,
    refetchInterval: 5000,
  });
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      if (useAuthStore.getState().user?.id === owner)
        await cache.invalidateQueries({ queryKey: ['assistant', 'chat-schedules', owner] });
    } catch (failure) {
      if (useAuthStore.getState().user?.id === owner)
        setError(
          failure instanceof Error ? failure.message : 'Zeitplan konnte nicht gespeichert werden'
        );
    } finally {
      if (useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  const save = (row?: Schedule, enabled = true) => {
    const payload = row
      ? {
          title: row.title,
          prompt: row.prompt,
          chatId: row.chatId,
          plan: row.plan,
          expectedRevision: row.revision,
        }
      : { title, prompt, chatId, plan, ...(editing ? { expectedRevision: editing.revision } : {}) };
    return act(async () => {
      const id = row?.id ?? editing?.id;
      if (id)
        await api.put(`/api/assistant/chat-schedules/${id}`, {
          ...payload,
          commandId: crypto.randomUUID(),
          enabled,
        });
      else
        await api.post('/api/assistant/chat-schedules', {
          ...payload,
          commandId: crypto.randomUUID(),
          enabled,
        });
      if (!row) {
        setEditing(null);
        setTitle('');
        setPrompt('');
      }
    });
  };
  const dateValue = (value?: string | null) =>
    value
      ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : '';
  return (
    <main className="chat-workspace-page h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-3xl font-semibold">Geplante Chats</h1>
        <form
          className="workspace-panel grid gap-3 rounded-2xl p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <select
            aria-label="Zielgespräch"
            className="workspace-field w-full rounded-xl border p-3"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            disabled={busy}
          >
            <option value="">Gespräch wählen</option>
            {chats.data
              ?.filter((item) => !item.body.temporary)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </select>
          <input
            aria-label="Zeitplantitel"
            placeholder="Titel"
            className="workspace-field rounded-xl border p-3"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <textarea
            aria-label="Geplante Nachricht"
            placeholder="Was soll Plum dann bearbeiten?"
            className="workspace-field rounded-xl border p-3"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={20000}
          />
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <select
              aria-label="Häufigkeit"
              className="workspace-field min-w-0 rounded-xl border p-3"
              value={plan.frequency}
              onChange={(e) => setPlan({ ...plan, frequency: e.target.value })}
            >
              <option value="once">Einmal</option>
              <option value="interval">Intervall</option>
              <option value="daily">Täglich</option>
              <option value="weekly">Wöchentlich</option>
            </select>
            <input
              aria-label="Zeitzone"
              className="workspace-field min-w-0 rounded-xl border p-3"
              value={plan.timezone}
              onChange={(e) => setPlan({ ...plan, timezone: e.target.value })}
            />
            {plan.frequency === 'once' ? (
              <input
                aria-label="Ausführungszeitpunkt"
                className="workspace-field min-w-0 rounded-xl border p-3"
                type="datetime-local"
                value={dateValue(plan.runAt)}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    runAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                  })
                }
              />
            ) : plan.frequency === 'interval' ? (
              <label className="grid gap-1 text-sm">
                Alle Minuten
                <input
                  aria-label="Intervall in Minuten"
                  className="workspace-field min-w-0 rounded-xl border p-3"
                  type="number"
                  min={5}
                  max={10080}
                  value={plan.intervalMinutes}
                  onChange={(e) => setPlan({ ...plan, intervalMinutes: Number(e.target.value) })}
                />
              </label>
            ) : (
              <label className="grid gap-1 text-sm">
                Uhrzeit
                <input
                  aria-label="Uhrzeit"
                  className="workspace-field min-w-0 rounded-xl border p-3"
                  type="time"
                  value={plan.time}
                  onChange={(e) => setPlan({ ...plan, time: e.target.value })}
                />
              </label>
            )}
            <label className="grid min-w-0 gap-1 text-sm">
              Enddatum
              <input
                aria-label="Enddatum"
                className="workspace-field min-w-0 rounded-xl border p-3"
                type="datetime-local"
                value={dateValue(plan.endAt)}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    endAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </label>
          </div>
          {plan.frequency === 'weekly' && (
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-2 text-sm">Wochentage</legend>
              {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, index) => (
                <label key={day} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={plan.days.includes(index)}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        days: e.target.checked
                          ? [...plan.days, index]
                          : plan.days.filter((item) => item !== index),
                      })
                    }
                  />
                  {day}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex gap-2">
            <Button disabled={busy || !chatId || !title.trim() || !prompt.trim()}>
              {editing ? 'Zeitplan ändern' : 'Zeitplan aktivieren'}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setTitle('');
                  setPrompt('');
                  setPlan(initial);
                }}
              >
                Abbrechen
              </Button>
            )}
          </div>
        </form>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {schedules.data?.map((row) => (
          <article key={row.id} className="workspace-panel space-y-3 rounded-2xl p-4">
            <h2 className="text-lg font-semibold">{row.title}</h2>
            <p className="whitespace-pre-wrap">{row.prompt}</p>
            <p className="text-sm">
              {row.paused
                ? 'Pausiert'
                : row.nextAt
                  ? `Nächster Lauf: ${new Date(row.nextAt).toLocaleString('de-CH', { timeZone: row.plan.timezone })}`
                  : 'Abgeschlossen'}{' '}
              · {row.plan.timezone}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void save(row, row.paused)}>
                {row.paused ? 'Fortsetzen' : 'Pausieren'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-foreground hover:text-foreground"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    api.post(`/api/assistant/chat-schedules/${row.id}/run`, {
                      commandId: crypto.randomUUID(),
                    })
                  )
                }
              >
                Jetzt ausführen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(row);
                  setChatId(row.chatId);
                  setTitle(row.title);
                  setPrompt(row.prompt);
                  setPlan(row.plan);
                }}
              >
                Bearbeiten
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    api.delete(`/api/assistant/chat-schedules/${row.id}`, {
                      body: JSON.stringify({ expectedRevision: row.revision }),
                    })
                  )
                }
              >
                Entfernen
              </Button>
              <Link className="p-2 text-sm underline" to={`/chat/model/${row.chatId}`}>
                Ergebnisse im Chat
              </Link>
            </div>
            {row.error && (
              <p role="alert" className="text-destructive">
                {row.error}
              </p>
            )}
            {!!row.runs.length && (
              <details>
                <summary className="cursor-pointer text-sm">Letzte Läufe</summary>
                {row.runs.map((run) => (
                  <p className="py-1 text-sm" key={run.id}>
                    {run.slotAt.startsWith('manual:')
                      ? 'Manuell'
                      : new Date(run.slotAt).toLocaleString('de-CH')}{' '}
                    ·{' '}
                    {(
                      {
                        accepted: 'Im Chat',
                        pending: 'Wartet',
                        dispatching: 'Wird übergeben',
                        failed: 'Fehlgeschlagen',
                        cancelled: 'Abgebrochen',
                      } as Record<string, string>
                    )[run.status] ?? run.status}
                    {run.error ? ' · ' + run.error : ''}
                  </p>
                ))}
              </details>
            )}
          </article>
        ))}
        {schedules.isError && <p role="alert">Zeitpläne konnten nicht geladen werden.</p>}
      </div>
    </main>
  );
}
