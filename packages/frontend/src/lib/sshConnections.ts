import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

/** Mirrors `SshConnectionDto` in packages/backend/src/services/connections/store.ts. */
export interface SshConnection {
  id: string;
  kind: 'ssh';
  name: string;
  alias: string;
  host: string;
  port: number;
  user: string;
  jumpHost: string | null;
  tags: string[];
  keySource: 'file' | 'upload';
  keyFile: string | null;
  /** Write-only secret: only whether a key is configured is ever returned. */
  keyConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SshConnectionInput {
  name: string;
  alias: string;
  host: string;
  port: number;
  user: string;
  jumpHost: string | null;
  tags: string[];
  keySource: 'file' | 'upload';
  keyFile: string | null;
  /** Empty or omitted keeps the stored key on update. */
  privateKey?: string;
  clearKey?: boolean;
}

export interface SshTestResult {
  ok: boolean;
  message: string;
  durationMs: number;
}

export interface SessionConnections {
  connections: SshConnection[];
  /** False when the user may not run CLI agents, so hosts are not handed over. */
  agentAccess: boolean;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export const SSH_ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function aliasFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 41)
    .replace(/-+$/g, '');
  return SSH_ALIAS_PATTERN.test(slug) ? slug : '';
}

export function sshTarget(connection: Pick<SshConnection, 'user' | 'host' | 'port'>): string {
  return `${connection.user}@${connection.host}${connection.port === 22 ? '' : `:${connection.port}`}`;
}

export const sshConnectionKeys = {
  all: ['ssh-connections'] as const,
  keyFiles: ['ssh-connections', 'key-files'] as const,
  session: (sessionId: string) => ['ssh-connections', 'session', sessionId] as const,
};

export function useSshConnections() {
  return useQuery({
    queryKey: sshConnectionKeys.all,
    queryFn: async () =>
      (await api.get<Envelope<SshConnection[]>>('/api/connections')).data.data ?? [],
  });
}

export function useSshKeyFiles(enabled = true) {
  return useQuery({
    queryKey: sshConnectionKeys.keyFiles,
    enabled,
    queryFn: async () =>
      (
        await api.get<Envelope<{ available: boolean; files: string[] }>>(
          '/api/connections/ssh-keys'
        )
      ).data.data ?? { available: false, files: [] },
  });
}

export function useSessionConnections(sessionId: string) {
  return useQuery({
    queryKey: sshConnectionKeys.session(sessionId),
    enabled: !!sessionId,
    queryFn: async () =>
      (await api.get<Envelope<SessionConnections>>(`/api/sessions/${sessionId}/connections`)).data
        .data ?? { connections: [], agentAccess: false },
  });
}

export function useSshConnectionMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: sshConnectionKeys.all });
  return {
    save: useMutation({
      mutationFn: async ({ id, input }: { id?: string; input: SshConnectionInput }) => {
        const body = {
          ...input,
          privateKey: input.privateKey?.trim() ? input.privateKey : undefined,
        };
        return id
          ? (await api.patch<Envelope<SshConnection>>(`/api/connections/${id}`, body)).data.data
          : (await api.post<Envelope<SshConnection>>('/api/connections', { kind: 'ssh', ...body }))
              .data.data;
      },
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        await api.delete(`/api/connections/${id}`);
      },
      onSuccess: invalidate,
    }),
    test: useMutation({
      mutationFn: async (id: string) =>
        (await api.post<Envelope<SshTestResult>>(`/api/connections/${id}/test`)).data.data,
    }),
  };
}

export function useSetSessionConnections(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionIds: string[]) =>
      (
        await api.put<Envelope<SessionConnections>>(`/api/sessions/${sessionId}/connections`, {
          connectionIds,
        })
      ).data.data,
    onSuccess: (data) => {
      queryClient.setQueryData(sshConnectionKeys.session(sessionId), data);
    },
  });
}
