import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArtifactViewer } from '../../src/components/assistant/ArtifactViewer';
import { ComparisonStarter } from '../../src/components/assistant/ComparisonWorkspace';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({ user: { id: 'comparison-alice', email: 'fixture.invalid' } as never });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const [artifact, setArtifact] = useState<AssistantResource | null>(null);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-xl">Produkte vergleichen</h1>
      {artifact ? (
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
      ) : (
        <ComparisonStarter onCreated={setArtifact} />
      )}
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
