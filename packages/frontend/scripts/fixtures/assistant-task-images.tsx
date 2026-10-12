import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskImages } from '../../src/components/assistant/TaskImages';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({ user: { id: 'photo-alice', email: 'fixture.invalid' } as never });
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function fresh(id: string): AssistantResource {
  return {
    id,
    kind: 'task',
    title: id === 'photo-task' ? 'Foto analysieren' : 'Zweiter Auftrag',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    body: { goal: 'Original erhalten', status: 'draft', inputImageIds: [] },
  };
}
function Fixture() {
  const [task, setTask] = useState(fresh('photo-task')),
    [blocked, setBlocked] = useState(false);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl">{task.title}</h1>
      <TaskImages key={task.id} task={task} onBusy={setBlocked} onChanged={setTask} />
      <button
        disabled={blocked}
        onClick={() => setTask({ ...task, body: { ...task.body, status: 'queued' } })}
      >
        Starten
      </button>
      <button onClick={() => setTask(fresh('photo-task-2'))}>Anderen Auftrag öffnen</button>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <Fixture />
  </QueryClientProvider>
);
