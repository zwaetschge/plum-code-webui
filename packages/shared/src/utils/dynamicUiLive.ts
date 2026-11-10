/**
 * Live widgets of Dynamic UI v2: the model only names a widget and its
 * parameters (`{"type":"weather","id":"w1","location":"Zürich"}`); the server
 * fetches the data and stores one envelope per widget ID with the turn
 * (`turn.uiResults[id]`). Clients render placeholders at final size until a
 * result arrives, by GET turns or the `assistant:ui-result` socket event.
 *
 * Data payloads use snake_case. Fields ending in `_text` are pre-formatted for
 * de-CH; `_tone` fields colour changes. Raw numbers stay alongside for charts.
 * External images are always loaded through uiImageProxyUrl().
 */
import type { UiLiveNode, UiStockRange } from './dynamicUi.js';
import type { UiLiveNodeType } from './dynamicUiCatalog.js';

export type UiResultStatus = 'pending' | 'resolved' | 'failed';
/** positive = up/green, negative = down/red. */
export type UiChangeTone = 'positive' | 'negative' | 'neutral';

/** Attribution shown under a widget. */
export interface UiLiveSource {
  name: string;
  url: string;
}

// Weather (Open-Meteo)

export type UiWeatherIcon =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy-rain'
  | 'freezing-rain'
  | 'showers'
  | 'snow'
  | 'heavy-snow'
  | 'snow-showers'
  | 'thunderstorm'
  | 'hail';
export const UI_WEATHER_ICONS: readonly UiWeatherIcon[] = [
  'clear-day',
  'clear-night',
  'partly-cloudy-day',
  'partly-cloudy-night',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'heavy-rain',
  'freezing-rain',
  'showers',
  'snow',
  'heavy-snow',
  'snow-showers',
  'thunderstorm',
  'hail',
];

export interface UiWeatherLocation {
  name: string;
  /** State/canton, e.g. "Kanton Zürich". */
  region: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, e.g. "CH". */
  country_code: string | null;
  latitude: number;
  longitude: number;
  /** IANA zone; all times below are local wall-clock times in this zone. */
  timezone: string;
  /** "Zürich, Schweiz". */
  label: string;
}
export interface UiWeatherCurrent {
  /** Local time "2026-11-07T14:15". */
  time: string;
  temperature_c: number;
  feels_like_c: number;
  /** Relative humidity in %. */
  humidity: number;
  wind_kmh: number;
  wind_direction_deg: number | null;
  /** 8-point compass in German: N, NO, O, SO, S, SW, W, NW. */
  wind_direction_text: string | null;
  precipitation_mm: number;
  /** WMO code; see uiWeatherCode(). */
  weather_code: number;
  description: string;
  icon: UiWeatherIcon;
  is_day: boolean;
  /** "8 °C" */
  temperature_text: string;
  /** "Gefühlt 7 °C" */
  feels_like_text: string;
  /** "12 km/h SW" */
  wind_text: string;
  /** "95 %" */
  humidity_text: string;
}
export interface UiWeatherHour {
  /** Local time "2026-11-07T15:00". */
  time: string;
  /** "Jetzt" for the first entry, then "15 Uhr". */
  label: string;
  temperature_c: number;
  /** Probability of precipitation in % (null when the model has none). */
  precip_chance: number | null;
  precipitation_mm: number;
  weather_code: number;
  description: string;
  icon: UiWeatherIcon;
  is_day: boolean;
}
export interface UiWeatherDay {
  /** "2026-11-07" */
  date: string;
  /** "Heute", "Morgen", then the short weekday "Mo". */
  label: string;
  /** "Samstag" */
  weekday: string;
  /** "7. Nov." */
  date_text: string;
  high_c: number;
  low_c: number;
  precip_chance: number | null;
  precipitation_mm: number;
  weather_code: number;
  description: string;
  /** Day variant. */
  icon: UiWeatherIcon;
  /** Local "07:21". */
  sunrise: string | null;
  sunset: string | null;
}
export interface UiWeatherData {
  location: UiWeatherLocation;
  current: UiWeatherCurrent;
  /** 24 entries starting with the current hour. */
  hourly: UiWeatherHour[];
  /** `days` entries (1–10, default 7) starting today. */
  daily: UiWeatherDay[];
  units: { temperature: '°C'; wind: 'km/h'; precipitation: 'mm' };
  source: UiLiveSource;
}

// Currency (Frankfurter, ECB reference rates)

