import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CliDeviceLoginDialog } from '@/components/settings/CliDeviceLoginDialog';
import { api } from '@/services/api';
import type { ApiResponse } from '@plum-code-webui/shared';

interface SetupHarness {
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
  readyHarnesses: string[];
  configuredEndpoints: number;
  harnesses: SetupHarness[];
}

/**
 * First-run setup. One working harness is the whole requirement — every other
 * card stays available but never blocks, so an operator who only wants Codex is
 * finished after one step.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SetupStatus>>('/api/setup/status');
      return response.data.data;
    },
    refetchInterval: 5000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['setup-status'] });

  if (isLoading || !status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Set up Plum Code</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick one harness to get started. The others stay optional and can be added later from
          Settings.
        </p>
      </header>

      {status.ready && (
        <Card className="mb-6 border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <span className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-emerald-500" />
              Ready to run with{' '}
              <strong>
                {status.readyHarnesses.length === 1
                  ? status.readyHarnesses[0]
                  : `${status.readyHarnesses.length} harnesses`}
              </strong>
            </span>
            <Button onClick={() => navigate('/')}>Start working</Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {status.harnesses.map((harness) => (
          <HarnessCard key={harness.id} harness={harness} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

function HarnessCard({ harness, onChanged }: { harness: SetupHarness; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <Card className={harness.ready ? 'border-emerald-500/30' : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>{harness.icon}</span>
            {harness.name}
            {harness.ready && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500">
                Ready
              </span>
            )}
          </CardTitle>
          <CardDescription className="mt-1">
            {harness.ready
              ? `${harness.modelCount} model${harness.modelCount === 1 ? '' : 's'} available`
              : !harness.enabled
                ? 'Disabled for this account — enable it in Settings → Providers.'
                : harness.hint}
          </CardDescription>
        </div>

        <div className="shrink-0">
          {harness.kind === 'cli-login' &&
            (harness.id === 'codex' ||
              harness.id === 'claude' ||
              harness.id === 'kimi' ||
              harness.id === 'vibe') && (
              <CliDeviceLoginDialog
                provider={harness.id}
                authenticated={harness.credentials}
                onCompleted={onChanged}
              />
            )}
          {harness.kind === 'provider-keys' && (
            <Button variant="outline" size="sm" onClick={() => setShowForm((open) => !open)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add endpoint
            </Button>
          )}
          {harness.kind === 'endpoint' && (
            <Button variant="outline" size="sm" asChild>
              <a href="/settings">
                Configure
                <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </CardHeader>

      {showForm && harness.kind === 'provider-keys' && (
        <CardContent>
          <EndpointForm
            onSaved={() => {
              setShowForm(false);
              onChanged();
            }}
          />
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Endpoints are stored in the WebUI provider registry, so both Pi and OpenCode
 * pick them up without either harness having to be installed first.
 */
function EndpointForm({ onSaved }: { onSaved: () => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      await api.put('/api/opencode/providers', {
        id: id.trim(),
        name: name.trim() || id.trim(),
        apiKey: apiKey.trim(),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        enabled: true,
      });
    },
    onSuccess: onSaved,
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : 'Could not save endpoint'),
  });

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div>
        <Label htmlFor="endpoint-id">Provider ID</Label>
        <Input
          id="endpoint-id"
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="z-ai"
          required
        />
      </div>
      <div>
        <Label htmlFor="endpoint-name">Display name</Label>
        <Input
          id="endpoint-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Z.AI"
        />
      </div>
      <div>
        <Label htmlFor="endpoint-key">API key</Label>
        <Input
          id="endpoint-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="endpoint-url">Base URL (optional)</Label>
        <Input
          id="endpoint-url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="Known providers fill this in"
        />
      </div>
      {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save endpoint'}
        </Button>
      </div>
    </form>
  );
}

export default SetupPage;
