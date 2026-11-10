import {
  UI_LIVE_TIMEOUT_MS,
  UI_LIVE_TTL_MS,
  UI_RESULT_EVENT,
  UI_STOCK_RANGES,
  collectUiLiveNodes,
  formatUiChange,
  formatUiNumber,
  formatUiPercentChange,
  formatUiPrice,
  formatUiTemperature,
  isUiHttpsUrl,
  uiChangeTone,
  uiLiveKey,
  uiWeatherCode,
  type AnyUiResult,
  type DynamicUiSpec,
  type UiCurrencyData,
  type UiCurrencyPoint,
  type UiEntityData,
  type UiGalleryData,
  type UiGalleryImage,
  type UiLiveDataMap,
  type UiLiveNode,
  type UiLiveNodeType,
  type UiNewsArticle,
  type UiNewsData,
  type UiNodeOf,
  type UiResultEvent,
  type UiResults,
  type UiStockData,
  type UiStockMetric,
  type UiStockPoint,
  type UiStockRange,
  type UiStockRangeData,
  type UiWeatherData,
} from '@plum-code-webui/shared';
import { run } from '../../db/pg.js';
import { liveEvents } from '../liveEvents.js';
import { plainText, publishedDate } from './chatWebSources.js';
import { publicSourceUrl } from './publicSources.js';

/**
 * Live widgets of Dynamic UI v2 (shared/utils/dynamicUiLive.ts): the model
 * names a widget, this module fetches its data from free sources without API
 * keys, caches it per parameter set and stores one envelope per node ID with
 * the turn (`assistant_api_turns.ui_results_json`).
 *
 * Every upstream request has its own 8 s timeout. Hosts are fixed per source
 * (only the Wikipedia language subdomain varies, validated as [a-z]{2,3}), so
 * no model value can steer a request to another server.
 */

const USER_AGENT = 'Plum-Code-WebUI/2 (self-hosted assistant; dynamic-ui live widgets)';
const MAX_BYTES = 3 * 1024 * 1024;
/** A forced refresh within this window returns the cached result. */
const REFRESH_COOLDOWN_MS = 30_000;
const CACHE_LIMIT = 500;

export class UiLiveError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message);
  }
}

export interface UiLiveDeps {
  fetch: (
    url: string,
    init: { signal: AbortSignal; headers: Record<string, string> }
  ) => Promise<Response>;
  now: () => Date;
  /** SearXNG base URL (PLUM_SEARXNG_URL) for news and gallery. */
  searxngUrl: () => string | undefined;
  /** Yahoo chart API when Stooq refuses automated CSV downloads (PLUM_STOCK_FALLBACK=off disables). */
  stockFallback: () => boolean;
  timeoutMs: number;
}

const DEFAULT_DEPS: UiLiveDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  searxngUrl: () => process.env.PLUM_SEARXNG_URL?.trim() || undefined,
  stockFallback: () => process.env.PLUM_STOCK_FALLBACK?.trim().toLowerCase() !== 'off',
  timeoutMs: UI_LIVE_TIMEOUT_MS,
};

async function fetchText(deps: UiLiveDeps, url: string, accept = 'application/json') {
  try {
    const response = await deps.fetch(url, {
      signal: AbortSignal.timeout(deps.timeoutMs),
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
    });
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES)
      throw new UiLiveError('Die Datenquelle liefert zu viele Daten.', false);
    const text = await response.text();
    if (text.length > MAX_BYTES)
      throw new UiLiveError('Die Datenquelle liefert zu viele Daten.', false);
    return {
      status: response.status,
      text,
      url: response.url || url,
      type: (response.headers.get('content-type') ?? '').toLowerCase(),
    };
  } catch (error) {
    if (error instanceof UiLiveError) throw error;
    const name = (error as Error)?.name;
    throw new UiLiveError(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Die Datenquelle antwortet gerade nicht.'
        : 'Die Datenquelle ist nicht erreichbar.',
      true
    );
  }
}
function checkStatus(status: number, notFound: string) {
  if (status === 200) return;
  if (status === 404) throw new UiLiveError(notFound, false);
  if (status === 429 || status >= 500)
    throw new UiLiveError('Die Datenquelle ist gerade überlastet.', true);
  throw new UiLiveError(notFound, false);
}
async function fetchJson<T>(deps: UiLiveDeps, url: string, notFound: string): Promise<T> {
  const response = await fetchText(deps, url);
  checkStatus(response.status, notFound);
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new UiLiveError('Die Datenquelle lieferte unlesbare Daten.', true);
  }
}

