import { useLayoutEffect, useRef, useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import './dynamic-ui-inline.css';

const GAP = 8;

/**
 * Suggestion chips under the latest answer: as many of the 1–3 follow-ups as
 * fit on one line (at least one, truncated if needed). Clicking sends the
 * prompt; the chips are never part of the copied answer.
 */
export function Followups({
  items,
  onSelect,
  disabled,
  className,
}: {
  items: string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(items.length);
  const key = items.join('\u0000');
  useLayoutEffect(() => {
    const container = row.current;
    const probe = measure.current;
    if (!container || !probe) return;
    const update = () => {
      const available = container.clientWidth;
      const widths = Array.from(probe.children).map((child) => (child as HTMLElement).offsetWidth);
      let used = 0;
      let count = 0;
      for (const width of widths) {
        const next = used + (count ? GAP : 0) + width;
        if (next > available) break;
        used = next;
        count++;
      }
      setFit(Math.max(1, count));
    };
    update();
    // Chip widths change when the web font arrives: watch the probe too.
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(probe);
    let active = true;
    void document.fonts?.ready.then(() => active && update());
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [key]);
  if (!items.length) return null;
  const chip = (text: string, index: number, probe = false) => (
    <button
      key={`${index}:${text}`}
      type="button"
      className="dui-followup"
      tabIndex={probe ? -1 : undefined}
      disabled={!probe && disabled}
      style={probe ? undefined : { ['--dui-i' as string]: index }}
      onClick={probe ? undefined : () => onSelect(text)}
    >
      <CornerDownRight size={14} aria-hidden />
      <span>{text}</span>
    </button>
  );
  return (
    <div className={cn('dui-followups-wrap', className)}>
      <div ref={row} className="dui-followups" role="group" aria-label="Vorgeschlagene Folgefragen">
        {items.slice(0, fit).map((text, index) => chip(text, index))}
      </div>
      <div ref={measure} className="dui-followups is-probe" aria-hidden>
        {items.map((text, index) => chip(text, index, true))}
      </div>
    </div>
  );
}
