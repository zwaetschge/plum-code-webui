import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Download, ImageDown, Maximize2 } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUiValue, type UiNodeOf, type UiRow, type UiValue } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { useReducedMotion } from '@/lib/motion/reducedMotion';
import type { Ctx } from './context';
import { SegmentedControl } from './basic';
import { downloadCsv, downloadSvgAsPng, fileName, toCsv } from './download';
import { Fullscreen } from './media';
import { useThemePalette } from './theme';

type ChartNode = UiNodeOf<'chart'>;

function TooltipCard({
  active,
  payload,
  label,
  format,
  xLabel,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: unknown; color?: string; payload?: UiRow }>;
  label?: unknown;
  format: (value: unknown) => string;
  xLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dui-tooltip">
      {label !== undefined && label !== '' && (
        <span className="dui-tooltip-label">
          {xLabel ? `${xLabel} ` : ''}
          {String(label)}
        </span>
      )}
      {payload.map((entry, index) => (
        <span key={index} className="dui-tooltip-row">
          <i style={{ background: entry.color }} aria-hidden />
          <span>{entry.name}</span>
          <strong>{format(entry.value)}</strong>
        </span>
      ))}
    </div>
  );
}

function ChartSurface({
  node,
  rows,
  hidden,
  height,
  animate,
  palette,
}: {
  node: ChartNode;
  rows: UiRow[];
  hidden: Set<string>;
  height: number;
  animate: boolean;
  palette: string[];
}) {
  const format = (value: unknown) => formatUiValue(value as UiValue, node.format);
  const axisFormat = (value: unknown) =>
    typeof value === 'number' && (node.format?.startsWith('currency') || Math.abs(value) >= 10000)
      ? formatUiValue(value, 'compact')
      : formatUiValue(value as UiValue, node.format === 'percent' ? 'percent' : undefined);
  const axis = { stroke: 'currentColor', fontSize: 11, tickLine: false, axisLine: false } as const;
  const grid = <CartesianGrid strokeOpacity={0.1} vertical={false} />;
  const motion = {
    isAnimationActive: animate,
    animationDuration: 1200,
    animationEasing: 'ease-out' as const,
  };
  const tooltip = (
    <Tooltip
      cursor={{
        stroke: 'currentColor',
        strokeOpacity: 0.25,
        fill: 'currentColor',
        fillOpacity: 0.05,
      }}
      content={<TooltipCard format={format} />}
    />
  );
  const color = (index: number) => palette[index % palette.length]!;
  let chart: ReactNode;
  if (node.kind === 'pie') {
    const series = node.series[0]!;
    const data = rows.filter((row) => !hidden.has(String(row[node.x])));
    chart = (
      <PieChart>
        <Pie
          data={data}
          dataKey={series.key}
          nameKey={node.x}
          innerRadius="58%"
          outerRadius="88%"
          paddingAngle={2}
          cornerRadius={4}
          {...motion}
        >
          {data.map((row) => (
            <Cell key={String(row[node.x])} fill={color(rows.indexOf(row))} stroke="none" />
          ))}
        </Pie>
        {tooltip}
      </PieChart>
    );
  } else if (node.kind === 'scatter') {
    chart = (
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis
          type="number"
          dataKey="x"
          name={node.x}
          domain={['auto', 'auto']}
          {...axis}
          tickFormatter={axisFormat}
        />
        <YAxis
          type="number"
          dataKey="y"
          domain={['auto', 'auto']}
          {...axis}
          width={56}
          tickFormatter={axisFormat}
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: 'currentColor', strokeOpacity: 0.3 }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as
              | { x?: unknown; y?: unknown; name?: string }
              | undefined;
            if (!active || !point) return null;
            return (
              <div className="dui-tooltip">
                <span className="dui-tooltip-label">{point.name}</span>
                <span className="dui-tooltip-row">
                  <span>{node.x}</span>
                  <strong>{formatUiValue(point.x as UiValue)}</strong>
                </span>
                <span className="dui-tooltip-row">
                  <span>Wert</span>
                  <strong>{format(point.y)}</strong>
                </span>
              </div>
            );
          }}
        />
        {node.series.map((series, index) =>
          hidden.has(series.key) ? null : (
            <Scatter
              key={series.key}
              name={series.label}
              data={rows
                .map((row) => ({ x: row[node.x], y: row[series.key], name: series.label }))
                .filter((point) => typeof point.x === 'number' && typeof point.y === 'number')}
              fill={color(index)}
              {...motion}
            />
          )
        )}
      </ScatterChart>
    );
  } else if (node.kind === 'bar') {
    chart = (
      <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        {grid}
        <XAxis dataKey={node.x} {...axis} />
        <YAxis {...axis} width={56} tickFormatter={axisFormat} />
        {tooltip}
        {node.series.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            fill={color(index)}
            hide={hidden.has(series.key)}
            radius={node.stacked ? [0, 0, 0, 0] : [6, 6, 0, 0]}
            maxBarSize={48}
            stackId={node.stacked ? 'stack' : undefined}
            {...motion}
          />
        ))}
      </BarChart>
    );
  } else {
    const Lines = node.kind === 'line' ? LineChart : AreaChart;
    chart = (
      <Lines data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <defs>
          {node.series.map((series, index) => (
            <linearGradient
              key={series.key}
              id={`dui-fill-${series.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={color(index)} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color(index)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid}
        <XAxis dataKey={node.x} {...axis} />
        <YAxis {...axis} width={56} tickFormatter={axisFormat} />
        {tooltip}
        {node.series.map((series, index) =>
          node.kind === 'line' ? (
            <Line
              key={series.key}
              dataKey={series.key}
              name={series.label}
              stroke={color(index)}
              strokeWidth={2.4}
              hide={hidden.has(series.key)}
              dot={false}
              activeDot={{ r: 4.5, strokeWidth: 0 }}
              {...motion}
            />
          ) : (
            <Area
              key={series.key}
              dataKey={series.key}
              name={series.label}
              stroke={color(index)}
              strokeWidth={2.4}
              hide={hidden.has(series.key)}
              fill={`url(#dui-fill-${series.key})`}
              stackId={node.stacked ? 'stack' : undefined}
              activeDot={{ r: 4.5, strokeWidth: 0 }}
              {...motion}
            />
          )
        )}
      </Lines>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      {chart as ReactElement}
    </ResponsiveContainer>
  );
}

/**
 * Charts: draw in once (~1.2 s), tooltips in the view's format, a legend that
 * toggles series, an optional range segment, full screen, CSV and PNG.
 */
export default function Chart({ node, ctx }: { node: ChartNode; ctx: Ctx }) {
  const palette = useThemePalette();
  const reduced = useReducedMotion();
  const rows = ctx.rt.source(node.data);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [full, setFull] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const height = node.height ?? 240;
  const legendItems =
    node.kind === 'pie'
      ? rows.map((row, index) => ({ key: String(row[node.x]), label: String(row[node.x]), index }))
      : node.series.map((series, index) => ({ key: series.key, label: series.label, index }));
  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (legendItems.length - next.size > 1) next.add(key);
      return next;
    });
  const title = ctx.rt.spec.title || node.series.map((series) => series.label).join(', ');
  const csv = () =>
    downloadCsv(
      fileName(title, 'diagramm', 'csv'),
      toCsv(rows, [{ key: node.x, label: node.x }, ...node.series])
    );
  const png = () => {
    const svg = figure.current?.querySelector<SVGSVGElement>('svg.recharts-surface');
    if (svg) void downloadSvgAsPng(svg, fileName(title, 'diagramm', 'png'));
  };
  const showLegend = legendItems.length > 1;
  const ranges = node.ranges && node.rangeBind && (
    <SegmentedControl
      className="dui-chart-ranges"
      label="Zeitraum"
      options={node.ranges}
      value={String(ctx.rt.state[node.rangeBind] ?? '')}
      onChange={(value) => ctx.set(node.rangeBind!, value)}
    />
  );
  const tools = (
    <div className="dui-toolbar">
      <button type="button" className="dui-tool" onClick={csv} title="Daten als CSV">
        <Download size={14} aria-hidden />
        <span>CSV</span>
      </button>
      <button type="button" className="dui-tool" onClick={png} title="Als Bild (PNG)">
        <ImageDown size={14} aria-hidden />
        <span>PNG</span>
      </button>
      {!full && (
        <button
          type="button"
          className="dui-tool"
          onClick={() => setFull(true)}
          aria-label="Diagramm vergrössern"
          title="Vergrössern"
        >
          <Maximize2 size={14} aria-hidden />
        </button>
      )}
    </div>
  );
  const legend = showLegend && (
    <div className="dui-legend" role="group" aria-label="Reihen ein- und ausblenden">
      {legendItems.map((item) => {
        const off = hidden.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={!off}
            className={cn('dui-legend-item', off && 'is-off')}
            onClick={() => toggle(item.key)}
          >
            <i style={{ background: palette[item.index % palette.length] }} aria-hidden />
            {item.label}
          </button>
        );
      })}
    </div>
  );
  const body = (fullHeight?: number) => (
    <>
      <div className="dui-chart-head">
        {ranges}
        {tools}
      </div>
      <div className="dui-chart-plot">
        <ChartSurface
          node={node}
          rows={rows}
          hidden={hidden}
          height={fullHeight ?? height}
          animate={!reduced}
          palette={palette}
        />
      </div>
      {legend}
    </>
  );
  return (
    <figure
      ref={figure}
      className="dui-chart"
      aria-label={node.series.map((series) => series.label).join(', ')}
    >
      {body()}
      <Fullscreen open={full} title={title} onClose={() => setFull(false)}>
        {full && (
          <figure className="dui-chart is-full">
            {body(Math.max(320, Math.round(window.innerHeight * 0.62)))}
          </figure>
        )}
      </Fullscreen>
    </figure>
  );
}