export interface UiCurrencyPoint {
  /** "2026-11-06" (ECB business days). */
  date: string;
  /** Units of `to` per one `from`. */
  rate: number;
}
export interface UiCurrencyData {
  from: string;
  to: string;
  /** "Euro" */
  from_name: string | null;
  /** "Schweizer Franken" */
  to_name: string | null;
  /** Requested amount (default 1). */
  amount: number;
  rate: number;
  inverse_rate: number;
  /** amount × rate */
  converted: number;
  /** ECB reference date "2026-11-06". */
  date: string;
  /** "€ 100.00" */
  amount_text: string;
  /** "CHF 91.43" */
  converted_text: string;
  /** "1 EUR = 0.9143 CHF" */
  rate_text: string;
  /** "1 CHF = 1.0937 EUR" */
  inverse_rate_text: string;
  /** "Referenzkurs der EZB vom 6. Nov. 2026" */
  date_text: string;
  /** Change of the rate over `series` in %, null without history. */
  change_percent: number | null;
  /** "−2.0 % in 30 Tagen" */
  change_text: string;
  change_tone: UiChangeTone;
  /** About 30 calendar days, oldest first. */
  series: UiCurrencyPoint[];
  source: UiLiveSource;
}

// Stock (Stooq daily CSV; Yahoo chart API as fallback when Stooq is blocked)

export interface UiStockPoint {
  /** Trading day "2026-11-06". */
  date: string;
  close: number;
}
export interface UiStockRangeData {
  /** Oldest first; 5Y is thinned to weekly closes. */
  points: UiStockPoint[];
  start: number | null;
  end: number | null;
  change: number | null;
  change_percent: number | null;
  /** "+1.23 (+1.5 %)" */
  change_text: string;
  change_tone: UiChangeTone;
  high: number | null;
  low: number | null;
}
export interface UiStockMetric {
  key: 'open' | 'high' | 'low' | 'previous_close' | 'volume' | 'year_high' | 'year_low';
  /** "Eröffnung", "Tageshoch", "Tagestief", "Vortag", "Volumen", "52W-Hoch", "52W-Tief" */
  label: string;
  value: number | null;
  value_text: string;
}
export interface UiStockData {
  /** As requested, upper case: "NESN.SW". */
  symbol: string;
  name: string | null;
  exchange: string | null;
  /** ISO code; "GBX" means pence. */
  currency: string | null;
  price: number;
  /** "CHF 85.85" */
  price_text: string;
  previous_close: number | null;
  /** Against the previous close. */
  change: number | null;
  change_percent: number | null;
  /** "−1.38 (−1.6 %)" */
  change_text: string;
  change_tone: UiChangeTone;
  trade_date: string;
  /** "Schlusskurs vom 6. Nov. 2026" or "Stand 6. Nov. 2026" */
  trade_date_text: string;
  metrics: UiStockMetric[];
  ranges: Record<UiStockRange, UiStockRangeData>;
  /** The node's `range`, default 1M. */
  default_range: UiStockRange;
  source: UiLiveSource;
}

// Entity (Wikipedia REST page summary)

export interface UiEntityData {
  /** Canonical title "Ada_Lovelace" (use for links/refresh). */
  title: string;
  /** "Ada Lovelace" */
  display_title: string;
  /** Short description "britische Mathematikerin". */
  description: string | null;
  /** Plain-text lead, at most 1200 characters. */
  extract: string;
  lang: string;
  /** Article URL. */
  url: string;
  /** Thumbnail (~330 px); proxy it. */
  image: { src: string; width: number | null; height: number | null; alt: string } | null;
  /** Full-size image for the lightbox. */
  original_image: string | null;
  kind: 'standard' | 'disambiguation';
  coordinates: { lat: number; lon: number } | null;
  source: UiLiveSource;
}

// News and gallery (SearXNG)

export interface UiNewsArticle {
  title: string;
  url: string;
  /** Publisher domain "srf.ch". */
  source: string;
  published_at: string | null;
  /** "vor 3 Std.", "gestern", "6. Nov." */
  date_text: string | null;
  excerpt: string | null;
  /** Preview image (https); proxy it. */
  image: string | null;
}
export interface UiNewsData {
  query: string;
  /** 1–10 articles, newest first when dated. */
  articles: UiNewsArticle[];
  source: UiLiveSource;
}
export interface UiGalleryImage {
  /** Full image (https); proxy it. */
  src: string;
  /** Smaller preview (https) when the engine has one; proxy it. */
  thumbnail: string | null;
  title: string;
  /** Page that shows the image. */
  page_url: string;
  /** Domain of page_url. */
  source: string;
  width: number | null;
  height: number | null;
}
export interface UiGalleryData {
  query: string;
  /** 1–12 images. */
  images: UiGalleryImage[];
  source: UiLiveSource;
}

