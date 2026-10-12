import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArtifactViewer } from '../../src/components/assistant/ArtifactViewer';
import { useAuthStore } from '../../src/stores/authStore';
import { motionFromText, type AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
useAuthStore.setState({
  token: 'motion-audio-fixture-token',
  user: { id: 'audio-alice', email: 'audio@fixture.invalid' } as never,
});
const initial: AssistantResource = {
  id: 'motion-audio-fixture',
  kind: 'artifact',
  title: 'Mein Clip',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: {
    type: 'video',
    format: 'json',
    content: JSON.stringify({
      ...motionFromText('Übersicht'),
      width: 320,
      height: 180,
      duration: 2,
      fps: 2,
    }),
  },
};
function Fixture() {
  const [artifact, setArtifact] = useState(initial);
  (window as unknown as { __artifact: AssistantResource }).__artifact = artifact;
  return (
    <main className="mx-auto max-w-3xl p-4 font-sans">
      <h1 className="text-xl">Animation mit Audiospur</h1>
      <ArtifactViewer
        artifact={artifact}
        onSaved={() => setArtifact((window as unknown as { __saved: AssistantResource }).__saved)}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>
);