// Dates and German labels (deterministic, independent of the ICU build).
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = [
  'Jan.',
  'Feb.',
  'März',
  'Apr.',
  'Mai',
  'Juni',
  'Juli',
  'Aug.',
  'Sept.',
  'Okt.',
  'Nov.',
  'Dez.',
];
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const utcDay = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);
/** "6. Nov." or "6. Nov. 2026". */
function dayText(day: string, withYear = false) {
  const date = utcDay(day);
  if (Number.isNaN(date.getTime())) return day;
  const text = `${date.getUTCDate()}. ${MONTHS[date.getUTCMonth()]}`;
  return withYear ? `${text} ${date.getUTCFullYear()}` : text;
}
function shiftMonths(day: string, months: number) {
  const date = utcDay(day);
  date.setUTCMonth(date.getUTCMonth() - months);
  return isoDay(date);
}
const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const compass = (degrees: number | null) =>
  degrees === null || !Number.isFinite(degrees)
    ? null
    : COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8]!;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown, max = 300): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
/** Protocol-relative and https URLs only; everything else is dropped. */
const httpsImage = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const url = value.startsWith('//') ? 'https:' + value : value;
  return isUiHttpsUrl(url) ? url : null;
};

// Weather: Open-Meteo geocoding + forecast.

interface GeoResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  timezone?: string;
}

