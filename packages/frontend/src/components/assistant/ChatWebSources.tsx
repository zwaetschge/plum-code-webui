import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FileText, Globe, Search } from 'lucide-react';
import type { AssistantApiTurn } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import {
  domainHue,
  domainOf,
  formatPublished,
  normalizeUrl,
  orderSources,
  shortDomain,
  sourceCount,
  webSteps,
  type WebSource,
  type WebStep,
} from './webSources';
import './chat-web.css';

/** Neutral site mark: the domain's initial on a hue derived from it. No favicon is fetched. */
export function SourceMark({ domain, className }: { domain: string; className?: string }) {
  const name = shortDomain(domain);
  return (
    <span
      aria-hidden
      className={cn('plum-source-mark', className)}
      style={{ '--source-hue': domainHue(domain) } as CSSProperties}
    >
      {name.charAt(0).toUpperCase() || <Globe size={10} />}
    </span>
  );
}

function SourceMeta({ source }: { source: WebSource }) {
  const date = formatPublished(source.publishedAt);
  return (
    <span className="plum-source-meta">
      <SourceMark domain={source.domain} />
      <span className="plum-source-domain">{source.domain}</span>
      {date && (
        <>
          <span aria-hidden>·</span>
          <time dateTime={source.publishedAt ?? undefined}>{date}</time>
        </>
      )}
    </span>
  );
}

const sourceLabel = (source: WebSource) =>
  [source.title || source.domain, source.domain, formatPublished(source.publishedAt)]
    .filter(Boolean)
    .join(' · ');

interface Placement {
  top: number;
  left: number;
  width: number;
  above: boolean;
}

/**
 * Inline citation for one or several adjacent sources. A pointer hover or keyboard focus
 * previews them; click opens the first source. On touch, a group opens its preview instead.
 */
