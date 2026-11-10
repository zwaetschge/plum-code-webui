/**
 * Dynamic UI v2 fixtures for /chat/ui-demo and tests: one spec per area plus
 * realistic live results (resolved, pending, failed). Pure data: importable
 * from Node scripts like fixtures.ts. All live numbers here are made up.
 */
import {
  formatUiChange,
  formatUiNumber,
  formatUiPercentChange,
  formatUiPrice,
  formatUiTemperature,
  uiChangeTone,
  uiLiveKey,
  uiWeatherCode,
  uiWidgetLiveId,
  type AnyUiResult,
  type DynamicUiSpec,
  type UiCurrencyData,
  type UiEntityData,
  type UiGalleryData,
  type UiLiveNode,
  type UiNewsData,
  type UiResult,
  type UiStockData,
  type UiStockPoint,
  type UiStockRange,
  type UiStockRangeData,
  type UiWeatherData,
  type UiWeatherDay,
  type UiWeatherHour,
} from '@plum-code-webui/shared';
import { WIDGET_LOAN, WIDGET_MEMORY, WIDGET_POMODORO, WIDGET_RAIN_DICE } from './fixtures-widgets';

const FETCHED = '2026-11-07T14:12:00.000Z';
const img = (name: string) => `https://images.example.org/${name}.jpg`;

/** Deterministic pseudo-random numbers for the series. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (value: number) => String(value).padStart(2, '0');
const isoDay = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
/** Business days ending at `last` (inclusive), oldest first. */
function businessDays(last: string, count: number) {
  const out: string[] = [];
  const date = new Date(`${last}T12:00:00Z`);
  while (out.length < count) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) out.unshift(isoDay(date));
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return out;
}

// Weather (Zürich)

function weatherData(): UiWeatherData {
  const hourCodes = [3, 3, 3, 61, 61, 63, 61, 3, 2, 2, 1, 1, 0, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3];
  const hourly: UiWeatherHour[] = hourCodes.map((code, index) => {
    const hour = (14 + index) % 24;
    const day = 7 + Math.floor((14 + index) / 24);
    const isDay = hour >= 7 && hour < 17;
    const temperature = 6 + 3.4 * Math.sin(((hour - 8) / 24) * 2 * Math.PI) - index * 0.06;
    const chance = [
      10, 15, 30, 65, 80, 85, 60, 35, 20, 10, 5, 5, 0, 0, 0, 5, 5, 10, 10, 15, 20, 15, 10, 15,
    ][index]!;
    const { description, icon } = uiWeatherCode(code, isDay);
    return {
      time: `2026-11-${pad(day)}T${pad(hour)}:00`,
      label: index === 0 ? 'Jetzt' : `${hour} Uhr`,
      temperature_c: Math.round(temperature * 10) / 10,
      precip_chance: chance,
      precipitation_mm: chance > 50 ? 0.6 : 0,
      weather_code: code,
      description,
      icon,
      is_day: isDay,
    };
  });
  const days: Array<[string, string, string, number, number, number, number]> = [
    ['Heute', 'Samstag', '7. Nov.', 10, 4, 3, 70],
    ['Morgen', 'Sonntag', '8. Nov.', 8, 5, 61, 80],
    ['Mo', 'Montag', '9. Nov.', 9, 3, 80, 55],
    ['Di', 'Dienstag', '10. Nov.', 11, 2, 2, 10],
    ['Mi', 'Mittwoch', '11. Nov.', 12, 4, 0, 0],
    ['Do', 'Donnerstag', '12. Nov.', 4, -1, 71, 60],
    ['Fr', 'Freitag', '13. Nov.', 6, 1, 45, 20],
  ];
  const daily: UiWeatherDay[] = days.map(
    ([label, weekday, dateText, high, low, code, chance], index) => {
      const { description, icon } = uiWeatherCode(code, true);
      return {
        date: `2026-11-${pad(7 + index)}`,
        label,
        weekday,
        date_text: dateText,
        high_c: high,
        low_c: low,
        precip_chance: chance,
        precipitation_mm: chance > 50 ? 4.2 : 0.2,
        weather_code: code,
        description,
        icon,
        sunrise: `07:${pad(21 + index)}`,
        sunset: `17:${pad(4 - Math.min(index, 3))}`,
      };
    }
  );
  const now = uiWeatherCode(3, true);
  return {
    location: {
      name: 'Zürich',
      region: 'Kanton Zürich',
      country: 'Schweiz',
      country_code: 'CH',
      latitude: 47.37,
      longitude: 8.55,
      timezone: 'Europe/Zurich',
      label: 'Zürich, Schweiz',
    },
    current: {
      time: '2026-11-07T14:15',
      temperature_c: 8.2,
      feels_like_c: 6.1,
      humidity: 87,
      wind_kmh: 12,
      wind_direction_deg: 225,
      wind_direction_text: 'SW',
      precipitation_mm: 0,
      weather_code: 3,
      description: now.description,
      icon: now.icon,
      is_day: true,
      temperature_text: formatUiTemperature(8.2),
      feels_like_text: `Gefühlt ${formatUiTemperature(6.1)}`,
      wind_text: '12 km/h SW',
      humidity_text: '87 %',
    },
    hourly,
    daily,
    units: { temperature: '°C', wind: 'km/h', precipitation: 'mm' },
    source: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
  };
}

// Stock (Nestlé)

