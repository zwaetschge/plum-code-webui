import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssistantOutbox } from '../../src/components/assistant/AssistantOutbox';
import { deliverAssistant } from '../../src/services/assistantOutbox';
import { useAuthStore } from '../../src/stores/authStore';
import '../../src/index.css';
function Fixture() {
  const [error, setError] = useState('');
  return (
    <main>
      <h1>Outbox verification fixture</h1>
      <button
        onClick={() =>
          void deliverAssistant(
            '/api/assistant/matrix/rooms/%21fixture%3Aexample.invalid/events',
            {
              type: 'm.room.message',
              content: { msgtype: 'm.text', body: 'Unveränderter Originalauftrag' },
            },
            'Originalauftrag'
          ).catch((failure) => setError(failure.message))
        }
      >
        Nachricht senden
      </button>
      <button
        onClick={() =>
          useAuthStore.setState({
            user: {
              id: 'other',
              email: 'other@example.invalid',
              username: 'Other',
              role: 'user',
            } as never,
            token: 'other-fixture',
            isAuthenticated: true,
          })
        }
      >
        Konto wechseln
      </button>
      <p role="alert">{error}</p>
      <AssistantOutbox />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
