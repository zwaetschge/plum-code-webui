import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';

/** Same-origin paths only: no scheme-relative or backslash tricks. */
export function safeReturnPath(returnTo: string | null): string {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return '/';
  if (/[\\\u0000-\u001f]/.test(returnTo)) return '/';
  try {
    const url = new URL(returnTo, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}

/**
 * Landing page of every browser login. The server sends a one-time `code`; it
 * is traded for the token by POST, together with a nonce cookie, so the token
 * never sits in a URL. The address is replaced afterwards, so neither the code
 * nor an error stays in the history.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setToken } = useAuthStore();
  // The code works once; React's double effect in development must not spend it twice.
  const exchanged = useRef(false);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      navigate(`/connect?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }

    const destination = safeReturnPath(searchParams.get('returnTo'));
    const finish = (token: string) =>
      setToken(token).then(() => navigate(destination, { replace: true }));

    const code = searchParams.get('code');
    if (code) {
      if (exchanged.current) return;
      exchanged.current = true;
      api
        .post<{ success: boolean; data?: { token?: string } }>('/auth/web/exchange', { code })
        .then((response) => {
          const token = response.data.data?.token;
          if (!token) throw new Error('missing token');
          return finish(token);
        })
        .catch(() => navigate('/connect?error=login_expired', { replace: true }));
      return;
    }

    // Plum Desktop loads this page with its own stored token inside its shell.
    // A browser no longer accepts a token from the address: a link could
    // otherwise sign someone into another account.
    const token = searchParams.get('token');
    const inDesktopShell = typeof window !== 'undefined' && 'electronAPI' in window;
    if (token && inDesktopShell) {
      void finish(token);
      return;
    }
    navigate('/connect', { replace: true });
  }, [searchParams, setToken, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}
