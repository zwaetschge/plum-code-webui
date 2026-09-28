import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Globe, Loader2, Play, RefreshCw, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import type { ApiResponse, OracleBrowserMode } from '@plum-code-webui/shared';

interface OracleBrowserPanelProps {
  sessionId: string;
  className?: string;
}

interface OracleBrowserState {
  sessionId: string;
  status: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
  running: boolean;
  mode: OracleBrowserMode;
  chatgptUrl: string;
  currentUrl: string | null;
  title: string | null;
  profileDir: string;
  debugPort: number | null;
  remoteChromeTarget: string | null;
  oracleWillAttachToEmbeddedBrowser: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  lastFrameAt: string | null;
  viewport: {
    width: number;
    height: number;
  };
  message: string;
  error: string | null;
  outputTail: string;
}

const FRAME_REFRESH_MS = 900;
const STATE_REFRESH_MS = 2000;

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getViewportPointerRatios(
  image: HTMLImageElement | null,
  viewport: OracleBrowserState['viewport'] | undefined,
  clientX: number,
  clientY: number
): { xRatio: number; yRatio: number } | null {
  if (!image) return null;

  const rect = image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const viewportWidth = viewport?.width || image.naturalWidth || 1;
  const viewportHeight = viewport?.height || image.naturalHeight || 1;
  const viewportAspect = viewportWidth / viewportHeight;
  const containerAspect = rect.width / rect.height;

  let renderedWidth = rect.width;
  let renderedHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (containerAspect > viewportAspect) {
    renderedWidth = rect.height * viewportAspect;
    offsetX = (rect.width - renderedWidth) / 2;
  } else if (containerAspect < viewportAspect) {
    renderedHeight = rect.width / viewportAspect;
    offsetY = (rect.height - renderedHeight) / 2;
  }

  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;

  if (localX < 0 || localX > renderedWidth || localY < 0 || localY > renderedHeight) {
    return null;
  }

  return {
    xRatio: clampRatio(localX / renderedWidth),
    yRatio: clampRatio(localY / renderedHeight),
  };
}

function statusTone(status: OracleBrowserState['status'] | undefined): string {
  if (status === 'running') return 'bg-emerald-500';
  if (status === 'starting') return 'bg-amber-400 animate-pulse';
  if (status === 'error') return 'bg-red-500';
  return 'bg-muted-foreground/40';
}

function modeLabel(mode: OracleBrowserMode | undefined): string {
  if (mode === 'manual') return 'Embedded Browser';
  if (mode === 'remote') return 'Remote Browser';
  return 'Profile Copy';
}

