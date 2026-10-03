import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@plum-code-webui/shared';

/**
 * Live view of the tab this session works in through the Plum Browser
 * extension: a picture every few seconds, the agent's cursor and marks
 * included, plus a pause switch for all connected browsers.
 */

interface LiveFrame {
  image: { data: string; mimeType: string } | null;
  info: string | null;
  code?: string;
  paused: boolean;
  at: string;
}

const REFRESH_MS = 2500;

export function BrowserLivePanel({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const [watching, setWatching] = useState(false);
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.get<ApiResponse<LiveFrame>>(
        `/api/browser-bridge/live/${encodeURIComponent(sessionId)}`
      );
      if (response.data.data) setFrame(response.data.data);
    } catch (error) {
      setFrame({
        image: null,
        info: error instanceof Error ? error.message : 'Live-Ansicht nicht erreichbar',
        paused: false,
        at: new Date().toISOString(),
      });
    }
  }, [sessionId]);

  useEffect(() => {
    if (!watching) return;
    let timer: number | undefined;
    let cancelled = false;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!cancelled) timer = window.setTimeout(tick, REFRESH_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load, watching]);

  const togglePause = async () => {
    setBusy(true);
    try {
      await api.post('/api/browser-bridge/pause', { paused: !frame?.paused });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={cn('space-y-2 border-b border-border/60 p-3', className)}
      aria-label="Browser live"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Mein Browser · live</h3>
          <p className="truncate text-xs text-muted-foreground">
            {watching
              ? frame?.info || 'Lade …'
              : 'Sieh zu, was die Session in deinem Firefox oder Chrome macht.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {watching && frame && !frame.code && (
            <Button
              type="button"
              size="sm"
              variant={frame.paused ? 'default' : 'outline'}
              onClick={() => void togglePause()}
              disabled={busy}
            >
              {frame.paused ? (
                <Play className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Pause className="mr-1 h-3.5 w-3.5" />
              )}
              {frame.paused ? 'Fortsetzen' : 'Pause'}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={watching ? 'outline' : 'default'}
            onClick={() => setWatching((value) => !value)}
          >
            {watching ? (
              <EyeOff className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Eye className="mr-1 h-3.5 w-3.5" />
            )}
            {watching ? 'Aus' : 'Zusehen'}
          </Button>
        </div>
      </div>
      {watching && frame?.image && (
        <img
          src={`data:${frame.image.mimeType};base64,${frame.image.data}`}
          alt={`Browser-Tab der Session: ${frame.info ?? ''}`}
          className="w-full rounded-md border border-border/60 bg-black/5"
        />
      )}
      {watching && frame?.paused && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Browser-Steuerung ist pausiert – Agents können gerade nichts tun.
        </p>
      )}
    </section>
  );
}

export default BrowserLivePanel;
