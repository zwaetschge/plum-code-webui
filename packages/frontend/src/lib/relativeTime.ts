import { useEffect, useState } from 'react';

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * German "vor 12 min" / "gestern" stamp for lists where the exact time is
 * noise. Calendar days, not 24-hour windows, decide "gestern".
 */
export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
  const then = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor((now - then) / MINUTE);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} min`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (then >= today.getTime()) return `vor ${Math.floor(minutes / 60)} Std.`;
  const days = Math.ceil((today.getTime() - then) / DAY);
  if (days <= 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(then).toLocaleDateString('de-CH', {
    day: 'numeric',
    month: 'short',
    ...(new Date(then).getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Re-render once per interval so relative stamps do not freeze. */
export function useNow(intervalMs = MINUTE): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
