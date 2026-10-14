import { lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { LIBRARY_PARAM, LIBRARY_SECTIONS, libraryHref } from './libraryNav';

const AssistantPage = lazy(() =>
  import('@/pages/AssistantPage').then((m) => ({ default: m.AssistantPage }))
);

/**
 * The library as a panel over the current page: the chat stays in place,
 * the section switcher sits at the top, closing drops `?library=` again.
 */
export function LibraryPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const slug = new URLSearchParams(location.search).get(LIBRARY_PARAM);
  const active = LIBRARY_SECTIONS.find((section) => section.slug === slug);

  const close = () => {
    const params = new URLSearchParams(location.search);
    params.delete(LIBRARY_PARAM);
    params.delete('resource');
    params.delete('revision');
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  };

  return (
    <Sheet open={!!active} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        title={active ? `Bibliothek · ${active.label}` : 'Bibliothek'}
        className="library-panel plum-assistant-shell w-full max-w-none p-0 sm:w-[min(680px,92vw)]"
      >
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
      </SheetContent>
    </Sheet>
  );
}
