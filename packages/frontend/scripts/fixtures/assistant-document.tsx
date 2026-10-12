import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../../src/stores/authStore';
import { ArtifactViewer } from '../../src/components/assistant/ArtifactViewer';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({
  token: 'document-fixture-token',
  user: { id: 'document-alice', email: 'fixture.invalid' } as never,
});
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const initial: AssistantResource = {
  id: 'document-fixture',
  kind: 'artifact',
  title: 'Mein Bericht',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: {
    type: 'document',
    format: 'markdown',
    content: '# Mein Bericht\nÄpfel und Birnen',
    sourceIds: [],
  },
};
function Fixture() {
  const [artifact, setArtifact] = useState(initial);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl">Dokument bearbeiten</h1>
      <ArtifactViewer
        artifact={artifact}
        onSaved={() =>
          setArtifact({
            ...artifact,
            revision: artifact.revision + 1,
            body: (window as unknown as { __savedBody: AssistantResource['body'] }).__savedBody,
          })
        }
      />
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
