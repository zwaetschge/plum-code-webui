import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { nativeShell } from '@/lib/nativeShell';
import { clearSessionStorageInBrowser } from '@/lib/sessionStorageKeys';
import type { User } from '@plum-code-webui/shared';
import { api, ApiError } from '@/services/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  initializeAuth: () => Promise<void>;
}

function isAuthFailure(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,

      setToken: async (token: string) => {
        set({ token, isLoading: true });
        try {
          const response = await api.get<{ success: boolean; data: User }>('/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.data.success && response.data.data) {
            set({ user: response.data.data, isAuthenticated: true, isLoading: false });
          } else {
            set({ token: null, isAuthenticated: false, isLoading: false });
          }
        } catch (err) {
          if (isAuthFailure(err)) {
            set({ token: null, user: null, isAuthenticated: false, isLoading: false });
          } else {
            // Network / transient error: keep token, just stop loading.
            // Next request will retry; don't force the user to re-login.
            set({ isLoading: false });
          }
        }
      },

      logout: () => {
        // Drafts and unsent messages are plain text; the next account must not see them.
        clearSessionStorageInBrowser();
        set({ user: null, token: null, isAuthenticated: false });
        if (nativeShell()) {
          (window as Window & { PlumHost?: { logout(): void } }).PlumHost?.logout();
          return;
        }
        api.post('/auth/logout').catch(() => {});
      },

      checkAuth: async () => {
        const { token } = get();
        if (!token) {
          set({ isLoading: false });
          return;
        }

        try {
          const response = await api.get<{ success: boolean; data: User }>('/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.data.success && response.data.data) {
            set({ user: response.data.data, isAuthenticated: true, isLoading: false });
          } else {
            set({ token: null, user: null, isAuthenticated: false, isLoading: false });
          }
        } catch (err) {
          if (isAuthFailure(err)) {
            set({ token: null, user: null, isAuthenticated: false, isLoading: false });
          } else {
            // Keep the token on network/transient errors so new tabs can recover
            // once the backend is reachable again.
            set({ isLoading: false });
          }
        }
      },

      initializeAuth: async () => {
        set({ isLoading: true });
        try {
          // Wait for persist rehydration before reading the token. Otherwise a
          // fresh tab can read token=null and incorrectly flip isAuthenticated
          // to false before the persisted token arrives.
          if (!useAuthStore.persist.hasHydrated()) {
            await new Promise<void>((resolve) => {
              const unsub = useAuthStore.persist.onFinishHydration(() => {
                unsub();
                resolve();
              });
            });
          }
          await get().checkAuth();
        } finally {
          // checkAuth already manages isLoading, but guarantee it is cleared
          // even on unexpected early returns.
          if (get().isLoading) set({ isLoading: false });
        }
      },
    }),
    {
      name: 'claude-webui-auth',
      ...(nativeShell()
        ? {
            storage: createJSONStorage(() => ({
              getItem: () =>
                JSON.stringify({ state: { token: nativeShell()?.token ?? null }, version: 0 }),
              setItem: () => {},
              removeItem: () => {},
            })),
          }
        : {}),
      partialize: (state) => ({ token: state.token }),
    }
  )
);
