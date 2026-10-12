import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArtifactViewer } from '../../src/components/assistant/ArtifactViewer';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
const initial: AssistantResource = {
  id: 'motion-fixture',
  kind: 'artifact',
  title: 'Meine Bewegung',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: { type: 'video', format: 'markdown', content: 'Ein bewegter Kreis' },
};
function Fixture() {
  const [artifact, setArtifact] = useState(initial);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1>Animation gestalten</h1>
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
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