export function OracleBrowserPanel({ sessionId, className }: OracleBrowserPanelProps) {
  const navigate = useNavigate();
  const token = useAuthStore((state) => state.token);
  const [state, setState] = useState<OracleBrowserState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isStateLoading, setIsStateLoading] = useState(true);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isFrameLoading, setIsFrameLoading] = useState(false);
  const [hasControlFocus, setHasControlFocus] = useState(false);
  const frameRequestInFlight = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const wheelThrottleRef = useRef(0);

  const cleanupFrameUrl = useCallback((url: string | null) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }, []);

  useEffect(() => {
    return () => cleanupFrameUrl(frameUrl);
  }, [cleanupFrameUrl, frameUrl]);

  const fetchFrame = useCallback(async () => {
    if (frameRequestInFlight.current) return;
    frameRequestInFlight.current = true;
    setIsFrameLoading(true);

    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`/api/oracle/browser/${sessionId}/frame`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Browser frame is not available yet');
      }

      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setFrameUrl((previous) => {
        cleanupFrameUrl(previous);
        return nextUrl;
      });
    } catch (error) {
      setStateError(error instanceof Error ? error.message : 'Failed to load browser frame');
    } finally {
      frameRequestInFlight.current = false;
      setIsFrameLoading(false);
    }
  }, [cleanupFrameUrl, sessionId, token]);

  const stateRef = useRef<OracleBrowserState | null>(null);
  const loadState = useCallback(async () => {
    try {
      const response = await api.get<ApiResponse<OracleBrowserState>>(
        `/api/oracle/browser/${sessionId}`
      );
      const nextState = response.data.data || null;
      setState(nextState);
      setStateError(null);
      setDraftUrl((current) => {
        const previous = stateRef.current;
        if (
          !current.trim() ||
          current === previous?.currentUrl ||
          current === previous?.chatgptUrl
        ) {
          return nextState?.currentUrl || nextState?.chatgptUrl || '';
        }
        return current;
      });
      stateRef.current = nextState;
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load browser state';
      setStateError(message);
      return null;
    } finally {
      setIsStateLoading(false);
    }
    // Deliberately not keyed on state: every URL change used to mint a new
    // loadState, which re-fired the mount effect immediately and rebuilt the
    // poll interval — back-to-back requests instead of one every 2s.
  }, [sessionId]);

  const refreshAll = useCallback(async () => {
    const nextState = await loadState();
    if (nextState?.running) {
      await fetchFrame();
    }
  }, [fetchFrame, loadState]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    const stateInterval = window.setInterval(() => {
      void loadState();
    }, STATE_REFRESH_MS);
    return () => window.clearInterval(stateInterval);
  }, [loadState]);

  useEffect(() => {
    if (!state?.running) {
      setFrameUrl((previous) => {
        cleanupFrameUrl(previous);
        return null;
      });
      return;
    }

    void fetchFrame();
    const frameInterval = window.setInterval(() => {
      void fetchFrame();
    }, FRAME_REFRESH_MS);
    return () => window.clearInterval(frameInterval);
  }, [cleanupFrameUrl, fetchFrame, state?.running]);

  const runAction = useCallback(
    async (task: () => Promise<void>) => {
      setIsActionPending(true);
      try {
        await task();
        await refreshAll();
      } catch (error) {
        setStateError(error instanceof Error ? error.message : 'Oracle browser action failed');
      } finally {
        setIsActionPending(false);
      }
    },
    [refreshAll]
  );

  const startBrowser = useCallback(() => {
    void runAction(async () => {
      await api.post<ApiResponse<OracleBrowserState>>(`/api/oracle/browser/${sessionId}/start`, {
        url: draftUrl || state?.chatgptUrl || undefined,
      });
    });
  }, [draftUrl, runAction, sessionId, state?.chatgptUrl]);

  const stopBrowser = useCallback(() => {
    void runAction(async () => {
      await api.post(`/api/oracle/browser/${sessionId}/stop`);
    });
  }, [runAction, sessionId]);

  const reloadBrowser = useCallback(() => {
    void runAction(async () => {
      await api.post(`/api/oracle/browser/${sessionId}/reload`);
    });
  }, [runAction, sessionId]);

  const navigateBrowser = useCallback(() => {
    const url = draftUrl.trim();
    if (!url) return;
    void runAction(async () => {
      await api.post(`/api/oracle/browser/${sessionId}/navigate`, { url });
    });
  }, [draftUrl, runAction, sessionId]);

  const sendText = useCallback(() => {
    const text = textInput;
    if (!text) return;
    void runAction(async () => {
      await api.post(`/api/oracle/browser/${sessionId}/text`, { text });
      setTextInput('');
    });
  }, [runAction, sessionId, textInput]);

  const focusPreview = useCallback(() => {
    previewRef.current?.focus();
  }, []);

  const clickPreview = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      focusPreview();
      const point = getViewportPointerRatios(
        imageRef.current,
        state?.viewport,
        event.clientX,
        event.clientY
      );
      if (!point) return;

      void api
        .post(`/api/oracle/browser/${sessionId}/click`, { ...point, button: 'left' })
        .then(() => window.setTimeout(() => void fetchFrame(), 180))
        .catch((error) =>
          setStateError(error instanceof Error ? error.message : 'Browser click failed')
        );
    },
    [fetchFrame, focusPreview, sessionId, state?.viewport]
  );

  const wheelPreview = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const point = getViewportPointerRatios(
        imageRef.current,
        state?.viewport,
        event.clientX,
        event.clientY
      );
      if (!point) return;

      const now = Date.now();
      if (now - wheelThrottleRef.current < 90) return;
      wheelThrottleRef.current = now;

      event.preventDefault();
      void api
        .post(`/api/oracle/browser/${sessionId}/wheel`, {
          xRatio: point.xRatio,
          yRatio: point.yRatio,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        })
        .then(() => window.setTimeout(() => void fetchFrame(), 160))
        .catch((error) =>
          setStateError(error instanceof Error ? error.message : 'Browser scroll failed')
        );
    },
    [fetchFrame, sessionId, state?.viewport]
  );

  const keyPreview = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        reloadBrowser();
        return;
      }

      const allowedSpecialKeys = new Set([
        'Enter',
        'Tab',
        'Backspace',
        'Escape',
        'Delete',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ]);
      const isPrintable = event.key.length === 1;
      if (!isPrintable && !allowedSpecialKeys.has(event.key)) {
        return;
      }

      event.preventDefault();
      void api
        .post(`/api/oracle/browser/${sessionId}/key`, {
          key: event.key,
          code: event.code,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        })
        .then(() => window.setTimeout(() => void fetchFrame(), 140))
        .catch((error) =>
          setStateError(error instanceof Error ? error.message : 'Browser key input failed')
        );
    },
    [fetchFrame, reloadBrowser, sessionId]
  );

  const diagnostics = useMemo(() => {
    if (!state?.outputTail) return null;
    return state.outputTail.split('\n').slice(-8).join('\n').trim();
  }, [state?.outputTail]);

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      <div className="shrink-0 border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Oracle Browser</span>
              <span className={cn('h-2 w-2 rounded-full', statusTone(state?.status))} />
              <span className="text-[11px] text-muted-foreground">{modeLabel(state?.mode)}</span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground/80">
              {state?.currentUrl || state?.chatgptUrl || 'Embedded browser not started'}
            </p>
          </div>
          {isStateLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'shrink-0 border-b border-border/60 px-3',
          state?.running ? 'space-y-2 py-2' : 'space-y-3 py-3'
        )}
      >
        {!state?.running && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {state?.message ||
              'Start a headless Chromium profile inside Plum, then log into ChatGPT directly in this panel.'}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={startBrowser}
            disabled={isActionPending || state?.status === 'starting'}
            className="flex-1"
          >
            {state?.running ? (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Reopen ChatGPT
              </>
            ) : state?.status === 'starting' ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Starting
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Start Browser
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={reloadBrowser}
            disabled={!state?.running || isActionPending}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={stopBrowser}
            disabled={!state || state.status === 'idle' || isActionPending}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                navigateBrowser();
              }
            }}
            placeholder={state?.chatgptUrl || 'https://chatgpt.com/'}
            className="h-9 text-xs font-mono"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={navigateBrowser}
            disabled={!state?.running || isActionPending}
          >
            Open
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="min-w-0">
            <div className="truncate">
              {state?.oracleWillAttachToEmbeddedBrowser
                ? 'Oracle attach: ready'
                : `Oracle mode: ${modeLabel(state?.mode)}`}
            </div>
            <div className="truncate font-mono opacity-80">
              {state?.remoteChromeTarget || state?.profileDir || 'No browser target yet'}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => navigate('/settings?tab=integrations&section=oracle-browser')}
          >
            Settings
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-2">
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-[#0b1018]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] text-slate-300">
            <span className="truncate">
              {state?.title || (state?.running ? 'Embedded Chromium' : 'Browser inactive')}
            </span>
            <span className="font-mono text-slate-400">
              {state?.viewport.width}x{state?.viewport.height}
            </span>
          </div>

          <div
            ref={previewRef}
            tabIndex={0}
            role="application"
            className={cn(
              'relative flex-1 overflow-hidden outline-none',
              hasControlFocus && 'ring-2 ring-inset ring-emerald-400/60'
            )}
            onFocus={() => setHasControlFocus(true)}
            onBlur={() => setHasControlFocus(false)}
            onClick={clickPreview}
            onWheel={wheelPreview}
            onKeyDown={keyPreview}
          >
            {state?.running && frameUrl ? (
              <>
                <img
                  ref={imageRef}
                  src={frameUrl}
                  alt="Embedded Oracle browser"
                  className="h-full w-full object-contain"
                  draggable={false}
                />
                {!hasControlFocus && (
                  <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-center text-[11px] text-slate-200 backdrop-blur">
                    Click the preview, then type directly here to log into ChatGPT.
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-slate-300">
                {state?.status === 'starting' || isFrameLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                ) : (
                  <Globe className="h-8 w-8 text-slate-500" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {state?.status === 'starting'
                      ? 'Starting embedded browser'
                      : 'No browser viewport yet'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {state?.status === 'starting'
                      ? 'Chromium is launching and exposing a controllable DevTools session.'
                      : 'Start the browser, then log into ChatGPT without leaving Plum.'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 bg-black/20 px-2 py-2">
            <div className="flex gap-2">
              <Input
                value={textInput}
                onChange={(event) => setTextInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    sendText();
                  }
                }}
                placeholder="Paste email, password, or OTP into the currently focused field"
                className="h-8 border-white/10 bg-black/30 text-xs text-slate-100 placeholder:text-slate-500"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={sendText}
                disabled={!state?.running || !textInput || isActionPending}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {(stateError || state?.error || diagnostics) && (
        <div className="shrink-0 border-t border-border/60 bg-destructive/5 px-3 py-3">
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div className="min-w-0 flex-1 space-y-2">
              {stateError || state?.error ? (
                <p className="text-destructive">{stateError || state?.error}</p>
              ) : null}
              {diagnostics ? (
                <pre className="max-h-28 overflow-auto rounded-md border border-destructive/20 bg-background/60 p-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                  {diagnostics}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
