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
        if (this.buffer.length > 4_000_000) {
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
export async function chatToolset(userId: string, options: ChatOptions, signal: AbortSignal) {
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
          'Search the public web. Return actual result links and excerpts; use web_fetch for full sources.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', maxLength: 500 } },
          required: ['query'],
          additionalProperties: false,
        },
      },
      async (args) => {
        const query = z.string().trim().min(1).max(500).parse(args.query);
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
        const results: Array<{ title: string; url: string; excerpt: string }> = [];
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
            });
          } catch {
            /* Search results never bypass the public-URL boundary. */
          }
          if (results.length >= 8) break;
        }
        if (!results.length) throw new Error('Websuche hat keine lesbaren Ergebnisse geliefert');
        return { query, results, retrievedAt: new Date().toISOString() };
      }
    );
    add(
      {
        name: 'web_fetch',
        description:
          'Read a public HTTPS page; use its exact URL when citing information. Local/private addresses are blocked.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', maxLength: 2000 } },
          required: ['url'],
          additionalProperties: false,
        },
      },
      async (args) => {
        const page = await fetchPublicSource(z.string().max(2000).parse(args.url), 3);
        return {
          title: page.title,
          url: page.url,
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
      call: async (name: string, args: Record<string, unknown>, approved = false) => {
        const handler = handlers.get(name);
        if (!handler || !tools.some((tool) => tool.name === name))
          throw new Error('Werkzeug ist für diesen Chat nicht freigegeben oder noch nicht geladen');
        if (approvals.has(name) && !approved) throw new Error('Einzelgenehmigung fehlt');
        const result = await handler(args);
        return redactSensitiveText(JSON.stringify(result)).slice(0, 32000);
      },
      close: () => connections.forEach((c) => c.close()),
    };
  } catch (error) {
    connections.forEach((c) => c.close());
    throw error;
  }
}
