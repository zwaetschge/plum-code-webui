import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { socketService } from '@/services/socket';

interface UseSocketReturn {
  socket: ReturnType<typeof socketService.getSocket>;
  isConnected: boolean;
}

export function useSocket(): UseSocketReturn {
  const { isAuthenticated, token } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated && token) {
      try {
        socketService.connect();
      } catch (error) {
        console.error('Failed to connect socket:', error);
      }
    }

    return () => {
      // Read the live store rather than the captured values. This closure was
      // built during the render that armed the effect, so on the logout
      // transition it still saw `isAuthenticated === true` and the socket — with
      // the now-revoked token on it — was never torn down. That also covers the
      // unmount case: `logout()` flips the flag synchronously, before
      // `ProtectedRoute` redirects and takes this hook with it.
      const { isAuthenticated: stillAuthenticated, token: currentToken } = useAuthStore.getState();
      if (!stillAuthenticated || !currentToken) {
        socketService.disconnect();
      }
    };
  }, [isAuthenticated, token]);

  const socket = socketService.getSocket();
  const isConnected = socket?.connected ?? false;

  return { socket, isConnected };
}
