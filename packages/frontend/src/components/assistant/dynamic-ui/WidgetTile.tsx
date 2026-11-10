import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, CircleAlert, Code2, Maximize2, RotateCcw, Sparkles, X } from 'lucide-react';
import { isUiHttpsUrl, uiWidgetLiveId, type UiLiveNode } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import type { Ctx, Renderer } from './context';
import { CodeBlock } from './content';
import { useDynamicUiHost } from './host';
import { readPersisted, writePersisted } from './persist';
import { readThemePalette, useThemeClass } from './theme';
import './dynamic-ui-inline.css';
import './dynamic-ui-widget.css';

/*
 * Host of a model-authored tile (type "widget"). The code runs only inside
 * /ui-widget.html in an iframe with sandbox="allow-scripts" (opaque origin: no
 * cookies, storage or network; the server adds a CSP sandbox header). This
 * side checks every message's source and fields and maps the plum.* calls to
 * the same actions and guards as the catalog components.
 * Protocol: docs/plans/dynamic-ui-widgets-2026-11-07.md §2.
 */

const FRAME_SRC = `${import.meta.env.BASE_URL}ui-widget.html`;
const START_TIMEOUT_MS = 6000;
const DEFAULT_HEIGHT = 180;
const MIN_HEIGHT = 60;
const MAX_INLINE_HEIGHT = 900;
const MAX_STATE_JSON = 32000;
const MAX_TEXT = 2000;
const MAX_COPY = 20000;
const SEND_INTERVAL_MS = 3000;
const REFRESH_INTERVAL_MS = 5000;
const MAX_IMAGES = 24;
const MAX_ERRORS = 3;
/** A frame that keeps reloading itself is stopped. */
const MAX_READY = 4;

type Json = Record<string, unknown>;
type FrameTheme = { mode: 'dark' | 'light'; vars: Record<string, string> };
type FrameLive = Record<
  string,
  { status: 'pending' | 'resolved' | 'failed'; data?: unknown; error?: string; retryable?: boolean }
>;

const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max ? value : null;

/** Plain JSON copy of an object, or null when it is not one or too large. */
function jsonObject(value: unknown, max: number): Json | null {
  if (!isRecord(value)) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length > max) return null;
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** A user gesture inside the tile also activates this page (HTML user activation). */
const hasGesture = () => navigator.userActivation?.isActive ?? true;

/** WebUI tokens as the tile's --plum-* variables (resolved colour strings). */
function readFrameTheme(): FrameTheme {
  const root = document.documentElement;
  const dark = root.classList.contains('dark');
  const styles = getComputedStyle(root);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const hsl = (name: string, fallback: string) => `hsl(${token(name, fallback)})`;
  const ink = dark ? '0 0% 100%' : token('--foreground', '220 20% 10%');
  const vars: Record<string, string> = {
    '--plum-text': hsl('--foreground', dark ? '0 0% 96%' : '220 20% 10%'),
    '--plum-muted': hsl('--muted-foreground', '220 8% 50%'),
    '--plum-surface': `hsl(${ink} / ${dark ? 0.05 : 0.035})`,
    '--plum-surface-2': `hsl(${ink} / ${dark ? 0.085 : 0.06})`,
    '--plum-border': `hsl(${ink} / ${dark ? 0.12 : 0.11})`,
    '--plum-accent': hsl('--primary', '168 72% 40%'),
    '--plum-accent-text': hsl('--primary-foreground', '0 0% 100%'),
    '--plum-good': hsl('--dui-success', dark ? '146 58% 56%' : '146 64% 32%'),
    '--plum-bad': hsl('--dui-danger', dark ? '4 88% 68%' : '2 70% 48%'),
    '--plum-warn': hsl('--dui-warning', dark ? '40 95% 62%' : '34 92% 40%'),
    '--plum-radius': '14px',
    '--plum-font': token(
      '--font-body',
      "'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, sans-serif"
    ),
  };
  // Same hue order as the runtime defaults (teal, violet, pink, amber, blue, …),
  // so a tile looks alike on every host.
  const [primary, violet, amber, blue, pink] = readThemePalette(dark);
  const orange = dark ? 'hsl(24 92% 60%)' : 'hsl(22 88% 48%)';
  [primary, violet, pink, amber, blue, orange].forEach(
    (colour, index) => (vars[`--plum-chart-${index + 1}`] = colour!)
  );
  return { mode: dark ? 'dark' : 'light', vars };
}

