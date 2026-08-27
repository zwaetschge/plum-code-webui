import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../services/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * User-defined subagent upstreams: any Anthropic-compatible endpoint, matched
 * per request by model id. Z.AI is the built-in first entry of this idea; this
 * section manages the general case. An agent whose Model field names one of
 * the listed ids runs on that provider's subscription while the session's main
 * agent stays on the Claude plan.
 *
 * The whole list is saved at once (PUT), mirroring how the router reads it.
 * Tokens never come back from the server — an entry with an empty token field
 * keeps its stored one.
 */

interface UpstreamRow {
  id?: string;
  label: string;
  baseUrl: string;
  /** Empty means "keep the stored token" for existing entries. */
  authToken: string;
  hasStoredToken: boolean;
  modelsText: string;
}

interface UpstreamStatus {
  id: string;
  label: string;
  baseUrl: string;
  hasAuthToken: boolean;
  authTokenPreview: string | null;
  models: string[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

function toRow(status: UpstreamStatus): UpstreamRow {
  return {
    id: status.id,
    label: status.label,
    baseUrl: status.baseUrl,
    authToken: '',
    hasStoredToken: status.hasAuthToken,
    modelsText: status.models.join(', '),
  };
}

export function SubagentUpstreamsSection() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<UpstreamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: stored } = useQuery({
    queryKey: ['subagent-upstreams'],
    queryFn: async () => {
      const response =
        await api.get<ApiEnvelope<UpstreamStatus[]>>('/api/settings/subagent-upstreams');
      return response.data.data;
    },
  });

  const edited = rows ?? (stored ? stored.map(toRow) : []);

  const save = useMutation({
    mutationFn: async (next: UpstreamRow[]) => {
      const payload = next.map((row) => ({
        id: row.id,
        label: row.label.trim(),
        baseUrl: row.baseUrl.trim(),
        authToken: row.authToken.trim() || undefined,
        models: row.modelsText
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean),
      }));
      const response = await api.put<ApiEnvelope<UpstreamStatus[]>>(
        '/api/settings/subagent-upstreams',
        payload
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      setRows(null);
      setError(null);
      queryClient.setQueryData(['subagent-upstreams'], data);
      void queryClient.invalidateQueries({ queryKey: ['subagent-models'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Speichern fehlgeschlagen';
      setError(message);
    },
  });

  const update = (index: number, patch: Partial<UpstreamRow>) => {
    const next = edited.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setRows(next);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-4">
      <div>
        <p className="text-sm font-medium">Subagent-Upstreams (weitere Provider)</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Beliebige Anthropic-kompatible Endpoints. Ein Agent, dessen Modellfeld eine der
          Modell-IDs nennt, läuft über diesen Anbieter, während der Hauptagent auf dem Claude-Abo
          bleibt. Muster mit <code>*</code> am Ende matchen als Präfix (z.&nbsp;B.{' '}
          <code>kimi-*</code>). GLM-Modelle routen auch ohne Eintrag über die Z.AI-Konfiguration
          oben.
        </p>
      </div>

      {edited.map((row, index) => (
        <div key={row.id ?? `new-${index}`} className="space-y-2 rounded-lg border border-border/50 p-3">
          <div className="flex items-center gap-2">
            <Input
              value={row.label}
              onChange={(e) => update(index, { label: e.target.value })}
              placeholder="Label (z. B. Kimi)"
              className="h-9 flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => setRows(edited.filter((_, i) => i !== index))}
              title="Eintrag entfernen"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Input
            value={row.baseUrl}
            onChange={(e) => update(index, { baseUrl: e.target.value })}
            placeholder="https://api.example.com/anthropic"
            className="h-9"
          />
          <Input
            type="password"
            value={row.authToken}
            onChange={(e) => update(index, { authToken: e.target.value })}
            placeholder={row.hasStoredToken ? 'Token gespeichert — leer lassen zum Behalten' : 'API-Token'}
            className="h-9"
          />
          <Input
            value={row.modelsText}
            onChange={(e) => update(index, { modelsText: e.target.value })}
            placeholder="Modell-IDs, Komma-getrennt (z. B. kimi-k2-0905, kimi-*)"
            className="h-9"
          />
        </div>
      ))}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setRows([
              ...edited,
              { label: '', baseUrl: '', authToken: '', hasStoredToken: false, modelsText: '' },
            ])
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Upstream hinzufügen
        </Button>
        <Button
          size="sm"
          disabled={rows === null || save.isPending}
          onClick={() => save.mutate(edited)}
        >
          {save.isPending ? 'Speichern…' : 'Speichern'}
        </Button>
      </div>
    </div>
  );
}
