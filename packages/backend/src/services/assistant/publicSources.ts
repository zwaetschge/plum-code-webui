import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../middleware/errorHandler.js';

/** Public document capture has no cookies, credentials, redirects or LAN access.
 * Selected browser/connector sessions remain the path for protected documents. */
export function isPublicSourceAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a! >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 192 && b === 0 && [0, 2].includes(c!)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && [18, 19].includes(b!)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase();
    const first = parseInt(value.split(':')[0]!, 16);
    const second = parseInt(value.split(':')[1] || '0', 16);
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !(first === 0x2001 && second < 0x200) &&
      !/^2001:0*db8:/i.test(value) &&
      !/^2002:/i.test(value)
    );
  }
  return false;
}
export function publicSourceUrl(value: string): URL {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('Ungültige Quellenadresse', 400, 'SOURCE_URL_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.href.length > 2000
  )
    throw new AppError(
      'Eine öffentliche HTTPS-Adresse ohne Zugangsdaten verwenden',
      400,
      'SOURCE_URL_INVALID'
    );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    (net.isIP(host) && !isPublicSourceAddress(host)) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    (!net.isIP(host) && !host.includes('.'))
  )
    throw new AppError(
      'Für lokale oder geschützte Quellen eine verbundene Browser-/Kontositzung verwenden',
      400,
      'SOURCE_URL_PRIVATE'
    );
  url.hash = '';
  return url;
}
export async function publicSourceAddress(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.promises.lookup(host, { all: true }).catch(() => {
        throw new AppError('Quellenadresse ist nicht erreichbar', 502, 'SOURCE_UNAVAILABLE');
      });
  if (!addresses.length || addresses.some((a) => !isPublicSourceAddress(a.address)))
    throw new AppError(
      'Quellenadresse verweist auf ein nicht öffentliches Netz',
      400,
      'SOURCE_URL_PRIVATE'
    );
  return addresses.find((a) => a.family === 4) ?? addresses[0]!;
}
async function htmlText(bytes: Buffer) {
  const executable = process.env.PLUM_PYTHON_BIN || '/usr/local/bin/plum-python';
  const script = fileURLToPath(
    new URL('../../../../../scripts/plum-web-extract.py', import.meta.url)
  );
  return new Promise<{ title: string; text: string; truncated: boolean }>((resolve, reject) => {
    const child = spawn(executable, [script], { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError('Webtext konnte nicht gelesen werden', 422, 'SOURCE_EXTRACT_FAILED'));
    }, 10000);
    timer.unref();
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 400000) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new AppError('Webtext konnte nicht gelesen werden', 422, 'SOURCE_EXTRACT_FAILED'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || size > 400000) throw new Error();
        const parsed = JSON.parse(Buffer.concat(chunks).toString()) as {
          title: string;
          text: string;
          truncated: boolean;
        };
        if (
          typeof parsed.text !== 'string' ||
          !parsed.text.trim() ||
          parsed.text.length > 100000 ||
          typeof parsed.title !== 'string'
        )
          throw new Error();
        // The extractor caps at 50000 code points; characters outside the BMP (emoji)
        // count twice in UTF-16, which used to reject long pages with a single emoji.
        if (parsed.text.length > 50000) {
          parsed.text = parsed.text.slice(0, 50000).replace(/[\uD800-\uDBFF]$/, '');
          parsed.truncated = true;
        }
        resolve(parsed);
      } catch {
        reject(
          new AppError(
            'Die Seite liefert keinen lesbaren Dokumenttext',
            422,
            'SOURCE_EXTRACT_FAILED'
          )
        );
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}
export async function fetchPublicSource(
  value: string,
  redirects = 0,
  options: { signal?: AbortSignal } = {}
): Promise<{
  bytes: Buffer;
  mimeType: string;
  title: string;
  text: string;
  truncated: boolean;
  url: string;
}> {
  const url = publicSourceUrl(value),
    address = await publicSourceAddress(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const response = await new Promise<{ bytes: Buffer; mimeType: string; redirect?: string }>(
    (resolve, reject) => {
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
            'User-Agent': 'Plum-Source-Capture/1.0',
            Accept: 'text/html,application/xhtml+xml,text/plain,application/json,text/csv',
            'Accept-Encoding': 'identity',
          },
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)])
            : AbortSignal.timeout(12000),
        },
        (reply) => {
          if (
            redirects > 0 &&
            reply.statusCode &&
            [301, 302, 303, 307, 308].includes(reply.statusCode) &&
            reply.headers.location
          ) {
            reply.destroy();
            resolve({
              bytes: Buffer.alloc(0),
              mimeType: 'text/plain',
              redirect: new URL(reply.headers.location, url).href,
            });
            return;
          }
          if (reply.statusCode !== 200) {
            reply.destroy();
            reject(
              new AppError(
                reply.statusCode && reply.statusCode >= 300 && reply.statusCode < 400
                  ? 'Die Seite leitet weiter. Bitte die öffentliche Zieladresse eintragen.'
                  : 'Seite nicht öffentlich lesbar; gegebenenfalls eine verbundene Browser-/Kontositzung verwenden',
                422,
                'SOURCE_HTTP_FAILED'
              )
            );
            return;
          }
          const encoding = String(reply.headers['content-encoding'] ?? 'identity')
            .trim()
            .toLowerCase();
          const mimeType = String(reply.headers['content-type'] ?? '')
            .split(';')[0]!
            .toLowerCase();
          if (
            ![
              'text/html',
              'application/xhtml+xml',
              'text/plain',
              'application/json',
              'text/csv',
            ].includes(mimeType) ||
            !['identity', 'gzip', 'deflate', 'br'].includes(encoding)
          ) {
            reply.destroy();
            reject(
              new AppError(
                'Diese Quellenadresse liefert kein unterstütztes Textdokument',
                415,
                'SOURCE_TYPE_UNSUPPORTED'
              )
            );
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          reply.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 1024 * 1024) {
              reply.destroy();
              reject(new AppError('Webdokument überschreitet 1 MB', 413, 'SOURCE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          reply.on('end', () => {
            try {
              const wire = Buffer.concat(chunks);
              const options = { maxOutputLength: 1024 * 1024 };
              const bytes =
                encoding === 'gzip'
                  ? gunzipSync(wire, options)
                  : encoding === 'deflate'
                    ? inflateSync(wire, options)
                    : encoding === 'br'
                      ? brotliDecompressSync(wire, options)
                      : wire;
              resolve({ bytes, mimeType });
            } catch (error) {
              const oversized = (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE';
              reject(
                new AppError(
                  oversized
                    ? 'Webdokument überschreitet 1 MB'
                    : 'Komprimiertes Webdokument ist beschädigt',
                  oversized ? 413 : 422,
                  oversized ? 'SOURCE_TOO_LARGE' : 'SOURCE_DECODE_FAILED'
                )
              );
            }
          });
          reply.on('error', () =>
            reject(new AppError('Quellenübertragung wurde unterbrochen', 502, 'SOURCE_UNAVAILABLE'))
          );
        }
      );
      request.on('error', () =>
        reject(new AppError('Quellenadresse ist nicht erreichbar', 502, 'SOURCE_UNAVAILABLE'))
      );
      request.end();
    }
  );
  if (response.redirect)
    return fetchPublicSource(response.redirect, Math.min(redirects, 3) - 1, options);
  let extracted;
  if (['text/html', 'application/xhtml+xml'].includes(response.mimeType))
    extracted = await htmlText(response.bytes);
  else {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(response.bytes);
    } catch {
      throw new AppError('Das Textdokument muss UTF-8 verwenden', 415, 'SOURCE_TYPE_UNSUPPORTED');
    }
    if (!text.trim() || text.includes('\0'))
      throw new AppError('Quelle enthält keinen gültigen Text', 422, 'SOURCE_EMPTY');
    extracted = { title: url.hostname, text: text.slice(0, 50000), truncated: text.length > 50000 };
  }
  return { ...response, ...extracted, url: url.href };
}
