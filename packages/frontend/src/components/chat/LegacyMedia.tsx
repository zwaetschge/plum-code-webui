import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

/**
 * Fetch a protected file through the API client and hand back an object URL.
 *
 * The tempting alternative is `?token=<jwt>` on the `src`, but a URL is not a
 * private channel: it lands in the browser history, in the `Referer` of anything
 * the page navigates to, and in every proxy and access log between here and the
 * server — and this token is valid for seven days. `api.download` sends the same
 * credential in the `Authorization` header, which none of those record.
 */
function useAuthedBlobUrl(url: string | null): { objectUrl: string | null; failed: boolean } {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) {
      setObjectUrl(null);
      setFailed(false);
      return;
    }

    const controller = new AbortController();
    let activeObjectUrl: string | null = null;
    let cancelled = false;

    setObjectUrl(null);
    setFailed(false);

    void api
      .download(url, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => {
        if (cancelled) return;
        if (blob.size === 0) throw new Error('Empty response');
        activeObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(activeObjectUrl);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn(`[CHAT MEDIA] Failed to load ${url}:`, error);
        setFailed(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    };
  }, [url]);

  return { objectUrl, failed };
}

interface LegacyMediaImageProps {
  url: string;
  alt: string;
}

/**
 * An inline image from the pre-`ChatMedia` attachment paths.
 *
 * A real button rather than an `<img onClick>`: opening the full-size view was
 * mouse-only before, invisible to the keyboard and announced as nothing.
 */
export function LegacyMediaImage({ url, alt }: LegacyMediaImageProps) {
  const { objectUrl, failed } = useAuthedBlobUrl(url);

  if (failed) {
    return (
      <div className="rounded-lg border border-border bg-muted px-3 py-2 text-xs" role="alert">
        {alt} could not be loaded
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div
        className="h-32 w-48 animate-pulse rounded-lg border border-foreground/15 bg-muted"
        role="status"
        aria-label={`Loading ${alt}`}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => window.open(objectUrl, '_blank', 'noopener')}
      aria-label={`Open ${alt} at full size`}
      className="rounded-lg transition-opacity hover:opacity-90"
    >
      <img
        src={objectUrl}
        alt={alt}
        className="max-h-32 max-w-48 rounded-lg border border-foreground/15 object-cover"
      />
    </button>
  );
}

interface LegacyMediaFileProps {
  url: string | null;
  filename: string;
  className?: string;
  children: ReactNode;
}

/**
 * A non-image attachment from the legacy paths. Fetched on click, so a chat full
 * of PDFs does not pull every one of them down just to draw the row of chips.
 */
export function LegacyMediaFile({ url, filename, className, children }: LegacyMediaFileProps) {
  const [isOpening, setIsOpening] = useState(false);

  const handleOpen = async () => {
    if (!url || isOpening) return;
    setIsOpening(true);
    try {
      const response = await api.download(url);
      const objectUrl = URL.createObjectURL(await response.blob());
      window.open(objectUrl, '_blank', 'noopener');
      // Revoked late: the new tab has to have read it first.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      console.warn(`[CHAT MEDIA] Failed to open ${filename}:`, error);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleOpen()}
      disabled={!url || isOpening}
      title={filename}
      aria-label={url ? `Open ${filename}` : filename}
      className={cn('transition-opacity hover:opacity-90 disabled:opacity-60', className)}
    >
      {children}
    </button>
  );
}
