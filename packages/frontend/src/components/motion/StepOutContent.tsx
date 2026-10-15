import * as React from 'react';
import { DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { boxOf, onFrame, SpringBox, type Box } from '@/lib/motion/spring';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { SPRINGS } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils';

const RADIUS = 14;
const SHOULDER = 10;
const PAD = 2;

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
const r2 = (value: number) => Math.round(value * 100) / 100;

function roundedRect(b: Box, r: number, Y: (v: number) => number) {
  const rr = clamp(r, Math.min((b.right - b.left) / 2, (b.bottom - b.top) / 2));
  const x = r2;
  return [
    `M ${x(b.left + rr)} ${Y(b.top)}`,
    `H ${x(b.right - rr)} Q ${x(b.right)} ${Y(b.top)} ${x(b.right)} ${Y(b.top + rr)}`,
    `V ${Y(b.bottom - rr)} Q ${x(b.right)} ${Y(b.bottom)} ${x(b.right - rr)} ${Y(b.bottom)}`,
    `H ${x(b.left + rr)} Q ${x(b.left)} ${Y(b.bottom)} ${x(b.left)} ${Y(b.bottom - rr)}`,
    `V ${Y(b.top + rr)} Q ${x(b.left)} ${Y(b.top)} ${x(b.left + rr)} ${Y(b.top)} Z`,
  ].join(' ');
}

/**
 * One connected contour around the panel and its trigger, with concave
 * shoulders where they meet. Computed for a panel above the trigger; a panel
 * below is mirrored on the y axis. Coordinates are relative to `origin`.
 */
function contour(panel: Box, trigger: Box, up: boolean, triggerRadius: number, origin: Box) {
  const shift = (b: Box): Box => ({
    left: b.left - origin.left,
    right: b.right - origin.left,
    top: up ? b.top - origin.top : -(b.bottom - origin.top),
    bottom: up ? b.bottom - origin.top : -(b.top - origin.top),
  });
  const p = shift(panel);
  const t = shift(trigger);
  const Y = (v: number) => r2(up ? v : -v);
  const x = r2;
  const r = clamp(RADIUS, Math.min((p.right - p.left) / 2, (p.bottom - p.top) / 2));
  const bx0 = Math.max(t.left, p.left);
  const bx1 = Math.min(t.right, p.right);
  const near = Math.min(p.bottom, t.bottom);
  const far = Math.max(t.bottom, near);
  const length = far - near;
  const union: Box = {
    left: Math.min(p.left, t.left),
    right: Math.max(p.right, t.right),
    top: Math.min(p.top, t.top),
    bottom: Math.max(p.bottom, t.bottom),
  };
  if (bx1 - bx0 < 16 || length < 8) return roundedRect(union, r, Y);
  const tr = clamp(triggerRadius, Math.min((bx1 - bx0) / 2, length / 2));
  const dR = p.right - bx1;
  const dL = bx0 - p.left;
  const fR = clamp(SHOULDER, Math.min(dR / 2, length - tr));
  const fL = clamp(SHOULDER, Math.min(dL / 2, length - tr));
  const rbR = clamp(r, dR - fR);
  const rbL = clamp(r, dL - fL);
  return [
    `M ${x(p.left + r)} ${Y(p.top)}`,
    `H ${x(p.right - r)} Q ${x(p.right)} ${Y(p.top)} ${x(p.right)} ${Y(p.top + r)}`,
    `V ${Y(near - rbR)} Q ${x(p.right)} ${Y(near)} ${x(p.right - rbR)} ${Y(near)}`,
    `H ${x(bx1 + fR)} Q ${x(bx1)} ${Y(near)} ${x(bx1)} ${Y(near + fR)}`,
    `V ${Y(far - tr)} Q ${x(bx1)} ${Y(far)} ${x(bx1 - tr)} ${Y(far)}`,
    `H ${x(bx0 + tr)} Q ${x(bx0)} ${Y(far)} ${x(bx0)} ${Y(far - tr)}`,
    `V ${Y(near + fL)} Q ${x(bx0)} ${Y(near)} ${x(bx0 - fL)} ${Y(near)}`,
    `H ${x(p.left + rbL)} Q ${x(p.left)} ${Y(near)} ${x(p.left)} ${Y(near - rbL)}`,
    `V ${Y(p.top + r)} Q ${x(p.left)} ${Y(p.top)} ${x(p.left + r)} ${Y(p.top)} Z`,
  ].join(' ');
}

/**
 * Drives the glass body behind one open menu: grows out of the trigger,
 * follows Radix positioning while open, shrinks back on close. Lives outside
 * React state because it repaints every frame.
 */
class StepOutShape {
  private layer: HTMLDivElement;
  private glass: HTMLDivElement;
  private edge: SVGPathElement;
  private svg: SVGSVGElement;
  private box: SpringBox;
  private stop: (() => void) | null = null;
  private closing = false;
  private triggerRadius: number;
  private up: boolean;

  constructor(
    private content: HTMLElement,
    private trigger: HTMLElement
  ) {
    const triggerBox = boxOf(trigger.getBoundingClientRect());
    const radius = parseFloat(getComputedStyle(trigger).borderTopLeftRadius) || 8;
    this.triggerRadius = Math.min(radius, (triggerBox.bottom - triggerBox.top) / 2);
    this.up = content.dataset.side === 'top';
    this.layer = document.createElement('div');
    this.layer.className = 'plum-stepout-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    const scrim = document.createElement('div');
    scrim.className = 'plum-stepout-scrim';
    this.glass = document.createElement('div');
    this.glass.className = 'plum-stepout-glass';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('plum-stepout-edge');
    this.edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.svg.append(this.edge);
    this.layer.append(scrim, this.glass, this.svg);
    document.body.append(this.layer);
    this.box = new SpringBox(triggerBox);
    content.dataset.stepout = 'shaped';
    // Children rise one after another once the body has room for them.
    Array.from(content.children).forEach((child, index) =>
      (child as HTMLElement).style.setProperty('--stepout-i', String(Math.min(index, 6)))
    );
    if (prefersReducedMotion()) this.box.jump(boxOf(content.getBoundingClientRect()));
    requestAnimationFrame(() => this.layer.classList.add('is-open'));
    this.run();
  }

  private paint(current: Box) {
    const trigger = boxOf(this.trigger.getBoundingClientRect());
    const frame: Box = {
      left: Math.min(current.left, trigger.left) - PAD,
      top: Math.min(current.top, trigger.top) - PAD,
      right: Math.max(current.right, trigger.right) + PAD,
      bottom: Math.max(current.bottom, trigger.bottom) + PAD,
    };
    const width = frame.right - frame.left;
    const height = frame.bottom - frame.top;
    const outline = contour(current, trigger, this.up, this.triggerRadius, frame);
    // The trigger stays visible through a hole in the glass.
    const hole = roundedRect(
      {
        left: trigger.left - frame.left,
        top: trigger.top - frame.top,
        right: trigger.right - frame.left,
        bottom: trigger.bottom - frame.top,
      },
      this.triggerRadius,
      r2
    );
    for (const element of [this.glass, this.svg]) {
      element.style.transform = `translate(${frame.left}px, ${frame.top}px)`;
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    this.glass.style.clipPath = `path(evenodd, '${outline} ${hole}')`;
    this.edge.setAttribute('d', outline);
  }

  private run() {
    if (this.stop) return;
    this.stop = onFrame((dt) => {
      if (!this.closing) {
        if (!this.content.isConnected) this.close();
        else this.box.setTarget(boxOf(this.content.getBoundingClientRect()), SPRINGS.menu);
      }
      this.paint(this.box.step(dt));
      if (this.closing && this.box.settled) {
        this.destroy();
        return false;
      }
    });
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.layer.classList.remove('is-open');
    if (prefersReducedMotion() || !this.trigger.isConnected) {
      this.destroy();
      return;
    }
    this.box.setTarget(boxOf(this.trigger.getBoundingClientRect()), SPRINGS.menu, () => 40);
  }

  destroy() {
    this.stop?.();
    this.stop = null;
    this.layer.remove();
  }
}

type ContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenuContent>;

/**
 * Drop-in replacement for `DropdownMenuContent`: the menu grows out of its
 * trigger as one glass body (StepOut). Radix keeps keyboard handling, focus
 * return, typeahead and submenus; when the trigger cannot be found or the
 * menu opens sideways, the regular popup material is used.
 */
export const StepOutContent = React.forwardRef<HTMLDivElement, ContentProps>(
  ({ className, ...props }, forwarded) => {
    const shape = React.useRef<StepOutShape | null>(null);
    const watcher = React.useRef<MutationObserver | null>(null);
    const attached = React.useRef<HTMLDivElement | null>(null);
    const attach = React.useCallback(
      (node: HTMLDivElement | null) => {
        if (typeof forwarded === 'function') forwarded(node);
        else if (forwarded) forwarded.current = node;
        // Radix re-attaches the same node when its composed ref changes; closing is
        // driven by data-state and by the shape noticing a disconnected node.
        if (!node || node === attached.current) return;
        attached.current = node;
        watcher.current?.disconnect();
        shape.current?.destroy();
        shape.current = null;
        // Transparent from the first paint so the plain popup never flashes.
        node.dataset.stepout = 'pending';
        // Without frames (background tab) fall back to the plain popup material.
        const fallback = window.setTimeout(() => {
          if (node.dataset.stepout === 'pending') delete node.dataset.stepout;
        }, 400);
        // Radix places the content in the next frame; measure after that.
        requestAnimationFrame(() => {
          window.clearTimeout(fallback);
          if (attached.current !== node || !node.isConnected || node.dataset.state !== 'open')
            return;
          const side = node.dataset.side;
          const trigger = node.id
            ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(node.id)}"]`)
            : null;
          if (!trigger || (side !== 'top' && side !== 'bottom')) {
            delete node.dataset.stepout;
            return;
          }
          const current = new StepOutShape(node, trigger);
          shape.current = current;
          watcher.current = new MutationObserver(() => {
            if (node.dataset.state === 'closed') current.close();
          });
          watcher.current.observe(node, { attributes: true, attributeFilter: ['data-state'] });
        });
      },
      [forwarded]
    );
    React.useEffect(
      () => () => {
        watcher.current?.disconnect();
        shape.current?.destroy();
      },
      []
    );
    return (
      <DropdownMenuContent ref={attach} className={cn('plum-stepout', className)} {...props} />
    );
  }
);
StepOutContent.displayName = 'StepOutContent';