export interface UiLiveDataMap {
  weather: UiWeatherData;
  currency: UiCurrencyData;
  stock: UiStockData;
  entity: UiEntityData;
  news: UiNewsData;
  gallery: UiGalleryData;
}

/**
 * Result envelope of one live widget (`turn.uiResults[nodeId]`).
 * - pending: placeholder at final size.
 * - resolved: `data` is set.
 * - failed: quiet local fallback; offer „Erneut versuchen“ when `retryable`
 *   (POST uiResultRefreshPath()).
 */
export interface UiResult<T extends UiLiveNodeType = UiLiveNodeType> {
  type: T;
  /** uiLiveKey(node) it was fetched for; show it only while the node still matches. */
  key: string;
  status: UiResultStatus;
  data?: UiLiveDataMap[T];
  /** German, user-facing. */
  error?: string;
  retryable?: boolean;
  /** ISO timestamp of the fetch. */
  fetchedAt?: string;
}
/** Discriminated by `type`: narrowing on it types `data`. */
export type AnyUiResult = { [K in UiLiveNodeType]: UiResult<K> }[UiLiveNodeType];
/** `turn.uiResults`: node ID → envelope. */
export type UiResults = Record<string, AnyUiResult>;

/** Socket.IO event to the owner's `user:<id>` room when a widget result changes. */
export const UI_RESULT_EVENT = 'assistant:ui-result';
export interface UiResultEvent {
  chatId: string;
  turnId: string;
  /** Node ID. */
  id: string;
  result: AnyUiResult;
}

/** Server cache lifetimes per widget. */
export const UI_LIVE_TTL_MS: Record<UiLiveNodeType, number> = {
  weather: 10 * 60_000,
  currency: 60 * 60_000,
  stock: 15 * 60_000,
  entity: 24 * 60 * 60_000,
  news: 30 * 60_000,
  gallery: 24 * 60 * 60_000,
};
/** Upstream timeout per request. */
export const UI_LIVE_TIMEOUT_MS = 8000;

export const UI_IMAGE_PROXY_PATH = '/api/assistant/ui/image';
export const UI_ENTITY_PATH = '/api/assistant/ui/entity';
/** Same-origin URL of an external image (https only, ≤ 8 MB, cached 24 h). */
export function uiImageProxyUrl(src: string): string {
  return `${UI_IMAGE_PROXY_PATH}?url=${encodeURIComponent(src)}`;
}
/** GET → `{success, data: UiResult<'entity'>}` for inline `entity:` links and openEntity. */
export function uiEntityPath(title: string, lang?: string): string {
  return `${UI_ENTITY_PATH}?title=${encodeURIComponent(title)}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`;
}
/** POST (no body) → `{success, data: AnyUiResult}`; also pushes `assistant:ui-result`. */
export function uiResultRefreshPath(chatId: string, turnId: string, nodeId: string): string {
  return `/api/assistant/chats/${encodeURIComponent(chatId)}/turns/${encodeURIComponent(turnId)}/ui/${encodeURIComponent(nodeId)}/refresh`;
}
/** `entity:Albert_Einstein` link targets in answer Markdown → article title. */
export function parseUiEntityHref(href: string): string | null {
  if (!href.startsWith('entity:')) return null;
  const title = decodeURIComponentSafe(href.slice(7)).replace(/_/g, ' ').trim();
  return title && title.length <= 200 ? title : null;
}
function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const norm = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
/** Identity of a live widget's parameters; a stored result applies while keys match. */
export function uiLiveKey(node: UiLiveNode): string {
  switch (node.type) {
    case 'weather':
      return `weather:${norm(node.location)}:${node.days ?? 7}`;
    case 'currency':
      return `currency:${node.from}:${node.to}:${node.amount ?? 1}`;
    case 'stock':
      return `stock:${node.symbol.toUpperCase()}:${node.range ?? '1M'}`;
    case 'entity':
      return `entity:${node.lang ?? 'de'}:${norm(node.title).replace(/ /g, '_')}`;
    case 'news':
    case 'gallery':
      return `${node.type}:${norm(node.query)}`;
  }
}