async function resolveWeather(node: UiNodeOf<'weather'>, deps: UiLiveDeps): Promise<UiWeatherData> {
  const [name, ...hints] = node.location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!name) throw new UiLiveError('Ort fehlt.', false);
  const notFound = `Ort „${name}“ nicht gefunden.`;
  const geo = await fetchJson<{ results?: GeoResult[] }>(
    deps,
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=de&format=json`,
    notFound
  );
  const results = (geo.results ?? []).filter(
    (r) => num(r.latitude) !== null && num(r.longitude) !== null
  );
  const hint = hints.join(' ').toLowerCase();
  const matches = (r: GeoResult) =>
    [r.country, r.admin1, r.admin2]
      .filter((v): v is string => typeof v === 'string' && v.length > 1)
      .map((v) => v.toLowerCase())
      .some((v) => v === hint || v.includes(hint) || hint.includes(v)) ||
    (hint.length === 2 && r.country_code?.toLowerCase() === hint);
  const place = (hint && results.find(matches)) || results[0];
  if (!place) throw new UiLiveError(notFound, false);
  const days = node.days ?? 7;
  const forecast = await fetchJson<{
    timezone?: string;
    current?: Record<string, unknown>;
    hourly?: Record<string, unknown[]>;
    daily?: Record<string, unknown[]>;
  }>(
    deps,
    'https://api.open-meteo.com/v1/forecast?' +
      new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        timezone: 'auto',
        forecast_days: String(Math.max(days, 2)),
        forecast_hours: '24',
        current:
          'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
        hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day',
        daily:
          'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset',
      }).toString(),
    'Für diesen Ort gibt es keine Vorhersage.'
  );
  const c = forecast.current ?? {};
  const temperature = num(c.temperature_2m);
  if (temperature === null) throw new UiLiveError('Die Wetterdaten sind unvollständig.', true);
  const currentCode = num(c.weather_code) ?? 3;
  const currentDay = c.is_day !== 0;
  const feels = num(c.apparent_temperature) ?? temperature;
  const wind = num(c.wind_speed_10m) ?? 0;
  const windDirection = num(c.wind_direction_10m);
  const humidity = num(c.relative_humidity_2m) ?? 0;
  const h = forecast.hourly ?? {};
  const hourly = ((h.time ?? []) as unknown[]).slice(0, 24).map((time, i) => {
    const code = num(h.weather_code?.[i]) ?? 3;
    const isDay = h.is_day?.[i] !== 0;
    return {
      time: String(time),
      label: i === 0 ? 'Jetzt' : `${String(time).slice(11, 13)} Uhr`,
      temperature_c: num(h.temperature_2m?.[i]) ?? temperature,
      precip_chance: num(h.precipitation_probability?.[i]),
      precipitation_mm: num(h.precipitation?.[i]) ?? 0,
      weather_code: code,
      ...uiWeatherCode(code, isDay),
      is_day: isDay,
    };
  });
  const d = forecast.daily ?? {};
  const daily = ((d.time ?? []) as unknown[]).slice(0, days).map((date, i) => {
    const day = String(date);
    const code = num(d.weather_code?.[i]) ?? 3;
    const weekday = utcDay(day).getUTCDay();
    return {
      date: day,
      label: i === 0 ? 'Heute' : i === 1 ? 'Morgen' : WEEKDAYS_SHORT[weekday]!,
      weekday: WEEKDAYS[weekday]!,
      date_text: dayText(day),
      high_c: num(d.temperature_2m_max?.[i]) ?? temperature,
      low_c: num(d.temperature_2m_min?.[i]) ?? temperature,
      precip_chance: num(d.precipitation_probability_max?.[i]),
      precipitation_mm: num(d.precipitation_sum?.[i]) ?? 0,
      weather_code: code,
      ...uiWeatherCode(code, true),
      sunrise: typeof d.sunrise?.[i] === 'string' ? String(d.sunrise[i]).slice(11, 16) : null,
      sunset: typeof d.sunset?.[i] === 'string' ? String(d.sunset[i]).slice(11, 16) : null,
    };
  });
  const placeName = str(place.name, 120) ?? name;
  const country = str(place.country, 120);
  const direction = compass(windDirection);
  return {
    location: {
      name: placeName,
      region: str(place.admin1, 120),
      country,
      country_code: str(place.country_code, 2)?.toUpperCase() ?? null,
      latitude: place.latitude!,
      longitude: place.longitude!,
      timezone: str(forecast.timezone, 60) ?? str(place.timezone, 60) ?? 'UTC',
      label: [placeName, country ?? str(place.admin1, 120)].filter(Boolean).join(', '),
    },
    current: {
      time: String(c.time ?? ''),
      temperature_c: temperature,
      feels_like_c: feels,
      humidity,
      wind_kmh: wind,
      wind_direction_deg: windDirection,
      wind_direction_text: direction,
      precipitation_mm: num(c.precipitation) ?? 0,
      weather_code: currentCode,
      ...uiWeatherCode(currentCode, currentDay),
      is_day: currentDay,
      temperature_text: formatUiTemperature(temperature),
      feels_like_text: `Gefühlt ${formatUiTemperature(feels)}`,
      wind_text: `${Math.round(wind)} km/h${direction ? ' ' + direction : ''}`,
      humidity_text: `${Math.round(humidity)} %`,
    },
    hourly,
    daily,
    units: { temperature: '°C', wind: 'km/h', precipitation: 'mm' },
    source: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
  };
}

// Currency: Frankfurter (ECB reference rates).

const FRANKFURTER = 'https://api.frankfurter.dev/v1';
function currencyName(code: string) {
  try {
    const name = new Intl.DisplayNames(['de-CH'], { type: 'currency' }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}
async function resolveCurrency(
  node: UiNodeOf<'currency'>,
  deps: UiLiveDeps
): Promise<UiCurrencyData> {
  const { from, to } = node;
  const notFound = `Für ${from} → ${to} gibt es keinen EZB-Referenzkurs.`;
  const query = `base=${from}&symbols=${to}`;
  const today = deps.now();
  const start = isoDay(new Date(today.getTime() - 30 * 86_400_000));
  const [latest, history] = await Promise.all([
    fetchJson<{ date?: string; rates?: Record<string, number> }>(
      deps,
      `${FRANKFURTER}/latest?${query}`,
      notFound
    ),
    fetchJson<{ rates?: Record<string, Record<string, number>> }>(
      deps,
      `${FRANKFURTER}/${start}..?${query}`,
      notFound
    ).catch(() => ({ rates: {} as Record<string, Record<string, number>> })),
  ]);
  const rate = num(latest.rates?.[to]);
  if (rate === null || rate <= 0) throw new UiLiveError(notFound, false);
  const date = str(latest.date, 10) ?? isoDay(today);
  const series: UiCurrencyPoint[] = Object.entries(history.rates ?? {})
    .map(([day, rates]) => ({ date: day, rate: num(rates?.[to]) }))
    .filter(
      (point): point is UiCurrencyPoint =>
        point.rate !== null && /^\d{4}-\d{2}-\d{2}$/.test(point.date)
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length || series.at(-1)!.date < date) series.push({ date, rate });
  const first = series[0]!.rate;
  const change = series.length >= 2 ? (rate / first - 1) * 100 : null;
  const amount = node.amount ?? 1;
  const inverse = 1 / rate;
  return {
    from,
    to,
    from_name: currencyName(from),
    to_name: currencyName(to),
    amount,
    rate,
    inverse_rate: inverse,
    converted: amount * rate,
    date,
    amount_text: formatUiPrice(amount, from, 2),
    converted_text: formatUiPrice(amount * rate, to, 2),
    rate_text: `1 ${from} = ${formatUiNumber(rate, 4)} ${to}`,
    inverse_rate_text: `1 ${to} = ${formatUiNumber(inverse, 4)} ${from}`,
    date_text: `Referenzkurs der EZB vom ${dayText(date, true)}`,
    change_percent: change,
    change_text: change === null ? 'Kein Verlauf' : `${formatUiPercentChange(change)} in 30 Tagen`,
    change_tone: uiChangeTone(change),
    series,
    source: { name: 'Frankfurter (EZB)', url: 'https://frankfurter.dev/' },
  };
}

// Stock: Stooq daily CSV, Yahoo chart API as fallback.

const STOOQ_SUFFIX: Record<string, string> = {
  US: 'us',
  SW: 'ch',
  VX: 'ch',
  DE: 'de',
  F: 'de',
  XETRA: 'de',
  L: 'uk',
  T: 'jp',
  HK: 'hk',
  WA: 'pl',
  BD: 'hu',
};
const STOOQ_INDEX: Record<string, string> = {
  '^GSPC': '^spx',
  '^DJI': '^dji',
  '^IXIC': '^ndq',
  '^GDAXI': '^dax',
  '^SSMI': '^smi',
};
const YAHOO_SUFFIX: Record<string, string> = {
  us: '',
  ch: '.SW',
  de: '.DE',
  uk: '.L',
  jp: '.T',
  hk: '.HK',
  pl: '.WA',
  hu: '.BD',
};
const STOOQ_CURRENCY: Record<string, string> = {
  us: 'USD',
  ch: 'CHF',
  de: 'EUR',
  uk: 'GBX',
  jp: 'JPY',
  hk: 'HKD',
  pl: 'PLN',
  hu: 'HUF',
};
/** Ticker → Stooq symbol: AAPL → aapl.us, NESN.SW → nesn.ch, SAP.DE → sap.de, ^GSPC → ^spx. */
export function stooqSymbol(symbol: string): string {
  const value = symbol.trim();
  const upper = value.toUpperCase();
  if (STOOQ_INDEX[upper]) return STOOQ_INDEX[upper]!;
  if (value.startsWith('^')) return value.toLowerCase();
  const dot = value.lastIndexOf('.');
  if (dot < 0) return `${value.toLowerCase()}.us`;
  const suffix = upper.slice(dot + 1);
  const mapped =
    STOOQ_SUFFIX[suffix] ??
    (Object.values(STOOQ_SUFFIX).includes(suffix.toLowerCase()) ? suffix.toLowerCase() : null);
  return mapped ? `${value.slice(0, dot).toLowerCase()}.${mapped}` : value.toLowerCase();
}
/** Ticker → Yahoo symbol (AAPL, NESN.SW, SAP.DE …), accepting Stooq forms too. */
export function yahooSymbol(symbol: string): string {
  const stooq = stooqSymbol(symbol);
  const index = Object.entries(STOOQ_INDEX).find(([, value]) => value === stooq)?.[0];
  if (index) return index;
  const dot = stooq.lastIndexOf('.');
  const suffix = dot < 0 ? null : stooq.slice(dot + 1);
  if (suffix && suffix in YAHOO_SUFFIX)
    return stooq.slice(0, dot).toUpperCase() + YAHOO_SUFFIX[suffix];
  return symbol.trim().toUpperCase();
}

interface Bar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}
class StooqBlocked extends Error {}

async function stooqBars(symbol: string, deps: UiLiveDeps): Promise<Bar[]> {
  const today = isoDay(deps.now());
  const from = shiftMonths(today, 61).replace(/-/g, '');
  const response = await fetchText(
    deps,
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(symbol))}&i=d&d1=${from}&d2=${today.replace(/-/g, '')}`,
    'text/csv'
  );
  const text = response.text.trim();
  if (response.status !== 200 || !/^date,/i.test(text)) {
    if (/^no data/i.test(text)) throw new UiLiveError(`Kein Kurs für „${symbol}“ gefunden.`, false);
    throw new StooqBlocked();
  }
  const bars: Bar[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [date, open, high, low, close, volume] = line.split(',');
    const value = Number(close);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) continue;
    const n = (x?: string) =>
      x !== undefined && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null;
    bars.push({ date, open: n(open), high: n(high), low: n(low), close: value, volume: n(volume) });
  }
  return bars;
}

