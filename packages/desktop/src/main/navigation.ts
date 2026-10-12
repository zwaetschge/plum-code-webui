/** Remote windows stay bound to the explicitly configured HTTP(S) origin. */
export function desktopOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Invalid Plum server URL');
  return url.origin;
}
export function isDesktopOrigin(value: string, origin: string): boolean {
  try {
    return desktopOrigin(value) === origin;
  } catch {
    return false;
  }
}
