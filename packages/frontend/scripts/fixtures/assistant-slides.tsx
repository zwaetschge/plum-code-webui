import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArtifactViewer } from '../../src/components/assistant/ArtifactViewer';
import type { AssistantResource } from '@plum-code-webui/shared';
import '../../src/index.css';
const initial: AssistantResource = {
  id: 'slides-fixture',
  kind: 'artifact',
  title: 'Mein Vortrag',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  body: {
    type: 'slides',
    format: 'markdown',
    content: '# Vergleich\nÄpfel und Birnen\n---\n# Fazit\nQuellen prüfen',
    sourceIds: [],
  },
};
function Fixture() {
  const [artifact, setArtifact] = useState(initial);
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-xl">Präsentation bearbeiten</h1>
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