async function yahooChart(symbol: string, deps: UiLiveDeps) {
  const notFound = `Kein Kurs für „${symbol}“ gefunden.`;
  const body = await fetchJson<{
    chart?: {
      result?: Array<{
        meta?: Record<string, unknown>;
        timestamp?: number[];
        indicators?: { quote?: Array<Record<string, Array<number | null>>> };
      }>;
    };
  }>(
    deps,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=5y&interval=1d&includePrePost=false`,
    notFound
  );
  const result = body.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new UiLiveError(notFound, false);
  const meta = result.meta ?? {};
  const quote = result.indicators?.quote?.[0] ?? {};
  const offset = (num(meta.gmtoffset) ?? 0) * 1000;
  const bars: Bar[] = [];
  result.timestamp.forEach((time, i) => {
    const close = num(quote.close?.[i]);
    if (close === null) return;
    bars.push({
      date: isoDay(new Date(time * 1000 + offset)),
      open: num(quote.open?.[i]),
      high: num(quote.high?.[i]),
      low: num(quote.low?.[i]),
      close,
      volume: num(quote.volume?.[i]),
    });
  });
  return {
    bars,
    name: str(meta.longName, 120) ?? str(meta.shortName, 120),
    exchange: str(meta.fullExchangeName, 60) ?? str(meta.exchangeName, 60),
    currency: str(meta.currency, 3)?.toUpperCase() ?? null,
    price: num(meta.regularMarketPrice),
    yearHigh: num(meta.fiftyTwoWeekHigh),
    yearLow: num(meta.fiftyTwoWeekLow),
  };
}

function rangeData(points: UiStockPoint[]): UiStockRangeData {
  const start = points[0]?.close ?? null;
  const end = points.at(-1)?.close ?? null;
  const change = start !== null && end !== null ? end - start : null;
  const percent = change !== null && start ? (change / start) * 100 : null;
  const closes = points.map((p) => p.close);
  return {
    points,
    start,
    end,
    change,
    change_percent: percent,
    change_text: formatUiChange(change, percent),
    change_tone: uiChangeTone(change),
    high: closes.length ? Math.max(...closes) : null,
    low: closes.length ? Math.min(...closes) : null,
  };
}
const RANGE_MONTHS: Record<UiStockRange, number> = { '1M': 1, '6M': 6, '1Y': 12, '5Y': 60 };
/** Last close of each week, so five years stay around 260 points. */
function weekly(points: UiStockPoint[]) {
  const out: UiStockPoint[] = [];
  let week = NaN;
  for (const point of points) {
    const key = Math.floor((utcDay(point.date).getTime() / 86_400_000 + 3) / 7);
    if (key === week) out[out.length - 1] = point;
    else out.push(point);
    week = key;
  }
  return out;
}

function buildStock(
  node: UiNodeOf<'stock'>,
  bars: Bar[],
  meta: {
    name: string | null;
    exchange: string | null;
    currency: string | null;
    price: number | null;
    yearHigh: number | null;
    yearLow: number | null;
    closing: boolean;
    source: { name: string; url: string };
  }
): UiStockData {
  if (!bars.length) throw new UiLiveError(`Kein Kurs für „${node.symbol}“ gefunden.`, false);
  bars.sort((a, b) => a.date.localeCompare(b.date));
  const last = bars.at(-1)!;
  const previous = bars.at(-2) ?? null;
  const price = meta.price ?? last.close;
  const previousClose = previous?.close ?? null;
  const change = previousClose !== null ? price - previousClose : null;
  const percent = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const all = bars.map((bar) => ({ date: bar.date, close: bar.close }));
  if (meta.price !== null) all[all.length - 1] = { date: last.date, close: price };
  const ranges = Object.fromEntries(
    UI_STOCK_RANGES.map((range) => {
      const cutoff = shiftMonths(last.date, RANGE_MONTHS[range]);
      const points = all.filter((point) => point.date >= cutoff);
      return [range, rangeData(range === '5Y' ? weekly(points) : points)];
    })
  ) as Record<UiStockRange, UiStockRangeData>;
  const currency = meta.currency;
  const money = (value: number | null) => (value === null ? '–' : formatUiPrice(value, currency));
  const yearHigh = meta.yearHigh ?? ranges['1Y'].high;
  const yearLow = meta.yearLow ?? ranges['1Y'].low;
  const metrics: UiStockMetric[] = [
    { key: 'open', label: 'Eröffnung', value: last.open, value_text: money(last.open) },
    { key: 'high', label: 'Tageshoch', value: last.high, value_text: money(last.high) },
    { key: 'low', label: 'Tagestief', value: last.low, value_text: money(last.low) },
    {
      key: 'previous_close',
      label: 'Vortag',
      value: previousClose,
      value_text: money(previousClose),
    },
    {
      key: 'volume',
      label: 'Volumen',
      value: last.volume,
      value_text:
        last.volume === null
          ? '–'
          : new Intl.NumberFormat('de-CH', {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(last.volume),
    },
    { key: 'year_high', label: '52W-Hoch', value: yearHigh, value_text: money(yearHigh) },
    { key: 'year_low', label: '52W-Tief', value: yearLow, value_text: money(yearLow) },
  ];
  return {
    symbol: node.symbol.toUpperCase(),
    name: meta.name,
    exchange: meta.exchange,
    currency,
    price,
    price_text: formatUiPrice(price, currency),
    previous_close: previousClose,
    change,
    change_percent: percent,
    change_text: formatUiChange(change, percent),
    change_tone: uiChangeTone(change),
    trade_date: last.date,
    trade_date_text: `${meta.closing ? 'Schlusskurs vom' : 'Stand'} ${dayText(last.date, true)}`,
    metrics,
    ranges,
    default_range: node.range ?? '1M',
    source: meta.source,
  };
}

async function resolveStock(node: UiNodeOf<'stock'>, deps: UiLiveDeps): Promise<UiStockData> {
  let stooqError: unknown;
  try {
    const bars = await stooqBars(node.symbol, deps);
    const suffix = stooqSymbol(node.symbol).split('.')[1] ?? '';
    return buildStock(node, bars, {
      name: null,
      exchange: null,
      currency: STOOQ_CURRENCY[suffix] ?? null,
      price: null,
      yearHigh: null,
      yearLow: null,
      closing: true,
      source: { name: 'Stooq', url: `https://stooq.com/q/?s=${stooqSymbol(node.symbol)}` },
    });
  } catch (error) {
    stooqError = error;
  }
  // Stooq answers automated CSV requests with a browser challenge since 2026;
  // the challenge is not solved, the request moves to the fallback source.
  if (!deps.stockFallback())
    throw stooqError instanceof StooqBlocked
      ? new UiLiveError('Die Kursquelle ist gerade nicht erreichbar.', true)
      : stooqError;
  const chart = await yahooChart(node.symbol, deps);
  return buildStock(node, chart.bars, {
    ...chart,
    closing: false,
    source: {
      name: 'Yahoo Finance',
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol(node.symbol))}`,
    },
  });
}

// Entity: Wikipedia REST page summary.

interface WikiSummary {
  type?: string;
  title?: string;
  titles?: { canonical?: string; normalized?: string };
  description?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source?: string; width?: number; height?: number };
  originalimage?: { source?: string };
  coordinates?: { lat?: number; lon?: number };
}

async function resolveEntity(node: UiNodeOf<'entity'>, deps: UiLiveDeps): Promise<UiEntityData> {
  const title = node.title.trim();
  const langs =
    node.lang && node.lang !== 'en' ? [node.lang, 'en'] : node.lang ? ['en'] : ['de', 'en'];
  for (const lang of langs) {
    if (!/^[a-z]{2,3}$/.test(lang)) continue;
    const response = await fetchText(
      deps,
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`
    );
    if (response.status === 404) continue;
    checkStatus(response.status, `Kein Wikipedia-Artikel zu „${title}“ gefunden.`);
    if (!/(^|\.)wikipedia\.org$/.test(domain(response.url)))
      throw new UiLiveError('Wikipedia leitete unerwartet weiter.', false);
    let body: WikiSummary;
    try {
      body = JSON.parse(response.text) as WikiSummary;
    } catch {
      throw new UiLiveError('Wikipedia lieferte unlesbare Daten.', true);
    }
    const canonical = str(body.titles?.canonical, 300) ?? str(body.title, 300) ?? title;
    const display =
      plainText(str(body.titles?.normalized, 300) ?? str(body.title, 300) ?? title, 300) || title;
    const page = str(body.content_urls?.desktop?.page, 2000);
    const thumbnail = httpsImage(body.thumbnail?.source);
    const lat = num(body.coordinates?.lat),
      lon = num(body.coordinates?.lon);
    return {
      title: canonical,
      display_title: display,
      description: str(body.description, 300),
      extract: plainText(String(body.extract ?? ''), 1200),
      lang,
      url:
        page && isUiHttpsUrl(page)
          ? page
          : `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(canonical)}`,
      image: thumbnail
        ? {
            src: thumbnail,
            width: num(body.thumbnail?.width),
            height: num(body.thumbnail?.height),
            alt: display,
          }
        : null,
      original_image: httpsImage(body.originalimage?.source),
      kind: body.type === 'disambiguation' ? 'disambiguation' : 'standard',
      coordinates: lat !== null && lon !== null ? { lat, lon } : null,
      source: { name: 'Wikipedia', url: page ?? `https://${lang}.wikipedia.org/` },
    };
  }
  throw new UiLiveError(`Kein Wikipedia-Artikel zu „${title}“ gefunden.`, false);
}

