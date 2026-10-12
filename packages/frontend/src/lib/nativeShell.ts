/** Configuration exists only in the Android APK's bundled, origin-bound workspace. */
export interface NativeShellConfig {
  apiBase: string;
  token: string;
}
export function nativeShell(): NativeShellConfig | null {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { __PLUM_ANDROID__?: NativeShellConfig }).__PLUM_ANDROID__;
  if (!value || typeof value.token !== 'string' || !value.token) return null;
  try {
    const url = new URL(value.apiBase);
    if (
      url.origin !== window.location.origin ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      return null;
    return { apiBase: url.href.replace(/\/$/, ''), token: value.token };
  } catch {
    return null;
  }
}
