import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type {
  AssistantApiProvider,
  AssistantApiTurn,
  AssistantResource,
} from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ChatRichText } from './ChatRichText';

interface Options {
  webSearch: boolean;
  mcpServerIds: string[];
  allowToolWrites: boolean;
  comparisonModels: Array<{ providerId: string; model: string }>;
  temperature?: number;
  maxOutputTokens: number;
  contextTurns: number;
  fullDocuments: boolean;
}
const defaults: Options = {
  webSearch: false,
  mcpServerIds: [],
  allowToolWrites: false,
  comparisonModels: [],
  maxOutputTokens: 8192,
  contextTurns: 20,
  fullDocuments: false,
};
async function saveDownload(path: string, name: string) {
  const response = await api.download(path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function ChatImport({
  providers,
  onImported,
}: {
  providers: AssistantApiProvider[];
  onImported?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(''),
    [error, setError] = useState('');
  const navigate = useNavigate(),
    owner = useAuthStore((s) => s.user?.id);
  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer rounded-md border px-3 py-2 text-sm">
        Chats importieren
        <input
          aria-label="Chats importieren"
          className="sr-only"
          type="file"
          accept="application/json,.json"
          disabled={busy || !providers.length}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            setError('');
            setResult('');
            void (async () => {
              try {
                const provider = providers[0]!;
                const form = new FormData();
                form.append('file', file);
                form.append('providerId', provider.id);
                form.append('model', provider.models[0]!);
                const imported = (
                  await api.post<{
                    data: {
                      chats: Array<{ id: string }>;
                      count: number;
                      attachmentNotice?: string;
                    };
                  }>('/api/assistant/api-chats/import', form)
                ).data.data;
                if (useAuthStore.getState().user?.id !== owner) return;
                setResult(
                  `${imported.count} Gespräche importiert${imported.attachmentNotice ? ' · ' + imported.attachmentNotice : ''}`
                );
                onImported?.();
                if (!imported.attachmentNotice && imported.chats[0])
                  navigate('/chat/model/' + imported.chats[0].id);
              } catch (failure) {
                if (useAuthStore.getState().user?.id === owner)
                  setError(failure instanceof Error ? failure.message : 'Import fehlgeschlagen');
              } finally {
                if (useAuthStore.getState().user?.id === owner) setBusy(false);
              }
            })();
          }}
        />
      </label>
      {busy && <p role="status">Importiert …</p>}
      {result && (
        <p role="status" className="text-sm">
          {result}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export function ChatWorkbench({
  chat,
  providers,
  disabled,
  onSaved,
}: {
  chat: AssistantResource;
  providers: AssistantApiProvider[];
  disabled: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(new URLSearchParams(window.location.search).has('workbench'));
  const [options, setOptions] = useState<Options>({
    ...defaults,
    ...(chat.body.chatOptions as Partial<Options>),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [link, setLink] = useState('');
  const owner = useAuthStore((s) => s.user?.id);
  const servers = useQuery({
    queryKey: ['chat-mcp-servers', owner],
    enabled: open,
    queryFn: async () =>
      (await api.get<{ data: Array<{ id: string; name: string; enabled: boolean }> }>('/api/mcp'))
        .data.data,
  });
  const shares = useQuery({
    queryKey: ['chat-shares', owner, chat.id],
    enabled: open && !chat.body.temporary,
    queryFn: async () =>
      (
        await api.get<{ data: Array<{ id: string; expiresAt: string; revoked: number }> }>(
          `/api/assistant/api-chats/${chat.id}/shares`
        )
      ).data.data,
  });
  useEffect(() => {
    setOptions({ ...defaults, ...(chat.body.chatOptions as Partial<Options>) });
  }, [chat.id, chat.revision, chat.body.chatOptions]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Chat-Werkzeuge"
      >
        Werkzeuge
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[88dvh] overflow-y-auto">
          <DialogTitle>Chat-Werkzeuge</DialogTitle>
          <fieldset disabled={disabled || busy} className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.webSearch}
                onChange={(e) => setOptions((o) => ({ ...o, webSearch: e.target.checked }))}
              />
              Websuche und Seitenabruf
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.fullDocuments}
                onChange={(e) => setOptions((o) => ({ ...o, fullDocuments: e.target.checked }))}
              />
              Volltext statt Fundstellensuche
            </label>
            <details>
              <summary className="cursor-pointer">MCP-Werkzeuge</summary>
              <div className="space-y-3 py-3">
                {servers.isError && <p role="alert">MCP-Server konnten nicht geladen werden</p>}
                {servers.data
                  ?.filter((s) => s.enabled)
                  .map((server) => (
                    <label key={server.id} className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={options.mcpServerIds.includes(server.id)}
                        onChange={(e) =>
                          setOptions((o) => ({
                            ...o,
                            mcpServerIds: e.target.checked
                              ? [...o.mcpServerIds, server.id].slice(0, 6)
                              : o.mcpServerIds.filter((id) => id !== server.id),
                          }))
                        }
                      />
                      {server.name}
                    </label>
                  ))}
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={options.allowToolWrites}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, allowToolWrites: e.target.checked }))
                    }
                  />
                  Schreibende und nicht als lesend gekennzeichnete Werkzeuge erlauben
                </label>
              </div>
            </details>
            <details>
              <summary className="cursor-pointer">Modelle vergleichen</summary>
              <div className="space-y-3 py-3">
                {options.comparisonModels.map((candidate, index) => (
                  <div key={index} className="flex min-w-0 gap-2">
                    <span className="min-w-0 flex-1 truncate">{candidate.model}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setOptions((o) => ({
                          ...o,
                          comparisonModels: o.comparisonModels.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      Entfernen
                    </Button>
                  </div>
                ))}
                <select
                  aria-label="Vergleichsmodell hinzufügen"
                  className="w-full rounded-md border bg-background p-2"
                  value=""
                  disabled={options.comparisonModels.length >= 3}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [providerId, model] = JSON.parse(e.target.value) as [string, string];
                    setOptions((o) => ({
                      ...o,
                      comparisonModels: [
                        ...o.comparisonModels.filter(
                          (m) => m.providerId !== providerId || m.model !== model
                        ),
                        { providerId, model },
                      ].slice(0, 3),
                    }));
                  }}
                >
                  <option value="">Modell hinzufügen</option>
                  {providers.flatMap((p) =>
                    p.models.map((model) => (
                      <option key={p.id + model} value={JSON.stringify([p.id, model])}>
                        {p.name} · {model}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </details>
            <details>
              <summary className="cursor-pointer">Modellparameter</summary>
              <div className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-3">
                <label>
                  Temperatur
                  <input
                    aria-label="Temperatur"
                    className="mt-1 w-full rounded-md border bg-background p-2"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={options.temperature ?? ''}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        temperature: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Ausgabetokens
                  <input
                    aria-label="Ausgabetokens"
                    className="mt-1 w-full rounded-md border bg-background p-2"
                    type="number"
                    min="128"
                    max="32768"
                    value={options.maxOutputTokens}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, maxOutputTokens: Number(e.target.value) }))
                    }
                  />
                </label>
                <label>
                  Kontext-Turns
                  <input
                    aria-label="Kontext-Turns"
                    className="mt-1 w-full rounded-md border bg-background p-2"
                    type="number"
                    min="1"
                    max="100"
                    value={options.contextTurns}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, contextTurns: Number(e.target.value) }))
                    }
                  />
                </label>
              </div>
            </details>
            <Button
              onClick={() =>
                void act(async () => {
                  await api.put(`/api/assistant/api-chats/${chat.id}/options`, {
                    expectedRevision: chat.revision,
                    options,
                  });
                  await onSaved();
                  setOpen(false);
                })
              }
            >
              Speichern
            </Button>
          </fieldset>
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  saveDownload(`/api/assistant/api-chats/${chat.id}/export`, 'plum-chat.json')
                )
              }
            >
              Chat exportieren
            </Button>
            {!!chat.body.importArchiveAssetId && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    saveDownload(
                      `/api/assistant/api-chats/${chat.id}/import-archive`,
                      'original-chat-import.json'
                    )
                  )
                }
              >
                Originalarchiv
              </Button>
            )}
            {!chat.body.temporary && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = (
                      await api.post<{ data: { viewPath: string } }>(
                        `/api/assistant/api-chats/${chat.id}/share`,
                        {}
                      )
                    ).data.data;
                    setLink(new URL(result.viewPath, window.location.origin).href);
                    await shares.refetch();
                  })
                }
              >
                Chat teilen
              </Button>
            )}
          </div>
          {link && (
            <div className="flex gap-2">
              <input
                readOnly
                aria-label="Freigabelink"
                className="min-w-0 flex-1 rounded-md border bg-background p-2 text-sm"
                value={link}
              />
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(link)}>
                Kopieren
              </Button>
            </div>
          )}
          {shares.data
            ?.filter((s) => !s.revoked && Date.parse(s.expiresAt) > Date.now())
            .map((share) => (
              <div key={share.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  Freigabe bis {new Date(share.expiresAt).toLocaleDateString('de-CH')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api.delete('/api/assistant/shares/' + share.id);
                      await shares.refetch();
                    })
                  }
                >
                  Widerrufen
                </Button>
              </div>
            ))}
          <ChatImport providers={providers} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ChatTurnDetails({
  turn,
  onMerge,
  disabled,
}: {
  turn: AssistantApiTurn;
  onMerge: () => void;
  disabled: boolean;
}) {
  const [source, setSource] = useState<NonNullable<AssistantApiTurn['sources']>[number] | null>(
      null
    ),
    [error, setError] = useState('');
  return (
    <div className="space-y-3">
      {!!turn.toolEvents?.length && (
        <details className="text-sm">
          <summary className="cursor-pointer">Werkzeuge · {turn.toolEvents.length}</summary>
          {turn.toolEvents.map((event, index) => (
            <details key={event.id + index} className="my-2 rounded-md border p-2">
              <summary>
                {event.name === 'web_search'
                  ? 'Websuche'
                  : event.name === 'web_fetch'
                    ? 'Seitenabruf'
                    : event.name}{' '}
                ·{' '}
                {event.status === 'running'
                  ? 'Läuft …'
                  : event.status === 'failed'
                    ? 'Fehlgeschlagen'
                    : 'Abgeschlossen'}
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                {event.result}
              </pre>
            </details>
          ))}
        </details>
      )}
      {!!turn.sources?.length && (
        <div className="flex flex-wrap gap-2" aria-label="Fundstellen">
          {turn.sources.map((item, index) => (
            <button
              key={item.id + ':' + index}
              type="button"
              onClick={() => setSource(item)}
              className="rounded-md border px-2 py-1 text-left text-xs"
            >
              {item.title}
              {item.page ? ` · S. ${item.page}` : ''}
            </button>
          ))}
        </div>
      )}
      {!!turn.comparisons?.length && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {turn.comparisons.map((candidate) => (
              <section
                key={candidate.providerId + candidate.model}
                className="min-w-0 rounded-xl border p-3"
              >
                <h3 className="mb-2 break-all text-sm font-medium">{candidate.model}</h3>
                <ChatRichText
                  sourceVersions={turn.sourceVersions}
                  text={
                    candidate.response ||
                    (candidate.status === 'running'
                      ? 'Antwortet …'
                      : candidate.error || 'Keine Antwort')
                  }
                />
              </section>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={
              disabled ||
              turn.status !== 'completed' ||
              !turn.comparisons.some((c) => c.status === 'completed')
            }
            onClick={onMerge}
          >
            Antworten zusammenführen
          </Button>
        </div>
      )}
      <Dialog
        open={!!source}
        onOpenChange={(open) => {
          if (!open) setSource(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85dvh] overflow-y-auto">
          <DialogTitle>{source?.title}</DialogTitle>
          {source && (
            <>
              <p className="text-xs text-muted-foreground">
                Revision {source.revision}
                {source.page ? ` · Seite ${source.page}` : ''} ·{' '}
                {source.retrieval === 'hybrid'
                  ? 'Hybride Suche'
                  : source.retrieval === 'full'
                    ? 'Volltext'
                    : 'Stichwortsuche'}
              </p>
              <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-4 text-sm">
                {source.text}
              </blockquote>
              <Button
                variant="outline"
                onClick={() => {
                  setError('');
                  void saveDownload(
                    `/api/assistant/sources/${source.id}/file?revision=${source.revision}`,
                    source.title
                  ).catch((e) => setError(e.message));
                }}
              >
                Originaldatei
              </Button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
