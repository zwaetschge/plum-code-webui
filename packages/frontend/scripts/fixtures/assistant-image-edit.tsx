import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageEditTask } from '../../src/components/assistant/ImageEditTask';
import { useAuthStore } from '../../src/stores/authStore';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({ user: { id: 'edit-alice', email: 'fixture.invalid' } as never });
const source = {
  id: 'source-task',
  kind: 'task',
  title: 'Original',
  revision: 2,
  createdAt: '',
  updatedAt: '',
  body: { status: 'draft', inputImageIds: ['image-fixture'] },
} as AssistantResource;
function Fixture() {
  const [created, setCreated] = useState<AssistantResource | null>(null),
    [open, setOpen] = useState(true);
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-3">
      {created ? (
        <>
          <h1>Neuer Bildauftrag</h1>
          <p>{created.body.goal as string}</p>
          <p>Entwurf – noch nicht gestartet</p>
        </>
      ) : open ? (
        <ImageEditTask
          task={source}
          image={{
            id: 'image-fixture',
            filename: 'Grün.png',
            mimeType: 'image/png',
            byteLength: 100,
          }}
          onCreated={setCreated}
          onClose={() => setOpen(false)}
        />
      ) : (
        <p>Geschlossen</p>
      )}
      <button
        onClick={() => {
          useAuthStore.setState({ user: { id: 'edit-bob' } as never });
          setOpen(false);
        }}
      >
        Konto wechseln
      </button>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
