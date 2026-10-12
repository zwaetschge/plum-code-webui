import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';

/** A retained native token after a transient failure still needs server verification. */
export function NativeAuthRecovery() {
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const retry = useCallback(async () => {
    if (pending.current || !useAuthStore.getState().token) return;
    pending.current = true;
    setBusy(true);
    try {
      await checkAuth();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [checkAuth]);
  useEffect(() => {
    const timer = window.setInterval(() => void retry(), 5000);
    const online = () => void retry();
    window.addEventListener('online', online);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', online);
    };
  }, [retry]);
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center" role="status">
        <h1 className="text-xl font-semibold">Verbindung zu Plum unterbrochen</h1>
        <p className="text-sm text-muted-foreground">
          Der Server ist gerade nicht erreichbar. Deine Anmeldung bleibt erhalten. Plum versucht die
          Verbindung automatisch erneut.
        </p>
        <Button disabled={busy} onClick={() => void retry()}>
          {busy ? 'Verbinden …' : 'Erneut verbinden'}
        </Button>
      </div>
    </main>
  );
}
