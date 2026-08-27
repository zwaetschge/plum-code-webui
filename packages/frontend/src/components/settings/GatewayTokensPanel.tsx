import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import type { ApiResponse } from '@plum-code-webui/shared';

interface GatewayToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: 'read' | 'write';
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/**
 * Credentials for an outside supervisor — Hermes, an OpenCode or Codex CLI —
 * that watches and drives every session through the same API this UI uses.
 * The secret is shown once, on creation, and never again.
 */
export function GatewayTokensPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  // Read-only has to be chosen deliberately: defaulting to it would break a
  // supervisor that needs to act, and the server keeps 'write' as its default.
  const [readOnly, setReadOnly] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: tokens } = useQuery({
    queryKey: ['gateway-tokens'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<GatewayToken[]>>('/api/gateway/tokens');
      return response.data.data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<GatewayToken & { token: string }>>(
        '/api/gateway/tokens',
        { name: name.trim() || 'gateway', scope: readOnly ? 'read' : 'write' }
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      setIssued(data?.token ?? null);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['gateway-tokens'] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/gateway/tokens/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gateway-tokens'] }),
  });

  const active = (tokens ?? []).filter((token) => !token.revoked);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
      <div>
        <span className="block text-sm font-medium">Control gateway</span>
        <span className="block text-xs text-muted-foreground">
          Give an outside instance a token and it can watch and drive every session through the same
          API you use. Start at <code>GET /api/gateway/overview</code>.
        </span>
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
          placeholder="hermes"
          className="h-9"
        />
        <Button type="submit" size="sm" disabled={create.isPending}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Issue token
        </Button>
      </form>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        Read-only — the token may query everything but cannot change anything.
      </label>

      {issued && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">
            Copy this now — it is not stored and cannot be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
              {issued}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(issued);
                setCopied(true);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )}

      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground">No gateway tokens yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {active.map((token) => (
            <li
              key={token.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{token.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {token.tokenPrefix}… · {token.scope === 'read' ? 'read-only' : 'full access'} ·{' '}
                  {token.lastUsedAt ? `last used ${token.lastUsedAt}` : 'never used'}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => revoke.mutate(token.id)}
                disabled={revoke.isPending}
                aria-label={`Revoke ${token.name}`}
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

export default GatewayTokensPanel;
