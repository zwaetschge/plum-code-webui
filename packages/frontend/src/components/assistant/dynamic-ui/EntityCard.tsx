import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CloudOff, ExternalLink, X } from 'lucide-react';
import type { UiEntityData } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { useDynamicUiHost } from './host';
import { Lightbox, UiImg } from './media';
import './dynamic-ui-inline.css';

/** Wikipedia summary: image, short description, lead text, article link. */
export function EntityCard({
  data,
  variant = 'card',
}: {
  data: UiEntityData;
  /** `card` in answers, `popover` in hover cards and sheets. */
  variant?: 'card' | 'popover';
}) {
  const [more, setMore] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const long = data.extract.length > 260;
  const image = data.image && !imageFailed ? data.image : null;
  const picture = image && (
    <UiImg
      src={image.src}
      alt={image.alt || data.display_title}
      aspect={image.width && image.height && image.height > image.width * 1.15 ? '3 / 4' : '1 / 1'}
      onFailed={() => setImageFailed(true)}
    />
  );
  return (
    <article className={cn('dui-entity', `is-${variant}`)}>
      <div className="dui-entity-main">
        <header>
          <h4>{data.display_title}</h4>
          {data.description && <p className="dui-entity-desc">{data.description}</p>}
        </header>
        {data.kind === 'disambiguation' ? (
          <p className="dui-entity-text">
            „{data.display_title}“ hat mehrere Bedeutungen. Die Wikipedia-Seite listet sie auf.
          </p>
        ) : (
          <p className={cn('dui-entity-text', long && !more && 'is-clamped')}>{data.extract}</p>
        )}
        <footer className="dui-entity-foot">
          {long && data.kind !== 'disambiguation' && (
            <button type="button" className="dui-link-button" onClick={() => setMore(!more)}>
              {more ? 'Weniger' : 'Mehr lesen'}
            </button>
          )}
          <a className="dui-entity-link" href={data.url} target="_blank" rel="noopener noreferrer">
            <BookOpen size={13} aria-hidden />
            Wikipedia
            <ExternalLink size={12} aria-hidden />
          </a>
        </footer>
      </div>
      {image &&
        (variant === 'card' ? (
          <button
            type="button"
            className="dui-entity-image"
            aria-label={`Bild von ${data.display_title} vergrössern`}
            onClick={() => setLightbox(0)}
          >
            {picture}
          </button>
        ) : (
          <span className="dui-entity-image">{picture}</span>
        ))}
      {image && variant === 'card' && (
        <Lightbox
          items={[
            {
              src: data.original_image ?? image.src,
              alt: image.alt || data.display_title,
              title: data.display_title,
              source: { label: 'Wikipedia', url: data.url },
            },
          ]}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </article>
  );
}

export function EntitySkeleton() {
  return (
    <div
      className="dui-entity is-popover dui-skeleton"
      role="status"
      aria-label="Steckbrief wird geladen"
    >
      <div className="dui-entity-main">
        <span className="dui-sk" style={{ width: '60%', height: 18 }} />
        <span className="dui-sk" style={{ width: '40%', height: 11 }} />
        <span className="dui-sk" style={{ width: '100%', height: 10 }} />
        <span className="dui-sk" style={{ width: '94%', height: 10 }} />
        <span className="dui-sk" style={{ width: '70%', height: 10 }} />
      </div>
      <span className="dui-sk is-block" style={{ width: 88, height: 88 }} />
    </div>
  );
}

/** Loads one entity summary through the host (cached for the session). */
export function useEntity(title: string, lang: string | undefined, enabled: boolean) {
  const host = useDynamicUiHost();
  return useQuery({
    queryKey: ['assistant', 'ui-entity', lang ?? 'de', title],
    enabled,
    staleTime: 60 * 60_000,
    retry: 1,
    queryFn: () => host.loadEntity(title, lang),
  });
}

export function EntityContent({ title, lang }: { title: string; lang?: string }) {
  const entity = useEntity(title, lang, true);
  if (entity.isPending) return <EntitySkeleton />;
  const result = entity.data;
  if (entity.isError || !result || result.status !== 'resolved' || !result.data)
    return (
      <div className="dui-live-failed" role="status">
        <CloudOff size={16} aria-hidden />
        <span>{result?.error || `Zu „${title}“ gibt es gerade keinen Steckbrief.`}</span>
      </div>
    );
  return <EntityCard data={result.data} variant="popover" />;
}

/** The entity card as a dialog: centred on desktop, a bottom sheet on touch. */
export function EntitySheet({
  entity,
  onClose,
}: {
  entity: { title: string; lang?: string } | null;
  onClose: () => void;
}) {
  return (
    <DialogPrimitive.Root open={!!entity} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dui-overlay is-soft" />
        <DialogPrimitive.Content className="dui-sheet" aria-describedby={undefined}>
          <span className="dui-sheet-grip" aria-hidden />
          <DialogPrimitive.Title className="sr-only">
            {entity?.title ?? 'Steckbrief'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="dui-icon-button dui-sheet-close"
            aria-label="Schliessen"
          >
            <X size={17} />
          </DialogPrimitive.Close>
          {entity && <EntityContent title={entity.title} lang={entity.lang} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
