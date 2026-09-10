/**
 * Render a stored credential for display.
 *
 * The previews this replaces showed the first 6-8 characters plus the last 4.
 * For a `ghp_`/`github_pat_`/`sk-` token the leading run is a public type
 * prefix, so the visible window was mostly real secret material — shipped to
 * the browser on every settings page load, and into any log or screenshot of
 * it. Only the trailing four characters are kept, which is enough to tell two
 * credentials apart and useless for reconstructing either.
 */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  const trimmed = secret.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}
