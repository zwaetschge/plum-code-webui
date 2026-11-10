import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { AppError } from '../../middleware/errorHandler.js';
import { publicSourceAddress, publicSourceUrl } from './publicSources.js';

/**
 * Same-origin proxy for Dynamic UI images (`image`, `carousel`, `list`, `news`,
 * `gallery`, entity cards): the browser never contacts third-party hosts, so
 * they see no user IP, cookies or referrer.
 *
 * Same boundary as web_fetch (publicSources.ts): https on port 443 without
 * credentials, every hop's DNS answers must be public, and the connection is
 * pinned to the checked address (no DNS rebinding). At most three redirects,
 * each re-checked. Only raster images ≤ 8 MB whose bytes match their type are
 * served; SVG is refused because it can carry script. Cached on disk 24 h.
 */

export const UI_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TTL_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 10_000;
const CACHE_FILES = 3000;
/** Oldest files go first once the cache exceeds this size. */
const CACHE_BYTES = 512 * 1024 * 1024;
const MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
];

export interface UiImage {
  bytes: Buffer;
  mimeType: string;
}

/** Image type from magic bytes; null for anything that is not a supported raster image. */
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    bytes
      .subarray(0, 6)
      .toString('latin1')
      .match(/^GIF8[79]a$/)
  )
    return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (
    bytes.subarray(4, 8).toString('latin1') === 'ftyp' &&
    /^avi[fs]$/.test(bytes.subarray(8, 12).toString('latin1'))
  )
    return 'image/avif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  return null;
}

type Hop = { image: UiImage } | { redirect: string };
export interface UiImageProxyDeps {
  /** One pinned https GET; tests replace it. */
  request: (url: URL, address: { address: string; family: number }) => Promise<Hop>;
  resolve: (url: URL) => Promise<{ address: string; family: number }>;
  cacheDir: () => Promise<string>;
  now: () => number;
}

function pinnedRequest(url: URL, address: { address: string; family: number }): Promise<Hop> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: 'https:',
        hostname: address.address,
        family: address.family,
        servername: net.isIP(hostname) ? undefined : hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Host: url.host,
          'User-Agent': 'Plum-Image-Proxy/1.0',
          Accept: MIME_TYPES.join(',') + ';q=0.9',
          'Accept-Encoding': 'identity',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
      (reply) => {
        const status = reply.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && reply.headers.location) {
          reply.destroy();
          try {
            resolve({ redirect: new URL(reply.headers.location, url).href });
          } catch {
            reject(new AppError('Ungültige Weiterleitung', 502, 'IMAGE_UNAVAILABLE'));
          }
          return;
        }
        if (status !== 200) {
          reply.destroy();
          reject(new AppError('Bild nicht verfügbar', 502, 'IMAGE_UNAVAILABLE'));
          return;
        }
        const type = String(reply.headers['content-type'] ?? '')
          .split(';')[0]!
          .trim()
          .toLowerCase();
        const encoding = String(reply.headers['content-encoding'] ?? 'identity').toLowerCase();
        const length = Number(reply.headers['content-length'] ?? 0);
        if (!type.startsWith('image/') || type === 'image/svg+xml' || encoding !== 'identity') {
          reply.destroy();
          reject(new AppError('Die Adresse liefert kein unterstütztes Bild', 415, 'IMAGE_TYPE'));
          return;
        }
        if (length > UI_IMAGE_MAX_BYTES) {
          reply.destroy();
          reject(new AppError('Bild grösser als 8 MB', 413, 'IMAGE_TOO_LARGE'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        reply.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > UI_IMAGE_MAX_BYTES) {
            reply.destroy();
            reject(new AppError('Bild grösser als 8 MB', 413, 'IMAGE_TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        reply.on('end', () => resolve({ image: { bytes: Buffer.concat(chunks), mimeType: type } }));
        reply.on('error', () =>
          reject(new AppError('Bildübertragung unterbrochen', 502, 'IMAGE_UNAVAILABLE'))
        );
      }
    );
    request.on('error', () =>
      reject(new AppError('Bild nicht erreichbar', 502, 'IMAGE_UNAVAILABLE'))
    );
    request.end();
  });
}

