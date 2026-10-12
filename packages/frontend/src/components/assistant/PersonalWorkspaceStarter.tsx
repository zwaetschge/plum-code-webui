import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PERSONAL_WORKSPACES,
  type PersonalWorkspacePreset,
  type AssistantResource,
} from '@plum-code-webui/shared';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Packet = { commandId: string; preset: PersonalWorkspacePreset; title: string };
export function PersonalWorkspaceStarter({ onCreated }: { onCreated?: () => void }) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true);
  const [preset, setPreset] = useState<PersonalWorkspacePreset>('health'),
    [title, setTitle] = useState<string>(PERSONAL_WORKSPACES.health.title),
    [pending, setPending] = useState<Packet | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<{
      project: AssistantResource;
      profile: AssistantResource;
    } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function create(packet: Packet) {
    setPending(packet);
    setBusy(true);
    setError('');
    try {
      const value = (
        await api.post<{ data: NonNullable<typeof result> }>(
          '/api/assistant/personal-workspaces',
          packet
        )
      ).data.data;
      if (active.current && useAuthStore.getState().user?.id === owner) {
        setResult(value);
        setPending(null);
        onCreated?.();
      }
    } catch (failure) {
      if (active.current && useAuthStore.getState().user?.id === owner) {
        if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
          setPending(null);
        setError(
          failure instanceof Error ? failure.message : 'Bereich konnte nicht bestätigt werden.'
        );
      }
    } finally {
      if (active.current && useAuthStore.getState().user?.id === owner) setBusy(false);
    }
  }
  return (
    <details
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label="Persönliche Fachunterlagen"
    >
      <summary className="cursor-pointer font-medium">
        Gesundheits- und Finanzunterlagen ordnen
      </summary>
      <p className="text-sm text-muted-foreground">
        Ein eigener Wissensbereich mit Dokumentprofil. Erinnerungen sind zunächst ausgeschaltet.
        Unterlagen und Quellenstand wählst du selbst; Bank- und Gesundheitskonten werden dabei nicht
        verbunden.
      </p>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create({ commandId: crypto.randomUUID(), preset, title: title.trim() });
        }}
      >
        <label className="grid gap-1 text-sm">
          Dokumentbereich
          <select
            aria-label="Dokumentbereich"
            className="rounded-md border bg-background p-2"
            disabled={busy || !!pending}
            value={preset}
            onChange={(e) => {
              const key = e.target.value as PersonalWorkspacePreset;
              setPreset(key);
              setTitle(PERSONAL_WORKSPACES[key].title);
              setResult(null);
            }}
          >
            {Object.entries(PERSONAL_WORKSPACES).map(([key, value]) => (
              <option key={key} value={key}>
                {value.title}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm">{PERSONAL_WORKSPACES[preset].description}</p>
        <label className="grid gap-1 text-sm">
          Name des Wissensbereichs
          <Input
            aria-label="Name des Wissensbereichs"
            required
            maxLength={200}
            disabled={busy || !!pending}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <Button disabled={busy || !!pending || !title.trim()}>Bereich und Profil erstellen</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {pending && !busy && (
        <Button variant="outline" onClick={() => void create(pending)}>
          Dieselbe Erstellung bestätigen
        </Button>
      )}
      {result && (
        <div role="status" className="grid gap-2 text-sm">
          <p>{result.project.title} und das Dokumentprofil sind gespeichert.</p>
          <Link
            className="text-primary underline"
            to={`/assistant/sources?project=${result.project.id}`}
          >
            Unterlagen für diesen Bereich importieren
          </Link>
          <Link
            className="text-primary underline"
            to={`/assistant/profiles?resource=${result.profile.id}`}
          >
            Dokumentprofil ansehen
          </Link>
          <Link className="text-primary underline" to="/chat">
            Gespräch öffnen und Dokumentprofil auswählen
          </Link>
        </div>
      )}
    </details>
  );
}
