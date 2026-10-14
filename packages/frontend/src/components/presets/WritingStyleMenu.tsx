import { Check, PenLine } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { WRITING_STYLE_GROUPS, styleLabel, useStyleLibrary } from './useStyleLibrary';

interface WritingStyleMenuProps {
  /** Active preset (style-library baseName); null = no style. */
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

/**
 * „Stil: …" entry of the composer `+` menu in Chat and Task. Lists the
 * writing presets of the style library grouped by kind.
 */
export function WritingStyleMenu({ value, onChange, disabled }: WritingStyleMenuProps) {
  const library = useStyleLibrary();
  const styles = library.data?.writingStyles ?? [];
  const current = styleLabel(styles, value);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} className="gap-2">
        <PenLine className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Stil: {current ?? 'Kein Stil'}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className="flex-1">Kein Stil</span>
          {!value && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
        {library.isLoading && <DropdownMenuLabel>Stile laden …</DropdownMenuLabel>}
        {WRITING_STYLE_GROUPS.map((group) => {
          const items = styles.filter(
            (item) => (item.writingStyleType ?? 'persona') === group.type
          );
          if (!items.length) return null;
          return (
            <div key={group.type}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {group.label}
              </DropdownMenuLabel>
              {items.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => onChange(item.baseName)}
                  title={item.description || item.baseName}
                >
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {value === item.baseName && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
