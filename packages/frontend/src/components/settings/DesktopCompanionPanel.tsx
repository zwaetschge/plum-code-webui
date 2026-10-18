import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Monitor, Plus, Trash2 } from 'lucide-react';
import type { ApiResponse } from '@plum-code-webui/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { DesktopActivityCard, type DesktopActivity } from './DesktopActivityCard';

interface DesktopConnection {
  id: string;
  client: { kind?: string; version: string; label: string; platform?: string };
  paused: boolean;
  mode?: string | null;
  recording?: boolean;
  lastSeenAt: string;
  desktopActivity?: DesktopActivity | null;
}

interface DesktopRule {
  match: string;
  mode: 'block' | 'ask';
  note?: string;
}

const MODES = [
  ['control', 'Steuern'],
  ['guide', 'Nur zeigen'],
  ['paused', 'Pausiert'],
] as const;

/**
 * Plum Desktop: connected computers with their mode, demonstrations,
 * per-app rules and the one-line installer for another computer.
 */
export function DesktopCompanionPanel() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [computer, setComputer] = useState('');
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<DesktopRule[] | null>(null);
  const [match, setMatch] = useState('');
  const [ruleMode, setRuleMode] = useState<DesktopRule['mode']>('ask');

  const status = useQuery({
    queryKey: ['browser-bridge-status'],
    queryFn: async () =>
      (
        await api.get<ApiResponse<{ connections: DesktopConnection[] }>>(
          '/api/browser-bridge/status'
        )
      ).data.data ?? { connections: [] },
    refetchInterval: 2_000,
  });
  const desktops = (status.data?.connections ?? []).filter((c) => c.client.kind === 'desktop');

  const rules = useQuery({
    queryKey: ['desktop-rules'],
    queryFn: async () =>
      (await api.get<ApiResponse<DesktopRule[]>>('/api/browser-bridge/desktop/rules')).data.data ??
      [],
  });
  useEffect(() => {
    if (rules.data && draft === null) setDraft(rules.data);
  }, [rules.data, draft]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['browser-bridge-status'] });
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const setMode = useMutation({
    mutationFn: (body: { mode: string; connectionId: string }) =>
      api.post('/api/browser-bridge/desktop/mode', body),
    onSuccess: () => setTimeout(refresh, 600),
    onError: fail,
  });
  const record = useMutation({
    mutationFn: (body: { action: 'start' | 'stop' | 'cancel'; connectionId: string }) =>
      api.post('/api/browser-bridge/desktop/record', body),
    onSuccess: () => setTimeout(refresh, 600),
    onError: fail,
  });
  const saveRules = useMutation({
    mutationFn: async (next: DesktopRule[]) =>
      (
        await api.put<ApiResponse<DesktopRule[]>>('/api/browser-bridge/desktop/rules', {
          rules: next,
        })
      ).data.data ?? next,
    onSuccess: (saved) => {
      setDraft(saved);
      queryClient.setQueryData(['desktop-rules'], saved);
    },
    onError: fail,
  });
  const install = useMutation({
    mutationFn: async () =>
      (
        await api.post<ApiResponse<{ command: string }>>('/api/browser-bridge/desktop/install', {
          name: computer.trim() || 'Desktop',
        })
      ).data.data,
    onSuccess: (data) => {
      setCommand(data?.command ?? null);
      setCopied(false);
    },
    onError: fail,
  });

  const changeRules = (next: DesktopRule[]) => {
    setDraft(next);
    saveRules.mutate(next);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card px-4 py-3">
      <div>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Monitor className="h-4 w-4" />
          Plum Desktop
        </span>
        <span className="block text-xs text-muted-foreground">
          Plum sieht und bedient Programme auf deinem Computer. Escape auf der Tastatur stoppt es
          jederzeit.
        </span>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        {desktops.length === 0 ? (
          <p className="text-xs text-muted-foreground">Kein Computer verbunden.</p>
        ) : (
          desktops.map((desktop) => {
            const mode = desktop.mode ?? (desktop.paused ? 'paused' : 'control');
            return (
              <div key={desktop.id} className="space-y-2 rounded-lg border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{desktop.client.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      Plum Desktop {desktop.client.version}
                      {desktop.client.platform ? ` · ${desktop.client.platform}` : ''}
                    </span>
                  </span>
                  <div
                    role="radiogroup"
                    aria-label="Modus"
                    className="flex rounded-lg border border-border p-0.5"
                  >
                    {MODES.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={mode === id}
                        disabled={setMode.isPending}
                        onClick={() => setMode.mutate({ mode: id, connectionId: desktop.id })}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-xs transition-colors',
                          mode === id
                            ? id === 'paused'
                              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                              : 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <DesktopActivityCard connectionId={desktop.id} activity={desktop.desktopActivity} />
                <div className="flex flex-wrap items-center gap-2">
                  {desktop.recording ? (
                    <>
                      <span className="text-xs font-medium text-destructive">
                        ● Vorführung läuft
                      </span>
                      <Button
                        size="sm"
                        onClick={() => record.mutate({ action: 'stop', connectionId: desktop.id })}
                      >
                        Beenden und senden
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          record.mutate({ action: 'cancel', connectionId: desktop.id })
                        }
                      >
                        Verwerfen
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => record.mutate({ action: 'start', connectionId: desktop.id })}
                    >
                      Vorführung aufnehmen
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Mach es einmal vor; Plum lernt es und kann es als Makro wiederholen.
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-medium text-muted-foreground">Regeln pro Programm</span>
        <p className="text-xs text-muted-foreground">
          Gesperrt: keine Eingaben, im Screenshot geschwärzt. Fragen: jede Eingabe bestätigst du am
          Computer. Treffer auf Programmklasse (z. B. org.kde.konsole) oder Fenstertitel.
        </p>
        <ul className="space-y-1">
          {(draft ?? []).map((rule, index) => (
            <li
              key={`${rule.match}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{rule.match}</span>
              {rule.note && (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                  {rule.note}
                </span>
              )}
              <select
                aria-label={`Regel für ${rule.match}`}
                className="rounded-md border bg-background px-2 py-1 text-xs"
                value={rule.mode}
                onChange={(e) =>
                  changeRules(
                    (draft ?? []).map((r, i) =>
                      i === index ? { ...r, mode: e.target.value as DesktopRule['mode'] } : r
                    )
                  )
                }
              >
                <option value="block">Gesperrt</option>
                <option value="ask">Fragen</option>
              </select>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`Regel ${rule.match} entfernen`}
                onClick={() => changeRules((draft ?? []).filter((_, i) => i !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!match.trim()) return;
            changeRules([...(draft ?? []), { match: match.trim(), mode: ruleMode }]);
            setMatch('');
          }}
        >
          <Input
            className="h-8 min-w-0 flex-1 text-sm"
            placeholder="Programm oder Fenstertitel, z. B. keepassxc"
            value={match}
            onChange={(e) => setMatch(e.target.value)}
          />
          <select
            aria-label="Art der neuen Regel"
            className="rounded-md border bg-background px-2 text-xs"
            value={ruleMode}
            onChange={(e) => setRuleMode(e.target.value as DesktopRule['mode'])}
          >
            <option value="block">Gesperrt</option>
            <option value="ask">Fragen</option>
          </select>
          <Button size="sm" type="submit" disabled={!match.trim()}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Regel
          </Button>
        </form>
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-medium text-muted-foreground">
          Weiteren Computer einrichten (Linux)
        </span>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            install.mutate();
          }}
        >
          <Input
            className="h-8 min-w-0 flex-1 text-sm"
            placeholder="Name, z. B. Laptop"
            value={computer}
            onChange={(e) => setComputer(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={install.isPending}>
            Befehl erzeugen
          </Button>
        </form>
        {command && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <code className="min-w-0 flex-1 break-all text-xs">{command}</code>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                aria-label="Befehl kopieren"
                onClick={() => {
                  void navigator.clipboard.writeText(command);
                  setCopied(true);
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Im Terminal des Computers ausführen. Gilt 15 Minuten und nur einmal; installiert
              Abhängigkeiten (sudo), Rechte für Tastatur und Maus und den Autostart.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
