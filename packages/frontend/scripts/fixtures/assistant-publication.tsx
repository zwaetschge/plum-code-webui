import React from 'react';
import { createRoot } from 'react-dom/client';
import { PublicationPanel } from '../../src/components/assistant/PublicationPanel';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({
  token: 'publication-fixture-only',
  user: { id: 'release-alice', email: 'release@fixture.invalid' } as never,
});
const id = new URLSearchParams(location.search).get('artifact')!;
const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <main className="mx-auto max-w-3xl p-4 font-sans">
      <h1 className="mb-4 text-xl">Ergebnis veröffentlichen</h1>
      <PublicationPanel
        resource={{ id, revision: 1, body: { type: 'app' }, kind: 'artifact' } as AssistantResource}
      />
    </main>
  </React.StrictMode>
);
import.meta.hot?.dispose(() => root.unmount());
