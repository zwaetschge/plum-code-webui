import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativePreferences } from '../../src/components/assistant/NativePreferences';
import { useAuthStore } from '../../src/stores/authStore';
import '../../src/index.css';
useAuthStore.setState({
  token: 'native-preferences-fixture-token',
  user: { id: 'preferences-alice', email: 'preferences@fixture.invalid' } as never,
});
function Fixture() {
  const [command, setCommand] = useState('');
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4 font-sans">
      <h1 className="text-xl">Native Schwarm-Einstellungen</h1>
      <NativePreferences
        nativeUserId="@alice:fixture.invalid"
        epoch="existing-epoch"
        onCommand={setCommand}
      />
      <label className="grid gap-1">
        Vorbereitete Nachricht
        <textarea
          aria-label="Vorbereitete Nachricht"
          readOnly
          value={command}
          className="min-h-24 rounded-md border bg-background p-2"
        />
      </label>
    </main>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>
);
import.meta.hot?.dispose(() => root.unmount());
