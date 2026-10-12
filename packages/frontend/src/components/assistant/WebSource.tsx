import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AssistantResource } from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { deliverAssistant } from '@/services/assistantOutbox';
import { Button } from '@/components/ui/button';
import { ResourcePicker } from './ResourcePicker';
import { AssistantOutbox } from './AssistantOutbox';

export function WebSourceImport({ onCreated }: { onCreated: (source: AssistantResource) => void }) {
  const owner = useAuthStore((s) => s.user?.id),
    [url, setUrl] = useState(''),
    [projects, setProjects] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="space-y-3 rounded-md border p-4" aria-label="Webquelle übernehmen">
      <h3 className="font-medium">Öffentliche Webquelle</h3>
      <p className="text-sm text-muted-foreground">
        Dokumenttext und Original mit Abrufdatum speichern. Für geschützte Seiten eine verbundene
        Browser- oder Kontositzung nutzen.
      </p>
      <label className="grid gap-1 text-sm">
        Webadresse
        <input
          type="url"
          className="min-w-0 rounded-md border bg-background p-2"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
      </label>
      <ResourcePicker
        label="Wissensprojekt für Webquelle"
        kind="project"
        maximum={1}
        value={projects}
        onChange={setProjects}
      />
      <Button
        disabled={busy || !url.trim()}
        onClick={async () => {
          const captured = owner;
          setBusy(true);
          setError('');
          try {
            const source = (await deliverAssistant(
              '/api/assistant/sources/import-url',
              { url: url.trim(), ...(projects[0] ? { projectId: projects[0] } : {}) },
              'Webquelle übernehmen'
            )) as { data: { data: AssistantResource } };
            if (useAuthStore.getState().user?.id === captured) {
              onCreated(source.data.data);
              setUrl('');
            }
          } catch (failure) {
            if (useAuthStore.getState().user?.id === captured)
              setError(
                failure instanceof Error
                  ? failure.message
                  : 'Webquelle konnte nicht übernommen werden'
              );
          } finally {
            if (useAuthStore.getState().user?.id === captured) setBusy(false);
          }
        }}
      >
        {busy ? 'Quelle wird abgerufen …' : 'Webquelle übernehmen'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AssistantOutbox />
    </section>
  );
}
interface Watch {
  revision: number;
  enabled: boolean;
  intervalMinutes: number;
  checkedAt: string | null;
  nextCheckAt: string | null;
  error: string | null;
}
export function WebSourceWatch({
  source,
  onUpdated,
}: {
  source: AssistantResource;
  onUpdated: (source: AssistantResource) => void;
}) {
  const owner = useAuthStore((s) => s.user?.id),
    [enabled, setEnabled] = useState(false),
    [interval, setIntervalMinutes] = useState(60),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const watch = useQuery({
    queryKey: ['assistant', 'web-watch', owner, source.id],
    queryFn: async () =>
      (await api.get<{ data: Watch }>(`/api/assistant/sources/${source.id}/watch`)).data.data,
    refetchInterval: 30000,
    enabled: source.body.capture === 'public-web',
  });
  const watchRevision = watch.data?.revision,
    currentEnabled = watch.data?.enabled,
    currentInterval = watch.data?.intervalMinutes;
  useEffect(() => {
    if (currentEnabled !== undefined && currentInterval !== undefined) {
      setEnabled(currentEnabled);
      setIntervalMinutes(currentInterval);
    }
  }, [watchRevision, currentEnabled, currentInterval]);
  if (source.body.capture !== 'public-web') return null;
  const configure = async () => {
    const captured = owner;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await deliverAssistant(
        `/api/assistant/sources/${source.id}/watch`,
        {
          expectedRevision: source.revision,
          expectedWatchRevision: watch.data?.revision ?? 0,
          enabled,
          intervalMinutes: interval,
        },
        'Quellenbeobachtung ändern'
      );
      if (useAuthStore.getState().user?.id === captured) {
        await watch.refetch();
        setNotice(
          enabled
            ? 'Beobachtung aktiviert. Änderungen erhalten eine neue Quellenrevision.'
            : 'Beobachtung beendet.'
        );
      }
    } catch (failure) {
      if (useAuthStore.getState().user?.id === captured)
        setError(
          failure instanceof Error ? failure.message : 'Beobachtung konnte nicht gespeichert werden'
        );
    } finally {
      if (useAuthStore.getState().user?.id === captured) setBusy(false);
    }
  };
  return (
    <section aria-label="Webquelle beobachten" className="space-y-3 rounded-md border p-3">
      <h3 className="font-medium">Webquelle beobachten</h3>
      <p className="text-sm text-muted-foreground">
        Neue Abrufe überschreiben keine älteren Revisionen. Unter Quellenbeobachtung kannst du
        zusätzlich Task-Vorschläge für Änderungen einrichten; ein Abruf startet keinen
        Agentenauftrag.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || watch.isLoading || !!watch.error}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Regelmässig prüfen
      </label>
      <label className="grid gap-1 text-sm">
        Abrufintervall
        <select
          className="min-w-0 rounded-md border bg-background p-2"
          value={interval}
          disabled={busy}
          onChange={(e) => setIntervalMinutes(Number(e.target.value))}
        >
          {[15, 30, 60, 180, 360, 1440].map((value) => (
            <option key={value} value={value}>
              {value < 60 ? `${value} Minuten` : `${value / 60} Stunden`}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !watch.data || !!watch.error}
          onClick={() => void configure()}
        >
          Beobachtung speichern
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            const captured = owner;
            setBusy(true);
            setError('');
            setNotice('');
            try {
              const response = (await deliverAssistant(
                `/api/assistant/sources/${source.id}/refresh`,
                { expectedRevision: source.revision },
                'Webquelle aktualisieren'
              )) as { data: { data: { source: AssistantResource; changed: boolean } } };
              if (useAuthStore.getState().user?.id === captured) {
                onUpdated(response.data.data.source);
                await watch.refetch();
                setNotice(
                  response.data.data.changed
                    ? 'Neue Quellenrevision gespeichert.'
                    : 'Geprüft: Original ist unverändert.'
                );
              }
            } catch (failure) {
              if (useAuthStore.getState().user?.id === captured)
                setError(failure instanceof Error ? failure.message : 'Abruf fehlgeschlagen');
            } finally {
              if (useAuthStore.getState().user?.id === captured) setBusy(false);
            }
          }}
        >
          Jetzt prüfen
        </Button>
      </div>
      {watch.data?.checkedAt && (
        <p className="text-xs text-muted-foreground">
          Letzter Abruf: {new Date(watch.data.checkedAt).toLocaleString()}
        </p>
      )}
      {watch.data?.error && (
        <p role="status" className="text-sm text-destructive">
          Letzter Abruf fehlgeschlagen: {watch.data.error}
        </p>
      )}
      {watch.error && (
        <p role="alert" className="text-sm text-destructive">
          {watch.error.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <AssistantOutbox />
    </section>
  );
}