// News and gallery: SearXNG.

async function searx(deps: UiLiveDeps, query: string, category: 'news' | 'images') {
  const base = deps.searxngUrl();
  if (!base) throw new UiLiveError('Die Websuche ist nicht eingerichtet.', false);
  const url = new URL('search', base.endsWith('/') ? base : base + '/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', category);
  const body = await fetchJson<{ results?: Array<Record<string, unknown>> }>(
    deps,
    url.href,
    'Die Suche ist fehlgeschlagen.'
  );
  return Array.isArray(body.results) ? body.results : [];
}
const publicUrl = (value: unknown) => {
  try {
    return publicSourceUrl(String(value)).href;
  } catch {
    return null;
  }
};
function relativeDate(iso: string | null, now: Date) {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const minutes = Math.round((now.getTime() - time) / 60_000);
  if (minutes < 0) return dayText(iso);
  if (minutes < 60) return `vor ${Math.max(1, minutes)} Min.`;
  if (minutes < 24 * 60) return `vor ${Math.round(minutes / 60)} Std.`;
  if (minutes < 48 * 60) return 'gestern';
  return dayText(iso, utcDay(iso).getUTCFullYear() !== now.getUTCFullYear());
}

async function resolveNews(node: UiNodeOf<'news'>, deps: UiLiveDeps): Promise<UiNewsData> {
  const now = deps.now();
  const articles: UiNewsArticle[] = [];
  const seen = new Set<string>();
  for (const item of await searx(deps, node.query, 'news')) {
    const url = publicUrl(item.url);
    if (!url || seen.has(url)) continue;
    const title = plainText(String(item.title ?? ''), 200);
    if (!title) continue;
    seen.add(url);
    const published = publishedDate(item.publishedDate);
    const excerpt = plainText(String(item.content ?? ''), 280);
    articles.push({
      title,
      url,
      source: domain(url),
      published_at: published,
      date_text: relativeDate(published, now),
      excerpt: excerpt || null,
      image: httpsImage(item.thumbnail) ?? httpsImage(item.img_src),
    });
    if (articles.length >= 10) break;
  }
  if (!articles.length) throw new UiLiveError('Keine Nachrichten zu dieser Suche gefunden.', false);
  return {
    query: node.query,
    articles,
    source: { name: 'SearXNG', url: 'https://docs.searxng.org/' },
  };
}

