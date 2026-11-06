import type { AssistantWebSource } from '@plum-code-webui/shared';

/** Upper bound per turn; later new URLs get no number and are left out of results. */
export const MAX_TURN_WEB_SOURCES = 120;

const entities: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};
/** Plain single-line text: tags and entities removed, whitespace collapsed, at most `limit` chars. */
export function plainText(value: string, limit: number): string {
  const plain = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] !== '#') return entities[code.toLowerCase()] ?? match;
      const point =
        code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? plain.slice(0, limit - 1).trimEnd() + '…' : plain;
}

export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** SearXNG reports dates like 2026-10-28T18:30:00; anything unparseable becomes null. */
export function publishedDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, 40);
  return /^\d{4}-\d{2}-\d{2}/.test(text) && !Number.isNaN(Date.parse(text)) ? text : null;
}

function key(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Turn-wide web source numbering: every URL a turn's web_search/web_fetch
 * calls return keeps one `ref`, new URLs get the next number. `sources` is the
 * array persisted on the turn (`AssistantApiTurn.webSources`).
 */
export class WebSourceRegistry {
  private readonly byUrl = new Map<string, AssistantWebSource>();
  constructor(
    readonly sources: AssistantWebSource[] = [],
    private readonly onChange?: () => Promise<void>
  ) {
    for (const source of sources) this.byUrl.set(key(source.url), source);
  }
  find(url: string): AssistantWebSource | undefined {
    return this.byUrl.get(key(url));
  }
  /**
   * Returns the source for `url` (or for `alias`, e.g. the URL requested
   * before a redirect), creating it with the next ref when unknown. Known
   * sources only gain information; their number and URL never change.
   */
  add(
    input: {
      url: string;
      title?: string;
      excerpt?: string;
      publishedAt?: string | null;
      read?: boolean;
    },
    alias?: string
  ): AssistantWebSource | null {
    let source = this.find(input.url) ?? (alias ? this.find(alias) : undefined);
    const title = plainText(input.title ?? '', 300);
    const excerpt = plainText(input.excerpt ?? '', 300);
    if (!source) {
      if (this.sources.length >= MAX_TURN_WEB_SOURCES) return null;
      source = {
        ref: this.sources.reduce((max, item) => Math.max(max, item.ref), 0) + 1,
        url: key(input.url),
        title: title || key(input.url),
        domain: sourceDomain(input.url),
        excerpt,
        publishedAt: input.publishedAt ?? null,
        read: !!input.read,
      };
      this.sources.push(source);
    } else {
      if (title && (!source.title || source.title === source.url)) source.title = title;
      if (excerpt && !source.excerpt) source.excerpt = excerpt;
      if (input.publishedAt && !source.publishedAt) source.publishedAt = input.publishedAt;
      if (input.read) source.read = true;
    }
    this.byUrl.set(key(input.url), source);
    // An alias never takes over a URL that already has its own number.
    if (alias && !this.byUrl.has(key(alias))) this.byUrl.set(key(alias), source);
    return source;
  }
  /** Publishes the current sources while the turn is still streaming. */
  async changed(): Promise<void> {
    await this.onChange?.();
  }
}
