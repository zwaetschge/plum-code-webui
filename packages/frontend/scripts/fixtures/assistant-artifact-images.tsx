import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArtifactViewer } from '../../src/components/assistant/ArtifactViewer';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({
  user: { id: 'picture-alice', email: 'fixture.invalid' } as never,
  token: 'artifact-fixture-only',
});
const artifact = {
  id: 'image-artifact',
  kind: 'artifact',
  title: 'Meine Zeichnung',
  revision: 2,
  createdAt: '',
  updatedAt: '',
  body: {
    type: 'image',
    format: 'markdown',
    sourceIds: [],
    evidence: [],
    content:
      'Original und Resultat\n\n![Meine Zeichnung](/generated/00000000-0000-4000-8000-00000000000a.png)',
    images: [
      {
        url: '/generated/00000000-0000-4000-8000-00000000000a.png',
        assetId: 'image-original',
        filename: 'Zeichnung.png',
        mimeType: 'image/png',
        byteLength: 100,
        sha256: 'fixture',
      },
    ],
  },
} as AssistantResource;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const [shared, setShared] = useState(false);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-3">
      <h1 className="text-lg">Meine Zeichnung</h1>
      <ArtifactViewer
        key={String(shared)}
        artifact={artifact}
        readOnly={shared}
        shareToken={shared ? 'fixture-share' : undefined}
        onSaved={() => {}}
      />
      <button onClick={() => setShared(true)}>Freigabeansicht</button>
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
