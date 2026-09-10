import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import type { NextFunction, Request, Response } from 'express';
import { createReadStream, type Stats } from 'fs';
import fs from 'fs/promises';
import httpProxy from 'http-proxy';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import {
  STATIC_INIT_PATH,
  STATIC_ROOT_COOKIE,
  decodePreviewRoot,
  previewContentType,
  resolvePreviewStaticPath,
} from '../utils/previewStatic.js';

const PORT_COOKIE = 'preview_port';
const INIT_PATH = '/__preview-init';

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
  xfwd: false,
  secure: false,
  selfHandleResponse: false,
});

proxy.on('error', (err, _req, res) => {
  if (res && 'writeHead' in res && !res.headersSent) {
    try {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(errorPage('Dev server not reachable', err.message));
    } catch {
      // ignore
    }
  } else if (res && 'destroy' in res) {
    try {
      (res as unknown as Socket).destroy();
    } catch {
      // ignore
    }
  }
});

function isPreviewHost(host: string | undefined): boolean {
  if (!config.previewHostname || !host) return false;
  return host.toLowerCase() === config.previewHostname;
}

/**
 * Ports the preview vhost may proxy to. The old rule was "anything above 1023",
 * which turns the preview host into a request forwarder for every service
 * listening on the container's loopback. The default now covers the ranges dev
 * servers actually use; PREVIEW_ALLOWED_PORTS ("3000-3999,8080") overrides it.
 */
const previewPortRanges: Array<[number, number]> = (() => {
  const raw = process.env.PREVIEW_ALLOWED_PORTS?.trim();
  if (!raw) {
    return [
      [3000, 3999],
      [4000, 4999],
      [5000, 5999],
      [8000, 8999],
      [9000, 9999],
    ];
  }
  const ranges: Array<[number, number]> = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const match = entry.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      console.warn(`[preview] Ignoring unparseable PREVIEW_ALLOWED_PORTS entry: ${entry}`);
      continue;
    }
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (from < 1 || to > 65535 || to < from) {
      console.warn(`[preview] Ignoring out-of-range PREVIEW_ALLOWED_PORTS entry: ${entry}`);
      continue;
    }
    ranges.push([from, to]);
  }
  return ranges;
})();

function isPortAllowed(port: number): boolean {
  if (!Number.isInteger(port)) return false;
  // Never proxy to our own backend — would create loops / bypass auth
  if (port === config.port) return false;
  return previewPortRanges.some(([from, to]) => port >= from && port <= to);
}

/**
 * The cookie is scoped to the preview subdomain, but a cookie set on the parent
 * domain by any other host under it is still sent here — so an unsigned value
 * means a neighbouring subdomain picks the proxy target. Sign it with the
 * session secret; only /__preview-init can mint one.
 */
function signPort(port: number): string {
  return createHmac('sha256', config.sessionSecret)
    .update(`preview-port:${port}`)
    .digest('base64url')
    .slice(0, 27);
}

function verifyPortCookie(raw: string): number | null {
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const port = parseInt(raw.slice(0, separator), 10);
  if (!isPortAllowed(port)) return null;
  const provided = Buffer.from(raw.slice(separator + 1));
  const expected = Buffer.from(signPort(port));
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? port : null;
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`));
  if (!match || !match[1]) return null;
  return match[1];
}

function parsePortCookie(cookieHeader: string | undefined): number | null {
  const raw = parseCookie(cookieHeader, PORT_COOKIE);
  if (!raw) return null;
  return verifyPortCookie(decodeURIComponent(raw));
}

function parseStaticRootCookie(cookieHeader: string | undefined): string | null {
  const token = parseCookie(cookieHeader, STATIC_ROOT_COOKIE);
  return token ? decodePreviewRoot(token) : null;
}

function errorPage(title: string, detail: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[c] || c;
    });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:2rem;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{max-width:520px;padding:2rem;border:1px solid #262626;border-radius:12px;background:#111}
h1{margin:0 0 .5rem;font-size:1.25rem;color:#fafafa}p{margin:.25rem 0;color:#a3a3a3;font-size:.875rem}
code{font-family:ui-monospace,monospace;background:#1a1a1a;padding:.125rem .375rem;border-radius:4px;color:#d4d4d4}</style>
</head><body><div class="card"><h1>${esc(title)}</h1><p>${esc(detail)}</p><p>Pick a port or HTML file from the WebUI preview panel to start.</p></div></body></html>`;
}

function normalizePreviewPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function cookieString(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    config.isProduction ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');
}

function clearCookieString(name: string): string {
  return cookieString(name, '', 0);
}

function initSetupPage(port: number, previewPath: string): string {
  const destination = JSON.stringify(previewPath).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Preview ready</title></head><body><script>location.replace(${destination});</script>Setting up preview for port ${port}...</body></html>`;
}

function staticSetupPage(previewPath: string): string {
  const destination = JSON.stringify(previewPath).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Static preview ready</title></head><body><script>location.replace(${destination});</script>Opening static preview...</body></html>`;
}

