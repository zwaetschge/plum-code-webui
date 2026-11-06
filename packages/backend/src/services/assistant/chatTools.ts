import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import { get } from '../../db/pg.js';
import { getMcpServerForRequest } from '../../routes/mcp.js';
import { buildRestrictedChildEnv } from '../../utils/childProcessEnv.js';
import { redactSensitiveText } from '../../utils/sanitize.js';
import { fetchPublicSource, publicSourceUrl } from './publicSources.js';
import type { ChatOptions } from './chatOptions.js';
import type { ApiTool } from './apiTransport.js';
import { createHash } from 'node:crypto';
import { readChatSkill } from './chatSkills.js';
import { WebSourceRegistry, plainText, publishedDate } from './chatWebSources.js';

type WebSearchResult = { title: string; url: string; excerpt: string; publishedAt: string | null };
type WebSearchFilters = { recency?: 'day' | 'week' | 'month' | 'year'; topic?: 'general' | 'news' };
/** Pages read right away per search, their text budget and the bound on that step. */
const AUTO_READ_PAGES = 3,
  AUTO_READ_CHARS = 4000,
  AUTO_READ_TIMEOUT_MS = 6000;

/**
 * Self-hosted SearXNG (PLUM_SEARXNG_URL) aggregates Bing, Brave, Yahoo and more
 * in the query's own language. Only its JSON API is called; result links still
 * pass the public-URL boundary like every other web source.
 */
async function searchSearxng(
  query: string,
  filters: WebSearchFilters = {}
): Promise<WebSearchResult[]> {
  const base = process.env.PLUM_SEARXNG_URL?.trim();
  if (!base) return [];
  const url = new URL('search', base.endsWith('/') ? base : base + '/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  if (filters.recency) url.searchParams.set('time_range', filters.recency);
  if (filters.topic) url.searchParams.set('categories', filters.topic);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return [];
  const body = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; publishedDate?: unknown }>;
  };
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const item of body.results ?? []) {
    try {
      const href = publicSourceUrl(String(item.url)).href;
      if (seen.has(href)) continue;
      seen.add(href);
      results.push({
        title: String(item.title ?? '').trim() || href,
        url: href,
        excerpt: String(item.content ?? '').slice(0, 1500),
        publishedAt: publishedDate(item.publishedDate),
      });
    } catch {
      /* Search results never bypass the public-URL boundary. */
    }
    if (results.length >= 8) break;
  }
  return results;
}

