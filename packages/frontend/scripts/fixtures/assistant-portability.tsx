import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortabilityPanel } from '../../src/components/settings/PortabilityPanel';
import { AssistantOutbox } from '../../src/components/assistant/AssistantOutbox';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(
  <main className="p-4">
    <PortabilityPanel />
    <AssistantOutbox />
  </main>
);
