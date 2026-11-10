import { useId, useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import {
  formatUiNumber,
  formatUiPercentChange,
  uiChangeTone,
  type UiCurrencyData,
} from '@plum-code-webui/shared';
import { LineChart } from '../LineChart';
import { useToneColors } from '../theme';
import { Change } from './Stock';

const parse = (raw: string) => Number(raw.replace(/[’'\s]/g, '').replace(',', '.'));
const plain = (value: number) =>
  Number.isFinite(value)
    ? Math.abs(value) >= 1000
      ? value.toFixed(2)
      : value.toFixed(value < 1 ? 4 : 2)
    : '';
const dayFormat = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short' });

/** Two coupled amount fields, swap, rates both ways and a 30-day mini chart. */
export function Currency({ data }: { data: UiCurrencyData }) {
  const id = useId();
  const tones = useToneColors();
  const [swapped, setSwapped] = useState(false);
  const from = swapped ? data.to : data.from;
  const to = swapped ? data.from : data.to;
  const fromName = swapped ? data.to_name : data.from_name;
  const toName = swapped ? data.from_name : data.to_name;
  const rate = swapped ? data.inverse_rate : data.rate;
  const [fields, setFields] = useState(() => ({
    from: plain(data.amount),
    to: plain(data.converted),
  }));
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(
    () => data.series.map((point) => ({ ...point, rate: swapped ? 1 / point.rate : point.rate })),
    [data.series, swapped]
  );
  const first = series[0]?.rate;
  const last = series.at(-1)?.rate;
  const change = first && last ? ((last - first) / first) * 100 : null;
  const tone = uiChangeTone(change);
  const point = hover !== null ? series[hover] : undefined;
  const editFrom = (raw: string) =>
    setFields({ from: raw, to: raw.trim() ? plain(parse(raw) * rate) : '' });
  const editTo = (raw: string) =>
    setFields({ to: raw, from: raw.trim() ? plain(parse(raw) / rate) : '' });
  const digits = rate < 10 ? 4 : 2;
  return (
    <div className="dui-currency" aria-label={`Wechselkurs ${from} zu ${to}`}>
      <header className="dui-fx-head">
        <span>
          {fromName ?? from} → {toName ?? to}
        </span>
      </header>
      <div className="dui-fx-fields">
        <label className="dui-fx-field" htmlFor={`${id}-from`}>
          <span className="dui-fx-code">{from}</span>
          <input
            id={`${id}-from`}
            inputMode="decimal"
            autoComplete="off"
            value={fields.from}
            aria-label={`Betrag in ${fromName ?? from}`}
            onChange={(event) => editFrom(event.target.value)}
          />
          {fromName && <span className="dui-fx-name">{fromName}</span>}
        </label>
        <button
          type="button"
          className="dui-fx-swap"
          aria-label="Richtung tauschen"
          title="Richtung tauschen"
          onClick={() => {
            const nextRate = swapped ? data.rate : data.inverse_rate;
            setSwapped(!swapped);
            setFields((current) => ({
              from: current.from,
              to: current.from.trim() ? plain(parse(current.from) * nextRate) : '',
            }));
          }}
        >
          <ArrowLeftRight size={16} />
        </button>
        <label className="dui-fx-field" htmlFor={`${id}-to`}>
          <span className="dui-fx-code">{to}</span>
          <input
            id={`${id}-to`}
            inputMode="decimal"
            autoComplete="off"
            value={fields.to}
            aria-label={`Betrag in ${toName ?? to}`}
            onChange={(event) => editTo(event.target.value)}
          />
          {toName && <span className="dui-fx-name">{toName}</span>}
        </label>
      </div>
      <p className="dui-fx-rate">
        <strong>{swapped ? data.inverse_rate_text : data.rate_text}</strong>
        <span>{swapped ? data.rate_text : data.inverse_rate_text}</span>
      </p>
      {series.length > 1 && (
        <div className="dui-fx-trend">
          <div className="dui-fx-trend-head" aria-live="polite">
            {point ? (
              <>
                <span>{dayFormat.format(new Date(`${point.date}T12:00:00`))}</span>
                <strong>
                  1 {from} = {formatUiNumber(point.rate, digits)} {to}
                </strong>
              </>
            ) : (
              <>
                <span>30 Tage</span>
                {change !== null && <Change text={formatUiPercentChange(change)} tone={tone} />}
              </>
            )}
          </div>
          <LineChart
            className="dui-fx-chart"
            points={series.map((entry, index) => ({ x: index, y: entry.rate }))}
            height={92}
            color={tones[tone]}
            hovered={hover}
            onHover={setHover}
            drawKey={swapped ? 'inverse' : 'direct'}
            ariaLabel={`Verlauf ${from} zu ${to}, 30 Tage`}
          />
        </div>
      )}
      <p className="dui-fx-date">{data.date_text}</p>
    </div>
  );
}