/** The tile's live inputs as the frame sees them (missing = pending). */
function frameLive(
  node: { id: string; live?: Record<string, unknown> },
  ctx: Ctx,
  refreshing: string[]
): FrameLive {
  const out: FrameLive = {};
  for (const [name, input] of Object.entries(node.live ?? {})) {
    const liveNode = { ...(input as object), id: uiWidgetLiveId(node.id, name) } as UiLiveNode;
    const result = refreshing.includes(name) ? undefined : ctx.live(liveNode);
    if (!result || result.status === 'pending') out[name] = { status: 'pending' };
    else if (result.status === 'failed' || !result.data)
      out[name] = {
        status: 'failed',
        error: result.error || 'Die Daten sind gerade nicht verfügbar.',
        retryable: result.retryable !== false,
      };
    else out[name] = { status: 'resolved', data: result.data };
  }
  return out;
}

/** Per-frame bookkeeping; a new frame (restart, new code) starts a new session. */
interface Session {
  key: string;
  ready: number;
  rendered: boolean;
  images: number;
  sentLive: string;
  sentTheme: string;
  sentDisplay: string;
}

export const WidgetTile: Renderer<'widget'> = ({ node, ctx }) => {
  const host = useDynamicUiHost();
  const themeClass = useThemeClass();
  const theme = useMemo(readFrameTheme, [themeClass]);
  const storageKey = ctx.storageKey(node.id);
  const title = node.title?.trim() || 'Eigene Kachel';

  const [instance, setInstance] = useState(0);
  const propsJson = useMemo(() => JSON.stringify(node.props ?? {}), [node.props]);
  const frameKey = `${hashText(`${node.html}\u0000${propsJson}`)}-${instance}`;
  const [phase, setPhase] = useState<'loading' | 'rendered' | 'failed'>('loading');
  const [reported, setReported] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [placeholder, setPlaceholder] = useState(0);
  const [codeOpen, setCodeOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState<string[]>([]);
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});

  const frameRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const fullButton = useRef<HTMLButtonElement>(null);
  const session = useRef<Session>({
    key: '',
    ready: 0,
    rendered: false,
    images: 0,
    sentLive: '',
    sentTheme: '',
    sentDisplay: '',
  });
  const memoryState = useRef<Json | null>(null);
  const lastSend = useRef(0);
  const lastRefresh = useRef<Record<string, number>>({});
  const copiedTimer = useRef(0);

  const live = frameLive(node, ctx, refreshing);
  for (const [name, error] of Object.entries(refreshErrors))
    if (live[name]?.status === 'pending' && !refreshing.includes(name))
      live[name] = { status: 'failed', error, retryable: true };
  const liveJson = JSON.stringify(live);
  const themeJson = JSON.stringify(theme);

  const savedState = useCallback((): Json => {
    const stored = jsonObject(readPersisted<unknown>(storageKey), MAX_STATE_JSON);
    return stored ?? memoryState.current ?? node.state ?? {};
  }, [storageKey, node.state]);

  /** Everything the message handler reads, current on every render. */
  const current = useRef({ node, ctx, host, theme, live, full, savedState, storageKey });
  useLayoutEffect(() => {
    current.current = { node, ctx, host, theme, live, full, savedState, storageKey };
  });

  const post = useCallback((message: Json) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  const enterFull = useCallback(() => {
    setPlaceholder(rootRef.current?.offsetHeight ?? 0);
    setFull(true);
  }, []);
  const exitFull = useCallback(() => setFull(false), []);

  const restart = useCallback(() => {
    setErrors([]);
    setRefreshErrors({});
    setPhase('loading');
    setInstance((value) => value + 1);
  }, []);

  // A new frame: fresh session, skeleton until it reports `rendered`.
  useLayoutEffect(() => {
    session.current = {
      key: frameKey,
      ready: 0,
      rendered: false,
      images: 0,
      sentLive: '',
      sentTheme: '',
      sentDisplay: '',
    };
    setPhase('loading');
  }, [frameKey]);

  // Fallback when the frame does not start within 6 s of becoming visible
  // (loading="lazy": an off-screen frame has not even been requested yet).
  useEffect(() => {
    const stage = shellRef.current;
    if (!stage) return;
    let timer = 0;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || timer) return;
      observer.disconnect();
      timer = window.setTimeout(() => {
        if (session.current.key === frameKey && !session.current.rendered) setPhase('failed');
      }, START_TIMEOUT_MS);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [frameKey]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // Messages from the frame. Only our own frame's window counts, and only
  // while it has an opaque origin (the sandbox is in force).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return;
      if (event.origin !== 'null') return;
      const data: unknown = event.data;
      if (!isRecord(data) || typeof data.plum !== 'string') return;
      const now = current.current;
      const own = session.current;
      switch (data.plum) {
        case 'ready': {
          // Again after a reload of the frame: render once more from the saved state.
          if (++own.ready > MAX_READY) {
            setPhase('failed');
            return;
          }
          own.rendered = false;
          own.sentLive = JSON.stringify(now.live);
          own.sentTheme = JSON.stringify(now.theme);
          own.sentDisplay = now.full ? 'fullscreen' : 'inline';
          post({
            plum: 'render',
            html: now.node.html,
            props: now.node.props ?? {},
            live: now.live,
            state: now.savedState(),
            theme: now.theme,
            display: own.sentDisplay,
          });
          return;
        }
        case 'rendered':
          if (!own.ready) return;
          own.rendered = true;
          setPhase('rendered');
          return;
        case 'height':
          if (typeof data.value === 'number' && Number.isFinite(data.value) && data.value >= 0)
            setReported(Math.round(data.value));
          return;
        case 'state': {
          const value = jsonObject(data.value, MAX_STATE_JSON);
          if (!value) return;
          memoryState.current = value;
          writePersisted(now.storageKey, value);
          return;
        }
        case 'sendMessage': {
          const value = text(data.text, MAX_TEXT)?.trim();
          if (!value || !now.ctx.latest || !hasGesture()) return;
          const at = Date.now();
          if (at - lastSend.current < SEND_INTERVAL_MS) return;
          const action = { type: 'sendMessage', text: value } as const;
          if (!now.ctx.canRun(action)) return;
          lastSend.current = at;
          void now.ctx.runLiteral(action);
          return;
        }
        case 'prefill': {
          const value = text(data.text, MAX_TEXT);
          if (!value?.trim() || !hasGesture()) return;
          void now.ctx.runLiteral({ type: 'prefill', text: value });
          return;
        }
        case 'copy': {
          const value = text(data.text, MAX_COPY);
          if (!value || !hasGesture()) return;
          void now.ctx.runLiteral({ type: 'copy', text: value }).then((result) => {
            if (result !== 'copied') return;
            setCopied(true);
            window.clearTimeout(copiedTimer.current);
            copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
          });
          return;
        }
        case 'openUrl': {
          const url = text(data.url, MAX_TEXT);
          if (!url || !isUiHttpsUrl(url) || !hasGesture()) return;
          void now.ctx.runLiteral({ type: 'openUrl', url });
          return;
        }
        case 'openEntity': {
          const title = text(data.title, 200)?.trim();
          const lang = data.lang === undefined ? undefined : text(data.lang, 3);
          if (!title || lang === null || (lang && !/^[a-z]{2,3}$/.test(lang)) || !hasGesture())
            return;
          void now.ctx.runLiteral({ type: 'openEntity', title, ...(lang ? { lang } : {}) });
          return;
        }
        case 'refresh': {
          const name = text(data.name, 40);
          const input = name ? now.node.live?.[name] : undefined;
          const state = name ? now.live[name] : undefined;
          if (!name || !input || !now.ctx.refresh || state?.status !== 'failed') return;
          if (state.retryable === false) return;
          const at = Date.now();
          if (at - (lastRefresh.current[name] ?? 0) < REFRESH_INTERVAL_MS) return;
          lastRefresh.current[name] = at;
          const refresh = now.ctx.refresh;
          setRefreshing((list) => [...list, name]);
          setRefreshErrors(({ [name]: _gone, ...rest }) => rest);
          refresh(uiWidgetLiveId(now.node.id, name))
            .catch((failure: unknown) =>
              setRefreshErrors((errors) => ({
                ...errors,
                [name]:
                  failure instanceof Error ? failure.message : 'Erneut versuchen fehlgeschlagen',
              }))
            )
            .finally(() => setRefreshing((list) => list.filter((entry) => entry !== name)));
          return;
        }
        case 'display':
          if (data.value === 'fullscreen' && !now.full && hasGesture()) enterFull();
          else if (data.value === 'inline' && now.full) exitFull();
          return;
        case 'image': {
          const id = data.id;
          const url = text(data.url, MAX_TEXT);
          if (typeof id !== 'number' || !Number.isSafeInteger(id) || !url) return;
          if (!isUiHttpsUrl(url) || own.images >= MAX_IMAGES) return;
          own.images++;
          const target = frame.contentWindow;
          const reply = (message: Json) => {
            if (session.current === own && frameRef.current?.contentWindow === target)
              target.postMessage({ plum: 'image', id, ...message }, '*');
          };
          now.host.loadImageData(url).then(
            (dataUrl) => reply({ dataUrl }),
            () => reply({ error: 'Bild nicht verfügbar' })
          );
          return;
        }
        case 'error': {
          const message = typeof data.message === 'string' ? data.message.slice(0, 300) : '';
          if (message) setErrors((list) => (list.length >= MAX_ERRORS ? list : [...list, message]));
          return;
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post, enterFull, exitFull]);

  // Live inputs, theme and display changes after the first render.
  useEffect(() => {
    const own = session.current;
    if (!own.ready || own.sentLive === liveJson) return;
    own.sentLive = liveJson;
    post({ plum: 'live', live: JSON.parse(liveJson) as FrameLive });
  }, [liveJson, post]);
  useEffect(() => {
    const own = session.current;
    if (!own.ready || own.sentTheme === themeJson) return;
    own.sentTheme = themeJson;
    post({ plum: 'theme', theme: JSON.parse(themeJson) as FrameTheme });
  }, [themeJson, post]);
  useEffect(() => {
    const own = session.current;
    const value = full ? 'fullscreen' : 'inline';
    if (!own.ready || own.sentDisplay === value) return;
    own.sentDisplay = value;
    post({ plum: 'display', value });
  }, [full, post]);

  // Fullscreen: the shell enters the top layer (popover) or a fixed overlay;
  // the iframe never moves in the DOM, which would reload it.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!full || !shell) return;
    const popover = typeof shell.showPopover === 'function';
    if (popover) {
      shell.setAttribute('popover', 'manual');
      try {
        shell.showPopover();
      } catch {
        /* falls back to the fixed overlay */
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    shell.querySelector<HTMLButtonElement>('.dui-widget-close')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      if (popover) {
        try {
          if (shell.matches(':popover-open')) shell.hidePopover();
        } catch {
          /* already closed */
        }
        shell.removeAttribute('popover');
      }
    };
  }, [full]);
  // Back from fullscreen: focus returns to the button that opened it.
  const wasFull = useRef(false);
  useEffect(() => {
    if (wasFull.current && !full) fullButton.current?.focus({ preventScroll: true });
    wasFull.current = full;
  }, [full]);

  const inlineHeight =
    node.height ??
    (reported === null
      ? DEFAULT_HEIGHT
      : Math.min(MAX_INLINE_HEIGHT, Math.max(MIN_HEIGHT, reported)));
  const overflowing = !node.height && reported !== null && reported > MAX_INLINE_HEIGHT;
  const codeNode = useMemo(
    () => ({ type: 'code' as const, code: node.html, language: 'html', title }),
    [node.html, title]
  );

  return (
    <section
      ref={rootRef}
      className="dui-widget"
      style={full && placeholder ? { minHeight: placeholder } : undefined}
      data-widget={node.id}
    >
      <div
        ref={shellRef}
        className={cn('dui-widget-shell', full && 'is-fullscreen')}
        role={full ? 'dialog' : undefined}
        aria-modal={full || undefined}
        aria-label={full ? title : undefined}
      >
        <header className="dui-widget-head">
          <span className="dui-widget-glyph" aria-hidden>
            <Sparkles size={13} />
          </span>
          <span className={cn('dui-widget-title', !node.title && 'is-generic')}>{title}</span>
          {copied && (
            <span className="dui-widget-flash" role="status">
              <Check size={13} className="plum-pop" aria-hidden />
              Kopiert
            </span>
          )}
          <div className="dui-widget-tools" role="toolbar" aria-label="Kachel">
            <button
              type="button"
              className="dui-icon-button is-quiet"
              aria-label="Code anzeigen"
              title="Code anzeigen"
              onClick={() => setCodeOpen(true)}
            >
              <Code2 size={15} />
            </button>
            <button
              type="button"
              className="dui-icon-button is-quiet"
              aria-label="Neu starten"
              title="Neu starten"
              onClick={restart}
            >
              <RotateCcw size={15} />
            </button>
            {!full && (
              <button
                ref={fullButton}
                type="button"
                className="dui-icon-button is-quiet"
                aria-label="Vollbild"
                title="Vollbild"
                onClick={enterFull}
              >
                <Maximize2 size={15} />
              </button>
            )}
          </div>
        </header>
        <div
          className={cn('dui-widget-stage', `is-${phase}`)}
          style={full ? undefined : { height: inlineHeight }}
        >
          <iframe
            key={frameKey}
            ref={frameRef}
            className="dui-widget-frame"
            src={FRAME_SRC}
            sandbox="allow-scripts"
            allow=""
            loading="lazy"
            referrerPolicy="no-referrer"
            title={title}
            style={{ colorScheme: theme.mode }}
            aria-hidden={phase === 'failed' || undefined}
            tabIndex={phase === 'rendered' ? undefined : -1}
          />
          {phase === 'loading' && (
            <div className="dui-widget-skeleton" role="status" aria-label="Kachel wird geladen">
              <span className="dui-sk" style={{ width: '38%', height: 14 }} />
              <span className="dui-sk is-block dui-widget-sk-main" />
              <span className="dui-widget-sk-row">
                <span className="dui-sk is-pill" style={{ width: 96, height: 34 }} />
                <span className="dui-sk is-pill" style={{ width: 72, height: 34 }} />
              </span>
            </div>
          )}
          {phase === 'failed' && (
            <div className="dui-widget-fallback" role="status">
              <CircleAlert size={18} aria-hidden />
              <p>Diese Kachel konnte nicht gestartet werden.</p>
              <button type="button" className="dui-link-button" onClick={restart}>
                <RotateCcw size={13} aria-hidden />
                Neu starten
              </button>
            </div>
          )}
        </div>
        {full && (
          <button
            type="button"
            className="dui-icon-button dui-widget-close"
            aria-label="Vollbild beenden"
            title="Vollbild beenden (Esc)"
            onClick={exitFull}
          >
            <X size={18} />
          </button>
        )}
      </div>
      {overflowing && !full && (
        <button type="button" className="dui-link-button dui-widget-more" onClick={enterFull}>
          <Maximize2 size={13} aria-hidden />
          Ganze Kachel im Vollbild zeigen
        </button>
      )}
      {errors.map((message, index) => (
        <p key={index} className="dui-widget-error">
          <CircleAlert size={13} aria-hidden />
          <span>Kachel-Fehler: {message}</span>
        </p>
      ))}
      <DialogPrimitive.Root open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="dui-overlay is-soft" />
          <DialogPrimitive.Content
            className="dui-sheet dui-widget-code"
            aria-describedby={undefined}
          >
            <span className="dui-sheet-grip" aria-hidden />
            <header className="dui-widget-code-head">
              <DialogPrimitive.Title className="dui-widget-code-title">
                Code der Kachel
              </DialogPrimitive.Title>
              <p>
                {node.html.length.toLocaleString('de-CH')} Zeichen · läuft abgeschottet ohne Netz
                und ohne Zugriff auf Plum
              </p>
              <DialogPrimitive.Close className="dui-icon-button is-quiet" aria-label="Schliessen">
                <X size={17} />
              </DialogPrimitive.Close>
            </header>
            {codeOpen && <CodeBlock node={codeNode} ctx={ctx} />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
};
