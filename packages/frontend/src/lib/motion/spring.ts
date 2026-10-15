import type { SpringConfig } from './tokens';

/**
 * Damped spring a = -k(x - target) - c·v with c = 2·ratio·√k (mass 1).
 * Integrated in 4 ms substeps with dt clamped to 50 ms, so 60 and 120 Hz
 * displays move alike and a stalled tab does not explode on return.
 * Retargeting keeps the current velocity.
 */
export class SpringValue {
  value: number;
  velocity = 0;
  target: number;
  private config: SpringConfig = { ratio: 0.8, stiffness: 380 };
  private delayUntil = 0;

  constructor(value = 0) {
    this.value = value;
    this.target = value;
  }

  jump(value: number) {
    if (!Number.isFinite(value)) return;
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.delayUntil = 0;
  }

  setTarget(value: number, config: SpringConfig, delayMs = 0, now = performance.now()) {
    if (!Number.isFinite(value)) return;
    this.target = value;
    this.config = config;
    this.delayUntil = delayMs > 0 ? now + delayMs : 0;
  }

  get settled() {
    return Math.abs(this.value - this.target) <= 0.2 && Math.abs(this.velocity) <= 2;
  }

  step(dtMs: number, now = performance.now()) {
    if (now < this.delayUntil) return this.value;
    let remaining = Math.min(Math.max(0, dtMs / 1000), 0.05);
    const k = this.config.stiffness;
    const c = 2 * this.config.ratio * Math.sqrt(k);
    while (remaining > 0) {
      const h = Math.min(remaining, 0.004);
      this.velocity += (-k * (this.value - this.target) - c * this.velocity) * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    if (this.settled) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const boxOf = (rect: DOMRect | Box): Box => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
});

const EDGES = ['left', 'top', 'right', 'bottom'] as const;
export type Edge = (typeof EDGES)[number];

/** Four independently sprung edges, used by floods, StepOut and the focus frame. */
export class SpringBox {
  readonly edges: Record<Edge, SpringValue>;

  constructor(box: Box) {
    this.edges = {
      left: new SpringValue(box.left),
      top: new SpringValue(box.top),
      right: new SpringValue(box.right),
      bottom: new SpringValue(box.bottom),
    };
  }

  jump(box: Box) {
    for (const edge of EDGES) this.edges[edge].jump(box[edge]);
  }

  /** `configFor` lets the leading edge run faster than the trailing one. */
  setTarget(
    box: Box,
    configFor: SpringConfig | ((edge: Edge) => SpringConfig),
    delayFor?: (edge: Edge) => number
  ) {
    const now = performance.now();
    for (const edge of EDGES) {
      const config = typeof configFor === 'function' ? configFor(edge) : configFor;
      this.edges[edge].setTarget(box[edge], config, delayFor?.(edge) ?? 0, now);
    }
  }

  step(dt: number, now?: number): Box {
    return {
      left: this.edges.left.step(dt, now),
      top: this.edges.top.step(dt, now),
      right: this.edges.right.step(dt, now),
      bottom: this.edges.bottom.step(dt, now),
    };
  }

  get value(): Box {
    return {
      left: this.edges.left.value,
      top: this.edges.top.value,
      right: this.edges.right.value,
      bottom: this.edges.bottom.value,
    };
  }

  get target(): Box {
    return {
      left: this.edges.left.target,
      top: this.edges.top.target,
      right: this.edges.right.target,
      bottom: this.edges.bottom.target,
    };
  }

  get settled() {
    return EDGES.every((edge) => this.edges[edge].settled);
  }
}

type FrameCallback = (dt: number, now: number) => boolean | void;

const callbacks = new Set<FrameCallback>();
let frame = 0;
let last = 0;

function tick(now: number) {
  const dt = last ? now - last : 16;
  last = now;
  for (const callback of [...callbacks]) {
    // Returning false unsubscribes: the animation has settled.
    if (callback(dt, now) === false) callbacks.delete(callback);
  }
  frame = callbacks.size ? requestAnimationFrame(tick) : 0;
  if (!frame) last = 0;
}

/**
 * One shared requestAnimationFrame loop for every sprung widget; it stops
 * when nothing is moving. Returns an unsubscribe function.
 */
export function onFrame(callback: FrameCallback): () => void {
  callbacks.add(callback);
  if (!frame) frame = requestAnimationFrame(tick);
  return () => {
    callbacks.delete(callback);
  };
}
