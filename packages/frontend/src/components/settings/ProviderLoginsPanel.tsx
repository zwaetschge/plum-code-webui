import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, LogOut, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CliDeviceLoginDialog } from '@/components/settings/CliDeviceLoginDialog';
import { api } from '@/services/api';
import type { ApiResponse } from '@plum-code-webui/shared';

interface Harness {
  id: string;
  name: string;
  icon: string;
  kind: 'cli-login' | 'provider-keys' | 'endpoint';
  hint: string;
  installed: boolean;
  credentials: boolean;
  enabled: boolean;
  modelCount: number;
  ready: boolean;
}

interface Endpoint {
  id: string;
  name: string;
  baseUrl: string | null;
  enabled: boolean;
  hasKey: boolean;
  modelCount: number;
}

interface SetupStatus {
  ready: boolean;
  harnesses: Harness[];
  endpoints: Endpoint[];
  antigravity: { available: boolean; authenticated: boolean };
}

const DEVICE_LOGIN = new Set(['codex', 'claude', 'kimi', 'vibe']);

/**
 * Every way into a provider, in one place.
 *
 * The methods genuinely differ — a device code for the CLI harnesses, an API
 * key for endpoints, an in-session OAuth for Antigravity — so this shows each
 * one with the step it actually needs instead of pretending they are uniform.
 */
