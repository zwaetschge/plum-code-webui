import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';

export interface DesktopActivity {
  sessionId: string;
  sessionName: string;
  status: string;
  action: string;
  progress: string;
  history: string[];
  result: string;
  resultTarget: string;
  chat: string;
  screens: Array<{ name: string; width: number; height: number; primary: boolean }>;
  layout?: {
    chatScreen: string;
    chatPlacement: string;
    chatVisible: boolean;
    chatZoom: number;
    chatInsetTop: number;
  };
}

export function DesktopActivityCard({
  connectionId,
  activity,
}: {
  connectionId: string;
  activity?: DesktopActivity | null;
}) {
  const [message, setMessage] = useState('');
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: (body: {
      action: string;
      message?: string;
      layout?: Partial<NonNullable<DesktopActivity['layout']>>;
    }) => api.post('/api/browser-bridge/desktop/action', { connectionId, ...body }),
    onSuccess: (_data, body) => {
      if (body.action === 'message') setMessage('');
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ['browser-bridge-status'] }),
        600
      );
    },
  });
  return (
    <div className="space-y-2 border-t border-border pt-2">
      {activity && (
        <>
          <p className="text-sm font-medium" aria-live="polite">
            {activity.sessionName} · {activity.status}
          </p>
          {activity.action && <p className="text-xs text-muted-foreground">{activity.action}</p>}
          {activity.progress && <p className="text-xs">{activity.progress}</p>}
          {activity.chat && (
            <div
              className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs"
              aria-label="Desktop-Chat"
            >
              {activity.chat}
            </div>
          )}
          {activity.result && <p className="whitespace-pre-wrap text-xs">{activity.result}</p>}
          {activity.history.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer">Letzte Schritte</summary>
              <ol className="space-y-1 pt-2">
                {activity.history.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={action.isPending}
          onClick={() => action.mutate({ action: 'stop' })}
        >
          Stoppen
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={action.isPending}
          onClick={() => action.mutate({ action: 'context' })}
        >
          Stelle am PC auswählen
        </Button>
        {activity?.resultTarget && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => action.mutate({ action: 'open_result' })}
          >
            Ergebnis am PC öffnen
          </Button>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) action.mutate({ action: 'message', message: message.trim() });
        }}
      >
        <Input
          aria-label="Nachricht an den Desktop-Agenten"
          placeholder="Nachricht oder Nachbesserung …"
          value={message}
          maxLength={4000}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button size="sm" disabled={!message.trim() || action.isPending} type="submit">
          Senden
        </Button>
      </form>
      {activity?.layout && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label>
            Chat-Bildschirm{' '}
            <select
              className="rounded border border-border bg-background p-1"
              value={activity.layout.chatScreen}
              onChange={(e) =>
                action.mutate({ action: 'layout', layout: { chatScreen: e.target.value } })
              }
            >
              <option value="primary">Hauptbildschirm</option>
              <option value="secondary">Kleiner Zusatzbildschirm</option>
              {activity.screens.map((screen) => (
                <option key={screen.name} value={screen.name}>
                  {screen.name} · {screen.width}×{screen.height}
                </option>
              ))}
            </select>
          </label>
          <label>
            Anordnung{' '}
            <select
              className="rounded border border-border bg-background p-1"
              value={activity.layout.chatPlacement}
              onChange={(e) =>
                action.mutate({ action: 'layout', layout: { chatPlacement: e.target.value } })
              }
            >
              <option value="floating">Frei verschiebbar</option>
              <option value="left">Linke Hälfte</option>
              <option value="right">Rechte Hälfte</option>
              <option value="full">Ganze Bildschirmfläche</option>
            </select>
          </label>
          <label>
            Schrift und Bedienung{' '}
            <select
              className="rounded border border-border bg-background p-1"
              value={activity.layout.chatZoom}
              onChange={(e) =>
                action.mutate({ action: 'layout', layout: { chatZoom: Number(e.target.value) } })
              }
            >
              {[100, 125, 150, 175, 200, 250].map((zoom) => (
                <option key={zoom} value={zoom}>
                  {zoom} %
                </option>
              ))}
            </select>
          </label>
          <label>
            Platz oben für Dock{' '}
            <select
              className="rounded border border-border bg-background p-1"
              value={activity.layout.chatInsetTop}
              onChange={(e) =>
                action.mutate({
                  action: 'layout',
                  layout: { chatInsetTop: Number(e.target.value) },
                })
              }
            >
              {[0, 48, 64, 80, 96, 120, 160, 200, activity.layout.chatInsetTop]
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort((a, b) => a - b)
                .map((space) => (
                  <option key={space} value={space}>
                    {space} px
                  </option>
                ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              action.mutate({
                action: 'layout',
                layout: { chatVisible: !activity.layout!.chatVisible },
              })
            }
          >
            {activity.layout.chatVisible ? 'Chat am PC ausblenden' : 'Chat am PC einblenden'}
          </Button>
        </div>
      )}
      {action.isError && (
        <p role="alert" className="text-xs text-destructive">
          {action.error.message}
        </p>
      )}
      {action.isSuccess && (
        <p role="status" className="text-xs text-muted-foreground">
          An den Computer übermittelt.
        </p>
      )}
    </div>
  );
}
