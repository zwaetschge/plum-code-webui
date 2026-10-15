import { boxOf, onFrame, SpringBox, type Box } from './spring';
import { prefersReducedMotion } from './reducedMotion';
import { SPRINGS } from './tokens';

/** Clip path that shows only `box` (viewport coordinates) of an element placed at `frame`. */
function clipTo(box: Box, frame: Box, radius: number) {
  const top = Math.max(0, box.top - frame.top);
  const left = Math.max(0, box.left - frame.left);
  const right = Math.max(0, frame.right - box.right);
  const bottom = Math.max(0, frame.bottom - box.bottom);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${Math.max(0, radius)}px)`;
}

/**
 * PageFlood: clips a fixed element from one viewport box to another with four
 * sprung edges. Resolves when the motion settles (or after a guard timeout).
 */
export function floodElement(
  element: HTMLElement,
  from: Box,
  to: Box,
  { radius = 18 }: { radius?: number } = {}
): Promise<void> {
  if (prefersReducedMotion()) {
    element.style.clipPath = '';
    return Promise.resolve();
  }
  const frame = boxOf(element.getBoundingClientRect());
  const box = new SpringBox(from);
  box.setTarget(to, SPRINGS.flood, (edge) => (edge === 'right' || edge === 'bottom' ? 30 : 0));
  element.style.clipPath = clipTo(from, frame, radius * 0.6);
  return new Promise((resolve) => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      stop();
      window.clearTimeout(guard);
      resolve();
    };
    const guard = window.setTimeout(() => {
      element.style.clipPath = clipTo(to, frame, radius);
      end();
    }, 1200);
    const stop = onFrame((dt) => {
      const current = box.step(dt);
      element.style.clipPath = clipTo(current, frame, radius);
      if (box.settled) {
        end();
        return false;
      }
    });
  });
}

/* ── Composer handoff from the start page into the new conversation ─────── */

let handoff: { box: Box; at: number } | null = null;

/** Remembers where the start-page composer sat right before navigating away. */
export function rememberComposer(element: Element | null) {
  handoff = element ? { box: boxOf(element.getBoundingClientRect()), at: Date.now() } : null;
}

/** True when a composer handoff is pending (the new chat should animate its first turn). */
export function composerHandoffPending() {
  return !!handoff && Date.now() - handoff.at < 6000;
}

/**
 * FLIP: the conversation composer starts where the start-page composer was
 * and glides to its own place, so the field never jumps across the screen.
 */
export function playComposerHandoff(element: HTMLElement | null) {
  const pending = handoff;
  if (!element || !pending || Date.now() - pending.at > 6000) return;
  handoff = null;
  if (prefersReducedMotion()) return;
  const now = element.getBoundingClientRect();
  const dx =
    pending.box.left + (pending.box.right - pending.box.left) / 2 - (now.left + now.width / 2);
  const dy =
    pending.box.top + (pending.box.bottom - pending.box.top) / 2 - (now.top + now.height / 2);
  const scale = (pending.box.right - pending.box.left) / Math.max(1, now.width);
  if (Math.abs(dx) + Math.abs(dy) < 4) return;
  element.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      { transform: 'translate(0, 0) scale(1)' },
    ],
    { duration: 620, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.04)' }
  );
}