export function ProviderLoginsPanel() {
  const queryClient = useQueryClient();
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SetupStatus>>('/api/setup/status');
      return response.data.data;
    },
    refetchInterval: 15_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['setup-status'] });
    queryClient.invalidateQueries({ queryKey: ['opencode-providers'] });
    queryClient.invalidateQueries({ queryKey: ['opencode-available-providers'] });
    queryClient.invalidateQueries({ queryKey: ['codex-status'] });
    queryClient.invalidateQueries({ queryKey: ['claude-status'] });
    queryClient.invalidateQueries({ queryKey: ['provider-diagnostics'] });
    // A finished Vibe browser sign-in changes the credential state the
    // write-only key field reports, so it has to re-read the agent probe.
    queryClient.invalidateQueries({ queryKey: ['vibe-auth-status'] });
  };

  if (!status) return null;

  const harnesses = status.harnesses.filter((h) => h.kind === 'cli-login');

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <header>
          <h3 className="text-sm font-medium">Harness sign-in</h3>
          <p className="text-xs text-muted-foreground">
            Device-code login: start it here, approve in the browser, paste the code back.
          </p>
        </header>
        <ul className="space-y-1.5">
          {harnesses.map((harness) => (
            <li key={harness.id} className="space-y-3 rounded-lg border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <HarnessSummary harness={harness} />
                {DEVICE_LOGIN.has(harness.id) && (
                  <CliDeviceLoginDialog
                    provider={harness.id as 'codex' | 'claude' | 'kimi' | 'vibe'}
                    authenticated={harness.credentials}
                    onCompleted={refresh}
                  />
                )}
              </div>
              {/* Vibe is the only harness with a second credential path: a key
                  pasted here spends a different allowance than the sign-in. */}
              {harness.id === 'vibe' && <VibeApiKeyControls onChanged={refresh} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <header>
          <h3 className="text-sm font-medium">API endpoints</h3>
          <p className="text-xs text-muted-foreground">
            Keys for OpenAI-compatible providers. Pi and OpenCode both resolve their models from
            here.
          </p>
        </header>
        {status.endpoints.length === 0 ? (
          <p className="text-xs text-muted-foreground">No endpoints yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {status.endpoints.map((endpoint) => (
              <li key={endpoint.id} className="rounded-lg border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{endpoint.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {endpoint.baseUrl ?? endpoint.id}
                      {endpoint.hasKey ? ' · key stored' : ' · no key'}
                      {endpoint.enabled ? '' : ' · disabled'}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <TestEndpointButton id={endpoint.id} />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Edit ${endpoint.name}`}
                      aria-expanded={editingEndpointId === endpoint.id}
                      onClick={() =>
                        setEditingEndpointId((current) =>
                          current === endpoint.id ? null : endpoint.id
                        )
                      }
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                    <RemoveEndpointButton endpoint={endpoint} onDone={refresh} />
                  </span>
                </div>
                {editingEndpointId === endpoint.id && (
                  <div className="mt-3">
                    <EndpointForm
                      endpoint={endpoint}
                      onSaved={() => {
                        setEditingEndpointId(null);
                        refresh();
                      }}
                      onCancel={() => setEditingEndpointId(null)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <AddEndpointForm onSaved={refresh} />
      </section>

      {status.antigravity.available && (
        <section className="space-y-2 rounded-lg border border-border px-3 py-3">
          <header>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              Google Antigravity (via Pi)
              {status.antigravity.authenticated && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                  <Check className="h-3 w-3" /> signed in
                </span>
              )}
            </h3>
          </header>
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">
              {status.antigravity.authenticated
                ? 'Signed in — the antigravity/* models are selectable in Pi sessions.'
                : 'Sign in with Google to use the antigravity/* models in Pi. Using this may violate Google’s Terms of Service.'}
            </p>
            <CliDeviceLoginDialog
              provider="pi"
              authenticated={status.antigravity.authenticated}
              onCompleted={refresh}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function HarnessSummary({ harness }: { harness: Harness }) {
  return (
    <span className="min-w-0">
      <span className="flex items-center gap-2 text-sm">
        <span aria-hidden>{harness.icon}</span>
        {harness.name}
        {harness.credentials && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
            <Check className="h-3 w-3" /> signed in
          </span>
        )}
      </span>
      <span className="block truncate text-xs text-muted-foreground">
        {harness.credentials
          ? `${harness.modelCount} model${harness.modelCount === 1 ? '' : 's'}`
          : harness.hint}
      </span>
    </span>
  );
}

interface VibeAuthStatus {
  installed: boolean;
  authenticated: boolean;
  source: 'dot-env' | 'process-env' | 'none';
  /** Opaque agent state; it can carry key material and is never rendered. */
  authState: unknown;
}

const VIBE_KEY_SOURCE_LABEL: Record<VibeAuthStatus['source'], string> = {
  'dot-env': 'Key in VIBE_HOME/.env',
  'process-env': 'Key aus der Umgebungsvariable',
  none: 'keine hinterlegten Anmeldedaten',
};

/**
 * Vibe's second credential path.
 *
 * Write-only on purpose: the backend never returns a stored key, so this shows
 * only the authenticated state and where the key comes from. Which allowance a
 * key spends is the reason both paths exist side by side.
 */
function VibeApiKeyControls({ onChanged }: { onChanged: () => void }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['vibe-auth-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<VibeAuthStatus>>('/api/cli-login/vibe/status');
      return response.data.data;
    },
    // The backend probe spawns `vibe-acp` and can take seconds, so this must not
    // refetch on every focus or remount; the mutations below refresh it instead.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const afterCredentialChange = () => {
    void queryClient.invalidateQueries({ queryKey: ['vibe-auth-status'] });
    void queryClient.invalidateQueries({ queryKey: ['usage-limits', 'vibe'] });
    onChanged();
  };

  const saveKey = useMutation({
    mutationFn: async () => {
      await api.post('/api/cli-login/vibe/key', { apiKey: apiKey.trim() });
    },
    onSuccess: () => {
      setApiKey('');
      setError(null);
      setNotice('API-Key gespeichert.');
      afterCredentialChange();
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'Der API-Key konnte nicht gespeichert werden.'
      ),
  });

  const signOut = useMutation({
    mutationFn: async () => {
      await api.delete('/api/cli-login/vibe/key');
    },
    onSuccess: () => {
      setApiKey('');
      setError(null);
      setNotice('Abgemeldet — der gespeicherte Key wurde entfernt.');
      afterCredentialChange();
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error ? mutationError.message : 'Abmelden ist fehlgeschlagen.'
      ),
  });

  const busy = saveKey.isPending || signOut.isPending;

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {status?.authenticated ? (
          <span className="inline-flex items-center gap-1 text-emerald-500">
            <Check className="h-3 w-3" /> Angemeldet
          </span>
        ) : (
          <span className="text-muted-foreground">Nicht angemeldet</span>
        )}
        <span className="text-muted-foreground">
          · {VIBE_KEY_SOURCE_LABEL[status?.source ?? 'none']}
        </span>
      </p>
      {status && !status.installed && (
        <p className="text-xs text-amber-500">
          <code>vibe-acp</code> ist nicht installiert — ohne CLI laufen keine Vibe-Sessions.
        </p>
      )}
      <p id={hintId} className="text-xs text-muted-foreground">
        Die Anmeldung im Browser nutzt das Vibe-Code-Kontingent (255 EUR/Monat), ein eingesetzter
        regulärer API-Key das API-Kontingent (25.50 EUR).
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!apiKey.trim()) return;
          setError(null);
          setNotice(null);
          saveKey.mutate();
        }}
      >
        <div className="grid min-w-0 flex-1 gap-1">
          <Label htmlFor={fieldId} className="text-xs font-normal text-muted-foreground">
            Mistral-API-Key einsetzen
          </Label>
          <Input
            id={fieldId}
            type="password"
            value={apiKey}
            // A stored key is never sent back to the browser, so the field must
            // not be pre-filled from the password manager either.
            autoComplete="off"
            aria-describedby={hintId}
            placeholder="wird nicht angezeigt"
            className="h-8 font-mono text-xs"
            onChange={(event) => setApiKey(event.target.value)}
            disabled={busy}
          />
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <Button type="submit" size="sm" variant="outline" disabled={busy || !apiKey.trim()}>
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            {saveKey.isPending ? 'Speichern…' : 'Key speichern'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || !status?.authenticated}
            onClick={() => {
              setError(null);
              setNotice(null);
              signOut.mutate();
            }}
          >
            <LogOut className="mr-1 h-3.5 w-3.5" />
            {signOut.isPending ? 'Abmelden…' : 'Abmelden'}
          </Button>
        </span>
      </form>
      {notice && (
        <p role="status" className="text-xs text-emerald-500">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function TestEndpointButton({ id }: { id: string }) {
  const [result, setResult] = useState<{ connected: boolean; message: string } | null>(null);
  const test = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<{ connected: boolean; message: string }>>(
        `/api/opencode/providers/${encodeURIComponent(id)}/test`
      );
      if (!response.data.data) throw new Error('No response from OpenCode.');
      return response.data.data;
    },
    onSuccess: setResult,
    onError: (error) =>
      setResult({
        connected: false,
        message: error instanceof Error ? error.message : 'Provider test failed',
      }),
  });

  return (
    <span className="inline-flex flex-col items-start">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => test.mutate()}
        disabled={test.isPending}
      >
        <Zap className="mr-1 h-3.5 w-3.5" /> {test.isPending ? 'Testing…' : 'Test'}
      </Button>
      {result && (
        <span
          role="status"
          className={`max-w-48 text-xs ${result.connected ? 'text-emerald-500' : 'text-destructive'}`}
        >
          {result.message}
        </span>
      )}
    </span>
  );
}

function RemoveEndpointButton({ endpoint, onDone }: { endpoint: Endpoint; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/api/opencode/providers/${encodeURIComponent(endpoint.id)}`);
    },
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error ? mutationError.message : 'Could not remove endpoint'
      ),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${endpoint.name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {endpoint.name}?</DialogTitle>
          <DialogDescription>
            This removes the saved connection and API key for OpenCode and Pi.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={remove.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? 'Removing…' : 'Remove endpoint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEndpointForm({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add endpoint
      </Button>
    );
  }

  return (
    <EndpointForm
      onSaved={() => {
        setOpen(false);
        onSaved();
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function EndpointForm({
  endpoint,
  onSaved,
  onCancel,
}: {
  endpoint?: Endpoint;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(endpoint?.id ?? '');
  const [name, setName] = useState(endpoint?.name ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(endpoint?.baseUrl ?? '');
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const save = useMutation({
    mutationFn: async () => {
      if (!endpoint && !apiKey.trim()) throw new Error('Enter an API key.');
      await api.put('/api/opencode/providers', {
        id: id.trim(),
        name: name.trim() || id.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        enabled,
      });
    },
    onSuccess: onSaved,
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : 'Could not save endpoint'),
  });

  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div>
        <Label htmlFor={`${formId}-id`}>Provider ID</Label>
        <Input
          id={`${formId}-id`}
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="z-ai"
          required
          readOnly={Boolean(endpoint)}
        />
      </div>
      <div>
        <Label htmlFor={`${formId}-name`}>Display name</Label>
        <Input
          id={`${formId}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Z.AI"
        />
      </div>
      <div>
        <Label htmlFor={`${formId}-key`}>{endpoint ? 'New API key (optional)' : 'API key'}</Label>
        <Input
          id={`${formId}-key`}
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={endpoint?.hasKey ? 'Leave blank to keep the stored key' : undefined}
          required={!endpoint}
          autoComplete="new-password"
        />
      </div>
      <div>
        <Label htmlFor={`${formId}-url`}>Base URL (optional)</Label>
        <Input
          id={`${formId}-url`}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="Known providers fill this in"
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Switch id={`${formId}-enabled`} checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor={`${formId}-enabled`}>Enabled for OpenCode and Pi</Label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          <KeyRound className="mr-1 h-3.5 w-3.5" />
          {save.isPending ? 'Saving…' : endpoint ? 'Save changes' : 'Save endpoint'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={save.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default ProviderLoginsPanel;
