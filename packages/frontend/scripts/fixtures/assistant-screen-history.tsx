import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenHistoryDisclosure } from '../../src/components/assistant/ScreenHistory';
import '../../src/index.css';
function Fixture() {
  const [scope, setScope] = useState('alice:a'),
    [shown, setShown] = useState(true),
    [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-xl">Fensterverlauf für Plum</h1>
      <div className="flex flex-wrap gap-3">
        <button onClick={() => setScope('bob:b')}>Konto wechseln</button>
        <button onClick={() => setShown(false)}>Ansicht verlassen</button>
        <button onClick={() => setBusy(true)}>Antwort läuft</button>
      </div>
      {shown && (
        <ScreenHistoryDisclosure
          key={scope}
          scopeKey={scope}
          disabled={busy}
          remaining={2}
          onUse={(files, context) => {
            (window as unknown as { __chosen: unknown }).__chosen = { files, context };
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
