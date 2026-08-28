import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../services/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

/**
 * CLI subagents: whole provider CLIs (Codex, Claude Code, OpenCode) that any
 * harness can spawn as one-shot workers through the `subagents` MCP tool —
 * cross-harness delegation, as opposed to the upstream list above which swaps
 * the API endpoint underneath Claude-transport agents.
 *
 * No secrets here; the spawned CLIs use their own shared logins.
 */

const PROVIDERS = ['codex', 'claude', 'opencode'] as const;
type CliProvider = (typeof PROVIDERS)[number];

interface CliSubagentEntry {
  id?: string;
  label: string;
  provider: CliProvider;
  model: string;
  enabled: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export function CliSubagentsSection() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<CliSubagentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: stored } = useQuery({
    queryKey: ['cli-subagents'],
    queryFn: async () => {
      const response = await api.get<ApiEnvelope<CliSubagentEntry[]>>('/api/settings/cli-subagents');
      return response.data.data;
    },
  });

  const edited = rows ?? stored ?? [];

  const save = useMutation({
    mutationFn: async (next: CliSubagentEntry[]) => {
      const payload = next.map((row) => ({
        id: row.id,
        label: row.label.trim(),
        provider: row.provider,
        model: row.model.trim(),
        enabled: row.enabled,
      }));
      const response = await api.put<ApiEnvelope<CliSubagentEntry[]>>(
        '/api/settings/cli-subagents',
        payload
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      setRows(null);
      setError(null);
      queryClient.setQueryData(['cli-subagents'], data);
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Speichern fehlgeschlagen';
      setError(message);
    },
  });

  const update = (index: number, patch: Partial<CliSubagentEntry>) => {
    setRows(edited.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-4">
      <div>
        <p className="text-sm font-medium">CLI-Subagenten (andere Provider als Worker)</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Jede Session (egal ob Claude Code, Codex, OpenCode oder Pi) kann über das MCP-Tool{' '}
          <code>run_subagent</code> einen dieser CLIs als Einmal-Worker starten — z.&nbsp;B. Codex
          delegiert an OpenCode mit <code>z-ai/glm-5.2</code>, oder Claude delegiert an Codex. Der
          Worker arbeitet im selben Verzeichnis und nutzt das jeweilige eigene Abo/Login. Modell
          leer lassen für den Provider-Default; OpenCode erwartet{' '}
          <code>anbieter/modell</code>-IDs.
        </p>
      </div>

      {edited.map((row, index) => (
        <div
          key={row.id ?? `new-${index}`}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 p-3"
        >
          <Switch
            checked={row.enabled}
            onCheckedChange={(checked) => update(index, { enabled: checked })}
          />
          <Input
            value={row.label}
            onChange={(e) => update(index, { label: e.target.value })}
            placeholder="Label"
            className="h-9 w-36"
          />
          <select
            value={row.provider}
            onChange={(e) => update(index, { provider: e.target.value as CliProvider })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
          <Input
            value={row.model}
            onChange={(e) => update(index, { model: e.target.value })}
            placeholder="Modell (leer = Default)"
            className="h-9 min-w-48 flex-1"
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
      ))}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setRows([...edited, { label: '', provider: 'opencode', model: '', enabled: true }])
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Subagent hinzufügen
        </Button>
        <Button size="sm" disabled={rows === null || save.isPending} onClick={() => save.mutate(edited)}>
          {save.isPending ? 'Speichern…' : 'Speichern'}
        </Button>
      </div>
    </div>
  );
}
