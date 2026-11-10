import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useWidth } from './useWidth';

export interface LinePoint {
  /** Position on the x axis (index, timestamp …). */
  x: number;
  y: number;
}

/**
 * A light SVG line/area chart for live widgets and KPI sparks: draws itself
 * in (~1.2 s), tracks the pointer with a crosshair and reports the hovered
 * point so the caller can drive a headline value.
 */
export function LineChart({
  points,
  height = 180,
  color,
  baseline,
  area = true,
  onHover,
  hovered,
  labels,
  yTicks = 0,
  formatY,
  className,
  ariaLabel,
  overlay,
  strokeWidth = 2,
  padTop = 10,
  drawKey,
}: {
  points: LinePoint[];
  height?: number;
  color: string;
  /** Dashed reference line (e.g. previous close). */
  baseline?: number | null;
  area?: boolean;
  onHover?: (index: number | null) => void;
  hovered?: number | null;
  /** X-axis labels at point indices. */
  labels?: Array<{ index: number; text: string }>;
  /** Number of horizontal grid lines with values on the right. */
  yTicks?: number;
  formatY?: (value: number) => string;
  className?: string;
  ariaLabel: string;
  /** Extra SVG content in chart coordinates (receives the scales). */
  overlay?: (scale: { x: (i: number) => number; y: (v: number) => number }) => ReactNode;
  strokeWidth?: number;
  padTop?: number;
  /** Changing it replays the draw-in (e.g. a new range). */
  drawKey?: string | number;
}) {
  const id = useId().replace(/:/g, '');
  const [box, width] = useWidth<SVGSVGElement>();
  const [local, setLocal] = useState<number | null>(null);
  const active = hovered !== undefined ? hovered : local;
  const padBottom = labels?.length ? 22 : 4;
  const padRight = yTicks ? 44 : 2;
  const geometry = useMemo(() => {
    if (!points.length) return null;
    const ys = points.map((point) => point.y);
    if (baseline !== null && baseline !== undefined && Number.isFinite(baseline)) ys.push(baseline);
    let min = Math.min(...ys);
    let max = Math.max(...ys);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;
    const innerW = Math.max(10, width - padRight);
    const innerH = Math.max(10, height - padTop - padBottom);
    const x = (index: number) =>
      points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW;
    const y = (value: number) => padTop + (1 - (value - min) / (max - min)) * innerH;
    const line = points
      .map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.y).toFixed(1)}`)
      .join('');
    const fill = `${line}L${x(points.length - 1).toFixed(1)},${padTop + innerH}L${x(0).toFixed(1)},${padTop + innerH}Z`;
    const ticks = yTicks
      ? Array.from({ length: yTicks }, (_, index) => min + ((max - min) * (index + 0.5)) / yTicks)
      : [];
    return { x, y, line, fill, innerW, innerH, ticks };
  }, [points, width, height, baseline, padTop, padBottom, padRight, yTicks]);
  if (!geometry) return null;
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !points.length) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, geometry.innerW)));
    const index = Math.round(ratio * (points.length - 1));
    setLocal(index);
    onHover?.(index);
  };
  const leave = () => {
    setLocal(null);
    onHover?.(null);
  };
  const activePoint = active !== null && active !== undefined ? points[active] : undefined;
  return (
    <svg
      ref={box}
      className={cn('dui-line', className)}
      width="100%"
      height={height}
      role="img"
      aria-label={ariaLabel}
      onPointerMove={(event) => pick(event.clientX)}
      onPointerDown={(event) => pick(event.clientX)}
      onPointerLeave={leave}
      onPointerCancel={leave}
    >
      <defs>
        <linearGradient id={`dui-area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {geometry.ticks.map((value) => (
        <g key={value} className="dui-line-grid">
          <line x1={0} x2={geometry.innerW} y1={geometry.y(value)} y2={geometry.y(value)} />
          <text x={geometry.innerW + 6} y={geometry.y(value) + 4}>
            {formatY ? formatY(value) : Math.round(value)}
          </text>
        </g>
      ))}
      {baseline !== null && baseline !== undefined && Number.isFinite(baseline) && (
        <line
          className="dui-line-baseline"
          x1={0}
          x2={geometry.innerW}
          y1={geometry.y(baseline)}
          y2={geometry.y(baseline)}
        />
      )}
      {area && (
        <path
          key={`area-${drawKey ?? ''}`}
          className="dui-line-area"
          d={geometry.fill}
          fill={`url(#dui-area-${id})`}
        />
      )}
      <path
        key={drawKey ?? 'line'}
        className="dui-line-path"
        d={geometry.line}
        stroke={color}
        strokeWidth={strokeWidth}
        pathLength={1}
        fill="none"
      />
      {overlay?.({ x: geometry.x, y: geometry.y })}
      {labels?.map((label) => (
        <text
          key={label.index}
          className="dui-line-label"
          x={Math.min(geometry.innerW - 2, Math.max(2, geometry.x(label.index)))}
          y={height - 6}
          textAnchor={
            label.index === 0 ? 'start' : label.index === points.length - 1 ? 'end' : 'middle'
          }
        >
          {label.text}
        </text>
      ))}
      {activePoint && (
        <g className="dui-line-cursor">
          <line
            x1={geometry.x(active!)}
            x2={geometry.x(active!)}
            y1={padTop - 6}
            y2={padTop + geometry.innerH}
          />
          <circle cx={geometry.x(active!)} cy={geometry.y(activePoint.y)} r={4.5} fill={color} />
        </g>
      )}
    </svg>
  );
}