interface StockOptions {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  seed: number;
}
const NESTLE: StockOptions = {
  symbol: 'NESN.SW',
  name: 'Nestlé S.A.',
  exchange: 'SIX Swiss Exchange',
  currency: 'CHF',
  price: 85.85,
  seed: 7,
};
function stockData(options: StockOptions = NESTLE): UiStockData {
  const { price, currency } = options;
  const next = random(options.seed);
  const all = businessDays('2026-11-06', 1260);
  let value = 100;
  const raw = all.map(() => {
    value *= 1 + (next() - 0.505) * 0.024;
    return value;
  });
  const scale = price / raw.at(-1)!;
  const closes: UiStockPoint[] = all.map((date, index) => ({
    date,
    close: Math.round(raw[index]! * scale * 100) / 100,
  }));
  const pick = (range: UiStockRange) =>
    range === '1M'
      ? closes.slice(-22)
      : range === '6M'
        ? closes.slice(-126)
        : range === '1Y'
          ? closes.slice(-252)
          : closes.filter((_, index) => index % 5 === 4 || index === closes.length - 1);
  const ranges = {} as Record<UiStockRange, UiStockRangeData>;
  for (const range of ['1M', '6M', '1Y', '5Y'] as const) {
    const points = pick(range);
    const start = points[0]!.close;
    const end = points.at(-1)!.close;
    const change = Math.round((end - start) * 100) / 100;
    const percent = (change / start) * 100;
    ranges[range] = {
      points,
      start,
      end,
      change,
      change_percent: percent,
      change_text: formatUiChange(change, percent),
      change_tone: uiChangeTone(change),
      high: Math.max(...points.map((point) => point.close)),
      low: Math.min(...points.map((point) => point.close)),
    };
  }
  const previous = closes.at(-2)!.close;
  const change = Math.round((price - previous) * 100) / 100;
  const year = ranges['1Y'];
  const metric = (key: UiStockData['metrics'][number]['key'], label: string, value: number) => ({
    key,
    label,
    value,
    value_text: key === 'volume' ? '2,4 Mio.' : formatUiPrice(value, currency),
  });
  return {
    symbol: options.symbol,
    name: options.name,
    exchange: options.exchange,
    currency,
    price,
    price_text: formatUiPrice(price, currency),
    previous_close: previous,
    change,
    change_percent: (change / previous) * 100,
    change_text: formatUiChange(change, (change / previous) * 100),
    change_tone: uiChangeTone(change),
    trade_date: '2026-11-06',
    trade_date_text: 'Schlusskurs vom 6. Nov. 2026',
    metrics: [
      metric('open', 'Eröffnung', Math.round(price * 1.0064 * 100) / 100),
      metric('high', 'Tageshoch', Math.round(price * 1.0101 * 100) / 100),
      metric('low', 'Tagestief', Math.round(price * 0.996 * 100) / 100),
      metric('previous_close', 'Vortag', previous),
      metric('volume', 'Volumen', 2_412_000),
      metric('year_high', '52W-Hoch', year.high!),
      metric('year_low', '52W-Tief', year.low!),
    ],
    ranges,
    default_range: '1M',
    source: { name: 'Stooq', url: 'https://stooq.com/' },
  };
}

// Currency (EUR → CHF)

function currencyData(): UiCurrencyData {
  const next = random(11);
  const days = businessDays('2026-11-06', 22);
  let rate = 0.9322;
  const series = days.map((date) => {
    rate += (next() - 0.56) * 0.0032;
    return { date, rate: Math.round(rate * 10000) / 10000 };
  });
  const last = 0.9143;
  const shift = last - series.at(-1)!.rate;
  for (const point of series) point.rate = Math.round((point.rate + shift) * 10000) / 10000;
  const percent = ((last - series[0]!.rate) / series[0]!.rate) * 100;
  return {
    from: 'EUR',
    to: 'CHF',
    from_name: 'Euro',
    to_name: 'Schweizer Franken',
    amount: 100,
    rate: last,
    inverse_rate: 1 / last,
    converted: 91.43,
    date: '2026-11-06',
    amount_text: formatUiPrice(100, 'EUR'),
    converted_text: formatUiPrice(91.43, 'CHF'),
    rate_text: `1 EUR = ${formatUiNumber(last, 4)} CHF`,
    inverse_rate_text: `1 CHF = ${formatUiNumber(1 / last, 4)} EUR`,
    date_text: 'Referenzkurs der EZB vom 6. Nov. 2026',
    change_percent: percent,
    change_text: `${formatUiPercentChange(percent)} in 30 Tagen`,
    change_tone: uiChangeTone(percent),
    series,
    source: { name: 'Frankfurter (EZB)', url: 'https://www.frankfurter.app/' },
  };
}

// Entities (texts written for the demo)

const wiki = (title: string) => `https://de.wikipedia.org/wiki/${encodeURIComponent(title)}`;
export const DEMO_ENTITIES: Record<string, UiEntityData> = {
  'Ada Lovelace': {
    title: 'Ada_Lovelace',
    display_title: 'Ada Lovelace',
    description: 'britische Mathematikerin (1815–1852)',
    extract:
      'Augusta Ada King, Countess of Lovelace, war eine britische Mathematikerin und gilt als erste Programmiererin. In ihren Anmerkungen zu Charles Babbages Analytical Engine beschrieb sie 1843 einen Algorithmus zur Berechnung der Bernoulli-Zahlen. Sie erkannte früh, dass solche Maschinen nicht nur rechnen, sondern beliebige Symbole verarbeiten könnten – etwa Musik. Die Programmiersprache Ada trägt ihren Namen.',
    lang: 'de',
    url: wiki('Ada_Lovelace'),
    image: { src: img('portrait-ada'), width: 320, height: 400, alt: 'Porträt von Ada Lovelace' },
    original_image: img('portrait-ada-large'),
    kind: 'standard',
    coordinates: null,
    source: { name: 'Wikipedia', url: wiki('Ada_Lovelace') },
  },
  'Charles Babbage': {
    title: 'Charles_Babbage',
    display_title: 'Charles Babbage',
    description: 'englischer Mathematiker und Erfinder (1791–1871)',
    extract:
      'Charles Babbage war ein englischer Mathematiker, Philosoph und Erfinder. Er entwarf die Difference Engine und die Analytical Engine, einen mechanischen Universalrechner, der als Vorläufer des modernen Computers gilt.',
    lang: 'de',
    url: wiki('Charles_Babbage'),
    image: {
      src: img('portrait-babbage'),
      width: 320,
      height: 400,
      alt: 'Porträt von Charles Babbage',
    },
    original_image: null,
    kind: 'standard',
    coordinates: null,
    source: { name: 'Wikipedia', url: wiki('Charles_Babbage') },
  },
  'Analytical Engine': {
    title: 'Analytical_Engine',
    display_title: 'Analytical Engine',
    description: 'mechanischer Universalrechner',
    extract:
      'Die Analytical Engine ist ein ab 1834 von Charles Babbage entworfener mechanischer Rechner. Sie besass bereits Rechenwerk, Speicher und eine Steuerung über Lochkarten, wurde zu seinen Lebzeiten aber nie vollständig gebaut.',
    lang: 'de',
    url: wiki('Analytical_Engine'),
    image: {
      src: img('machine-engine'),
      width: 400,
      height: 300,
      alt: 'Teil der Analytical Engine',
    },
    original_image: null,
    kind: 'standard',
    coordinates: null,
    source: { name: 'Wikipedia', url: wiki('Analytical_Engine') },
  },
  Zinseszins: {
    title: 'Zinseszins',
    display_title: 'Zinseszins',
    description: 'Verzinsung bereits gutgeschriebener Zinsen',
    extract:
      'Als Zinseszins bezeichnet man Zinsen, die auf bereits gutgeschriebene Zinsen anfallen. Werden Zinsen nicht ausbezahlt, sondern dem Kapital zugeschlagen, wächst es exponentiell. Die Endkapitalformel lautet Kₙ = K₀ · (1 + p/100)ⁿ.',
    lang: 'de',
    url: wiki('Zinseszins'),
    image: null,
    original_image: null,
    kind: 'standard',
    coordinates: null,
    source: { name: 'Wikipedia', url: wiki('Zinseszins') },
  },
};