async function resolveGallery(node: UiNodeOf<'gallery'>, deps: UiLiveDeps): Promise<UiGalleryData> {
  const images: UiGalleryImage[] = [];
  const seen = new Set<string>();
  for (const item of await searx(deps, node.query, 'images')) {
    const src = httpsImage(item.img_src);
    const page = publicUrl(item.url);
    if (!src || !page || seen.has(src)) continue;
    seen.add(src);
    const size = /(\d{2,5})\s*[x×]\s*(\d{2,5})/i.exec(String(item.resolution ?? ''));
    images.push({
      src,
      thumbnail: httpsImage(item.thumbnail_src),
      title: plainText(String(item.title ?? ''), 200) || domain(page),
      page_url: page,
      source: domain(page),
      width: size ? Number(size[1]) : null,
      height: size ? Number(size[2]) : null,
    });
    if (images.length >= 12) break;
  }
  if (!images.length) throw new UiLiveError('Keine Bilder zu dieser Suche gefunden.', false);
  return {
    query: node.query,
    images,
    source: { name: 'SearXNG', url: 'https://docs.searxng.org/' },
  };
}

const RESOLVERS: {
  [K in UiLiveNodeType]: (node: UiNodeOf<K>, deps: UiLiveDeps) => Promise<UiLiveDataMap[K]>;
} = {
  weather: resolveWeather,
  currency: resolveCurrency,
  stock: resolveStock,
  entity: resolveEntity,
  news: resolveNews,
  gallery: resolveGallery,
};

