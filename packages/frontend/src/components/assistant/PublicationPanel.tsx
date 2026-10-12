import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import type { AssistantResource } from '@plum-code-webui/shared';
type Release = {
  id: string;
  resourceId: string;
  revision: number;
  expiresAt: string;
  revoked: boolean;
  path?: string;
  url?: string;
};
type Packet = {
  commandId: string;
  resourceId: string;
  revision: number;
  expiresAt: string;
  acknowledgePublic: true;
};
export function PublicationPanel({ resource }: { resource: AssistantResource }) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true);
  const [opened, setOpened] = useState(false),
    [enabled, setEnabled] = useState(false),
    [items, setItems] = useState<Release[]>([]),
    [ack, setAck] = useState(false),
    [days, setDays] = useState('7'),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Packet | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const accepts = () => active.current && useAuthStore.getState().user?.id === owner;
  async function load() {
    try {
      const value = (
        await api.get<{ data: { enabled: boolean; items: Release[] } }>(
          `/api/assistant/publications?resourceId=${resource.id}`
        )
      ).data.data;
      if (accepts()) {
        setEnabled(value.enabled);
        setItems(value.items);
      }
    } catch (e) {
      if (accepts())
        setError(
          e instanceof Error ? e.message : 'Veröffentlichungen konnten nicht geladen werden.'
        );
    }
  }
  async function publish(packet: Packet) {
    setPending(packet);
    setBusy(true);
    setError('');
    try {
      const item = (await api.post<{ data: Release }>('/api/assistant/publications', packet)).data
        .data;
      if (accepts()) {
        setItems((old) => [item, ...old.filter((r) => r.id !== item.id)]);
        setPending(null);
        setAck(false);
      }
    } catch (e) {
      if (accepts()) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) setPending(null);
        setError(e instanceof Error ? e.message : 'Veröffentlichung wurde nicht bestätigt.');
      }
    } finally {
      if (accepts()) setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/assistant/publications/${id}`);
      if (accepts())
        setItems((old) => old.map((item) => (item.id === id ? { ...item, revoked: true } : item)));
    } catch (e) {
      if (accepts())
        setError(e instanceof Error ? e.message : 'Widerruf konnte nicht bestätigt werden.');
    } finally {
      if (accepts()) setBusy(false);
    }
  }
  if (!['app', 'design', 'document'].includes(String(resource.body.type))) return null;
  return (
    <details
      className="space-y-3 rounded-md border p-3"
      onToggle={(e) => {
        if (e.currentTarget.open && !opened) {
          setOpened(true);
          void load();
        }
      }}
    >
      <summary className="cursor-pointer font-medium">Öffentliche Version veröffentlichen</summary>
      <p className="text-sm text-muted-foreground">
        Dieser Link ist ohne Plum-Anmeldung lesbar. Er enthält ausschliesslich die gewählte
        Ergebnisversion und ihre eingebetteten Bilder. Persönlicher Appzustand und Plum-Aktionen
        werden nicht freigegeben. Ablauf und Widerruf sperren neue Abrufe; bereits gespeicherte
        Kopien bleiben beim Empfänger.
      </p>
      {opened && !enabled && (
        <p role="status" className="text-sm">
          Öffentliche Veröffentlichungen sind in dieser Installation nicht aktiviert.
        </p>
      )}
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void publish({
            commandId: crypto.randomUUID(),
            resourceId: resource.id,
            revision: resource.revision,
            expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString(),
            acknowledgePublic: true,
          });
        }}
      >
        <label className="grid gap-1 text-sm">
          Öffentlicher Link gültig für
          <select
            aria-label="Öffentlicher Link gültig für"
            className="rounded-md border bg-background p-2"
            value={days}
            disabled={busy || !!pending || !enabled}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="1">1 Tag</option>
            <option value="7">7 Tage</option>
            <option value="30">30 Tage</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Diese Version darf öffentlich gelesen werden"
            checked={ack}
            disabled={busy || !!pending || !enabled}
            onChange={(e) => setAck(e.target.checked)}
          />
          Diese Version {resource.revision} darf öffentlich gelesen werden.
        </label>
        <Button disabled={busy || !!pending || !enabled || !ack}>
          Diese Version öffentlich veröffentlichen
        </Button>
      </form>
      {pending && !busy && (
        <Button variant="outline" onClick={() => void publish(pending)}>
          Dieselbe Veröffentlichung bestätigen
        </Button>
      )}
      {items
        .filter((item) => item.resourceId === resource.id)
        .map((item) => (
          <div key={item.id} className="grid gap-2 rounded-md border p-3 text-sm">
            <p>
              Revision {item.revision} ·{' '}
              {item.revoked
                ? 'Widerrufen'
                : Date.parse(item.expiresAt) <= Date.now()
                  ? 'Abgelaufen'
                  : `Gültig bis ${new Date(item.expiresAt).toLocaleString()}`}
            </p>
            {!item.revoked && Date.parse(item.expiresAt) > Date.now() && (
              <>
                <label className="grid gap-1">
                  Öffentlicher Versionslink
                  <input
                    aria-label={`Öffentlicher Versionslink ${item.revision}`}
                    readOnly
                    className="min-w-0 rounded-md border bg-background p-2"
                    value={item.url ?? (item.path ? new URL(item.path, location.origin).href : '')}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={busy || !!pending}
                  onClick={() => void revoke(item.id)}
                >
                  Öffentliche Version widerrufen
                </Button>
              </>
            )}
          </div>
        ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
