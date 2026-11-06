import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface SetupStatus {
  ready: boolean;
  harnesses: Harness[];
  antigravity: { available: boolean; authenticated: boolean };
}

const DEVICE_LOGIN = new Set(['codex', 'claude', 'vibe']);

/**
 * Every way into a provider, in one place.
 *
 * The methods genuinely differ — a device code for the CLI harnesses, an
 * in-session OAuth for Antigravity — so this shows each one with the step it
 * actually needs instead of pretending they are uniform. API keys for model
 * endpoints live in the Modellanbieter registry (ModelProvidersPanel).
 */
export function ProviderLoginsPanel() {
  const queryClient = useQueryClient();

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
                    provider={harness.id as 'codex' | 'claude' | 'vibe'}
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

export default ProviderLoginsPanel;