/** Cached, de-duplicated resolution of live widgets; deps are injectable for tests. */
export function createUiLiveResolver(overrides: Partial<UiLiveDeps> = {}) {
  const deps: UiLiveDeps = { ...DEFAULT_DEPS, ...overrides };
  const cache = new Map<string, { expires: number; at: number; result: AnyUiResult }>();
  const inflight = new Map<string, Promise<AnyUiResult>>();
  async function resolve(
    node: UiLiveNode,
    options: { force?: boolean } = {}
  ): Promise<AnyUiResult> {
    const key = uiLiveKey(node);
    const started = deps.now().getTime();
    const hit = cache.get(key);
    if (hit && hit.expires > started && !(options.force && started - hit.at > REFRESH_COOLDOWN_MS))
      return hit.result;
    const running = inflight.get(key);
    if (running) return running;
    const task = (async (): Promise<AnyUiResult> => {
      try {
        const data = await (
          RESOLVERS[node.type] as (n: UiLiveNode, d: UiLiveDeps) => Promise<unknown>
        )(node, deps);
        const at = deps.now().getTime();
        const result = {
          type: node.type,
          key,
          status: 'resolved',
          data,
          fetchedAt: new Date(at).toISOString(),
        } as AnyUiResult;
        cache.delete(key);
        cache.set(key, { expires: at + UI_LIVE_TTL_MS[node.type], at, result });
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        return result;
      } catch (error) {
        const live =
          error instanceof UiLiveError
            ? error
            : new UiLiveError('Die Daten konnten nicht geladen werden.', true);
        return {
          type: node.type,
          key,
          status: 'failed',
          error: live.message,
          retryable: live.retryable,
          fetchedAt: deps.now().toISOString(),
        } as AnyUiResult;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, task);
    return task;
  }
  return { resolve, clear: () => cache.clear() };
}
export type UiLiveResolver = ReturnType<typeof createUiLiveResolver>;
export const uiLiveResolver = createUiLiveResolver();

// Turn integration: persistence, socket push and derived pending/failed states.

export interface UiResultStore {
  write(chatId: string, turnId: string, nodeId: string, result: AnyUiResult): Promise<boolean>;
  emit(userId: string, event: UiResultEvent): void;
}
const dbStore: UiResultStore = {
  async write(chatId, turnId, nodeId, result) {
    const updated = await run(
      `UPDATE assistant_api_turns SET ui_results_json=(COALESCE(NULLIF(ui_results_json,''),'{}')::jsonb || jsonb_build_object(?::text, ?::jsonb))::text WHERE id=? AND chat_id=?`,
      nodeId,
      JSON.stringify(result),
      turnId,
      chatId
    );
    return updated.changes > 0;
  },
  emit(userId, event) {
    liveEvents.emit(UI_RESULT_EVENT, userId, event);
  },
};

/** Node IDs being resolved per turn in this process; GET shows them as pending. */
const resolving = new Map<string, Set<string>>();
/** A completed turn without a stored result counts as pending this long. */
const PENDING_GRACE_MS = 60_000;

async function resolveInto(
  target: { userId: string; chatId: string; turnId: string },
  node: UiLiveNode,
  options: { force?: boolean; resolver?: UiLiveResolver; store?: UiResultStore }
) {
  const resolver = options.resolver ?? uiLiveResolver;
  const store = options.store ?? dbStore;
  const ids = resolving.get(target.turnId) ?? new Set<string>();
  resolving.set(target.turnId, ids);
  ids.add(node.id);
  try {
    const result = await resolver.resolve(node, { force: options.force });
    const stored = await store
      .write(target.chatId, target.turnId, node.id, result)
      .catch(() => false);
    if (stored)
      store.emit(target.userId, {
        chatId: target.chatId,
        turnId: target.turnId,
        id: node.id,
        result,
      });
    return result;
  } finally {
    ids.delete(node.id);
    if (!ids.size) resolving.delete(target.turnId);
  }
}

/**
 * Resolves every live widget of a turn's finished view in the background:
 * pushes `pending` right away, then each result as it arrives.
 */
export function startTurnUiResolution(
  target: { userId: string; chatId: string; turnId: string },
  spec: DynamicUiSpec | null,
  options: { resolver?: UiLiveResolver; store?: UiResultStore } = {}
): Promise<AnyUiResult[]> {
  const nodes = collectUiLiveNodes(spec);
  const store = options.store ?? dbStore;
  for (const node of nodes)
    store.emit(target.userId, {
      chatId: target.chatId,
      turnId: target.turnId,
      id: node.id,
      result: { type: node.type, key: uiLiveKey(node), status: 'pending' } as AnyUiResult,
    });
  return Promise.all(nodes.map((node) => resolveInto(target, node, options)));
}

/** „Erneut versuchen“: refetch one widget (cache bypassed after a 30 s cooldown). */
export function refreshTurnUiNode(
  target: { userId: string; chatId: string; turnId: string },
  node: UiLiveNode,
  options: { resolver?: UiLiveResolver; store?: UiResultStore } = {}
) {
  return resolveInto(target, node, { ...options, force: true });
}

/**
 * The `uiResults` a turn delivers: stored results whose parameters still match
 * the node; otherwise `pending` while the turn runs, resolution is in flight or
 * the turn just finished, else `failed` with retry.
 */
export function turnUiResults(
  spec: DynamicUiSpec | null,
  stored: unknown,
  turn: { id: string; status: string; updatedAt: string },
  now = Date.now()
): UiResults {
  const out: UiResults = {};
  const saved = (stored && typeof stored === 'object' ? stored : {}) as Record<string, AnyUiResult>;
  const busy = resolving.get(turn.id);
  for (const node of collectUiLiveNodes(spec)) {
    const key = uiLiveKey(node);
    const result = Object.hasOwn(saved, node.id) ? saved[node.id] : undefined;
    if (
      result &&
      result.key === key &&
      result.type === node.type &&
      result.status !== 'pending' &&
      !busy?.has(node.id)
    ) {
      out[node.id] = result;
      continue;
    }
    const pending =
      turn.status === 'running' ||
      busy?.has(node.id) ||
      now - Date.parse(turn.updatedAt) < PENDING_GRACE_MS;
    out[node.id] = (
      pending
        ? { type: node.type, key, status: 'pending' }
        : {
            type: node.type,
            key,
            status: 'failed',
            error: 'Die Daten wurden nicht geladen.',
            retryable: true,
          }
    ) as AnyUiResult;
  }
  return out;
}

/** Whether the answer's ```plum-ui block has its closing fence. */
export function dynamicUiBlockComplete(text: string): boolean {
  const start = text.indexOf('```plum-ui');
  if (start < 0) return false;
  const body = text.indexOf('\n', start);
  return body >= 0 && text.indexOf('\n```', body) >= 0;
}
