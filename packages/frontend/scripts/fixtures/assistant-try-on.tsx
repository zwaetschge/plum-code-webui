import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ArtifactViewer } from '../../src/components/assistant/ArtifactViewer';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({
  token: 'try-on-fixture-token',
  user: { id: 'try-alice', email: 'try@fixture.invalid' } as never,
});
const artifact: AssistantResource = {
  id: 'try-comparison-fixture',
  kind: 'artifact',
  title: 'Hemden vergleichen',
  revision: 7,
  createdAt: '',
  updatedAt: '',
  body: {
    type: 'comparison',
    format: 'json',
    content: JSON.stringify({
      type: 'plum-comparison',
      version: 1,
      offers: [
        {
          id: 'offer-one',
          name: 'Blaues Hemd',
          price: '39 CHF',
          url: 'https://example.invalid/hemd',
          asOf: '2026-10-10T10:00:00Z',
          sourceId: 'source-fixture',
          sourceRevision: 2,
          quote: 'Blaues Hemd 39 CHF',
          details: '',
          favorite: false,
        },
      ],
      decision: '',
    }),
  },
};
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter>
      <main className="mx-auto max-w-3xl space-y-3 p-4 font-sans">
        <h1 className="text-xl">Produktvergleich und Anprobe</h1>
        <ArtifactViewer artifact={artifact} onSaved={() => {}} />
      </main>
    </MemoryRouter>
  </React.StrictMode>
);
