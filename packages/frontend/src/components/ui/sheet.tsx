import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;

interface SheetContentProps {
  children: React.ReactNode;
  className?: string;
  side?: 'left' | 'right' | 'bottom';
  title?: string;
}

/** Portal + modal focus/scroll ownership keep panels above the chat and keyboard. */
export function SheetContent({
  children,
  className,
  side = 'left',
  title = 'Navigation',
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'glass-sheet fixed z-50 overflow-y-auto overscroll-contain shadow-xl duration-200 data-[state=closed]:animate-out',
          side === 'left' &&
            'inset-y-0 left-0 h-dvh w-3/4 max-w-xs border-r data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
          side === 'right' &&
            'inset-y-0 right-0 h-dvh w-3/4 max-w-xs border-l data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
          side === 'bottom' &&
            'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl border-t data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
          className
        )}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-md bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
