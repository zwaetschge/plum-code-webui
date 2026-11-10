import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EntityContent, EntitySheet } from './EntityCard';
import './dynamic-ui-inline.css';

const OPEN_DELAY = 220;
const CLOSE_DELAY = 150;
const finePointer = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/**
 * Inline `[Name](entity:Title)` link: a hover card for fine pointers (150 ms
 * close delay, Esc closes, keyboard focus opens it) and a bottom sheet on touch.
 */
export function EntityLink({
  title,
  lang,
  children,
}: {
  title: string;
  lang?: string;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(
    null
  );
  const timer = useRef(0);
  const schedule = (next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 24);
      const height = card.current?.offsetHeight ?? 220;
      const below = rect.bottom + 10 + height < window.innerHeight - 12;
      setPosition({
        left: Math.max(
          12,
          Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)
        ),
        top: below ? rect.bottom + 10 : Math.max(12, rect.top - 10 - height),
        above: !below,
      });
    };
    place();
    // Only a scroll that moves the link (an ancestor or the page) closes the card.
    const close = (event: Event) => {
      const target = event.target;
      if (target === document || (target instanceof Node && target.contains(anchor.current)))
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        anchor.current?.focus();
      }
    };
    const observer = new ResizeObserver(place);
    if (card.current) observer.observe(card.current);
    window.addEventListener('scroll', close, { capture: true, passive: true });
    const resize = () => setOpen(false);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', key);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="dui-entity-anchor"
        aria-haspopup="dialog"
        aria-expanded={open || sheet}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') schedule(true, OPEN_DELAY);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') schedule(false, CLOSE_DELAY);
        }}
        onFocus={() => {
          if (finePointer()) schedule(true, 0);
        }}
        onBlur={() => schedule(false, CLOSE_DELAY)}
        onClick={() => {
          if (finePointer()) {
            window.clearTimeout(timer.current);
            setOpen(true);
          } else setSheet(true);
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={card}
            className="dui-hovercard"
            role="dialog"
            aria-label={title}
            data-side={position?.above ? 'top' : 'bottom'}
            style={{
              left: position?.left ?? -9999,
              top: position?.top ?? -9999,
              visibility: position ? 'visible' : 'hidden',
            }}
            onPointerEnter={() => window.clearTimeout(timer.current)}
            onPointerLeave={() => schedule(false, CLOSE_DELAY)}
          >
            <EntityContent title={title} lang={lang} />
          </div>,
          document.body
        )}
      <EntitySheet entity={sheet ? { title, lang } : null} onClose={() => setSheet(false)} />
    </>
  );
}
