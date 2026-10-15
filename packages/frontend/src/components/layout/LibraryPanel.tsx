import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LIBRARY_PARAM, LIBRARY_SECTIONS, libraryHref } from './libraryNav';
import { floodElement } from '@/lib/motion/flood';
import { takeLibraryOrigin } from '@/lib/motion/navigation';
import { prefersReducedMotion } from '@/lib/motion/reducedMotion';
import { boxOf } from '@/lib/motion/spring';

const AssistantPage = lazy(() =>
  import('@/pages/AssistantPage').then((m) => ({ default: m.AssistantPage }))
);

const SIDEBAR_SELECTOR = '.app-sidebar-shell:not(.app-sidebar-mobile)';

/** Right edge of the desktop sidebar, so the popup docks beside it. */
function useSidebarEdge(open: boolean) {
  const [edge, setEdge] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    let observer: ResizeObserver | null = null;
    let timer = 0;
    // The sidebar may mount after a deep link opens the popup; wait for it.
    const attach = () => {
      const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
      if (!sidebar) {
        timer = window.setTimeout(attach, 150);
        return;
      }
      const update = () => setEdge(Math.round(sidebar.getBoundingClientRect().right));
      update();
      observer = new ResizeObserver(update);
      observer.observe(sidebar);
    };
    attach();
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [open]);
  return edge;
}

/**
 * The library as a popup docked to the right of the left sidebar, over the
 * chat. Non-modal: the sidebar tiles keep switching sections; Escape or a
 * click into the chat closes it and drops `?library=` again.
 */
export function LibraryPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const slug = new URLSearchParams(location.search).get(LIBRARY_PARAM);
  const active = LIBRARY_SECTIONS.find((section) => section.slug === slug);
  const edge = useSidebarEdge(!!active);
  // PageFlood: the popup grows out of the tile it was opened from and folds back into it.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const closing = useRef(false);
  // Layout effect: the first clip is in place before the popup is ever painted.
  useLayoutEffect(() => {
    if (!panel) return;
    closing.current = false;
    const origin = takeLibraryOrigin();
    if (!origin) return;
    panel.dataset.flood = 'opening';
    void floodElement(panel, origin, boxOf(panel.getBoundingClientRect())).then(() => {
      panel.style.clipPath = '';
      if (panel.dataset.flood === 'opening') delete panel.dataset.flood;
    });
  }, [panel]);

  const close = () => {
    const tile = document.querySelector('.sidebar-library-tile.is-active');
    if (panel && tile && !closing.current && !prefersReducedMotion()) {
      closing.current = true;
      panel.dataset.flood = 'closing';
      void floodElement(
        panel,
        boxOf(panel.getBoundingClientRect()),
        boxOf(tile.getBoundingClientRect())
      ).then(drop);
      return;
    }
    if (!closing.current) drop();
  };
  const drop = () => {
    const params = new URLSearchParams(location.search);
    params.delete(LIBRARY_PARAM);
    params.delete('resource');
    params.delete('revision');
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  };

  return (
    <DialogPrimitive.Root open={!!active} modal={false} onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={setPanel}
          aria-describedby={undefined}
          style={{ ['--library-left' as string]: `${edge}px` }}
          className="library-popup plum-assistant-shell"
          onInteractOutside={(event) => {
            // Sidebar clicks switch sections or navigate on their own.
            const target = event.target as Element | null;
            if (target?.closest(SIDEBAR_SELECTOR)) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            {active ? `Bibliothek · ${active.label}` : 'Bibliothek'}
          </DialogPrimitive.Title>
          <div className="library-panel-head">
            <nav aria-label="Bibliothek" className="library-panel-tabs">
              {LIBRARY_SECTIONS.map(({ slug: key, label, icon: Icon }) => (
                <Link
                  key={key}
                  to={libraryHref(location.pathname, location.search, key)}
                  replace
                  title={label}
                  aria-current={key === active?.slug ? 'page' : undefined}
                  className={cn('library-panel-tab', key === active?.slug && 'is-active')}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
            <DialogPrimitive.Close className="library-panel-close" aria-label="Schliessen">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="library-panel-body">
            {active && (
              <Suspense
                fallback={
                  <div className="flex justify-center p-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <AssistantPage key={active.slug} embeddedSection={active.slug} />
              </Suspense>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
