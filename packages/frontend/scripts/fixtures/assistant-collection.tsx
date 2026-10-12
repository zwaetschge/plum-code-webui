import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CollectionWorkspace } from '../../src/components/assistant/CollectionWorkspace';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({ user: { id: 'collection-alice', email: 'fixture.invalid' } as never });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const [collection, setCollection] = useState<AssistantResource>({
    id: 'collection-fixture',
    kind: 'collection',
    title: 'Meine Sammlung',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    body: {
      resourceIds: ['document-fixture', 'source-fixture', 'deleted-fixture'],
      favoriteIds: ['source-fixture'],
      description: '',
    },
  });
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-xl">Meine Sammlung</h1>
      <CollectionWorkspace collection={collection} onSaved={setCollection} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <Fixture />
    </MemoryRouter>
  </QueryClientProvider>
);
