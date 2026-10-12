import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';
import { AppTaskProposal } from './AppTaskProposal';
export function AppPreview({
  artifact,
  content,
  readOnly,
  shareToken,
}: {
  artifact: AssistantResource;
  content: string;
  readOnly: boolean;
  shareToken?: string;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null),
    version = useRef(0),
    queue = useRef(Promise.resolve()),
    generation = useRef(0);
  const [grant, setGrant] = useState<string | null>(null),
    [actionGrant, setActionGrant] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{ channel: string; path: string } | null>(null),
    [reload, setReload] = useState(0);
  const owner = useAuthStore((s) => s.user?.id);
  const permissionKey = JSON.stringify([owner, artifact.id, artifact.revision, content]);
  const enabled = grant === permissionKey;
  const actionsEnabled = actionGrant === permissionKey;
  const setEnabled = (active: boolean) => setGrant(active ? permissionKey : null);
  const channel = useMemo(
    () =>
      [
        artifact.id,
        artifact.revision,
        content.length,
        enabled,
        actionsEnabled,
        Boolean(owner),
        Boolean(shareToken),
        reload,
        crypto.randomUUID(),
      ].join(':'),
    [artifact.id, artifact.revision, content, enabled, actionsEnabled, owner, shareToken, reload]
  );
  useEffect(() => {
    setGrant(null);
    setActionGrant(null);
    setBusy(false);
    setError('');
    version.current = 0;
    generation.current++;
  }, [permissionKey]);
  const allowState = !readOnly && artifact.body.type === 'app' && content === artifact.body.content;
  useEffect(() => {
    if (!allowState) {
      setGrant(null);
      setActionGrant(null);
    }
  }, [allowState]);
  useEffect(() => {
    let current = true;
    setError('');
    // An independently served document can use its sandbox CSP without weakening Plum's CSP.
    const timer = setTimeout(() => {
      void api
        .post<{ data: { path: string } }>('/api/assistant/app-frames', {
          ...(shareToken
            ? { shareToken }
            : { artifactId: artifact.id, revision: artifact.revision, content }),
          channel,
          stateEnabled: enabled && allowState,
          actionsEnabled: actionsEnabled && allowState,
        })
        .then((result) => {
          if (current && useAuthStore.getState().user?.id === owner)
            setPreview({ channel, path: result.data.data.path });
        })
        .catch((failure) => {
          if (current)
            setError(
              failure instanceof Error ? failure.message : 'Vorschau konnte nicht geladen werden'
            );
        });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [
    artifact.id,
    artifact.revision,
    content,
    channel,
    shareToken,
    enabled,
    actionsEnabled,
    owner,
    allowState,
  ]);
  useLayoutEffect(() => {
    setBusy(false);
    if (!enabled || !allowState) return;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        event.data?.channel !== channel ||
        !Number.isSafeInteger(event.data.id) ||
        !['load', 'save'].includes(event.data.action)
      )
        return;
      const epoch = generation.current,
        source = event.source as Window,
        { action, id, state } = event.data;
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          if (epoch !== generation.current) return;
          if (useAuthStore.getState().user?.id !== owner) return;
          setBusy(true);
          setError('');
          try {
            const result = (
              action === 'load'
                ? await api.get<{ data: { version: number; state: unknown } }>(
                    `/api/assistant/artifacts/${artifact.id}/state?revision=${artifact.revision}`
                  )
                : await api.patch<{ data: { version: number; state: unknown } }>(
                    `/api/assistant/artifacts/${artifact.id}/state`,
                    { revision: artifact.revision, expectedVersion: version.current, state }
                  )
            ).data.data;
            if (epoch !== generation.current || useAuthStore.getState().user?.id !== owner) return;
            version.current = result.version;
            source.postMessage({ channel, id, state: result.state }, '*');
          } catch (failure) {
            if (epoch !== generation.current) return;
            const message =
              failure instanceof Error
                ? failure.message
                : 'App-Eingaben konnten nicht gespeichert werden';
            setError(message);
            source.postMessage({ channel, id, error: message }, '*');
          } finally {
            if (epoch === generation.current) setBusy(false);
          }
        });
    };
    const lifecycle = { generation };
    window.addEventListener('message', receive);
    return () => {
      lifecycle.generation.current++;
      window.removeEventListener('message', receive);
    };
  }, [enabled, allowState, channel, owner, artifact.id, artifact.revision]);
  return (
    <section className="space-y-3" aria-label="Interaktive App-Vorschau">
      {!readOnly && artifact.body.type === 'app' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !allowState}
            onClick={() => {
              version.current = 0;
              setEnabled(!enabled);
            }}
          >
            {enabled
              ? 'Speichern von Eingaben beenden'
              : 'Speichern persönlicher Eingaben aktivieren'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const epoch = generation.current;
              setBusy(true);
              void api
                .get<{ data: { version: number } }>(
                  `/api/assistant/artifacts/${artifact.id}/state?revision=${artifact.revision}`
                )
                .then((result) => {
                  if (epoch !== generation.current) return;
                  return api.patch(`/api/assistant/artifacts/${artifact.id}/state`, {
                    revision: artifact.revision,
                    expectedVersion: result.data.data.version,
                    state: null,
                  });
                })
                .then(() => {
                  if (epoch !== generation.current) return;
                  setEnabled(false);
                  version.current = 0;
                  setError('');
                })
                .catch((failure) => {
                  if (epoch === generation.current) setError(failure.message);
                })
                .finally(() => {
                  if (epoch === generation.current) setBusy(false);
                });
            }}
          >
            Gespeicherte Eingaben löschen
          </Button>
          <p className="text-xs text-muted-foreground">
            Persönliche Eingaben gelten für diese App-Version und dein Konto. Die App kann sie nach
            Aktivierung laden und speichern.
            {!allowState && ' Die bearbeitete App zuerst als Revision speichern.'}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!allowState}
            className="h-auto min-h-9 max-w-full whitespace-normal"
            onClick={() => setActionGrant(actionsEnabled ? null : permissionKey)}
          >
            {actionsEnabled
              ? 'Task-Vorschläge der App beenden'
              : 'Task-Vorschläge dieser App aktivieren'}
          </Button>
        </div>
      )}
      {preview?.channel === channel ? (
        <iframe
          key={`frame:${channel}`}
          ref={frame}
          title={artifact.title}
          sandbox="allow-scripts"
          src={preview.path}
          referrerPolicy="no-referrer"
          className="h-[32rem] w-full rounded-md border bg-white"
        />
      ) : (
        <p role="status">Vorschau wird geladen …</p>
      )}
      {actionsEnabled && allowState && (
        <AppTaskProposal
          key={`task:${channel}`}
          frame={frame}
          channel={channel}
          artifact={artifact}
        />
      )}
      <Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>
        Vorschau neu laden
      </Button>
      {busy && (
        <p role="status" className="text-xs">
          App-Eingaben werden verarbeitet …
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