/** Fallback without SearXNG: Bing's result page, pinned to en/US for stable markup. */
async function searchBing(query: string): Promise<WebSearchResult[]> {
  const page = await fetchPublicSource(
    'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=en&cc=us'
  );
  const decode = (text: string) =>
    text
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  const plain = (html: string) =>
    decode(html.replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  const results: WebSearchResult[] = [];
  for (const match of page.bytes
    .toString('utf8')
    .matchAll(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(match[1]!);
    const link = heading && /href=["']([^"']+)["']/i.exec(heading[1]!);
    if (!link) continue;
    try {
      let url = new URL(decode(link[1]!), page.url);
      if (url.hostname === 'www.bing.com' && url.pathname === '/ck/a') {
        const encoded = url.searchParams.get('u');
        if (!encoded?.startsWith('a1')) continue;
        url = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
      }
      if (url.hostname.endsWith('bing.com')) continue;
      results.push({
        title: plain(heading![1]!),
        url: publicSourceUrl(url.href).href,
        excerpt: plain(match[1]!).slice(0, 1500),
        publishedAt: null,
      });
    } catch {
      /* Search results never bypass the public-URL boundary. */
    }
    if (results.length >= 8) break;
  }
  return results;
}

/** One public page through the normal source boundary, cancelled after `timeoutMs`. */
async function readWebPage(url: string, signal: AbortSignal, timeoutMs: number) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  bounded.throwIfAborted();
  let cancel = () => {};
  try {
    return await Promise.race([
      fetchPublicSource(url, 3, { signal: bounded }),
      new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('Seite antwortet zu langsam'));
        bounded.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally {
    bounded.removeEventListener('abort', cancel);
  }
}

export interface ChatToolCatalogItem {
  key: string;
  name: string;
  description: string;
  readOnly: boolean;
  permission: 'allow' | 'ask' | 'block';
}

interface RpcResult {
  result?: unknown;
  error?: unknown;
  id?: number;
}
class McpConnection {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private next = 0;
  private buffer = '';
  private session = '';
  private version = '2024-11-05';
  constructor(
    private config: Awaited<ReturnType<typeof getMcpServerForRequest>>,
    private signal: AbortSignal
  ) {}
  private receive(message: RpcResult) {
    if (typeof message.id !== 'number') return;
    const p = this.pending.get(message.id);
    if (!p) return;
    this.pending.delete(message.id);
    if (message.error) p.reject(new Error('MCP-Aufruf abgelehnt'));
    else p.resolve(message.result);
  }
  async open() {
    const config = this.config!;
    if (config.type === 'subprocess') {
      this.child = spawn(config.command!, config.args, {
        env: buildRestrictedChildEnv(config.env),
        stdio: 'pipe',
        shell: false,
      });
      this.child.stderr.on('data', () => {});
      this.child.on('error', () => this.close());
      this.child.on('exit', () => this.close());
      this.child.stdout.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf8');
        if (this.buffer.length > 8_000_000) {
          this.close();
          return;
        }
        let at: number;
        while ((at = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, at);
          this.buffer = this.buffer.slice(at + 1);
          try {
            this.receive(JSON.parse(line));
          } catch {
            /* Ignore server log lines. */
          }
        }
      });
    }
    this.signal.addEventListener('abort', this.close, { once: true });
    const init = (await this.request('initialize', {
      protocolVersion: this.version,
      capabilities: {},
      clientInfo: { name: 'plum-chat', version: '1' },
    })) as { protocolVersion?: string };
    this.version = init.protocolVersion ?? this.version;
    await this.request('notifications/initialized', {}, true);
  }
  async request(method: string, params: unknown, notification = false): Promise<unknown> {
    this.signal.throwIfAborted();
    const id = ++this.next,
      message = { jsonrpc: '2.0', ...(notification ? {} : { id }), method, params };
    if (this.child) {
      if (notification) {
        this.child.stdin.write(JSON.stringify(message) + '\n');
        return null;
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('MCP-Zeitlimit'));
        }, 30000);
        this.pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        this.child!.stdin.write(JSON.stringify(message) + '\n');
      });
    }
    const url = new URL(this.config!.url!);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Ungültige MCP-Adresse');
    // URL comes from an administrator-owned registration, never from model arguments.
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(30000)]),
      headers: {
        ...this.config?.requestHeaders,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(this.session
          ? { 'Mcp-Session-Id': this.session, 'MCP-Protocol-Version': this.version }
          : {}),
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`MCP HTTP ${response.status}`);
    }
    this.session = response.headers.get('mcp-session-id') ?? this.session;
    if (notification || response.status === 202) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('MCP-Antwort fehlt');
    let text = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > 4_000_000) throw new Error('MCP-Antwort zu gross');
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          const frames = text.replace(/\r\n/g, '\n').split('\n\n');
          text = frames.pop() ?? '';
          for (const frame of frames) {
            const data = frame
              .split('\n')
              .filter((s) => s.startsWith('data:'))
              .map((s) => s.slice(5))
              .join('\n');
            if (!data) continue;
            const item = JSON.parse(data) as RpcResult;
            if (item.id === id) {
              if (item.error) throw new Error('MCP-Aufruf abgelehnt');
              return item.result;
            }
          }
        }
      }
      const item = JSON.parse(text) as RpcResult;
      if (item.error) throw new Error('MCP-Aufruf abgelehnt');
      return item.result;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  close = () => {
    this.signal.removeEventListener('abort', this.close);
    const child = this.child;
    this.child = undefined;
    for (const p of this.pending.values()) p.reject(new Error('MCP-Verbindung geschlossen'));
    this.pending.clear();
    if (child && !child.killed) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2000);
      timer.unref();
    }
  };
}
const toolSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()),
  annotations: z.object({ readOnlyHint: z.boolean().optional() }).passthrough().optional(),
});
export async function chatToolset(
  userId: string,
  options: ChatOptions,
  signal: AbortSignal,
  /** The generating turn's registry; refs then stay stable across all of its tool calls. */
  context: { webSources?: WebSourceRegistry } = {}
) {
  const webSources = context.webSources ?? new WebSourceRegistry();
  const connections: McpConnection[] = [],
    tools: ApiTool[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const catalog: ChatToolCatalogItem[] = [];
  const deferred = new Map<string, ApiTool>();
  const approvals = new Set<string>();
  const add = (tool: ApiTool, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
    tools.push(tool);
    handlers.set(tool.name, handler);
  };
  if (options.skillNames.length)
    add(
      {
        name: 'read_skill',
        description:
          'Load an explicitly selected skill instruction or its referenced text file. Follow nextOffset for longer files; this never executes scripts.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', enum: options.skillNames },
            file: { type: 'string' },
            offset: { type: 'integer', minimum: 0 },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      (args) => readChatSkill(options.skillNames, args)
    );
  if (options.webSearch) {
    add(
      {
        name: 'web_search',
        description:
          'Search the public web. Returns up to 8 results with turn-wide ref numbers, plus the main text of the top results in "pages". Cite as [ref](url). Use web_fetch for other results.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 500 },
            recency: {
              type: 'string',
              enum: ['day', 'week', 'month', 'year'],
              description: 'Only results from this period, for current events.',
            },
            topic: {
              type: 'string',
              enum: ['general', 'news'],
              description: 'news searches news sources.',
            },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
      async (args) => {
        const input = z
          .object({
            query: z.string().trim().min(1).max(500),
            // Models occasionally send null or an unsupported value: search unfiltered then.
            recency: z.enum(['day', 'week', 'month', 'year']).optional().catch(undefined),
            topic: z.enum(['general', 'news']).optional().catch(undefined),
          })
          .parse(args);
        const { query } = input;
        // Filtered searches often come back empty (e.g. news engines failing on a time
        // range): relax recency, then topic, before leaving SearXNG.
        const attempts: WebSearchFilters[] = [{ recency: input.recency, topic: input.topic }];
        if (input.recency) attempts.push({ topic: input.topic });
        if (input.topic) attempts.push({});
        let found: WebSearchResult[] = [],
          applied: WebSearchFilters = {};
        try {
          for (const filters of attempts) {
            found = await searchSearxng(query, filters);
            applied = filters;
            if (found.length) break;
          }
        } catch {
          found = [];
        }
        // Bing's page has neither dates nor time filters; the query alone still helps.
        if (!found.length) {
          found = await searchBing(query);
          applied = {};
        }
        const relaxed = (!!input.recency && !applied.recency) || (!!input.topic && !applied.topic);
        const results: Array<{
          ref: number;
          title: string;
          url: string;
          domain: string;
          excerpt: string;
          publishedAt: string | null;
        }> = [];
        for (const item of found) {
          const source = webSources.add(item);
          if (!source || results.some((result) => result.ref === source.ref)) continue;
          results.push({
            ref: source.ref,
            title: plainText(item.title, 300) || source.title,
            url: source.url,
            domain: source.domain,
            excerpt: plainText(item.excerpt, 600),
            publishedAt: item.publishedAt ?? source.publishedAt,
          });
          if (results.length >= 8) break;
        }
        if (!results.length) throw new Error('Websuche hat keine lesbaren Ergebnisse geliefert');
        // Sources appear in the client before the pages are read.
        await webSources.changed();
        // Pages already read in this turn are not fetched again; the next results take their place.
        const unread = results.filter((result) => !webSources.find(result.url)?.read);
        const read = await Promise.allSettled(
          unread.slice(0, AUTO_READ_PAGES).map(async (result) => {
            const page = await readWebPage(result.url, signal, AUTO_READ_TIMEOUT_MS);
            const text = page.text
              .replace(/[ \t]+\n/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim()
              .slice(0, AUTO_READ_CHARS);
            if (!text) throw new Error('Seite ohne Text');
            webSources.add({ url: result.url, title: page.title, read: true }, page.url);
            return {
              ref: result.ref,
              url: result.url,
              title: plainText(page.title, 300) || result.title,
              text,
            };
          })
        );
        signal.throwIfAborted();
        return {
          query,
          results,
          pages: read.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : [])),
          ...(relaxed
            ? {
                note: 'Nothing matched the requested recency/topic; these results are less filtered, so check their dates.',
              }
            : {}),
          retrievedAt: new Date().toISOString(),
        };
      }
    );
    add(
      {
        name: 'web_fetch',
        description:
          'Read a public HTTPS page in full. Returns its turn-wide ref; cite as [ref](url). Local/private addresses are blocked.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', maxLength: 2000 } },
          required: ['url'],
          additionalProperties: false,
        },
      },
      async (args) => {
        const requested = publicSourceUrl(z.string().max(2000).parse(args.url)).href;
        const page = await fetchPublicSource(requested, 3, { signal });
        const source = webSources.add(
          { url: page.url, title: page.title, excerpt: page.text, read: true },
          requested
        );
        return {
          ref: source?.ref ?? null,
          title: page.title,
          url: source?.url ?? page.url,
          text: page.text.slice(0, 24000),
          retrievedAt: new Date().toISOString(),
        };
      }
    );
  }
  try {
    for (const id of options.mcpServerIds) {
      const server = await getMcpServerForRequest(id, userId);
      if (!server?.enabled) throw new Error('Ausgewählter MCP-Server ist nicht verfügbar');
      // Subprocesses and global registrations run with the service account's privileges.
      if (
        (server.type === 'subprocess' || server.source === 'claude-settings') &&
        (await get('SELECT role FROM users WHERE id=?', userId))?.role !== 'admin'
      )
        throw new Error('Dieser MCP-Server benötigt Administratorrechte');
      const connection = new McpConnection(server, signal);
      connections.push(connection);
      await connection.open();
      let cursor: string | undefined;
      const cursors = new Set<string>();
      let count = 0;
      do {
        const list = (await connection.request('tools/list', cursor ? { cursor } : {})) as {
          tools?: unknown[];
          nextCursor?: string;
        };
        for (const raw of list.tools ?? []) {
          if (++count > 4000) throw new Error('MCP-Werkzeugkatalog überschreitet 4000 Funktionen');
          const tool = toolSchema.parse(raw);
          const key = id + ':' + tool.name;
          const name =
            `mcp_${createHash('sha256').update(key).digest('hex').slice(0, 12)}_${tool.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(
              0,
              64
            );
          const permission = options.toolPermissions[key] ?? 'allow';
          catalog.push({
            key,
            name: tool.name,
            description: `${server.name}: ${tool.description ?? tool.name}`.slice(0, 2000),
            readOnly: tool.annotations?.readOnlyHint === true,
            permission,
          });
          if (
            permission === 'block' ||
            (!options.allowToolWrites && tool.annotations?.readOnlyHint !== true)
          )
            continue;
          if (approvals.has(name) || deferred.has(name) || handlers.has(name))
            throw new Error('Doppelte MCP-Werkzeugkennung');
          const definition = {
            name,
            description: `${server.name}: ${tool.description ?? tool.name}`.slice(0, 2000),
            parameters: tool.inputSchema,
          };
          const handler = (args: Record<string, unknown>) =>
            connection.request('tools/call', { name: tool.name, arguments: args });
          if (permission === 'ask') approvals.add(name);
          if (options.toolLoading === 'eager') add(definition, handler);
          else {
            deferred.set(name, definition);
            handlers.set(name, handler);
          }
        }
        cursor = list.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('MCP-Katalog wiederholt eine Seite');
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    if (deferred.size)
      add(
        {
          name: 'find_tools',
          description:
            'Search the selected MCP tool catalog by task or function name and load up to eight matching function definitions for subsequent calls. Blocked functions are excluded.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', maxLength: 500 } },
            required: ['query'],
            additionalProperties: false,
          },
        },
        async (args) => {
          const query = z.string().trim().min(1).max(500).parse(args.query).toLocaleLowerCase();
          const terms = query.split(/\s+/).filter(Boolean);
          const matches = [...deferred.values()]
            .map((tool) => ({
              tool,
              score: terms.reduce(
                (n, term) =>
                  n +
                  (tool.name.toLocaleLowerCase().includes(term)
                    ? 3
                    : tool.description.toLocaleLowerCase().includes(term)
                      ? 1
                      : 0),
                0
              ),
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
          for (const { tool } of matches)
            if (!tools.some((loaded) => loaded.name === tool.name)) {
              if (tools.length >= 80) throw new Error('80 Werkzeuge sind bereits geladen');
              tools.push(tool);
            }
          return { matches: matches.map(({ tool }) => tool), catalogSize: deferred.size };
        }
      );
    return {
      tools,
      catalog,
      requiresApproval: (name: string) => approvals.has(name),
      call: async (
        name: string,
        args: Record<string, unknown>,
        approved = false,
        transform?: (result: unknown) => Promise<unknown>
      ) => {
        const handler = handlers.get(name);
        if (!handler || !tools.some((tool) => tool.name === name))
          throw new Error('Werkzeug ist für diesen Chat nicht freigegeben oder noch nicht geladen');
        if (approvals.has(name) && !approved) throw new Error('Einzelgenehmigung fehlt');
        const result = await handler(args);
        return redactSensitiveText(
          JSON.stringify(transform ? await transform(result) : result)
        ).slice(0, 32000);
      },
      close: () => connections.forEach((c) => c.close()),
    };
  } catch (error) {
    connections.forEach((c) => c.close());
    throw error;
  }
}
