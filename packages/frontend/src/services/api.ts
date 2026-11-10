import { useAuthStore } from '@/stores/authStore';
import { nativeShell } from '@/lib/nativeShell';

const API_BASE = nativeShell()?.apiBase ?? '';

interface RequestConfig extends RequestInit {
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Endpoints whose 401 is the answer itself, not news about the login. */
const AUTH_PROBE_ENDPOINTS = /^\/auth\/(me|logout|refresh|web\/exchange)(\?|$)/;
const AUTH_RECHECK_INTERVAL_MS = 10_000;
let lastAuthRecheckAt = 0;

/**
 * A 401 on a request that carried the stored token means the login may be
 * gone (expired, revoked, account suspended). It used to surface only as one
 * failed request while the app kept looking signed in. The store asks
 * `/auth/me` and signs out if the server agrees; a 401 that was about
 * something else leaves the session alone.
 */
function recheckLoginAfterUnauthorized(endpoint: string, sentToken: boolean): void {
  if (!sentToken || AUTH_PROBE_ENDPOINTS.test(endpoint)) return;
  const now = Date.now();
  if (now - lastAuthRecheckAt < AUTH_RECHECK_INTERVAL_MS) return;
  lastAuthRecheckAt = now;
  void useAuthStore.getState().checkAuth();
}

class ApiClient {
  private getAuthHeader(): Record<string, string> {
    const token = useAuthStore.getState().token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async request<T>(endpoint: string, config: RequestConfig = {}): Promise<{ data: T }> {
    const isFormData = config.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...this.getAuthHeader(),
      ...config.headers,
    };

    // Remove Content-Type for FormData so the browser sets the boundary automatically
    if (isFormData) {
      delete headers['Content-Type'];
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...config,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        recheckLoginAfterUnauthorized(endpoint, Boolean(headers.Authorization));
      }
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new ApiError(
        error.error?.message || error.message || 'Request failed',
        response.status
      );
    }

    const data = await response.json();
    return { data };
  }

  async download(endpoint: string, config: RequestConfig = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...this.getAuthHeader(),
      ...config.headers,
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...config,
      method: config.method || 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        recheckLoginAfterUnauthorized(endpoint, Boolean(headers.Authorization));
      }
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new ApiError(
        error.error?.message || error.message || 'Request failed',
        response.status
      );
    }

    return response;
  }

  get<T>(endpoint: string, config?: RequestConfig) {
    return this.request<T>(endpoint, { ...config, method: 'GET' });
  }

  post<T>(endpoint: string, body?: unknown, config?: RequestConfig) {
    return this.request<T>(endpoint, {
      ...config,
      method: 'POST',
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    } as RequestConfig);
  }

  put<T>(endpoint: string, body?: unknown, config?: RequestConfig) {
    return this.request<T>(endpoint, {
      ...config,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(endpoint: string, body?: unknown, config?: RequestConfig) {
    return this.request<T>(endpoint, {
      ...config,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(endpoint: string, config?: RequestConfig) {
    return this.request<T>(endpoint, { ...config, method: 'DELETE' });
  }
}

export const api = new ApiClient();
