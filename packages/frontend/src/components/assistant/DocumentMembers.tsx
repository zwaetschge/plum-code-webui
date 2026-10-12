import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantResource, AssistantDocumentMember } from '@plum-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { api, ApiError } from '@/services/api';
import { Button } from '@/components/ui/button';
type Command = {
  commandId: string;
  expectedRevision: number;
  email: string;
  role: 'viewer' | 'editor' | null;
};
export function DocumentMembers({ resource }: { resource: AssistantResource }) {
  const owner = useAuthStore((s) => s.user?.id);
  return resource.kind === 'artifact' &&
    resource.body.type === 'document' &&
    ['markdown', 'text', 'json'].includes(String(resource.body.format)) ? (
    <MemberPanel key={`${owner}:${resource.id}:${resource.revision}`} resource={resource} />
  ) : null;
}
function MemberPanel({ resource }: { resource: AssistantResource }) {
  const owner = useAuthStore((s) => s.user?.id),
    active = useRef(true),
    cache = useQueryClient();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && useAuthStore.getState().user?.id === owner;
  const [email, setEmail] = useState(''),
    [open, setOpen] = useState(false),
    [role, setRole] = useState<'viewer' | 'editor'>('viewer'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<Command | null>(null);
  const query = useQuery({
    enabled: open,
    queryKey: ['assistant', 'document-members', owner, resource.id],
    queryFn: async () =>
      (
        await api.get<{
          data: {
            members: AssistantDocumentMember[];
            audit: Array<{
              actorId: string;
              action: string;
              createdAt: string;
              metadata: { fromRevision?: number; toRevision?: number; role?: string | null };
            }>;
          };
        }>(`/api/assistant/documents/${resource.id}/members`)
      ).data.data,
    retry: false,
  });
  async function deliver(command: Command) {
    setBusy(true);
    setError('');
    setPending(command);
    try {
      await api.post(`/api/assistant/documents/${resource.id}/members`, command);
      if (!current()) return;
      setPending(null);
      setEmail('');
      await cache.invalidateQueries({
        queryKey: ['assistant', 'document-members', owner, resource.id],
      });
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500)
        setPending(null);
      setError(
        failure instanceof Error ? failure.message : 'Mitgliedschaft konnte nicht bestätigt werden'
      );
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <details
      className="rounded-md border p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">Dokument gemeinsam bearbeiten</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Erteile einem anderen aktiven Plum-Konto Zugriff auf dieses Dokument ab der aktuellen
          Revision. Leser sehen den Stand, Editoren speichern neue Versionen. Private Quellen,
          Aufgaben und Profile bleiben getrennt. Originalbilder können übernommen, aber hier nicht
          ergänzt werden.
        </p>
        <Link className="text-sm underline" to={`/collaborate/${resource.id}`}>
          Gemeinsame Dokumentansicht öffnen
        </Link>
        <label className="grid gap-1 text-sm">
          Plum-Konto (E-Mail)
          <input
            className="rounded-md border bg-background p-2"
            type="email"
            value={email}
            disabled={busy || !!pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Dokumentrecht
          <select
            className="rounded-md border bg-background p-2"
            value={role}
            disabled={busy || !!pending}
            onChange={(event) => setRole(event.target.value as 'viewer' | 'editor')}
          >
            <option value="viewer">Lesen</option>
            <option value="editor">Bearbeiten</option>
          </select>
        </label>
        <Button
          size="sm"
          disabled={busy || !!pending || !email.trim()}
          onClick={() =>
            void deliver({
              commandId: crypto.randomUUID(),
              expectedRevision: resource.revision,
              email: email.trim(),
              role,
            })
          }
        >
          Zugriff erteilen
        </Button>
        {pending && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void deliver(pending)}>
              Dieselbe Zugriffsänderung bestätigen
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPending(null);
                void query.refetch();
              }}
            >
              Mitgliedschaften neu prüfen
            </Button>
          </div>
        )}
        {query.isPending ? (
          <p role="status">Mitglieder werden geladen …</p>
        ) : query.isError ? (
          <p role="alert">Mitglieder konnten nicht geladen werden.</p>
        ) : (
          query.data?.members.map((member) => (
            <div key={member.userId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="break-all">
                {member.email} · {member.role === 'editor' ? 'Bearbeiten' : 'Lesen'} · ab Revision{' '}
                {member.grantedRevision}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !!pending}
                onClick={() =>
                  void deliver({
                    commandId: crypto.randomUUID(),
                    expectedRevision: resource.revision,
                    email: member.email,
                    role: null,
                  })
                }
              >
                Zugriff entziehen
              </Button>
            </div>
          ))
        )}
        {!!query.data?.audit.length && (
          <details>
            <summary className="cursor-pointer text-sm">Änderungsprotokoll</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {query.data.audit.map((entry, index) => (
                <li key={index}>
                  {new Date(entry.createdAt).toLocaleString('de-CH')} · {entry.actorId} ·{' '}
                  {entry.action === 'document-edit'
                    ? `Revision ${entry.metadata.fromRevision} → ${entry.metadata.toRevision}`
                    : entry.metadata.role === 'editor'
                      ? 'Bearbeitungsrecht erteilt'
                      : entry.metadata.role === 'viewer'
                        ? 'Leserecht erteilt'
                        : 'Zugriff entzogen'}
                </li>
              ))}
            </ul>
          </details>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
