import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, Globe, Pause, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import type { ApiResponse } from '@plum-code-webui/shared';

interface BrowserToken {
  id: string;
  name: string;
  tokenPrefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface BrowserConnection {
  id: string;
  tokenName: string;
  client: { name: string; version: string; extensionVersion: string; label: string };
  paused: boolean;
  tabGroups: boolean;
  connectedAt: string;
  lastSeenAt: string;
}

interface BrowserStatus {
  connections: BrowserConnection[];
  extensionAvailable: boolean;
  chromeExtensionAvailable?: boolean;
}

const DOWNLOADS = {
  firefox: { path: '/api/browser-bridge/extension.xpi', file: 'plum-browser-firefox.xpi' },
  chrome: { path: '/api/browser-bridge/extension-chrome.zip', file: 'plum-browser-chrome.zip' },
} as const;

/**
 * Pair the Plum Browser Firefox extension. Agents then drive that Firefox
 * through the `firefox` MCP server, each session inside its own tab group.
 * The pairing token only opens the browser bridge; it grants no API access.
 */
export function FirefoxBrowserPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState<'token' | 'url' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['browser-bridge-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<BrowserStatus>>('/api/browser-bridge/status');
      return response.data.data ?? { connections: [], extensionAvailable: false };
    },
    refetchInterval: 10_000,
  });

  const { data: tokens } = useQuery({
    queryKey: ['browser-tokens'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<BrowserToken[]>>('/api/browser-bridge/tokens');
      return response.data.data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<BrowserToken & { token: string }>>(
        '/api/browser-bridge/tokens',
        { name: name.trim() || 'Firefox' }
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      setIssued(data?.token ?? null);
      setCopied(null);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['browser-tokens'] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/browser-bridge/tokens/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['browser-tokens'] });
      void queryClient.invalidateQueries({ queryKey: ['browser-bridge-status'] });
    },
  });

  const saveBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };

  const downloadExtension = async (target: keyof typeof DOWNLOADS) => {
    setDownloadError(null);
    try {
      const response = await api.download(DOWNLOADS[target].path);
      saveBlob(await response.blob(), DOWNLOADS[target].file);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Download failed');
    }
  };

  const copy = (value: string, kind: 'token' | 'url') => {
    void navigator.clipboard.writeText(value);
    setCopied(kind);
  };

  const serverUrl = window.location.origin;
  const connections = status?.connections ?? [];
  const active = (tokens ?? []).filter((token) => !token.revoked);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
      <div>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Globe className="h-4 w-4" />
          Browser control (Firefox &amp; Chrome)
        </span>
        <span className="block text-xs text-muted-foreground">
          Let agents drive your browser like Claude in Chrome. Install the Plum Browser extension,
          pair it with a token, and sessions get the <code>firefox</code> MCP tools. Each session
          works in its own window and tab group, with a visible cursor and its chat on the right.
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Firefox</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void downloadExtension('firefox')}
              disabled={!status?.extensionAvailable}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              .xpi
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Release Firefox needs a signed build; distro Firefox (e.g. Fedora) loads it from the app
            folder. See the extension README.
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Chrome / Edge</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void downloadExtension('chrome')}
              disabled={!status?.chromeExtensionAvailable}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              .zip
            </Button>
          </div>
        </div>
      </div>
      {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}

      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Connected</span>
        {connections.length === 0 ? (
          <p className="text-xs text-muted-foreground">No browser is connected right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${connection.paused ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{connection.client.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {connection.client.name} {connection.client.version} · extension{' '}
                      {connection.client.extensionVersion}
                      {connection.tabGroups ? ' · tab groups' : ' · no tab-group API'}
                    </span>
                  </span>
                </span>
                {connection.paused && (
                  <span className="flex items-center gap-1 text-xs text-amber-600">
                    <Pause className="h-3 w-3" /> paused
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Work Mac"
          className="h-9"
          aria-label="Browser name"
        />
        <Button type="submit" size="sm" disabled={create.isPending}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Pair browser
        </Button>
      </form>

      {issued && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">
            Paste both into the extension settings. The token is shown only once.
          </p>
          {(
            [
              ['url', 'Plum address', serverUrl],
              ['token', 'Browser token', issued],
            ] as const
          ).map(([kind, label, value]) => (
            <div key={kind}>
              <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
              <div className="mt-0.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
                  {value}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copy(value, kind)}
                  aria-label={`Copy ${label}`}
                >
                  {copied === kind ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <ul className="space-y-1.5">
          {active.map((token) => (
            <li
              key={token.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{token.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {token.tokenPrefix}… ·{' '}
                  {token.lastUsedAt ? `last connected ${token.lastUsedAt}` : 'never connected'}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => revoke.mutate(token.id)}
                disabled={revoke.isPending}
                aria-label={`Unpair ${token.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FirefoxBrowserPanel;
