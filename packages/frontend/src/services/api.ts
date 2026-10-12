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