function newsData(): UiNewsData {
  const article = (
    title: string,
    source: string,
    date: string,
    image: string | null,
    excerpt: string
  ) => ({
    title,
    url: `https://www.${source}/beispiel/${title
      .toLowerCase()
      .replace(/[^a-z]+/g, '-')
      .slice(0, 40)}`,
    source,
    published_at: null,
    date_text: date,
    excerpt,
    image: image ? img(image) : null,
  });
  return {
    query: 'ETH Zürich',
    articles: [
      article(
        'Roboterhand der ETH ertastet Gegenstände wie ein Mensch',
        'srf.ch',
        'vor 2 Std.',
        'news-robot',
        'Ein Team zeigt eine Hand mit feinen Drucksensoren in jeder Fingerkuppe.'
      ),
      article(
        'Supercomputer «Alps» läuft jetzt mit voller Leistung',
        'nzz.ch',
        'vor 5 Std.',
        'news-alps',
        'Das Rechenzentrum in Lugano öffnet die Anlage für weitere Forschungsgruppen.'
      ),
      article(
        'Studierende bauen ein Solarboot für den Genfersee',
        'tagesanzeiger.ch',
        'gestern',
        null,
        'Im Sommer soll das Boot den See einmal ohne Ladestopp überqueren.'
      ),
      article(
        'Gletscherdaten aus den Alpen schärfen Klimamodelle',
        'watson.ch',
        '5. Nov.',
        'news-glacier',
        'Neue Messreihen zeigen, wie schnell das Eis in heissen Sommern schwindet.'
      ),
      article(
        'ETH-Spin-off sammelt 40 Millionen Franken ein',
        'handelszeitung.ch',
        '4. Nov.',
        'news-startup',
        'Das Geld soll in die Serienfertigung von Batteriespeichern fliessen.'
      ),
    ],
    source: { name: 'SearXNG', url: 'https://docs.searxng.org/' },
  };
}

function galleryData(): UiGalleryData {
  const images: Array<[string, string]> = [
    ['Matterhorn im Morgenlicht', 'commons.wikimedia.org'],
    ['Spiegelung im Riffelsee', 'myswitzerland.com'],
    ['Zermatt im Winter', 'zermatt.ch'],
    ['Aufstieg zur Hörnlihütte', 'sac-cas.ch'],
    ['Gornergrat-Bahn vor dem Matterhorn', 'gornergrat.ch'],
    ['Stellisee bei Sonnenaufgang', 'unsplash.com'],
    ['Nordwand im Abendrot', 'commons.wikimedia.org'],
  ];
  return {
    query: 'Matterhorn',
    images: images.map(([title, source], index) => ({
      src: img(`landscape-matterhorn-${index}`),
      thumbnail: img(`landscape-matterhorn-${index}-thumb`),
      title,
      page_url: `https://${source}/beispiel/${index}`,
      source,
      width: 1600,
      height: 1067,
    })),
    source: { name: 'SearXNG', url: 'https://docs.searxng.org/' },
  };
}

const resolved = <T extends UiLiveNode['type']>(
  node: UiLiveNode & { type: T },
  data: UiResult<T>['data']
) =>
  ({
    type: node.type,
    key: uiLiveKey(node),
    status: 'resolved',
    data,
    fetchedAt: FETCHED,
  }) as AnyUiResult;

/** Builds `uiResults` for a set of live nodes from per-node outcomes. */
function results(entries: Array<[UiLiveNode, AnyUiResult | null]>) {
  const out: Record<string, AnyUiResult> = {};
  for (const [node, result] of entries) if (result) out[node.id] = result;
  return out;
}

// Live widget nodes

const WEATHER = { type: 'weather', id: 'wetter', location: 'Zürich' } as const;
const STOCK = { type: 'stock', id: 'nestle', symbol: 'NESN.SW' } as const;
const CURRENCY = { type: 'currency', id: 'eurchf', from: 'EUR', to: 'CHF', amount: 100 } as const;
const ENTITY = { type: 'entity', id: 'ada', title: 'Ada Lovelace' } as const;
const NEWS = { type: 'news', id: 'eth', query: 'ETH Zürich' } as const;
const GALLERY = { type: 'gallery', id: 'matterhorn', query: 'Matterhorn' } as const;
const PENDING_WEATHER = { type: 'weather', id: 'bern', location: 'Bern', days: 5 } as const;
const FAILED_STOCK = { type: 'stock', id: 'apple', symbol: 'AAPL' } as const;
const PENDING_NEWS = { type: 'news', id: 'leer', query: 'Velorouten Graubünden' } as const;

