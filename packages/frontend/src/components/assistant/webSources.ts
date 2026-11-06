import type { AssistantApiTurn, AssistantWebSource } from '@plum-code-webui/shared';

export type WebSource = AssistantWebSource;
type ToolEvent = NonNullable<AssistantApiTurn['toolEvents']>[number];

export const WEB_TOOLS = new Set(['web_search', 'web_fetch']);
/** Web events with a pending approval stay in the generic tool block with its decision controls. */
export const isWebActivity = (event: ToolEvent) =>
  WEB_TOOLS.has(event.name) && event.status !== 'waiting';

/** Comparable form of a cited URL: scheme/host case, leading www., trailing slash and fragment ignored. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${host}${url.port ? ':' + url.port : ''}${path}${url.search}`;
  } catch {
    return raw.trim();
  }
}

export function sourceIndex(sources: readonly WebSource[] | undefined) {
  const map = new Map<string, WebSource>();
  for (const source of sources ?? []) {
    const key = normalizeUrl(source.url);
    if (!map.has(key)) map.set(key, source);
  }
  return map;
}

/** Visible link text that marks a citation rather than prose: `1`, `[1]`, `1, 2`, the URL or its domain. */
export function isCitationLabel(label: string, href: string, source?: WebSource): boolean {
  const text = label.trim();
  if (!text) return true;
  if (/^\[?\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\]?$/.test(text)) return true;
  if (normalizeUrl(text) === normalizeUrl(href)) return true;
  const bare = text.toLowerCase().replace(/^www\./, '');
  return !!source && (bare === source.domain.toLowerCase() || bare === shortDomain(source.domain));
}

/**
 * Compact site label: generic prefixes (www, mobile, language) are dropped, the site itself
 * stays (`de.wikipedia.org` → `wikipedia.org`, `meteoschweiz.admin.ch` unchanged).
 */
export function shortDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  while (parts.length > 2 && /^(www\d?|m|mobile|amp|[a-z]{2})$/.test(parts[0]!)) parts.shift();
  return parts.join('.');
}

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Deterministic hue per site, so marks are told apart without loading favicons. */
export function domainHue(domain: string): number {
  let hash = 0;
  for (const char of shortDomain(domain)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function formatPublished(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('de-CH', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"']+(?:\([^\s<>()"']*\)[^\s<>()[\]"']*)*/g;

/** Refs in order of their first citation in the answer text. */
export function citedRefs(text: string, sources: readonly WebSource[] | undefined): number[] {
  const index = sourceIndex(sources),
    seen = new Set<number>(),
    order: number[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const source = index.get(normalizeUrl(match[0].replace(/[.,;:!?]+$/, '')));
    if (source && !seen.has(source.ref)) {
      seen.add(source.ref);
      order.push(source.ref);
    }
  }
  return order;
}

/** Cited sources first (in citation order), then the rest by ref. */
export function orderSources(sources: readonly WebSource[], text: string): WebSource[] {
  const cited = citedRefs(text, sources);
  const rank = new Map(cited.map((ref, position) => [ref, position]));
  return [...sources].sort(
    (a, b) =>
      (rank.get(a.ref) ?? Infinity) - (rank.get(b.ref) ?? Infinity) ||
      Number(b.read) - Number(a.read) ||
      a.ref - b.ref
  );
}

export interface WebStep {
  id: string;
  kind: 'search' | 'fetch';
  status: ToolEvent['status'];
  query: string;
  url: string;
  title: string;
  /** Search filters the model chose: `day|week|month|year` and `general|news`. */
  recency: string;
  topic: string;
  results: Array<{ url: string; title: string; domain: string }>;
}

function parse(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Reads a top-level string field even from a result cut off by the transcript limit. */
function field(text: string | undefined, name: string): string {
  const match = text && new RegExp(`"${name}":"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1] ?? '';
  }
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

export function webSteps(events: AssistantApiTurn['toolEvents']): WebStep[] {
  return (events ?? []).filter(isWebActivity).map((event) => {
    const args = parse(event.arguments),
      result = event.status === 'completed' ? parse(event.result) : null;
    const results = Array.isArray(result?.results)
      ? (result.results as Array<Record<string, unknown>>)
          .filter((item) => item && typeof item.url === 'string')
          .map((item) => ({
            url: item.url as string,
            title: str(item.title),
            domain: str(item.domain) || domainOf(item.url as string),
          }))
      : [];
    const url = str(result?.url) || str(args?.url) || field(event.result, 'url');
    return {
      id: event.id,
      kind: event.name === 'web_search' ? 'search' : 'fetch',
      status: event.status,
      query: str(args?.query) || str(result?.query) || field(event.result, 'query'),
      url,
      title: str(result?.title) || field(event.result, 'title'),
      recency: str(args?.recency),
      topic: str(args?.topic),
      results,
    };
  });
}

/** Distinct sources of a turn; older turns without `webSources` count the URLs in their results. */
export function sourceCount(turn: Pick<AssistantApiTurn, 'webSources'>, steps: WebStep[]): number {
  if (turn.webSources?.length) return turn.webSources.length;
  const urls = new Set<string>();
  for (const step of steps) {
    for (const result of step.results) urls.add(normalizeUrl(result.url));
    if (step.kind === 'fetch' && step.url && step.status === 'completed')
      urls.add(normalizeUrl(step.url));
  }
  return urls.size;
}

export const webToolRunning = (turn: Pick<AssistantApiTurn, 'status' | 'toolEvents'>) =>
  turn.status === 'running' &&
  !!turn.toolEvents?.some((event) => WEB_TOOLS.has(event.name) && event.status === 'running');
