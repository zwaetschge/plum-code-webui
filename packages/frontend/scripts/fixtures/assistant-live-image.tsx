import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveImageCapture } from '../../src/components/assistant/LiveImageCapture';
import { ChatImageInput } from '../../src/components/assistant/ChatImages';
import '../../src/index.css';
function Fixture() {
  const [scope, setScope] = useState('alice:chat-a'),
    [files, setFiles] = useState<File[]>([]),
    [shown, setShown] = useState(true),
    [disabled, setDisabled] = useState(false);
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-xl">Bilder für Plum Chat</h1>
      <button onClick={() => setScope('bob:chat-b')}>Konto wechseln</button>
      <button onClick={() => setShown(false)}>Ansicht verlassen</button>
      <button onClick={() => setDisabled(true)}>Nachricht läuft</button>
      {shown && (
        <LiveImageCapture
          scopeKey={scope}
          disabled={disabled}
          remaining={4 - files.length}
          onCapture={(file) => setFiles((current) => [...current, file])}
        />
      )}
      <ChatImageInput files={files} onChange={setFiles} disabled={disabled} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
