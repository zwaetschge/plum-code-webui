import path from 'path';
import { isAllowedBasePath, isPathInside, isSensitivePath } from './allowedPaths.js';

export const STATIC_INIT_PATH = '/__preview-static-init';
export const STATIC_ROOT_COOKIE = 'preview_static_root';

const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function isAllowedPreviewPath(dir: string): boolean {
  return isAllowedBasePath(dir);
}

export function encodePreviewRoot(rootPath: string): string {
  return Buffer.from(path.resolve(rootPath), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodePreviewRoot(token: string): string | null {
  try {
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return decoded ? path.resolve(decoded) : null;
  } catch {
    return null;
  }
}

export function previewContentType(filePath: string): string | null {
  return STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}

export function isPreviewStaticFile(filePath: string): boolean {
  return Boolean(previewContentType(filePath));
}

export function resolvePreviewStaticPath(rootPath: string, requestPath: string): string | null {
  const root = path.resolve(rootPath);
  if (!isAllowedPreviewPath(root)) return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestPath.split('?')[0] || '/');
  } catch {
    return null;
  }

  if (!decodedPath.startsWith('/') || decodedPath.startsWith('//')) return null;

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
  const resolved = path.resolve(root, relativePath);
  if (!isPathInside(root, resolved)) return null;
  if (!isAllowedBasePath(resolved)) return null;
  if (isSensitivePath(resolved)) return null;
  if (!isPreviewStaticFile(resolved)) return null;
  return resolved;
}
