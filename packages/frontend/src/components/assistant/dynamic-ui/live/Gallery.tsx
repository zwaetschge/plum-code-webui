import { useState } from 'react';
import { Images } from 'lucide-react';
import type { UiGalleryData } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { Lightbox, UiImg } from '../media';

/** Image grid (2–3 columns, a larger lead image) with a lightbox and sources. */
export function Gallery({ data }: { data: UiGalleryData }) {
  const [open, setOpen] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const images = data.images
    .map((image, index) => ({ image, index }))
    .filter(({ index }) => !failed.has(index));
  const lead = images.length >= 5;
  const visible = lead ? images.slice(0, 5) : images;
  const hidden = images.length - visible.length;
  return (
    <div className="dui-gallery">
      <header className="dui-live-head">
        <Images size={15} aria-hidden />
        <span>Bilder zu „{data.query}“</span>
      </header>
      <div
        className={cn('dui-gallery-grid', lead ? 'has-lead' : 'is-few')}
        style={{ ['--dui-gallery-count' as string]: images.length <= 3 ? images.length : 2 }}
      >
        {visible.map(({ image, index }, position) => (
          <button
            key={image.src}
            type="button"
            className="dui-gallery-item"
            style={{ ['--dui-i' as string]: position }}
            aria-label={
              hidden && position === visible.length - 1
                ? `Alle ${images.length} Bilder ansehen`
                : `${image.title || 'Bild'} vergrössern`
            }
            onClick={() => setOpen(position)}
          >
            <UiImg
              src={image.thumbnail ?? image.src}
              alt={image.title}
              aspect="natural"
              onFailed={() => setFailed((current) => new Set(current).add(index))}
            />
            {hidden > 0 && position === visible.length - 1 ? (
              <span className="dui-gallery-more">+{hidden}</span>
            ) : (
              <span className="dui-gallery-source">{image.source}</span>
            )}
          </button>
        ))}
      </div>
      <Lightbox
        items={images.map(({ image }) => ({
          src: image.src,
          alt: image.title,
          title: image.title,
          source: { label: image.source, url: image.page_url },
        }))}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
