import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceComposer } from '../../src/components/assistant/VoiceComposer';
import '../../src/index.css';
function Fixture() {
  const [scope, setScope] = useState('first'),
    [draft, setDraft] = useState(''),
    [answer, setAnswer] = useState('Langer Text '.repeat(1100)),
    [key, setKey] = useState('initial'),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState<string[]>([]);
  return (
    <main>
      <h1>Voice verification fixture</h1>
      <button onClick={() => setScope('second')}>Chat wechseln</button>
      <button
        onClick={() => {
          setAnswer('Die Antwort ist vollständig.');
          setKey('new-answer');
          setBusy(false);
        }}
      >
        Antwort abschliessen
      </button>
      <output aria-label="Diktat">{draft}</output>
      <output aria-label="Gesendet">{sent.join('|')}</output>
      <VoiceComposer
        text={answer}
        answerKey={key}
        scopeKey={scope}
        modelBusy={busy}
        onTranscription={setDraft}
        onSend={async (text) => {
          setSent((old) => [...old, text]);
          setBusy(true);
          return { status: 'accepted' };
        }}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