export const LIVE_DATA = {
  weather: weatherData,
  stock: stockData,
  currency: currencyData,
  news: newsData,
  gallery: galleryData,
};

export interface DemoTurn {
  key: string;
  prompt: string;
  /** Answer text (Markdown, may contain entity: links). */
  answer: string;
  spec?: DynamicUiSpec;
  results?: Record<string, AnyUiResult>;
  followups?: string[];
}

export const DEMO_TURNS: DemoTurn[] = [
  {
    key: 'wetter',
    prompt: 'Wie wird das Wetter in Zürich?',
    answer:
      'Heute bleibt es in Zürich **bewölkt** bei rund 8 °C, am frühen Abend zieht Regen durch. Ab Dienstag wird es freundlicher.',
    spec: { version: 2, root: WEATHER },
    results: results([[WEATHER, resolved(WEATHER, weatherData())]]),
    followups: ['Brauche ich morgen einen Schirm?', 'Wie wird das Wetter am Wochenende in Bern?'],
  },
  {
    key: 'aktie',
    prompt: 'Wie steht die Nestlé-Aktie?',
    answer:
      'Die Nestlé-Aktie schloss am Freitag bei CHF 85.85. Fahre über das Diagramm, um einzelne Tage zu sehen.',
    spec: { version: 2, root: STOCK },
    results: results([[STOCK, resolved(STOCK, stockData())]]),
    followups: ['Wie hoch ist die Dividende?', 'Vergleiche Nestlé mit Novartis'],
  },
  {
    key: 'waehrung',
    prompt: '100 Euro in Franken',
    answer: '100 Euro sind aktuell rund **91.43 Franken** (EZB-Referenzkurs).',
    spec: { version: 2, root: CURRENCY },
    results: results([[CURRENCY, resolved(CURRENCY, currencyData())]]),
    followups: ['Und 500 Franken in Euro?', 'Wie hat sich der Kurs in einem Jahr entwickelt?'],
  },
  {
    key: 'person',
    prompt: 'Wer war Ada Lovelace?',
    answer:
      '[Ada Lovelace](entity:Ada_Lovelace) war eine britische Mathematikerin. Mit ihren Notizen zur [Analytical Engine](entity:Analytical_Engine) von [Charles Babbage](entity:Charles_Babbage) schrieb sie das erste veröffentlichte Computerprogramm.',
    spec: { version: 2, root: ENTITY },
    results: results([[ENTITY, resolved(ENTITY, DEMO_ENTITIES['Ada Lovelace'])]]),
    followups: [
      'Was berechnete ihr Programm genau?',
      'Welche Frauen prägten die Informatik noch?',
      'Wie funktionierte die Analytical Engine?',
    ],
  },
  {
    key: 'nachrichten',
    prompt: 'Was gibt es Neues von der ETH Zürich? Und zeig mir Bilder vom Matterhorn.',
    answer: 'Hier sind die neuesten Meldungen und ein paar Eindrücke vom Matterhorn.',
    spec: {
      version: 2,
      root: { type: 'stack', gap: 'lg', children: [NEWS, GALLERY] },
    },
    results: results([
      [NEWS, resolved(NEWS, newsData())],
      [GALLERY, resolved(GALLERY, galleryData())],
    ]),
    followups: ['Mehr zur Roboterhand', 'Wie lange dauert der Aufstieg aufs Matterhorn?'],
  },
  {
    key: 'live-zustaende',
    prompt: 'Live-Bausteine: Laden und Fehler',
    answer:
      'So sehen Live-Bausteine aus, solange ihre Daten laden (Platzhalter in Endgrösse) und wenn eine Quelle ausfällt.',
    spec: {
      version: 2,
      root: { type: 'stack', gap: 'lg', children: [PENDING_WEATHER, FAILED_STOCK, PENDING_NEWS] },
    },
    results: {
      bern: { type: 'weather', key: uiLiveKey(PENDING_WEATHER), status: 'pending' },
      apple: {
        type: 'stock',
        key: uiLiveKey(FAILED_STOCK),
        status: 'failed',
        error: 'Die Kursquelle antwortet gerade nicht.',
        retryable: true,
        fetchedAt: FETCHED,
      },
    },
  },
  {
    key: 'rezept',
    prompt: 'Rezept Risotto für 4',
    answer:
      'Ein klassischer Risotto alla milanese. Passe die Portionen an, die Mengen rechnen mit.',
    spec: {
      version: 2,
      title: 'Risotto alla milanese',
      state: { portions: 4 },
      computed: { factor: 'portions / 4' },
      root: {
        type: 'stack',
        gap: 'lg',
        children: [
          {
            type: 'row',
            children: [
              { type: 'stepper', bind: 'portions', label: 'Portionen', min: 1, max: 12 },
              {
                type: 'kpi',
                label: 'Zeit',
                value: '35',
                format: 'integer',
                hint: 'Minuten, davon 25 am Herd',
              },
            ],
          },
          {
            type: 'checklist',
            id: 'zutaten',
            title: 'Zutaten',
            copyable: true,
            items: [
              {
                id: 'reis',
                label: '{{round(320 * factor)}} g Risottoreis',
                detail: 'Carnaroli oder Arborio',
              },
              {
                id: 'bruehe',
                label: '{{1.2 * factor|decimal:1}} l Gemüsebrühe',
                detail: 'heiss halten',
              },
              { id: 'zwiebel', label: '{{round(factor)}} Zwiebel', detail: 'fein gehackt' },
              { id: 'wein', label: '{{round(150 * factor)}} ml Weisswein', detail: 'trocken' },
              { id: 'safran', label: '{{round(factor * 2) / 2}} Briefchen Safran' },
              {
                id: 'butter',
                label: '{{round(60 * factor)}} g Butter',
                detail: 'kalt, in Würfeln',
              },
              {
                id: 'parmesan',
                label: '{{round(80 * factor)}} g Parmesan',
                detail: 'frisch gerieben',
              },
            ],
          },
          {
            type: 'timeline',
            items: [
              {
                time: '5 Min.',
                title: 'Zwiebel anschwitzen',
                text: 'In der Hälfte der Butter glasig dünsten.',
                status: 'done',
              },
              {
                time: '2 Min.',
                title: 'Reis rösten',
                text: 'Unter Rühren, bis die Körner glasig sind.',
                status: 'done',
              },
              {
                time: '18 Min.',
                title: 'Ablöschen und köcheln',
                text: 'Mit Wein ablöschen, dann Brühe kellenweise zugeben. Safran nach 10 Minuten.',
                status: 'current',
              },
              {
                time: '2 Min.',
                title: 'Mantecare',
                text: 'Vom Herd nehmen, kalte Butter und Parmesan einrühren.',
                status: 'upcoming',
              },
            ],
          },
          {
            type: 'callout',
            tone: 'tip',
            title: 'Profi-Tipp',
            text: 'Den Risotto vor dem Servieren **zwei Minuten ruhen** lassen – so wird er schön cremig („all’onda“).',
          },
        ],
      },
    },
    followups: ['Welcher Wein passt dazu?', 'Geht das auch vegan?'],
  },
  {
    key: 'quiz',
    prompt: 'Quiz mich zu den Planeten',
    answer: 'Vier Fragen zum Sonnensystem – eine nach der anderen.',
    spec: {
      version: 2,
      root: {
        type: 'quiz',
        id: 'planeten',
        title: 'Planeten-Quiz',
        questions: [
          {
            q: 'Welcher Planet ist der Sonne am nächsten?',
            options: ['Venus', 'Merkur', 'Mars', 'Erde'],
            answer: 1,
            hint: 'Er ist zugleich der kleinste Planet.',
            explanation: 'Merkur umrundet die Sonne in nur 88 Tagen.',
          },
          {
            q: 'Welcher Planet hat die meisten bekannten Monde?',
            options: ['Jupiter', 'Saturn', 'Uranus', 'Neptun'],
            answer: 1,
            explanation:
              'Saturn liegt mit Abstand vorne, dank vieler kleiner, neu entdeckter Monde.',
          },
          {
            q: 'Wie heisst der höchste Vulkan im Sonnensystem?',
            kind: 'text',
            answer: 'Olympus Mons',
            hint: 'Er steht auf dem Mars.',
            explanation: 'Der Olympus Mons ist rund 22 Kilometer hoch.',
          },
          {
            q: 'Welcher Planet rotiert fast „liegend“ auf der Seite?',
            options: ['Neptun', 'Venus', 'Uranus'],
            answer: 2,
            explanation: 'Die Rotationsachse von Uranus ist um etwa 98 Grad geneigt.',
          },
        ],
      },
    },
    followups: ['Mach ein schwereres Quiz', 'Erklär mir die Monde des Saturn'],
  },
  {
    key: 'lernkarten',
    prompt: 'Lernkarten zu europäischen Hauptstädten',
    answer: 'Tippe auf eine Karte, um sie umzudrehen. Markiere, was du schon weisst.',
    spec: {
      version: 2,
      root: {
        type: 'flashcards',
        id: 'hauptstaedte',
        cards: [
          { front: 'Hauptstadt von Slowenien?', back: 'Ljubljana' },
          { front: 'Hauptstadt von Litauen?', back: 'Vilnius' },
          { front: 'Hauptstadt von Portugal?', back: 'Lissabon' },
          {
            front: 'Hauptstadt von Island?',
            back: 'Reykjavík – die nördlichste Hauptstadt eines souveränen Staates.',
          },
          { front: 'Hauptstadt von Malta?', back: 'Valletta' },
          { front: 'Hauptstadt der Schweiz?', back: 'Offiziell keine – Bern ist die Bundesstadt.' },
        ],
      },
    },
  },
  {
    key: 'ebikes',
    prompt: 'Vergleiche drei E-Bikes',
    answer: 'Drei Modelle für verschiedene Zwecke. Tippe ein Bike an, um mehr zu erfahren.',
    spec: {
      version: 2,
      title: 'E-Bikes im Vergleich',
      state: { tab: 0, pick: 'trekking' },
      root: {
        type: 'stack',
        gap: 'lg',
        children: [
          {
            type: 'carousel',
            aspect: '4:3',
            items: [
              {
                title: 'Urban 7',
                subtitle: 'Leicht, Riemenantrieb, ideal für die Stadt',
                meta: ['CHF 3 290', '19,8 kg', '90 km'],
                badge: 'Preistipp',
                image: { src: img('bike-urban'), alt: 'Graues Stadt-E-Bike vor einer Hauswand' },
                action: { type: 'sendMessage', text: 'Erzähl mir mehr über das Urban 7.' },
              },
              {
                title: 'Trekking Pro 9',
                subtitle: 'Grosser Akku, Federgabel, Gepäckträger',
                meta: ['CHF 4 690', '24,1 kg', '140 km'],
                badge: 'Empfehlung',
                image: { src: img('bike-trekking'), alt: 'Trekking-E-Bike auf einem Waldweg' },
                action: { type: 'sendMessage', text: 'Erzähl mir mehr über das Trekking Pro 9.' },
              },
              {
                title: 'Cargo Family 5',
                subtitle: 'Transportbox für zwei Kinder',
                meta: ['CHF 6 900', '38 kg', '80 km'],
                image: { src: img('bike-cargo'), alt: 'Lastenrad mit Holzbox' },
                action: { type: 'sendMessage', text: 'Erzähl mir mehr über das Cargo Family 5.' },
              },
              {
                title: 'Gravel E-Sport',
                subtitle: 'Schnell auf Schotter und Asphalt',
                meta: ['CHF 5 450', '15,9 kg'],
                image: { src: img('bike-gravel'), alt: 'Gravel-E-Bike vor Bergen' },
                action: { type: 'openUrl', url: 'https://www.velosuisse.ch/' },
              },
            ],
          },
          {
            type: 'tabs',
            bind: 'tab',
            tabs: [
              {
                label: 'Überblick',
                children: [
                  {
                    type: 'compare',
                    bind: 'pick',
                    items: [
                      {
                        id: 'urban',
                        title: 'Urban 7',
                        subtitle: 'Stadt',
                        values: { price: 3290, weight: 19.8, range: 90 },
                      },
                      {
                        id: 'trekking',
                        title: 'Trekking Pro 9',
                        subtitle: 'Touren',
                        badge: 'Empfehlung',
                        values: { price: 4690, weight: 24.1, range: 140 },
                      },
                      {
                        id: 'cargo',
                        title: 'Cargo Family 5',
                        subtitle: 'Familie',
                        values: { price: 6900, weight: 38, range: 80 },
                      },
                    ],
                    specs: [
                      { key: 'price', label: 'Preis', format: 'currency:CHF', better: 'lower' },
                      {
                        key: 'weight',
                        label: 'Gewicht (kg)',
                        format: 'decimal:1',
                        better: 'lower',
                      },
                      {
                        key: 'range',
                        label: 'Reichweite (km)',
                        format: 'integer',
                        better: 'higher',
                      },
                    ],
                  },
                ],
              },
              {
                label: 'Reichweite',
                children: [
                  {
                    type: 'chart',
                    kind: 'bar',
                    x: 'model',
                    format: 'integer',
                    height: 220,
                    data: [
                      { model: 'Urban 7', eco: 90, tour: 65, turbo: 40 },
                      { model: 'Trekking Pro 9', eco: 140, tour: 105, turbo: 70 },
                      { model: 'Cargo Family 5', eco: 80, tour: 60, turbo: 35 },
                    ],
                    series: [
                      { key: 'eco', label: 'Eco' },
                      { key: 'tour', label: 'Tour' },
                      { key: 'turbo', label: 'Turbo' },
                    ],
                  },
                ],
              },
              {
                label: 'Fazit',
                children: [
                  {
                    type: 'markdown',
                    text: 'Für Pendelstrecken bis 20 km reicht das **Urban 7**. Wer Touren fährt, nimmt das **Trekking Pro 9** – der grössere Akku zahlt sich aus.',
                  },
                  {
                    type: 'rating',
                    value: 4.5,
                    count: 1284,
                    label: 'Trekking Pro 9 · Kundenbewertungen',
                  },
                ],
              },
            ],
          },
          {
            type: 'accordion',
            items: [
              {
                title: 'Wie weit komme ich wirklich?',
                open: true,
                children: [
                  {
                    type: 'text',
                    text: 'Die Herstellerangaben gelten für Eco bei 20 °C. Im Winter und in den Bergen rechnest du besser mit 60 bis 70 Prozent.',
                  },
                ],
              },
              {
                title: 'Brauche ich ein Nummernschild?',
                children: [
                  {
                    type: 'text',
                    text: 'Nur für schnelle E-Bikes bis 45 km/h. Alle drei Modelle hier unterstützen bis 25 km/h und brauchen keines.',
                  },
                ],
              },
              {
                title: 'Riemen oder Kette?',
                children: [
                  {
                    type: 'text',
                    text: 'Ein Riemen ist leise und fast wartungsfrei, eine Kette günstiger und mit mehr Gängen kombinierbar.',
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    followups: ['Welches ist am besten für 30 km Arbeitsweg?', 'Gibt es Förderbeiträge?'],
  },
  {
    key: 'bausteine',
    prompt: 'Zeig mir die Inhaltsbausteine',
    answer: 'Listen, Hinweise, Fortschritt, Bewertungen, Bilder, Code und Formeln.',
    spec: {
      version: 2,
      root: {
        type: 'stack',
        gap: 'lg',
        children: [
          { type: 'heading', text: 'Ausflug aufs Jungfraujoch', level: 3 },
          {
            type: 'list',
            items: [
              {
                icon: 'train',
                title: 'Zug ab Zürich HB',
                subtitle: 'IC 61 · Gleis 32',
                trailing: '07:32',
              },
              {
                icon: 'coffee',
                title: 'Kaffee in Interlaken Ost',
                subtitle: 'Umsteigen in die BOB',
                trailing: '9:28',
              },
              {
                icon: '🏔️',
                title: 'Kleine Scheidegg',
                subtitle: 'Weiter mit der Jungfraubahn',
                trailing: '10:45',
              },
              {
                image: { src: img('landscape-jungfrau'), alt: 'Jungfraujoch im Schnee' },
                title: 'Jungfraujoch – Top of Europe',
                subtitle: '3454 m · Eispalast und Sphinx-Terrasse',
                trailing: '11:47',
                action: {
                  type: 'sendMessage',
                  text: 'Was kann ich auf dem Jungfraujoch unternehmen?',
                },
              },
            ],
          },
          {
            type: 'grid',
            columns: 2,
            children: [
              {
                type: 'callout',
                tone: 'info',
                title: 'Hinweis',
                text: 'Die Bahn fährt bei jedem Wetter.',
              },
              {
                type: 'callout',
                tone: 'success',
                title: 'Gebucht',
                text: 'Sitzplätze für 2 Personen reserviert.',
              },
              {
                type: 'callout',
                tone: 'warning',
                title: 'Höhe',
                text: 'Auf 3454 m ist die Luft dünn – langsam gehen.',
              },
              {
                type: 'callout',
                tone: 'danger',
                title: 'Gletscher',
                text: 'Markierte Wege nie verlassen.',
              },
            ],
          },
          {
            type: 'grid',
            columns: 2,
            children: [
              {
                type: 'progress',
                value: '2450',
                max: '4000',
                format: 'currency:CHF',
                label: 'Reisekasse · Ziel {{4000|currency:CHF}}',
              },
              {
                type: 'progress',
                kind: 'ring',
                value: '7',
                max: '10',
                label: '7 von 10 Gipfeln geschafft',
              },
            ],
          },
          { type: 'rating', value: 4.5, count: 2381, label: 'Bewertungen auf Google' },
          {
            type: 'image',
            src: img('landscape-lake'),
            alt: 'Blick über den Thunersee bei Sonnenuntergang',
            caption: 'Thunersee am Abend – auf der Rückfahrt links sitzen.',
            aspect: '16:9',
          },
          {
            type: 'code',
            language: 'python',
            title: 'Zinseszins in Python',
            code: 'def endkapital(start: float, zins: float, jahre: int) -> float:\n    """Kapital nach n Jahren mit jährlicher Verzinsung."""\n    return start * (1 + zins / 100) ** jahre\n\nprint(round(endkapital(10_000, 5, 15), 2))  # 20789.28',
          },
          { type: 'math', tex: 'K_n = K_0 \\cdot \\left(1 + \\frac{p}{100}\\right)^{n}' },
          {
            type: 'row',
            gap: 'sm',
            children: [
              {
                type: 'button',
                label: 'Formel kopieren',
                action: { type: 'copy', text: 'K_n = K_0 · (1 + p/100)^n' },
              },
              {
                type: 'button',
                label: 'In Eingabe übernehmen',
                variant: 'secondary',
                action: { type: 'prefill', text: 'Rechne mir den Zinseszins für ' },
              },
              {
                type: 'button',
                label: 'Was ist Zinseszins?',
                variant: 'secondary',
                action: { type: 'openEntity', title: 'Zinseszins' },
              },
            ],
          },
        ],
      },
    },
  },
  {
    key: 'formular',
    prompt: 'Hilf mir, einen Ausflug zu planen',
    answer: 'Erzähl mir kurz, was du dir vorstellst – ich mache dann konkrete Vorschläge.',
    spec: {
      version: 2,
      state: { ziel: 'berge', start: '2026-12-19', personen: 2, wuensche: '' },
      root: {
        type: 'form',
        id: 'ausflug',
        title: 'Wohin soll es gehen?',
        children: [
          {
            type: 'radio',
            bind: 'ziel',
            label: 'Art des Ausflugs',
            options: [
              { value: 'berge', label: 'Berge und Wandern' },
              { value: 'stadt', label: 'Städtetrip' },
              { value: 'see', label: 'See und Erholung' },
            ],
          },
          {
            type: 'row',
            children: [
              { type: 'date', bind: 'start', label: 'Abreise', min: '2026-11-08' },
              { type: 'stepper', bind: 'personen', label: 'Personen', min: 1, max: 8 },
            ],
          },
          {
            type: 'textarea',
            bind: 'wuensche',
            label: 'Besondere Wünsche',
            rows: 3,
            placeholder: 'z. B. mit Hund, barrierefrei, Wellness',
          },
        ],
        submit: {
          label: 'Vorschläge holen',
          message:
            'Plane mir einen Ausflug: {{ziel}}, Abreise {{start}}, {{personen}} Personen. Wünsche: {{wuensche}}',
        },
      },
    },
  },
  {
    key: 'daten',
    prompt: 'Wie lief mein Laufjahr?',
    answer: 'Deine Läufe 2026 – wähle den Zeitraum, die Kennzahlen und das Diagramm folgen.',
    spec: {
      version: 2,
      title: 'Laufjahr 2026',
      layout: 'dashboard',
      state: { months: 6 },
      data: {
        runs: [
          { month: 'Jan', idx: 1, km: 82, pace: 5.92, runs: 9, hr: 151 },
          { month: 'Feb', idx: 2, km: 96, pace: 5.85, runs: 10, hr: 150 },
          { month: 'Mär', idx: 3, km: 118, pace: 5.71, runs: 12, hr: 149 },
          { month: 'Apr', idx: 4, km: 131, pace: 5.64, runs: 13, hr: 148 },
          { month: 'Mai', idx: 5, km: 142, pace: 5.52, runs: 14, hr: 147 },
          { month: 'Jun', idx: 6, km: 128, pace: 5.48, runs: 12, hr: 147 },
          { month: 'Jul', idx: 7, km: 110, pace: 5.55, runs: 11, hr: 149 },
          { month: 'Aug', idx: 8, km: 151, pace: 5.41, runs: 15, hr: 146 },
          { month: 'Sep', idx: 9, km: 163, pace: 5.33, runs: 16, hr: 145 },
          { month: 'Okt', idx: 10, km: 174, pace: 5.27, runs: 16, hr: 144 },
          { month: 'Nov', idx: 11, km: 58, pace: 5.3, runs: 6, hr: 145 },
        ],
      },
      views: {
        recent: { from: 'runs', filter: 'idx > 11 - months' },
      },
      computed: {
        total: "sumOf('recent', 'km')",
        perMonth: "total / max(countOf('recent'), 1)",
        pace: "avgOf('recent', 'pace')",
        paceDelta: "avgOf('recent', 'pace') - avgOf('runs', 'pace')",
      },
      root: {
        type: 'stack',
        gap: 'lg',
        children: [
          {
            type: 'grid',
            columns: 3,
            children: [
              {
                type: 'kpi',
                label: 'Kilometer',
                value: 'total',
                format: 'integer',
                delta: 'perMonth - 120',
                deltaFormat: 'integer',
                hint: 'pro Monat gegenüber 120 km Ziel',
                spark: 'recent',
                sparkKey: 'km',
              },
              {
                type: 'kpi',
                label: 'Ø Pace (min/km)',
                value: 'pace',
                format: 'decimal:2',
                delta: 'paceDelta',
                deltaFormat: 'decimal:2',
                spark: 'recent',
                sparkKey: 'pace',
              },
              {
                type: 'kpi',
                label: 'Läufe',
                value: "sumOf('recent', 'runs')",
                format: 'integer',
                spark: 'recent',
                sparkKey: 'runs',
              },
            ],
          },
          {
            type: 'card',
            title: 'Kilometer pro Monat',
            subtitle: 'Letzte {{months}} Monate',
            expandable: true,
            children: [
              {
                type: 'chart',
                kind: 'area',
                data: 'recent',
                x: 'month',
                series: [{ key: 'km', label: 'Kilometer' }],
                format: 'integer',
                ranges: [
                  { label: '3 M', value: 3 },
                  { label: '6 M', value: 6 },
                  { label: 'Jahr', value: 11 },
                ],
                rangeBind: 'months',
              },
            ],
            actions: [
              {
                label: 'Trainingsplan erstellen',
                action: {
                  type: 'sendMessage',
                  text: 'Erstelle mir einen Trainingsplan für die nächsten {{months}} Monate.',
                },
              },
              {
                label: 'Werte kopieren',
                variant: 'secondary',
                action: {
                  type: 'copy',
                  text: '{{total}} km in {{months}} Monaten, Pace {{pace|decimal:2}}',
                },
              },
            ],
          },
          {
            type: 'chart',
            kind: 'scatter',
            data: 'runs',
            x: 'pace',
            series: [{ key: 'hr', label: 'Puls' }],
            height: 200,
          },
          {
            type: 'table',
            data: 'runs',
            columns: [
              { key: 'month', label: 'Monat' },
              { key: 'runs', label: 'Läufe', format: 'integer' },
              { key: 'km', label: 'km', format: 'integer' },
              { key: 'pace', label: 'Pace', format: 'decimal:2' },
              { key: 'hr', label: 'Puls', format: 'integer' },
            ],
            highlight: "km == maxOf('runs', 'km')",
          },
          {
            type: 'card',
            title: 'Nächstes Ziel: Zürich Marathon',
            subtitle: 'Sonntag, 19. April 2027',
            image: { src: img('landscape-zurich-marathon'), alt: 'Läufer am Zürichsee' },
            children: [{ type: 'progress', value: '64', label: 'Vorbereitung', format: 'percent' }],
            actions: [
              {
                label: 'Zur Anmeldung',
                action: { type: 'openUrl', url: 'https://www.zuerich-marathon.ch/' },
              },
            ],
          },
        ],
      },
    },
    followups: ['Wie schaffe ich die 4-Stunden-Marke?', 'Plane mir eine Erholungswoche'],
  },
];

// Eigene Kacheln (model-authored tiles, type "widget")

const RAIN_WEATHER = { type: 'weather', location: 'Zürich' } as const;
const RAIN_NODE = { ...RAIN_WEATHER, id: uiWidgetLiveId('regen', 'wetter') } as const;

/** Four hand-made tiles: the quality bar for model tiles (see fixtures-widgets.ts). */
export const WIDGET_TURNS: DemoTurn[] = [
  {
    key: 'kachel-timer',
    prompt: 'Bau mir einen Pomodoro-Timer mit 25/5-Rhythmus.',
    answer:
      'Hier ist dein Fokus-Timer. Nach jeder Fokusrunde startet die Pause von selbst; der Stand bleibt erhalten, auch wenn du die Seite neu lädst.',
    spec: {
      version: 2,
      root: { type: 'widget', id: 'pomodoro', title: 'Fokus-Timer', html: WIDGET_POMODORO },
    },
    followups: ['Wie lange sollten Pausen sein?', 'Was hilft gegen Ablenkung?'],
  },
  {
    key: 'kachel-regen',
    prompt: 'Werde ich bei meinem Spaziergang in Zürich nass?',
    answer:
      'Das hängt davon ab, wann du losgehst. Wähle Start und Dauer; die Kachel rechnet mit der stündlichen Regenwahrscheinlichkeit und würfelt 40 Spaziergänge durch.',
    spec: {
      version: 2,
      root: {
        type: 'widget',
        id: 'regen',
        title: 'Regen-Würfel',
        html: WIDGET_RAIN_DICE,
        live: { wetter: RAIN_WEATHER },
      },
    },
    // Arrives with a delay on the demo page (DEMO_DELAYED_RESULTS): pending → resolved.
    results: {
      [RAIN_NODE.id]: { type: 'weather', key: uiLiveKey(RAIN_NODE), status: 'pending' },
    },
    followups: ['Und morgen früh?', 'Welche Jacke brauche ich?'],
  },
  {
    key: 'kachel-hypothek',
    prompt: 'Wie entwickelt sich eine Hypothek über 600 000 Franken?',
    answer:
      'Bei 2.4 % Zins und 25 Jahren Laufzeit zahlst du rund 2660 Franken im Monat. Schiebe die Regler, um zu sehen, was eine zusätzliche Tilgung bringt.',
    spec: {
      version: 2,
      root: {
        type: 'widget',
        id: 'hypothek',
        title: 'Hypothek-Rechner',
        html: WIDGET_LOAN,
        props: { amount: 600000, rate: 2.4, years: 25 },
      },
    },
    followups: ['Fest oder SARON-Hypothek?', 'Wie viel Eigenkapital brauche ich?'],
  },
  {
    key: 'kachel-memory',
    prompt: 'Ein Memory-Spiel mit Schweizer Sehenswürdigkeiten.',
    answer:
      'Viel Spass! Dein Spielstand und dein Bestwert bleiben bei dieser Nachricht gespeichert.',
    spec: {
      version: 2,
      root: { type: 'widget', id: 'memory', title: 'Schweizer Memory', html: WIDGET_MEMORY },
    },
    followups: ['Mach es schwieriger', 'Ein Quiz zu den Sehenswürdigkeiten'],
  },
];

/** Live results the demo delivers after a moment, like the server's socket push. */
export const DEMO_DELAYED_RESULTS: Record<string, Record<string, AnyUiResult>> = {
  'kachel-regen': { [RAIN_NODE.id]: resolved(RAIN_NODE, weatherData()) },
};

/** A followups-only answer: no view, only chips. */
export const FOLLOWUPS_ONLY: DemoTurn = {
  key: 'nur-folgefragen',
  prompt: 'Was ist der Unterschied zwischen Wetter und Klima?',
  answer:
    'Wetter beschreibt den Zustand der Atmosphäre an einem Ort und zu einer Zeit – Klima ist das durchschnittliche Wetter über mindestens 30 Jahre.',
  followups: [
    'Wie misst man das Klima?',
    'Was ist ein Mikroklima?',
    'Ist ein kalter Winter ein Widerspruch zur Erwärmung?',
  ],
};

/** Simulated „Erneut versuchen“: the failed stock resolves. */
export function demoRefresh(nodeId: string): AnyUiResult | null {
  if (nodeId !== 'apple') return null;
  return resolved(
    FAILED_STOCK,
    stockData({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'NASDAQ',
      currency: 'USD',
      price: 236.4,
      seed: 21,
    })
  );
}