// Formatting shared by the server (pre-formatted fields) and clients (hover values).

const LOCALE = 'de-CH';
const MINUS = '−';
/** positive above +epsilon, negative below −epsilon. */
export function uiChangeTone(value: number | null | undefined): UiChangeTone {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 1e-9)
    return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}
/** de-CH number with fixed decimals; negative values use a true minus sign. */
export function formatUiNumber(value: number, digits = 2, signed = false): string {
  const text = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  const zero = Number(Math.abs(value).toFixed(digits)) === 0;
  if (value < 0 && !zero) return MINUS + text;
  return signed && !zero ? '+' + text : text;
}
/** "CHF 85.85"; small prices keep four decimals. Unknown codes fall back to "85.85 XYZ". */
export function formatUiPrice(value: number, currency: string | null, digits?: number): string {
  const fraction = digits ?? (Math.abs(value) < 1 ? 4 : 2);
  if (!currency) return formatUiNumber(value, fraction);
  if (currency === 'GBX') return `${formatUiNumber(value, fraction)} p`;
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    })
      .format(value)
      .replace('-', MINUS);
  } catch {
    return `${formatUiNumber(value, fraction)} ${currency}`;
  }
}
/** "+1.5 %" */
export function formatUiPercentChange(percent: number, digits = 1): string {
  return `${formatUiNumber(percent, digits, true)} %`;
}
/** "+1.23 (+1.5 %)"; "–" without values. */
export function formatUiChange(change: number | null, percent: number | null): string {
  if (change === null || !Number.isFinite(change)) return '–';
  const absolute = formatUiNumber(change, Math.abs(change) < 1 ? 4 : 2, true);
  return percent === null || !Number.isFinite(percent)
    ? absolute
    : `${absolute} (${formatUiPercentChange(percent)})`;
}
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}
/** "8 °C" / "46 °F", rounded; `bare` gives "8°". */
export function formatUiTemperature(celsius: number, unit: 'c' | 'f' = 'c', bare = false): string {
  const value = Math.round(unit === 'f' ? celsiusToFahrenheit(celsius) : celsius);
  const text = (value < 0 ? MINUS : '') + Math.abs(value);
  return bare ? `${text}°` : `${text} °${unit === 'f' ? 'F' : 'C'}`;
}

const WMO: Record<number, [string, UiWeatherIcon | 'clear' | 'partly-cloudy']> = {
  0: ['Klar', 'clear'],
  1: ['Überwiegend klar', 'partly-cloudy'],
  2: ['Teilweise bewölkt', 'partly-cloudy'],
  3: ['Bedeckt', 'cloudy'],
  45: ['Nebel', 'fog'],
  48: ['Gefrierender Nebel', 'fog'],
  51: ['Leichter Nieselregen', 'drizzle'],
  53: ['Nieselregen', 'drizzle'],
  55: ['Starker Nieselregen', 'drizzle'],
  56: ['Leichter gefrierender Nieselregen', 'freezing-rain'],
  57: ['Gefrierender Nieselregen', 'freezing-rain'],
  61: ['Leichter Regen', 'rain'],
  63: ['Regen', 'rain'],
  65: ['Starker Regen', 'heavy-rain'],
  66: ['Leichter gefrierender Regen', 'freezing-rain'],
  67: ['Gefrierender Regen', 'freezing-rain'],
  71: ['Leichter Schneefall', 'snow'],
  73: ['Schneefall', 'snow'],
  75: ['Starker Schneefall', 'heavy-snow'],
  77: ['Schneegriesel', 'snow'],
  80: ['Leichte Regenschauer', 'showers'],
  81: ['Regenschauer', 'showers'],
  82: ['Heftige Regenschauer', 'heavy-rain'],
  85: ['Leichte Schneeschauer', 'snow-showers'],
  86: ['Schneeschauer', 'snow-showers'],
  95: ['Gewitter', 'thunderstorm'],
  96: ['Gewitter mit Hagel', 'hail'],
  99: ['Schweres Gewitter mit Hagel', 'hail'],
};
/** WMO weather code → German description and icon key (day/night aware). */
export function uiWeatherCode(
  code: number,
  isDay = true
): { description: string; icon: UiWeatherIcon } {
  const [description, icon] = WMO[code] ?? ['Unbekannt', 'cloudy'];
  if (icon === 'clear' || icon === 'partly-cloudy')
    return { description, icon: `${icon}-${isDay ? 'day' : 'night'}` };
  return { description, icon };
}
