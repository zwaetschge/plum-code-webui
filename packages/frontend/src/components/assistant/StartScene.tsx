import { useEffect, useRef, type ReactNode } from 'react';
import { onFrame } from '@/lib/motion/spring';
import { useReducedMotion } from '@/lib/motion/reducedMotion';
import scenes from './startScenes.json';

/* Player for the start-page sketches. The scenes are data written by
 * `scripts/start-scenes.mjs`; Android plays the same file (StartScene.kt), so
 * the interpolation rules here and there must stay identical. */

type Track = { p: string; k: number[][]; e?: string };
type Common = {
  f?: string;
  s?: string;
  sw?: number;
  o?: number;
  tr?: number[];
  ro?: number;
  or?: number[];
  dl?: number;
  an?: Track[];
  rx?: number;
};
type Shape =
  | (Common & { k: 'rect'; x: number; y: number; w: number; h: number })
  | (Common & { k: 'circ'; cx: number; cy: number; r: number })
  | (Common & { k: 'path'; d: string })
  | (Common & { k: 'g'; c: Shape[] });
type Scene = { dur: number; rest: number; sh: Shape[] };

const SCENES = scenes as unknown as Record<string, Scene>;

const COLOURS: Record<string, string> = {
  a: 'hsl(var(--primary))',
  a2: 'hsl(var(--primary) / 0.45)',
  a3: 'hsl(var(--primary) / 0.16)',
  t: 'hsl(var(--foreground) / 0.22)',
  t2: 'hsl(var(--foreground) / 0.12)',
  m: 'hsl(var(--foreground) / 0.07)',
  fg: 'hsl(var(--foreground))',
  bg: 'hsl(var(--background))',
  r: 'hsl(var(--destructive))',
  y: 'hsl(38 92% 58%)',
  g: 'hsl(152 58% 44%)',
};

const EASE: Record<string, (u: number) => number> = {
  o: (u) => 1 - (1 - u) ** 3,
  io: (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2),
  l: (u) => u,
  s: () => 0,
  b: (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2,
};

function sample(track: Track, t: number): number {
  const keys = track.k;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t <= first[0]!) return first[1]!;
  if (t >= last[0]!) return last[1]!;
  let i = 0;
  while (keys[i + 1]![0]! < t) i++;
  const [t0, v0] = keys[i]!;
  const [t1, v1] = keys[i + 1]!;
  const u = (t - t0!) / (t1! - t0! || 1);
  return v0! + (v1! - v0!) * (EASE[track.e ?? 'o'] ?? EASE.o!)(u);
}

function pivot(shape: Shape): number[] {
  if (shape.or) return shape.or;
  if (shape.k === 'rect') return [shape.x + shape.w / 2, shape.y + shape.h / 2];
  if (shape.k === 'circ') return [shape.cx, shape.cy];
  return [60, 28];
}

/** Pose at cycle position t: translation, rotation, scale, opacity and stroke draw. */
export function pose(shape: Shape, t: number) {
  const local = (((t - (shape.dl ?? 0)) % 1) + 1) % 1;
  const v = { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, o: 1, d: -1 };
  for (const track of shape.an ?? []) {
    const value = sample(track, local);
    const p = track.p as keyof typeof v;
    if (p === 'x' || p === 'y' || p === 'r') v[p] += value;
    else if (p === 'd') v.d = value;
    else v[p] *= value;
  }
  // An undrawn stroke would still show its round cap as a dot.
  if (v.d >= 0 && v.d < 0.001) v.o = 0;
  return v;
}

function transformOf(shape: Shape, t: number) {
  const v = pose(shape, t);
  const [ox, oy] = pivot(shape);
  const [tx, ty] = shape.tr ?? [0, 0];
  return {
    transform:
      `translate(${tx! + v.x} ${ty! + v.y}) rotate(${(shape.ro ?? 0) + v.r} ${ox} ${oy}) ` +
      `translate(${ox} ${oy}) scale(${v.s * v.sx} ${v.s * v.sy}) translate(${-ox!} ${-oy!})`,
    opacity: (shape.o ?? 1) * v.o,
    draw: v.d,
  };
}

interface Live {
  shape: Shape;
  node: SVGGElement;
  body: SVGElement | null;
}

export function StartScene({ name }: { name: string }) {
  const scene = SCENES[name];
  const reduce = useReducedMotion();
  const live = useRef<Live[]>([]);
  live.current = [];
  const start = scene ? (reduce ? scene.rest : 0) : 0;

  const paint = (entry: Live, t: number) => {
    const { transform, opacity, draw } = transformOf(entry.shape, t);
    entry.node.setAttribute('transform', transform);
    entry.node.setAttribute('opacity', String(Math.max(0, Math.min(1, opacity))));
    if (draw >= 0 && entry.body) entry.body.setAttribute('stroke-dashoffset', String(1 - draw));
  };

  useEffect(() => {
    if (!scene) return;
    const entries = live.current.filter((entry) => entry.shape.an?.length);
    if (reduce) {
      entries.forEach((entry) => paint(entry, scene.rest));
      return;
    }
    const origin = performance.now();
    return onFrame((_dt, now) => {
      const t = ((now - origin) % scene.dur) / scene.dur;
      for (const entry of entries) paint(entry, t);
    });
  }, [scene, reduce]);

  if (!scene) return null;

  const render = (shape: Shape, key: number): ReactNode => {
    const { transform, opacity, draw } = transformOf(shape, start);
    const entry = { shape } as Live;
    live.current.push(entry);
    const paintProps = {
      fill: shape.f ? COLOURS[shape.f] : 'none',
      stroke: shape.s ? COLOURS[shape.s] : undefined,
      strokeWidth: shape.s ? (shape.sw ?? 1.5) : undefined,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
    };
    const drawProps =
      draw >= 0 ? { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw } : {};
    const bodyRef = (el: SVGElement | null) => {
      entry.body = el;
    };
    let body: ReactNode;
    if (shape.k === 'g') body = shape.c.map(render);
    else if (shape.k === 'rect')
      body = (
        <rect
          ref={bodyRef}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={shape.rx}
          {...paintProps}
        />
      );
    else if (shape.k === 'circ')
      body = <circle ref={bodyRef} cx={shape.cx} cy={shape.cy} r={shape.r} {...paintProps} />;
    else body = <path ref={bodyRef} d={shape.d} {...paintProps} {...drawProps} />;
    return (
      <g
        key={key}
        ref={(el) => {
          if (el) entry.node = el;
        }}
        transform={transform}
        opacity={Math.max(0, Math.min(1, opacity))}
      >
        {body}
      </g>
    );
  };

  return (
    <svg viewBox="0 0 120 56" aria-hidden>
      {scene.sh.map(render)}
    </svg>
  );
}
