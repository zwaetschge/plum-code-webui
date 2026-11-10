import { useMemo, useState } from 'react';
import { Droplets, Sunrise, Wind } from 'lucide-react';
import {
  celsiusToFahrenheit,
  formatUiTemperature,
  type UiWeatherData,
  type UiWeatherHour,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '../basic';
import { usePersistentState } from '../persist';
import { useWidth } from '../useWidth';
import { WeatherIcon } from './WeatherIcon';

type Unit = 'c' | 'f';
type Focus = 'temp' | 'precip';

/* Temperature → colour stops for the daily range bars (cold blue … hot red). */
const STOPS: Array<[number, [number, number, number]]> = [
  [-10, [120, 160, 255]],
  [0, [110, 200, 245]],
  [10, [120, 214, 170]],
  [18, [246, 206, 84]],
  [26, [247, 150, 60]],
  [34, [235, 84, 70]],
];
function tempColor(celsius: number) {
  const first = STOPS[0]!;
  const last = STOPS[STOPS.length - 1]!;
  if (celsius <= first[0]) return `rgb(${first[1].join(' ')})`;
  if (celsius >= last[0]) return `rgb(${last[1].join(' ')})`;
  for (let index = 1; index < STOPS.length; index++) {
    const [t1, c1] = STOPS[index]!;
    const [t0, c0] = STOPS[index - 1]!;
    if (celsius <= t1) {
      const k = (celsius - t0) / (t1 - t0);
      return `rgb(${c0.map((value, channel) => Math.round(value + (c1[channel]! - value) * k)).join(' ')})`;
    }
  }
  return `rgb(${last[1].join(' ')})`;
}

const bare = (celsius: number, unit: Unit) => formatUiTemperature(celsius, unit, true);

function HourlyChart({ hours, unit, focus }: { hours: UiWeatherHour[]; unit: Unit; focus: Focus }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 128;
  const pad = 14;
  const top = 26;
  const bottom = 22;
  const n = hours.length;
  const x = (index: number) => pad + (index / Math.max(1, n - 1)) * (width - pad * 2);
  const temps = hours.map((hour) =>
    unit === 'f' ? celsiusToFahrenheit(hour.temperature_c) : hour.temperature_c
  );
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(4, max - min);
  const y = (value: number) =>
    top + (1 - (value - (min - span * 0.15)) / (span * 1.3)) * (height - top - bottom);
  const line = temps
    .map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(t).toFixed(1)}`)
    .join('');
  const area = `${line}L${x(n - 1)},${height - bottom}L${x(0)},${height - bottom}Z`;
  const step = width < 420 ? 4 : 3;
  const marks = hours.map((_, index) => index).filter((index) => index % step === 0);
  const barWidth = Math.max(4, Math.min(14, ((width - pad * 2) / n) * 0.62));
  const pick = (clientX: number, element: Element) => {
    const rect = element.getBoundingClientRect();
    const ratio = (clientX - rect.left - pad) / Math.max(1, rect.width - pad * 2);
    setActive(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))));
  };
  const shown = active ?? null;
  return (
    <div ref={ref} className="dui-wx-hourly">
      <div className="dui-wx-hour-icons" aria-hidden>
        {marks.map((index) => (
          <span key={index} style={{ left: x(index) }}>
            <WeatherIcon icon={hours[index]!.icon} size={24} />
          </span>
        ))}
      </div>
      <svg
        width="100%"
        height={height}
        role="img"
        aria-label={
          focus === 'temp'
            ? `Temperatur der nächsten 24 Stunden zwischen ${bare(Math.min(...hours.map((h) => h.temperature_c)), unit)} und ${bare(Math.max(...hours.map((h) => h.temperature_c)), unit)}`
            : 'Niederschlagswahrscheinlichkeit der nächsten 24 Stunden'
        }
        onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
        onPointerDown={(event) => pick(event.clientX, event.currentTarget)}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="dui-wx-temp-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(38 95% 58%)" stopOpacity={0.34} />
            <stop offset="100%" stopColor="hsl(38 95% 58%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <line
          className="dui-wx-axis"
          x1={pad}
          x2={width - pad}
          y1={height - bottom}
          y2={height - bottom}
        />
        {focus === 'temp' ? (
          <g key={`t-${unit}`}>
            <path className="dui-line-area" d={area} fill="url(#dui-wx-temp-fill)" />
            <path className="dui-line-path dui-wx-temp-line" d={line} pathLength={1} fill="none" />
            {marks.map((index) => (
              <text
                key={index}
                className="dui-wx-value"
                x={x(index)}
                y={y(temps[index]!) - 9}
                textAnchor="middle"
              >
                {Math.round(temps[index]!)}°
              </text>
            ))}
          </g>
        ) : (
          <g key="p">
            {hours.map((hour, index) => {
              const chance = hour.precip_chance ?? 0;
              const h = ((height - top - bottom) * chance) / 100;
              return (
                <rect
                  key={index}
                  className="dui-wx-bar"
                  x={x(index) - barWidth / 2}
                  y={height - bottom - h}
                  width={barWidth}
                  height={Math.max(chance ? 2 : 0, h)}
                  rx={Math.min(3, barWidth / 2)}
                  style={{ opacity: 0.35 + (chance / 100) * 0.65, ['--dui-i' as string]: index }}
                />
              );
            })}
            {marks.map((index) => (
              <text
                key={index}
                className="dui-wx-value is-precip"
                x={x(index)}
                y={
                  height -
                  bottom -
                  ((height - top - bottom) * (hours[index]!.precip_chance ?? 0)) / 100 -
                  6
                }
                textAnchor="middle"
              >
                {hours[index]!.precip_chance ?? 0} %
              </text>
            ))}
          </g>
        )}
        {marks.map((index) => (
          <text
            key={index}
            className="dui-line-label"
            x={x(index)}
            y={height - 5}
            textAnchor="middle"
          >
            {hours[index]!.label}
          </text>
        ))}
        {shown !== null && (
          <g className="dui-line-cursor">
            <line x1={x(shown)} x2={x(shown)} y1={top - 8} y2={height - bottom} />
            {focus === 'temp' && (
              <circle cx={x(shown)} cy={y(temps[shown]!)} r={4.5} fill="hsl(36 95% 55%)" />
            )}
          </g>
        )}
      </svg>
      {shown !== null && (
        <span
          className="dui-wx-tip"
          style={{ left: Math.min(width - 70, Math.max(70, x(shown))) }}
          role="status"
        >
          <strong>{hours[shown]!.label}</strong>
          {bare(hours[shown]!.temperature_c, unit)} · {hours[shown]!.description}
          {hours[shown]!.precip_chance !== null && ` · ${hours[shown]!.precip_chance} %`}
        </span>
      )}
    </div>
  );
}

/** Current conditions, 24-hour chart (temperature/precipitation), daily list; °C/°F. */
export function Weather({ data }: { data: UiWeatherData }) {
  const [unit, setUnit] = usePersistentState<Unit>(
    'pref:temperature-unit',
    () => 'c',
    (value) => (value === 'f' || value === 'c' ? value : undefined)
  );
  const [focus, setFocus] = useState<Focus>('temp');
  const { current, daily, hourly, location } = data;
  const range = useMemo(() => {
    const lows = daily.map((day) => day.low_c);
    const highs = daily.map((day) => day.high_c);
    return { min: Math.min(...lows), max: Math.max(...highs) };
  }, [daily]);
  const today = daily[0];
  return (
    <div className="dui-weather" aria-label={`Wetter ${location.label}`}>
      <header className="dui-wx-head">
        <span className="dui-wx-place">{location.label}</span>
        <button
          type="button"
          className="dui-wx-unit"
          aria-label={unit === 'c' ? 'In Fahrenheit anzeigen' : 'In Celsius anzeigen'}
          onClick={() => setUnit(unit === 'c' ? 'f' : 'c')}
        >
          <span className={cn(unit === 'c' && 'is-active')}>°C</span>
          <span aria-hidden>/</span>
          <span className={cn(unit === 'f' && 'is-active')}>°F</span>
        </button>
      </header>
      <div className="dui-wx-now">
        <WeatherIcon icon={current.icon} size={76} label={current.description} />
        <span key={unit} className="dui-wx-temp">
          {bare(current.temperature_c, unit)}
        </span>
        <div className="dui-wx-summary">
          <strong>{current.description}</strong>
          <span>
            Gefühlt {bare(current.feels_like_c, unit)}
            {today && (
              <>
                {' '}
                · H {bare(today.high_c, unit)} T {bare(today.low_c, unit)}
              </>
            )}
          </span>
        </div>
      </div>
      <dl className="dui-wx-facts">
        <div>
          <dt>
            <Wind size={14} aria-hidden /> Wind
          </dt>
          <dd>{current.wind_text}</dd>
        </div>
        <div>
          <dt>
            <Droplets size={14} aria-hidden /> Feuchte
          </dt>
          <dd>{current.humidity_text}</dd>
        </div>
        {today?.sunrise && today.sunset && (
          <div>
            <dt>
              <Sunrise size={14} aria-hidden /> Sonne
            </dt>
            <dd>
              {today.sunrise}–{today.sunset}
            </dd>
          </div>
        )}
      </dl>
      {hourly.length > 1 && (
        <>
          <SegmentedControl
            className="dui-wx-focus"
            label="Diagramm"
            options={[
              { value: 'temp', label: 'Temperatur' },
              { value: 'precip', label: 'Niederschlag' },
            ]}
            value={focus}
            onChange={(value) => setFocus(value as Focus)}
          />
          <HourlyChart hours={hourly} unit={unit} focus={focus} />
        </>
      )}
      <ul className="dui-wx-days">
        {daily.map((day, index) => {
          const left = ((day.low_c - range.min) / Math.max(1, range.max - range.min)) * 100;
          const right = ((day.high_c - range.min) / Math.max(1, range.max - range.min)) * 100;
          const now =
            index === 0
              ? ((current.temperature_c - range.min) / Math.max(1, range.max - range.min)) * 100
              : null;
          return (
            <li key={day.date} className="dui-wx-day" style={{ ['--dui-i' as string]: index }}>
              <span className="dui-wx-day-label" title={`${day.weekday}, ${day.date_text}`}>
                {day.label}
              </span>
              <WeatherIcon icon={day.icon} size={28} label={day.description} />
              <span className="dui-wx-day-precip">
                {day.precip_chance !== null && day.precip_chance >= 10
                  ? `${day.precip_chance} %`
                  : ''}
              </span>
              <span className="dui-wx-day-low">{bare(day.low_c, unit)}</span>
              <span className="dui-wx-range" aria-hidden>
                <span
                  className="dui-wx-range-fill"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(4, right - left)}%`,
                    background: `linear-gradient(90deg, ${tempColor(day.low_c)}, ${tempColor(day.high_c)})`,
                  }}
                />
                {now !== null && (
                  <span
                    className="dui-wx-range-now"
                    style={{ left: `${Math.min(100, Math.max(0, now))}%` }}
                  />
                )}
              </span>
              <span className="dui-wx-day-high">{bare(day.high_c, unit)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
