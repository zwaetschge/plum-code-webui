import type { MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { boxOf, type Box } from './spring';
import { prefersReducedMotion } from './reducedMotion';

/** Plain left click without modifiers — the only one we may turn into an animated navigation. */
export const isPlainClick = (event: MouseEvent) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

/**
 * Swaps the conversation pane through a view transition: the old pane lifts
 * out, the new one settles in (see `plum-chat-pane` in motion.css). Returns
 * false when the browser cannot, so the caller navigates normally.
 */
export function transitionPane(update: () => void): boolean {
  const doc = document as TransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) return false;
  if (!document.querySelector('.plum-api-scroll')) return false;
  doc.startViewTransition(() => flushSync(update));
  return true;
}

export type AreaDirection = 'forward' | 'back';

/**
 * Area switch (Chat · Task · Code · Schwarm): the work area slides in the
 * direction of the mode pill — further right comes in from the right — while
 * the sidebar stays put and its marker glides along. Returns false when the
 * browser cannot, so the caller navigates normally.
 */
export function transitionArea(direction: AreaDirection, update: () => void): boolean {
  const doc = document as TransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) return false;
  const root = document.documentElement;
  // Set before the old state is captured: it also mutes the nested chat-pane name.
  root.dataset.areaDirection = direction;
  const transition = doc.startViewTransition(() => flushSync(update)) as
    | { finished?: Promise<void> }
    | undefined;
  const clear = () => {
    if (root.dataset.areaDirection === direction) delete root.dataset.areaDirection;
  };
  if (transition?.finished) transition.finished.then(clear, clear);
  else window.setTimeout(clear, 700);
  return true;
}

/* ── Origin of the library popup (PageFlood) ───────────────────────────── */

let libraryOrigin: { box: Box; at: number } | null = null;

export function rememberLibraryOrigin(element: Element) {
  libraryOrigin = { box: boxOf(element.getBoundingClientRect()), at: Date.now() };
}

/** The tile the popup was opened from, if the click was recent. */
export function takeLibraryOrigin(): Box | null {
  const origin = libraryOrigin;
  libraryOrigin = null;
  return origin && Date.now() - origin.at < 3000 ? origin.box : null;
}
