import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../../src/stores/authStore';
import { CollaborativeDocumentPage } from '../../src/pages/CollaborativeDocumentPage';
import { DocumentMembers } from '../../src/components/assistant/DocumentMembers';
import '../../src/index.css';
const owner = new URLSearchParams(location.search).has('owner'),
  index = new URLSearchParams(location.search).has('index');
useAuthStore.setState({
  token: owner ? 'document-owner-fixture-jwt' : 'document-access-fixture-jwt',
  user: {
    id: owner ? 'doc-owner' : 'doc-editor',
    email: owner ? 'doc-owner@fixture.invalid' : 'doc-editor@fixture.invalid',
  } as never,
});
(window as unknown as { __switchOwner: () => void }).__switchOwner = () =>
  useAuthStore.setState({
    token: 'other-fixture-jwt',
    user: { id: 'doc-other', email: 'doc-other@fixture.invalid' } as never,
  });
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const resource = {
  id: 'shared-document-fixture',
  kind: 'artifact' as const,
  title: 'Gemeinsamer Bericht',
  revision: 2,
  body: { type: 'document', format: 'markdown', content: 'Original ä' },
  createdAt: '',
  updatedAt: '',
};
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[index ? '/collaborate' : '/collaborate/shared-document-fixture']}
      >
        <Routes>
          <Route
            path="/collaborate/:id?"
            element={
              owner ? (
                <main className="mx-auto max-w-xl p-4 font-sans">
                  <h1>Dokumentrechte</h1>
                  <DocumentMembers resource={resource} />
                </main>
              ) : (
                <CollaborativeDocumentPage />
              )
            }
          />
          <Route path="/assistant/artifacts" element={<p>Ergebnisse</p>} />
        </Routes>
        <Link to="/collaborate">Gemeinsame Übersicht</Link>
      </MemoryRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
