import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiChatUsagePanel } from '../../src/components/analytics/ApiChatUsagePanel';
import { useAuthStore } from '../../src/stores/authStore';
import '../../src/index.css';
useAuthStore.setState({
  user: { id: 'api-usage-fixture', email: 'fixture@example.invalid', role: 'user' } as never,
  token: 'fixture-only',
  isAuthenticated: true,
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <main className="analytics-shell p-4">
      <ApiChatUsagePanel
        window={{ startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' }}
      />
    </main>
  </QueryClientProvider>
);
