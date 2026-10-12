import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../../src/stores/authStore';
import { LibrarySearch } from '../../src/components/assistant/LibrarySearch';
import '../../src/index.css';
useAuthStore.setState({ user: { id: 'search-alice', email: 'fixture.invalid' } as never });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <main className="mx-auto max-w-4xl p-4">
        <LibrarySearch />
      </main>
    </MemoryRouter>
  </QueryClientProvider>
);
