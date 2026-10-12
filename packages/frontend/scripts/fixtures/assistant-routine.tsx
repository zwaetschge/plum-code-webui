import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NativeRoutineControls } from '../../src/components/assistant/NativeRoutineControls';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({ user: { id: 'routine-alice', email: 'fixture.invalid' } as never });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const routine = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'routine',
  title: 'Morgenbriefing',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: {
    goal: 'Zeige meine fälligen Aufgaben, bestätigte Quellen und drei nächste Schritte.',
    schedule: 'werktags 07:00',
    timezone: 'Europe/Zurich',
    agentId: 'matrix:brian',
    enabled: false,
    owner: 'matrix',
  },
} as AssistantResource;
function Fixture() {
  const [value, setValue] = useState(routine),
    owner = useAuthStore((s) => s.user?.id);
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-3">
      <h1 className="text-lg">Mein Morgenbriefing</h1>
      <NativeRoutineControls key={`${owner}:${value.revision}`} routine={value} />
      <button
        onClick={() => {
          useAuthStore.setState({ user: { id: 'routine-bob' } as never });
        }}
      >
        Konto wechseln
      </button>
      <button
        onClick={() =>
          setValue({
            ...value,
            revision: value.revision + 1,
            body: { ...value.body, timezone: 'Etc/UTC' },
          })
        }
      >
        Zeitzone ändern
      </button>
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
