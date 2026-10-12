import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVoiceInput } from '../../src/hooks/useVoiceInput';
function Harness() {
  const [enabled, setEnabled] = useState(true),
    [scope, setScope] = useState('one'),
    [text, setText] = useState('');
  const voice = useVoiceInput(setText, enabled, scope);
  return (
    <main>
      <label>
        Sprachchat
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </label>
      <button
        disabled={!voice.available || voice.busy}
        aria-pressed={voice.recording}
        onClick={voice.toggle}
      >
        Aufnahme
      </button>
      <button onClick={() => setScope('two')}>Gespräch wechseln</button>
      <output aria-label="Transkript">{text}</output>
      <span role="status">{voice.busy ? 'Transkription läuft' : 'Bereit'}</span>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
