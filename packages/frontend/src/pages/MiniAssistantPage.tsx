import { useEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { ApiChatStarter } from '@/components/assistant/ApiChatStarter';
import { useAuthStore } from '@/stores/authStore';
import { applyTheme, getStoredTheme } from '@/stores/appearanceStore';

export function MiniAssistantShell() {
  useEffect(() => {
    const sync = () => applyTheme(getStoredTheme());
    sync();
    window.addEventListener('storage', sync);
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      media.removeEventListener('change', sync);
    };
  }, []);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <Link to="/mini" className="font-semibold">
          Plum Mini
        </Link>
        <Link
          to="/chat"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline focus-visible:outline"
        >
          Plum öffnen
        </Link>
      </header>
      <Outlet />
    </div>
  );
}
export function MiniAssistantPage() {
  const owner = useAuthStore((state) => state.user?.id);
  return (
    <main className="mx-auto max-w-xl p-3 sm:p-4">
      <ApiChatStarter key={owner} compact chatPathPrefix="/mini/chat" />
    </main>
  );
}
