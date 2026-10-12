import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
type OfficeBridge = {
  onReady: () => Promise<unknown>;
  context: { ui: { messageParent: (message: string, options: { targetOrigin: string }) => void } };
};
export function OfficeConnectPage() {
  const user = useAuthStore((s) => s.user),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const challenge = new URLSearchParams(location.search).get('challenge') ?? '';
  useEffect(() => {
    let active = true;
    const script = document.createElement('script');
    script.src = 'https://appsforoffice.microsoft.com/lib/1/hosted/office.js';
    script.async = true;
    script.onload = () => {
      const office = (window as unknown as { Office?: OfficeBridge }).Office;
      void office?.onReady().then(() => {
        if (active) setReady(!!office.context.ui.messageParent);
      });
    };
    script.onerror = () => {
      if (active) setError('Office-Dialog konnte nicht geladen werden.');
    };
    document.head.append(script);
    return () => {
      active = false;
      script.remove();
    };
  }, []);
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6 font-sans">
      <h1 className="text-xl font-semibold">Office mit Plum verbinden</h1>
      <p className="text-sm">Konto: {user?.email}</p>
      <p className="text-sm">
        Die Verbindung gilt eine Stunde für eigene Office-Textdialoge mit deinen API-Modellen.
        Ausgewählte Textstellen werden ausdrücklich übernommen; temporäre Dialoge verfallen nach 24
        Stunden.
      </p>
      <Button
        className="h-auto min-h-10 max-w-full whitespace-normal"
        disabled={busy || !ready || !/^[A-Za-z0-9_-]{43}$/.test(challenge)}
        onClick={async () => {
          const owner = user?.id;
          setBusy(true);
          setError('');
          try {
            const result = (
              await api.post<{ data: { ticket: string; expiresIn: number } }>(
                '/api/assistant/office-tickets',
                { challenge, origin: location.origin }
              )
            ).data.data;
            if (useAuthStore.getState().user?.id !== owner) return;
            (window as unknown as { Office: OfficeBridge }).Office.context.ui.messageParent(
              JSON.stringify({ type: 'plum-office-ticket', challenge, ticket: result.ticket }),
              { targetOrigin: location.origin }
            );
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : 'Office-Verbindung fehlgeschlagen'
            );
          } finally {
            if (useAuthStore.getState().user?.id === owner) setBusy(false);
          }
        }}
      >
        Dieses Konto für Office verbinden
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}
