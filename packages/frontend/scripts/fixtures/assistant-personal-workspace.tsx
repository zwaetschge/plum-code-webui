import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PersonalWorkspaceStarter } from '../../src/components/assistant/PersonalWorkspaceStarter';
import { useAuthStore } from '../../src/stores/authStore';
import '../../src/index.css';
useAuthStore.setState({
  token: 'personal-workspace-fixture-token',
  user: { id: 'personal-alice', email: 'personal@fixture.invalid' } as never,
});
const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <MemoryRouter>
      <main className="mx-auto max-w-3xl space-y-4 p-4 font-sans">
        <h1 className="text-xl">Persönliches Wissen</h1>
        <PersonalWorkspaceStarter />
      </main>
    </MemoryRouter>
  </React.StrictMode>
);
import.meta.hot?.dispose(() => root.unmount());
