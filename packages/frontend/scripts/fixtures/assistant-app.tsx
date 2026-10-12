import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppPreview } from '../../src/components/assistant/AppPreview';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../src/stores/authStore';
import '../../src/index.css';
const artifact = {
  id: new URLSearchParams(location.search).get('artifact') ?? 'fixture-app',
  kind: 'artifact' as const,
  title: 'Zähler',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: { type: 'app', format: 'html' },
};
import { content } from './assistant-app-content';
function Fixture() {
  const [revision, setRevision] = useState(1);
  return (
    <main>
      <h1>App verification fixture</h1>
      <button onClick={() => setRevision((value) => (value === 1 ? 2 : 1))}>
        Revision wechseln
      </button>
      <AppPreview
        artifact={{ ...artifact, revision, body: { ...artifact.body, content } }}
        content={content}
        readOnly={false}
      />
    </main>
  );
}
useAuthStore.setState({ user: { id: 'app-alice', email: 'app@example.invalid' } as never });
const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <MemoryRouter>
      <Fixture />
    </MemoryRouter>
  </React.StrictMode>
);
import.meta.hot?.dispose(() => root.unmount());
