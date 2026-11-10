import { createContext, useContext, useEffect, useState } from 'react';
import { uiEntityPath, uiImageProxyUrl, type UiResult } from '@plum-code-webui/shared';
import { api } from '@/services/api';

/**
 * Network access of Dynamic UI. External images only ever load through the
 * same-origin proxy (no tracking requests from the browser to third parties);
 * the demo page swaps in fixtures.
 */
export interface DynamicUiHost {
  /** Resolves an external https image to a displayable (object/data) URL. */
  loadImage: (src: string) => Promise<string>;
  /**
   * The same image as a base64 `data:` URL (raster formats, at most 2 MB), for
   * custom tiles: their sandbox has an opaque origin and cannot use our blob URLs.
   */
  loadImageData: (src: string) => Promise<string>;
  /** Wikipedia summary for entity links and openEntity. */
  loadEntity: (title: string, lang?: string) => Promise<UiResult<'entity'>>;
}

const MAX_IMAGES = 160;
const images = new Map<string, Promise<string>>();

/**
 * The proxy needs the API's bearer token, so images arrive as blobs. Object
 * URLs are cached per source and released when the bounded cache evicts.
 */
function loadProxiedImage(src: string): Promise<string> {
  const cached = images.get(src);
  if (cached) {
    images.delete(src);
    images.set(src, cached);
    return cached;
  }
  const pending = api
    .download(uiImageProxyUrl(src))
    .then((response) => response.blob())
    .then((blob) => {
      if (!blob.type.startsWith('image/')) throw new Error('Kein Bild');
      return URL.createObjectURL(blob);
    });
  pending.catch(() => images.delete(src));
  images.set(src, pending);
  if (images.size > MAX_IMAGES) {
    const [oldest, url] = images.entries().next().value as [string, Promise<string>];
    images.delete(oldest);
    void url.then((value) => window.setTimeout(() => URL.revokeObjectURL(value), 30_000));
  }
  return pending;
}

/** Raster types a tile accepts (ui-widget.html checks the same list). */
const TILE_IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;
export const TILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** A blob as `data:<type>;base64,…` with a bare MIME type (no parameters). */
export function blobToImageDataUrl(blob: Blob): Promise<string> {
  const type = blob.type.split(';')[0]!.trim().toLowerCase();
  if (!TILE_IMAGE_TYPES.test(type)) return Promise.reject(new Error('Kein unterstütztes Bild'));
  if (blob.size > TILE_IMAGE_MAX_BYTES) return Promise.reject(new Error('Bild grösser als 2 MB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('Bild nicht lesbar'));
      else resolve(`data:${type};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new Error('Bild nicht lesbar'));
    reader.readAsDataURL(blob);
  });
}

export const defaultDynamicUiHost: DynamicUiHost = {
  loadImage: loadProxiedImage,
  loadImageData: async (src) =>
    blobToImageDataUrl(await (await api.download(uiImageProxyUrl(src))).blob()),
  loadEntity: async (title, lang) =>
    (await api.get<{ data: UiResult<'entity'> }>(uiEntityPath(title, lang))).data.data,
};

export const DynamicUiHostContext = createContext<DynamicUiHost>(defaultDynamicUiHost);
export const useDynamicUiHost = () => useContext(DynamicUiHostContext);

export type ImageState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'failed' };

/** Loads one external image through the host; `null` src stays idle. */
export function useUiImage(src: string | null | undefined): ImageState {
  const host = useDynamicUiHost();
  const [state, setState] = useState<ImageState>({ status: 'loading' });
  useEffect(() => {
    if (!src) {
      setState({ status: 'failed' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    host.loadImage(src).then(
      (url) => active && setState({ status: 'ready', url }),
      () => active && setState({ status: 'failed' })
    );
    return () => {
      active = false;
    };
  }, [host, src]);
  return state;
}
