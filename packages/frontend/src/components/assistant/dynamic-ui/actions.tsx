import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { isUiHttpsUrl, type UiAction } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import type { Ctx } from './context';

/** Copies text; falls back to a hidden textarea where the Clipboard API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** Opens an https link in a new tab without opener or referrer. */
export function openExternal(url: string) {
  if (!isUiHttpsUrl(url)) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/** Runs actions and remembers a short „Kopiert“ confirmation. */
export function useActionRunner(ctx: Ctx) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = useCallback(
    async (action: UiAction) => {
      const result = await ctx.run(action);
      if (result === 'copied') {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      }
      return result;
    },
    [ctx]
  );
  return { run, copied };
}

export function ActionButton({
  ctx,
  action,
  label,
  variant = 'primary',
  className,
  icon,
}: {
  ctx: Ctx;
  action: UiAction;
  label: ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
  icon?: ReactNode;
}) {
  const { run, copied } = useActionRunner(ctx);
  const lead =
    action.type === 'copy' ? (
      copied ? (
        <Check size={14} className="plum-pop" aria-hidden />
      ) : (
        <Copy size={14} aria-hidden />
      )
    ) : (
      icon
    );
  return (
    <button
      type="button"
      className={cn(
        'dui-button',
        variant === 'secondary' ? 'is-secondary' : 'is-primary',
        className
      )}
      disabled={!ctx.canRun(action)}
      onClick={() => void run(action)}
    >
      {lead}
      <span>{action.type === 'copy' && copied ? 'Kopiert' : label}</span>
      {action.type === 'openUrl' && (
        <ExternalLink size={13} className="dui-button-trail" aria-hidden />
      )}
    </button>
  );
}