// Sets the preview_port cookie. Called via iframe src change when user picks a port.
function handleInit(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', 'http://localhost');
  const portParam = url.searchParams.get('port');
  const port = portParam ? parseInt(portParam, 10) : NaN;
  const previewPath = normalizePreviewPath(url.searchParams.get('to'));

  if (!isPortAllowed(port)) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      errorPage(
        'Invalid port',
        `Port ${Number.isInteger(port) ? port : '?'} is not in the allowed preview range. ` +
          `Set PREVIEW_ALLOWED_PORTS to widen it (current: ${previewPortRanges
            .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
            .join(', ')}), and note that ${config.port} is always excluded.`
      )
    );
    return;
  }

  // HMAC-signed and HttpOnly; AuthZ itself still comes from Authelia (Traefik
  // ForwardAuth). Cookies are scoped to the preview subdomain only.
  const cookies = [
    cookieString(PORT_COOKIE, `${port}.${signPort(port)}`, 60 * 60 * 8),
    clearCookieString(STATIC_ROOT_COOKIE),
  ];

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookies,
  });
  res.end(initSetupPage(port, previewPath));
}

function handleStaticInit(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url || '/', 'http://localhost');
  const token = url.searchParams.get('root') || '';
  const rootPath = decodePreviewRoot(token);
  const fileParam = url.searchParams.get('file') || 'index.html';
  const previewPath = normalizePreviewPath(`/${fileParam}`);

  if (!rootPath) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Invalid static preview', 'The preview root token is invalid.'));
    return;
  }

  const resolvedPath = resolvePreviewStaticPath(rootPath, previewPath);
  if (!resolvedPath) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(errorPage('Static preview blocked', 'The requested file is not previewable.'));
    return;
  }

  const cookies = [
    cookieString(STATIC_ROOT_COOKIE, token, 60 * 60 * 8),
    clearCookieString(PORT_COOKIE),
  ];

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookies,
  });
  res.end(staticSetupPage(previewPath));
}

function handleClear(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': [clearCookieString(PORT_COOKIE), clearCookieString(STATIC_ROOT_COOKIE)],
  });
  res.end(errorPage('Preview cleared', 'Pick a port from the WebUI to reconnect.'));
}

async function serveStaticPreview(req: Request, res: Response, rootPath: string): Promise<void> {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const filePath = resolvePreviewStaticPath(rootPath, pathname);
  if (!filePath) {
    res
      .status(403)
      .type('html')
      .send(errorPage('Static preview blocked', 'The requested file is not previewable.'));
    return;
  }

  const contentType = previewContentType(filePath);
  if (!contentType) {
    res
      .status(403)
      .type('html')
      .send(errorPage('Static preview blocked', 'This file type is not previewable.'));
    return;
  }

  let stats: Stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    res.status(404).type('html').send(errorPage('Static file not found', pathname));
    return;
  }

  if (!stats.isFile()) {
    res.status(404).type('html').send(errorPage('Static file not found', pathname));
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(stats.size));
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(filePath).pipe(res);
}

export function previewVhostMiddleware(req: Request, res: Response, next: NextFunction): void {
  const host = req.hostname?.toLowerCase();
  if (!isPreviewHost(host)) {
    next();
    return;
  }

  const reqUrl = req.url || '/';

  if (reqUrl === INIT_PATH || reqUrl.startsWith(`${INIT_PATH}?`)) {
    handleInit(req, res);
    return;
  }

  if (reqUrl === STATIC_INIT_PATH || reqUrl.startsWith(`${STATIC_INIT_PATH}?`)) {
    handleStaticInit(req, res);
    return;
  }

  if (reqUrl === '/__preview-clear') {
    handleClear(req, res);
    return;
  }

  const staticRoot = parseStaticRootCookie(req.headers.cookie);
  if (staticRoot) {
    void serveStaticPreview(req, res, staticRoot).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Static preview failed';
      if (!res.headersSent) {
        res.status(500).type('html').send(errorPage('Static preview failed', message));
      } else {
        res.end();
      }
    });
    return;
  }

  const port = parsePortCookie(req.headers.cookie);
  if (!port) {
    res
      .status(412)
      .type('html')
      .send(
        errorPage('No preview target selected', 'The preview session cookie is missing or invalid.')
      );
    return;
  }

  proxy.web(req, res, { target: `http://127.0.0.1:${port}` });
}

export function handlePreviewUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
  const host = ((req.headers.host || '').split(':')[0] || '').toLowerCase();
  if (!isPreviewHost(host)) {
    return false;
  }

  if (parseStaticRootCookie(req.headers.cookie)) {
    socket.destroy();
    return true;
  }

  const port = parsePortCookie(req.headers.cookie);
  if (!port) {
    socket.destroy();
    return true;
  }

  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${port}` });
  return true;
}

export function previewVhostEnabled(): boolean {
  return Boolean(config.previewHostname);
}
