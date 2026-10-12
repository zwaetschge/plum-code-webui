import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../../src/stores/authStore';
import { MiniAssistantPage, MiniAssistantShell } from '../../src/pages/MiniAssistantPage';
import { ApiChatPage } from '../../src/pages/ApiChatPage';
import '../../src/index.css';
useAuthStore.setState({ user: { id: 'mini-alice', email: 'fixture.invalid' } as never });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
localStorage.setItem('theme', 'light');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/mini']}>
      <Routes>
        <Route path="/mini" element={<MiniAssistantShell />}>
          <Route index element={<MiniAssistantPage />} />
          <Route path="chat/:id" element={<ApiChatPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);
