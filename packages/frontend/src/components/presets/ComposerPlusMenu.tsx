import type { ReactNode } from 'react';
import { Paperclip, Plus } from 'lucide-react';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StepOutContent } from '@/components/motion/StepOutContent';
import { cn } from '@/lib/utils';

interface ComposerPlusMenuProps {
  /** Opens the file picker or the attachment tray. */
  onAttach?: () => void;
  attachLabel?: string;
  attachDisabled?: boolean;
  disabled?: boolean;
  className?: string;
  /** Presets (e.g. the writing style) below the attachment entry. */
  children?: ReactNode;
}

/** The composer's `+`: attachments plus presets such as „Stil: …". */
export function ComposerPlusMenu({
  onAttach,
  attachLabel = 'Dateien anhängen',
  attachDisabled,
  disabled,
  className,
  children,
}: ComposerPlusMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label="Anhänge und Vorgaben"
        title="Anhänge und Vorgaben"
        className={cn(
          'plum-plus-trigger inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
          className
        )}
      >
        <Plus className="h-[18px] w-[18px]" />
      </DropdownMenuTrigger>
      <StepOutContent align="start" side="top" className="w-64">
        {onAttach && (
          <DropdownMenuItem disabled={attachDisabled} onSelect={() => onAttach()}>
            <Paperclip className="mr-2 h-4 w-4" />
            {attachLabel}
          </DropdownMenuItem>
        )}
        {children}
      </StepOutContent>
    </DropdownMenu>
  );
}
