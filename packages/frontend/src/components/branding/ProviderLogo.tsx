import type { UiProvider } from '@/lib/providers';
import { cn } from '@/lib/utils';

type ProviderLogoProps = {
  provider: UiProvider;
  className?: string;
  alt?: string;
};

export function ProviderLogo({ provider, className, alt }: ProviderLogoProps) {
  if (provider === 'plum') {
    const resolvedAlt = alt === undefined ? 'Plum' : alt;
    return (
      <img src="/logos/plum.png" alt={resolvedAlt} className={cn('object-contain', className)} />
    );
  }

  if (provider === 'claude') {
    const resolvedAlt = alt === undefined ? 'Claude' : alt;
    return (
      <img src="/claude-logo.png" alt={resolvedAlt} className={cn('object-contain', className)} />
    );
  }

  if (provider === 'zai') {
    const resolvedAlt = alt === undefined ? 'Z.AI' : alt;
    return (
      <img src="/logos/zai.png" alt={resolvedAlt} className={cn('object-contain', className)} />
    );
  }

  if (provider === 'codex') {
    const resolvedAlt = alt === undefined ? 'Codex' : alt;
    return (
      <img src="/logos/codex.webp" alt={resolvedAlt} className={cn('object-contain', className)} />
    );
  }

  if (provider === 'opencode') {
    const resolvedAlt = alt === undefined ? 'OpenCode' : alt;
    return (
      <img
        src="/logos/opencode.png"
        alt={resolvedAlt}
        className={cn('object-contain', className)}
      />
    );
  }

  if (provider === 'pi') {
    const resolvedAlt = alt === undefined ? 'Pi' : alt;
    return (
      <span
        aria-label={resolvedAlt || undefined}
        aria-hidden={resolvedAlt ? undefined : true}
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-current/30 font-serif font-semibold leading-none',
          className
        )}
      >
        π
      </span>
    );
  }

  if (provider === 'kimi') {
    const resolvedAlt = alt === undefined ? 'Kimi' : alt;
    return (
      <img src="/logos/kimi.png" alt={resolvedAlt} className={cn('object-contain', className)} />
    );
  }

  if (provider === 'vibe') {
    // No shipped asset for Mistral Vibe, so the badge is drawn inline like the
    // Pi mark: an SVG keeps scaling with the h-*/w-* classes callers pass in.
    const resolvedAlt = alt === undefined ? 'Mistral Vibe' : alt;
    return (
      <svg
        viewBox="0 0 64 64"
        role={resolvedAlt ? 'img' : 'presentation'}
        aria-label={resolvedAlt || undefined}
        aria-hidden={resolvedAlt ? undefined : true}
        className={className}
      >
        {resolvedAlt ? <title>{resolvedAlt}</title> : null}
        <rect x="4" y="4" width="56" height="56" rx="16" fill="#ff7000" />
        <path d="M18 22h6l8 18 8-18h6L34 46h-4z" fill="#fff8f2" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden={alt ? undefined : true}
      role={alt ? 'img' : 'presentation'}
      className={className}
    >
      {alt ? <title>{alt}</title> : null}
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="4" />
      <path
        d="M20 34c4-10 20-10 24 0"
        fill="none"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="44" cy="22" r="3.5" fill="hsl(var(--brand-accent))" />
    </svg>
  );
}
