import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, X } from 'lucide-react';
import type { UiAspect } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { useUiImage } from './host';
import './dynamic-ui-inline.css';

export const aspectRatio = (aspect: UiAspect | undefined, fallback = '16 / 9') =>
  aspect ? aspect.replace(':', ' / ') : fallback;

/**
 * An external image through the proxy: a shimmer at final size while it
 * loads, a soft fade-in, and a quiet fallback (or nothing) when it fails.
 */
export function UiImg({
  src,
  alt,
  aspect,
  className,
  style,
  fallback,
  onFailed,
  fit = 'cover',
}: {
  src: string | null | undefined;
  alt: string;
  /** CSS aspect-ratio; `natural` keeps the image's own proportions. */
  aspect?: string | 'natural';
  className?: string;
  style?: CSSProperties;
  /** Shown when loading fails; default: a muted image-off glyph. */
  fallback?: ReactNode;
  onFailed?: () => void;
  fit?: 'cover' | 'contain';
}) {
  const state = useUiImage(src);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const failed = state.status === 'failed' || broken;
  useEffect(() => {
    setLoaded(false);
    setBroken(false);
  }, [src]);
  useEffect(() => {
    if (failed) onFailed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);
  return (
    <span
      className={cn('dui-img', `is-${failed ? 'failed' : loaded ? 'ready' : 'loading'}`, className)}
      style={{ aspectRatio: aspect === 'natural' ? undefined : (aspect ?? '16 / 9'), ...style }}
    >
      {failed
        ? (fallback ?? (
            <span className="dui-img-fallback" aria-hidden>
              <ImageOff size={18} />
            </span>
          ))
        : state.status === 'ready' && (
            <img
              src={state.url}
              alt={alt}
              draggable={false}
              decoding="async"
              style={{ objectFit: fit }}
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
            />
          )}
    </span>
  );
}

export interface LightboxItem {
  src: string;
  alt: string;
  title?: string;
  /** Attribution: domain label and page link. */
  source?: { label: string; url?: string };
}

/** Full-screen image viewer: prev/next, arrow keys, swipe, source link, Esc. */
export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxItem[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && !!items[index];
  const item = open ? items[index!]! : null;
  const swipe = useRef<number | null>(null);
  const count = items.length;
  const go = (delta: number) => {
    if (index === null || count < 2) return;
    onIndex((index + delta + count) % count);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dui-overlay" />
        <DialogPrimitive.Content
          className="dui-lightbox"
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') go(1);
            else if (event.key === 'ArrowLeft') go(-1);
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {item?.title || item?.alt || 'Bild'}
          </DialogPrimitive.Title>
          <header className="dui-lightbox-bar">
            {count > 1 && (
              <span className="dui-lightbox-count">
                {(index ?? 0) + 1} / {count}
              </span>
            )}
            <span className="dui-lightbox-title">{item?.title}</span>
            {item?.source?.url ? (
              <a
                className="dui-lightbox-source"
                href={item.source.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.source.label}
                <ExternalLink size={13} aria-hidden />
              </a>
            ) : item?.source ? (
              <span className="dui-lightbox-source">{item.source.label}</span>
            ) : null}
            <DialogPrimitive.Close className="dui-icon-button" aria-label="Schliessen">
              <X size={18} />
            </DialogPrimitive.Close>
          </header>
          <div
            className="dui-lightbox-stage"
            onPointerDown={(event) => {
              swipe.current = event.clientX;
            }}
            onPointerUp={(event) => {
              if (swipe.current === null) return;
              const dx = event.clientX - swipe.current;
              swipe.current = null;
              if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
            }}
          >
            {item && (
              <UiImg
                key={item.src}
                src={item.src}
                alt={item.alt}
                aspect="natural"
                fit="contain"
                className="dui-lightbox-image"
              />
            )}
            {count > 1 && (
              <>
                <button
                  type="button"
                  className="dui-lightbox-nav is-prev"
                  aria-label="Vorheriges Bild"
                  onClick={() => go(-1)}
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  className="dui-lightbox-nav is-next"
                  aria-label="Nächstes Bild"
                  onClick={() => go(1)}
                >
                  <ChevronRight size={22} />
                </button>
              </>
            )}
          </div>
          {item?.alt && item.alt !== item.title && (
            <p className="dui-lightbox-caption">{item.alt}</p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Full-screen view for cards, charts and tables („Vergrössern“). */
export function Fullscreen({
  open,
  title,
  onClose,
  children,
  tools,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dui-overlay" />
        <DialogPrimitive.Content className="dui-fullscreen" aria-describedby={undefined}>
          <header className="dui-fullscreen-bar">
            <DialogPrimitive.Title className="dui-fullscreen-title">{title}</DialogPrimitive.Title>
            {tools}
            <DialogPrimitive.Close className="dui-icon-button" aria-label="Schliessen">
              <X size={18} />
            </DialogPrimitive.Close>
          </header>
          <div className="dui-fullscreen-body dui-root is-fullscreen">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
