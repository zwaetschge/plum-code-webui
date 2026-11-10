import { useState } from 'react';
import {
  formatUiChange,
  formatUiPrice,
  uiChangeTone,
  UI_STOCK_RANGES,
  type UiChangeTone,
  type UiStockData,
  type UiStockRange,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '../basic';
import { LineChart } from '../LineChart';
import { useToneColors } from '../theme';

const RANGE_LABEL: Record<UiStockRange, { short: string; long: string }> = {
  '1M': { short: '1M', long: '1 Monat' },
  '6M': { short: '6M', long: '6 Monate' },
  '1Y': { short: '1J', long: '1 Jahr' },
  '5Y': { short: '5J', long: '5 Jahre' },
};

const dayFormat = new Intl.DateTimeFormat('de-CH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const shortFormat = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short' });
const monthFormat = new Intl.DateTimeFormat('de-CH', { month: 'short', year: 'numeric' });
const parseDay = (value: string) => new Date(`${value}T12:00:00`);

export function Change({ text, tone }: { text: string; tone: UiChangeTone }) {
  return (
    <span className={cn('dui-change', `is-${tone}`)}>
      <span className="dui-change-arrow" aria-hidden>
        {tone === 'positive' ? '▲' : tone === 'negative' ? '▼' : '•'}
      </span>
      {text}
    </span>
  );
}

/** Price headline, range segment, hover-driven chart and a metrics grid. */
export function Stock({ data }: { data: UiStockData }) {
  const tones = useToneColors();
  const available = UI_STOCK_RANGES.filter((range) => (data.ranges[range]?.points.length ?? 0) > 1);
  const [range, setRange] = useState<UiStockRange>(
    available.includes(data.default_range) ? data.default_range : (available[0] ?? '1M')
  );
  const [hover, setHover] = useState<number | null>(null);
  const current = data.ranges[range];
  const points = current?.points ?? [];
  const point = hover !== null ? points[hover] : undefined;
  const start = current?.start ?? points[0]?.close ?? null;
  const hoverChange = point && start !== null ? point.close - start : null;
  const hoverPercent = hoverChange !== null && start ? (hoverChange / start) * 100 : null;
  const tone = point ? uiChangeTone(hoverChange) : (current?.change_tone ?? data.change_tone);
  const color = tones[tone];
  const long = range === '5Y' || range === '1Y';
  const labels =
    points.length > 1
      ? [0, Math.floor((points.length - 1) / 2), points.length - 1].map((index) => ({
          index,
          text: (long ? monthFormat : shortFormat).format(parseDay(points[index]!.date)),
        }))
      : [];
  return (
    <div className="dui-stock" aria-label={`Kurs ${data.name ?? data.symbol}`}>
      <header className="dui-stock-head">
        <span className="dui-stock-name">{data.name ?? data.symbol}</span>
        <span className="dui-stock-meta">
          {[data.symbol, data.exchange, data.currency === 'GBX' ? 'GBp' : data.currency]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </header>
      <div className="dui-stock-quote" aria-live="polite">
        <span className="dui-stock-price">
          {point ? formatUiPrice(point.close, data.currency) : data.price_text}
        </span>
        <span className="dui-stock-change">
          {point ? (
            <Change text={formatUiChange(hoverChange, hoverPercent)} tone={tone} />
          ) : (
            <Change text={current?.change_text ?? data.change_text} tone={tone} />
          )}
          <span className="dui-stock-when">
            {point ? dayFormat.format(parseDay(point.date)) : RANGE_LABEL[range].long}
          </span>
        </span>
        <span className="dui-stock-asof">{data.trade_date_text}</span>
      </div>
      {available.length > 1 && (
        <SegmentedControl
          className="dui-stock-ranges"
          label="Zeitraum"
          options={available.map((value) => ({ value, label: RANGE_LABEL[value].short }))}
          value={range}
          onChange={(value) => {
            setHover(null);
            setRange(value as UiStockRange);
          }}
        />
      )}
      {points.length > 1 && (
        <LineChart
          className="dui-stock-chart"
          points={points.map((entry, index) => ({ x: index, y: entry.close }))}
          height={210}
          color={color}
          baseline={start}
          hovered={hover}
          onHover={setHover}
          labels={labels}
          yTicks={4}
          formatY={(value) => formatUiPrice(value, null, value >= 100 ? 0 : 2)}
          drawKey={range}
          ariaLabel={`Kursverlauf ${RANGE_LABEL[range].long}: ${current?.change_text ?? ''}`}
        />
      )}
      {!!data.metrics.length && (
        <dl className="dui-metrics">
          {data.metrics.map((metric) => (
            <div key={metric.key}>
              <dt>{metric.label}</dt>
              <dd>{metric.value_text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
