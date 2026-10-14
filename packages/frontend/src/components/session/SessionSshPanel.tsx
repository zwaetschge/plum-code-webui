import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2Off, Loader2, Plug, Plus, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SshTestBadge } from '@/components/settings/SshConnectionsPanel';
import {
  sshTarget,
  useSessionConnections,
  useSetSessionConnections,
  useSshConnectionMutations,
  useSshConnections,
  type SshTestResult,
} from '@/lib/sshConnections';

/**
 * SSH section of the session's Verbindungen: which global hosts this session's
 * agent may reach (as `ssh -F $PLUM_SSH_CONFIG <alias>`), attach/detach and test.
 */
export function SessionSshPanel({ sessionId }: { sessionId: string }) {
  const { data: all = [] } = useSshConnections();
  const { data: attached } = useSessionConnections(sessionId);
  const setAttached = useSetSessionConnections(sessionId);
  const { test } = useSshConnectionMutations();
  const [choice, setChoice] = useState('');
  const [results, setResults] = useState<Record<string, SshTestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attachedList = attached?.connections ?? [];
  const attachedIds = attachedList.map((connection) => connection.id);
  const available = all.filter((connection) => !attachedIds.includes(connection.id));

  const update = async (ids: string[]) => {
    setError(null);
    try {
      await setAttached.mutateAsync(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ändern fehlgeschlagen.');
    }
  };

  const runTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await test.mutateAsync(id);
      setResults((current) => ({ ...current, [id]: result }));
    } catch (err) {
      setResults((current) => ({
        ...current,
        [id]: {
          ok: false,
          message: err instanceof Error ? err.message : 'Test fehlgeschlagen.',
          durationMs: 0,
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-2 p-2 text-sm">
      {attached && !attached.agentAccess && attachedList.length > 0 && (
        <p className="text-xs text-destructive">
          Dein Konto darf keine CLI-Agenten starten – die Hosts werden dem Agenten nicht übergeben.
        </p>
      )}
      {attachedList.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine SSH-Hosts an dieser Session.</p>
      ) : (
        <ul className="space-y-1.5">
          {attachedList.map((connection) => (
            <li key={connection.id} className="rounded-md border border-border px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <code className="text-xs">{connection.alias}</code>{' '}
                    <span className="text-xs text-muted-foreground">{sshTarget(connection)}</span>
                  </div>
                  {!connection.keyConfigured && (
                    <span className="text-[11px] text-destructive">Kein Schlüssel hinterlegt</span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => void runTest(connection.id)}
                  disabled={testing === connection.id}
                  aria-label={`${connection.alias} testen`}
                >
                  {testing === connection.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plug className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => void update(attachedIds.filter((id) => id !== connection.id))}
                  disabled={setAttached.isPending}
                  aria-label={`${connection.alias} lösen`}
                  title="Von der Session lösen"
                >
                  <Link2Off className="h-3.5 w-3.5" />
                </Button>
              </div>
              <SshTestBadge result={results[connection.id]} />
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="flex gap-2">
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="SSH-Host anhängen"
          >
            <option value="">SSH-Host anhängen …</option>
            {available.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name} ({connection.alias})
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!choice || setAttached.isPending}
            onClick={() => {
              void update([...attachedIds, choice]);
              setChoice('');
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Anhängen
          </Button>
        </div>
      ) : all.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Noch keine SSH-Hosts.{' '}
          <Link
            to="/settings?tab=connections"
            className="text-primary underline-offset-2 hover:underline"
          >
            In den Einstellungen unter Verbindungen anlegen
          </Link>
          .
        </p>
      ) : null}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[11px] text-muted-foreground">
        Der Agent erreicht angehängte Hosts mit <code>ssh -F $PLUM_SSH_CONFIG &lt;alias&gt;</code>.
      </p>
    </div>
  );
}
