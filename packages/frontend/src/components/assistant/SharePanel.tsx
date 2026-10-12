import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import type { AssistantResource } from '@plum-code-webui/shared';
import { DocumentMembers } from './DocumentMembers';
import { PublicationPanel } from './PublicationPanel';
interface Share {
  id: string;
  resourceId: string;
  revision: number;
  expiresAt: string;
  revoked: number;
}
export function SharePanel({ resource }: { resource: AssistantResource }) {
  const account = useAuthStore((state) => state.user?.id);
  const cache = useQueryClient();
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const shares = useQuery({
    queryKey: ['assistant', 'shares', account],
    queryFn: async () => (await api.get<{ data: Share[] }>('/api/assistant/shares')).data.data,
  });
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await cache.invalidateQueries({ queryKey: ['assistant', 'shares'] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Freigabe fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <PublicationPanel
        key={`${account}:${resource.id}:${resource.revision}`}
        resource={resource}
      />
      <DocumentMembers resource={resource} />
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium">Diese Ergebnisversion teilen</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Der Link zeigt Revision {resource.revision} unverändert für angemeldete Plum-Konten. Er
            läuft nach sieben Tagen ab und lässt sich jederzeit widerrufen.
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const response = await api.post<{ data: { viewPath: string } }>(
                  '/api/assistant/shares',
                  {
                    resourceId: resource.id,
                    revision: resource.revision,
                    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
                  }
                );
                setUrl(new URL(response.data.data.viewPath, location.origin).href);
              })
            }
          >
            Link erstellen
          </Button>
          {url && (
            <label className="grid gap-1 text-sm">
              Freigabelink
              <input
                className="w-full rounded-md border bg-background p-2"
                readOnly
                value={url}
                onFocus={(event) => event.target.select()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(url)
                    .catch(() => setError('Link bitte aus dem Feld kopieren'))
                }
              >
                Link kopieren
              </Button>
            </label>
          )}
          {shares.data
            ?.filter((share) => share.resourceId === resource.id && !share.revoked)
            .map((share) => (
              <div key={share.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Revision {share.revision} · bis {new Date(share.expiresAt).toLocaleDateString()}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.delete('/api/assistant/shares/' + share.id);
                      setUrl('');
                    })
                  }
                >
                  Widerrufen
                </Button>
              </div>
            ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