const DEFAULT_DEPS: UiImageProxyDeps = {
  request: pinnedRequest,
  resolve: publicSourceAddress,
  cacheDir: async () => {
    const { getDataDirectory } = await import('../../db/index.js');
    return path.join(getDataDirectory(), 'ui-image-cache');
  },
  now: () => Date.now(),
};

/**
 * Fetches (or reads from cache) an external image for a Dynamic UI view.
 * Throws AppError 400 for invalid/private addresses, 415 for non-images,
 * 413 above 8 MB and 502 when the host fails.
 */
export function createUiImageProxy(overrides: Partial<UiImageProxyDeps> = {}) {
  const deps: UiImageProxyDeps = { ...DEFAULT_DEPS, ...overrides };
  const inflight = new Map<string, Promise<UiImage>>();
  let writes = 0;

  async function download(source: string): Promise<UiImage> {
    let current = source;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Every hop passes the public-URL boundary again.
      const url = publicSourceUrl(current);
      const address = await deps.resolve(url);
      const result = await deps.request(url, address);
      if ('redirect' in result) {
        current = result.redirect;
        continue;
      }
      const sniffed = sniffImageType(result.image.bytes);
      if (!sniffed || !MIME_TYPES.includes(sniffed))
        throw new AppError('Die Adresse liefert kein unterstütztes Bild', 415, 'IMAGE_TYPE');
      return { bytes: result.image.bytes, mimeType: sniffed };
    }
    throw new AppError('Zu viele Weiterleitungen', 502, 'IMAGE_REDIRECTS');
  }

  async function prune(dir: string) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith('.img'))
        .map(async (name) => {
          const stat = await fs.stat(path.join(dir, name)).catch(() => null);
          return { name, mtime: stat?.mtimeMs ?? 0, size: stat?.size ?? 0 };
        })
    );
    entries.sort((a, b) => a.mtime - b.mtime);
    const now = deps.now();
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const [index, entry] of entries.entries())
      if (
        now - entry.mtime > TTL_MS ||
        entries.length - index > CACHE_FILES ||
        total > CACHE_BYTES
      ) {
        total -= entry.size;
        await fs.rm(path.join(dir, entry.name), { force: true });
        await fs.rm(path.join(dir, entry.name.replace(/\.img$/, '.json')), { force: true });
      }
  }

  async function load(source: string): Promise<UiImage> {
    // Validate before touching the cache, so refused URLs never hit the disk.
    const url = publicSourceUrl(source).href;
    const hash = createHash('sha256').update(url).digest('hex');
    const dir = await deps.cacheDir();
    const file = path.join(dir, `${hash}.img`);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && deps.now() - stat.mtimeMs < TTL_MS) {
      const meta = JSON.parse(
        await fs.readFile(file.replace(/\.img$/, '.json'), 'utf8').catch(() => '{}')
      );
      const bytes = await fs.readFile(file).catch(() => null);
      if (bytes && typeof meta.mimeType === 'string' && sniffImageType(bytes) === meta.mimeType)
        return { bytes, mimeType: meta.mimeType };
    }
    const running = inflight.get(hash);
    if (running) return running;
    const task = download(url)
      .then(async (image) => {
        await fs.mkdir(dir, { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, image.bytes);
        await fs.rename(temp, file);
        await fs.writeFile(
          file.replace(/\.img$/, '.json'),
          JSON.stringify({ mimeType: image.mimeType, url })
        );
        if (++writes % 50 === 1) void prune(dir).catch(() => {});
        return image;
      })
      .finally(() => inflight.delete(hash));
    inflight.set(hash, task);
    return task;
  }
  return { load };
}

export const uiImageProxy = createUiImageProxy();
