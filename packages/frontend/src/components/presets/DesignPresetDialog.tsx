import { useMemo, useState } from 'react';
import { Check, Loader2, Palette, Search, X } from 'lucide-react';
import type { SkillLibraryItem } from '@plum-code-webui/shared';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DesignStylePreview } from '@/components/session/SessionStyleLibraryPanel';
import { getDesignDisplayName } from '@/components/session/designPreviewTemplates';
import { useStyleLibrary } from './useStyleLibrary';

/** Pinned to the front without a search; every other preset follows them. */
export const CURATED_DESIGN_PRESETS = [
  'design-plum-style',
  'design-minimal',
  'design-shadcn',
  'material-3-design',
  'design-glassmorphism',
  'design-editorial',
  'design-brutalism',
  'design-dashboard',
];

interface DesignPresetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active preset (style-library baseName); null = none. */
  value: string | null;
  onSelect: (value: string | null) => void;
  pending?: boolean;
  title?: string;
  description?: string;
}

/**
 * Design-Vorgabe as preview cards: curated presets first, then the full
 * library, plus the search. Used from ⋯ → Darstellung, the new-session chat
 * bar and the personalisation default.
 */
export function DesignPresetDialog({
  open,
  onOpenChange,
  value,
  onSelect,
  pending = false,
  title = 'Design-Vorgabe',
  description = 'Gilt für Oberflächen, die der Agent in dieser Session baut oder ändert.',
}: DesignPresetDialogProps) {
  const [query, setQuery] = useState('');
  const library = useStyleLibrary(open);
  const designs = useMemo(() => library.data?.designStyles ?? [], [library.data]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (needle) {
      return designs.filter((item) =>
        [
          item.name,
          item.baseName,
          item.description,
          getDesignDisplayName(item),
          ...(item.aliases ?? []),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
    }
    const curated = CURATED_DESIGN_PRESETS.map((name) =>
      designs.find((item) => item.baseName === name)
    ).filter((item): item is SkillLibraryItem => Boolean(item));
    const rest = designs.filter((item) => !curated.includes(item));
    const active = value ? designs.find((item) => item.baseName === value) : undefined;
    if (active && !curated.includes(active)) {
      return [active, ...curated, ...rest.filter((item) => item !== active)];
    }
    return [...curated, ...rest];
  }, [designs, needle, value]);

  const choose = (next: string | null) => {
    if (pending) return;
    onSelect(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col gap-3 overflow-hidden">
        <div className="flex items-start gap-2 pr-6">
          <Palette className="mt-0.5 h-4 w-4 text-primary" />
          <div className="min-w-0">
            <DialogTitle className="text-base">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">{description}</DialogDescription>
          </div>
          {pending && <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Alle ${designs.length || ''} Design-Vorgaben durchsuchen`}
            aria-label="Design-Vorgaben durchsuchen"
            className="h-9 pl-8 pr-8 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-foreground/10"
              aria-label="Suche leeren"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {library.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {!needle && (
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className={cn(
                    'flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center text-sm transition-colors',
                    !value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:border-border hover:bg-foreground/[0.04]'
                  )}
                  aria-pressed={!value}
                >
                  {!value ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  Ohne Design-Vorgabe
                </button>
              )}
              {visible.map((item) => {
                const active = item.baseName === value;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => choose(active ? null : item.baseName)}
                    aria-pressed={active}
                    className={cn(
                      'group flex min-w-0 flex-col rounded-xl border p-2.5 text-left transition-all',
                      active
                        ? 'border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary))]'
                        : 'border-border/60 bg-foreground/[0.02] hover:border-border hover:bg-foreground/[0.05]'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {getDesignDisplayName(item)}
                      </span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </div>
                    <DesignStylePreview item={item} className="mt-2 rounded-md" />
                    <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                      {item.description || item.baseName}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
          {!library.isLoading && needle && visible.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Keine Design-Vorgabe gefunden.
            </p>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