export function CitationChip({ sources, label }: { sources: WebSource[]; label?: ReactNode }) {
  const first = sources[0]!;
  const [open, setOpen] = useState(false),
    [pinned, setPinned] = useState(false),
    [placement, setPlacement] = useState<Placement | null>(null);
  const anchor = useRef<HTMLAnchorElement>(null),
    card = useRef<HTMLDivElement>(null),
    timer = useRef<number | undefined>(undefined),
    pointer = useRef('mouse'),
    enter = useRef(false);
  const id = useId();
  const schedule = (next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOpen(next);
      if (!next) setPinned(false);
    }, delay);
  };
  const close = (refocus = false) => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
    if (refocus) anchor.current?.focus();
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    let frame = 0;
    const place = () => {
      const target = anchor.current?.getBoundingClientRect(),
        height = card.current?.offsetHeight ?? 0;
      if (!target) return;
      if (target.bottom < 0 || target.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      const width = Math.min(320, window.innerWidth - 16);
      const left = Math.min(
        Math.max(8, target.left + target.width / 2 - width / 2),
        window.innerWidth - width - 8
      );
      const below = window.innerHeight - target.bottom;
      const above = below < height + 16 && target.top > below;
      setPlacement({
        width,
        left,
        above,
        top: above ? Math.max(8, target.top - height - 6) : target.bottom + 6,
      });
    };
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('scroll', queue, true);
    window.addEventListener('resize', queue);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue, true);
      window.removeEventListener('resize', queue);
    };
  }, [open, sources.length]);
  useEffect(() => {
    if (!pinned) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !card.current?.contains(target)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [pinned]);
  const links = () => [...(card.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
  // ArrowDown on the chip moves into the preview once it is placed (hidden elements take no focus).
  useEffect(() => {
    if (!placement || !enter.current) return;
    enter.current = false;
    links()[0]?.focus();
  }, [placement]);
  const onCardKey = (event: KeyboardEvent) => {
    const items = links(),
      at = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  };
  const extra = sources.length - 1;
  return (
    <>
      <a
        ref={anchor}
        href={first.url}
        target="_blank"
        rel="noopener noreferrer"
        className={label ? 'plum-cite-text' : 'plum-cite'}
        aria-label={label ? undefined : sources.map(sourceLabel).join('; ')}
        aria-describedby={open ? id : undefined}
        onPointerDown={(event) => (pointer.current = event.pointerType)}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') schedule(true, 90);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch' && !pinned) schedule(false, 160);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) schedule(true, 0);
        }}
        onBlur={(event) => {
          if (!card.current?.contains(event.relatedTarget as Node) && !pinned) schedule(false, 0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            window.clearTimeout(timer.current);
            if (placement) links()[0]?.focus();
            else {
              enter.current = true;
              setOpen(true);
            }
          }
        }}
        onClick={(event) => {
          if (pointer.current === 'touch' && extra > 0 && !pinned) {
            event.preventDefault();
            window.clearTimeout(timer.current);
            setPinned(true);
            setOpen(true);
          } else close();
          pointer.current = 'mouse';
        }}
      >
        {label ?? (
          <>
            <span className="plum-cite-domain">{shortDomain(first.domain)}</span>
            {extra > 0 && <span className="plum-cite-more">+{extra}</span>}
          </>
        )}
      </a>
      {open &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="group"
            aria-label={extra ? `${sources.length} Quellen` : 'Quelle'}
            className={cn('plum-cite-card', placement?.above && 'is-above')}
            data-ready={placement ? '' : undefined}
            style={
              placement
                ? { top: placement.top, left: placement.left, width: placement.width }
                : {
                    top: 0,
                    left: 0,
                    width: Math.min(320, window.innerWidth - 16),
                    visibility: 'hidden',
                  }
            }
            onPointerEnter={() => window.clearTimeout(timer.current)}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'touch' && !pinned) schedule(false, 160);
            }}
            onKeyDown={onCardKey}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (!pinned && !card.current?.contains(next) && !anchor.current?.contains(next))
                schedule(false, 0);
            }}
          >
            {sources.map((source) => (
              <a
                key={source.ref}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="plum-cite-card-item"
                onClick={() => close()}
              >
                <SourceMeta source={source} />
                <span className="plum-cite-card-title">{source.title || source.url}</span>
                {source.excerpt && (
                  <span className={cn('plum-cite-card-excerpt', extra > 0 && 'is-short')}>
                    {source.excerpt}
                  </span>
                )}
              </a>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

const COLLAPSED = 3;

/** „Quellen“ under an answer: cited sources first, a few at a glance, all on demand. */
export function ChatSourcesRow({
  sources,
  text,
  live = false,
}: {
  sources: WebSource[];
  text: string;
  live?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const ordered = useMemo(() => orderSources(sources, text), [sources, text]);
  const listId = useId();
  if (!ordered.length) return null;
  const visible = expanded ? ordered : ordered.slice(0, COLLAPSED);
  return (
    <section className={cn('plum-sources', live && 'is-live')} aria-label="Quellen">
      <div className="plum-sources-head">
        <h3>
          <Globe size={14} aria-hidden />
          Quellen
          <span className="plum-sources-count">{ordered.length}</span>
        </h3>
        {ordered.length > COLLAPSED && (
          <button
            type="button"
            className="plum-sources-toggle"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Weniger' : `Alle ${ordered.length}`}
            <ChevronDown size={14} aria-hidden />
          </button>
        )}
      </div>
      <ul id={listId} className="plum-sources-grid">
        {visible.map((source, index) => (
          <li key={source.ref} className={index >= COLLAPSED ? 'is-extra' : undefined}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="plum-source-card"
              title={source.url}
            >
              <span className="plum-source-card-title">{source.title || source.domain}</span>
              <SourceMeta source={source} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const RECENCY: Record<string, string> = {
  day: 'Letzte 24 Stunden',
  week: 'Letzte Woche',
  month: 'Letzter Monat',
  year: 'Letztes Jahr',
};
/** Filters and outcome of one step, e.g. „Nachrichten · Letzte Woche · 6 Treffer“. */
function stepMeta(step: WebStep, live: boolean): string {
  if (step.status === 'failed') return 'Fehlgeschlagen';
  if (step.kind === 'fetch')
    return step.status === 'running' ? (live ? 'Läuft …' : '') : step.url ? domainOf(step.url) : '';
  const parts = [
    step.topic === 'news' ? 'Nachrichten' : '',
    RECENCY[step.recency] ?? '',
    step.status === 'running'
      ? live && step.query
        ? 'Läuft …'
        : ''
      : step.results.length
        ? plural(step.results.length, 'Treffer', 'Treffer')
        : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

function StepResults({ step, read }: { step: WebStep; read: Set<string> }) {
  if (!step.results.length) return null;
  const results = [...step.results].sort(
    (a, b) => Number(read.has(normalizeUrl(b.url))) - Number(read.has(normalizeUrl(a.url)))
  );
  return (
    <span className="plum-web-results">
      {results.map((result) => {
        const isRead = read.has(normalizeUrl(result.url));
        return (
          <a
            key={result.url}
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('plum-web-result', isRead && 'is-read')}
            title={result.title || result.url}
            aria-label={`${result.title || result.domain} · ${result.domain}${isRead ? ' · gelesen' : ''}`}
          >
            <SourceMark domain={result.domain} />
            {shortDomain(result.domain)}
            {isRead && <Check size={11} aria-hidden />}
          </a>
        );
      })}
    </span>
  );
}

/** One line for all web tool calls of a turn; expands to the queries and the pages read. */
export function ChatWebActivity({ turn }: { turn: AssistantApiTurn }) {
  const steps = useMemo(() => webSteps(turn.toolEvents), [turn.toolEvents]);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!steps.length) return null;
  const live = turn.status === 'running';
  const running = live && steps.some((step) => step.status === 'running');
  const searches = steps.filter((step) => step.kind === 'search').length;
  const fetches = steps.length - searches;
  const failed = steps.every((step) => step.status === 'failed');
  const count = sourceCount(turn, steps);
  const read = new Set(
    (turn.webSources ?? []).filter((s) => s.read).map((s) => normalizeUrl(s.url))
  );
  const title = failed
    ? searches
      ? 'Websuche fehlgeschlagen'
      : 'Seitenabruf fehlgeschlagen'
    : searches
      ? running
        ? 'Durchsucht das Web'
        : 'Web durchsucht'
      : running
        ? fetches === 1
          ? 'Liest Webseite'
          : 'Liest Webseiten'
        : fetches === 1
          ? 'Webseite gelesen'
          : `${fetches} Webseiten gelesen`;
  const current = running
    ? [...steps].reverse().find((step) => step.status === 'running')
    : undefined;
  const parts = failed
    ? []
    : current?.kind === 'search' && current.query
      ? [`„${current.query}“`]
      : searches
        ? [
            plural(searches, 'Suche', 'Suchen'),
            ...(count ? [plural(count, 'Quelle', 'Quellen')] : []),
          ]
        : fetches === 1 && steps[0]!.url
          ? [shortDomain(domainOf(steps[0]!.url))]
          : [];
  return (
    <div className={cn('plum-web-activity', running && 'is-running', failed && 'is-failed')}>
      <button
        type="button"
        className="plum-web-activity-line"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="plum-web-activity-icon" aria-hidden>
          <Globe size={14} />
        </span>
        <span className="plum-web-activity-title">{title}</span>
        {parts.map((part) => (
          <span key={part} className="plum-web-activity-part">
            <span aria-hidden>·</span> {part}
          </span>
        ))}
        <ChevronDown size={14} aria-hidden className="plum-web-activity-chevron" />
      </button>
      {running && (
        <span className="sr-only" role="status">
          {title}
        </span>
      )}
      {open && (
        <ol id={panelId} className="plum-web-steps">
          {steps.map((step) => (
            <li key={step.id} className={cn('plum-web-step', `is-${step.status}`)}>
              <span className="plum-web-step-icon" aria-hidden>
                {step.kind === 'search' ? <Search size={13} /> : <FileText size={13} />}
              </span>
              <span className="plum-web-step-body">
                <span className="plum-web-step-head">
                  {step.kind === 'search' ? (
                    <span className="plum-web-step-query">
                      {step.query
                        ? `„${step.query}“`
                        : step.status === 'running'
                          ? 'Sucht …'
                          : 'Suche'}
                    </span>
                  ) : step.url ? (
                    <a href={step.url} target="_blank" rel="noopener noreferrer">
                      {step.title || shortDomain(domainOf(step.url))}
                    </a>
                  ) : (
                    <span>{step.status === 'running' ? 'Liest …' : 'Seitenabruf'}</span>
                  )}
                  <span className="plum-web-step-meta">{stepMeta(step, live)}</span>
                </span>
                {step.kind === 'search' && <StepResults step={step} read={read} />}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
