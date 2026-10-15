import { lazy, Suspense, useState } from 'react';
import { DYNAMIC_UI_FIXTURES } from '@/components/assistant/dynamic-ui/fixtures';
import '@/components/assistant/dynamic-ui/dynamic-ui.css';

const DynamicUi = lazy(() => import('@/components/assistant/dynamic-ui/DynamicUi'));

/**
 * Local fixtures for Dynamic UI: the three reference views rendered exactly
 * like an assistant message, without a model call.
 */
export function DynamicUiDemoPage() {
  const [sent, setSent] = useState('');
  return (
    <main className="plum-api-conversation">
      <div className="plum-api-scroll">
        <div className="plum-api-content space-y-10">
          <header className="space-y-1">
            <h1 className="text-lg font-semibold">Interaktive Ansichten · Beispiele</h1>
            <p className="text-sm text-muted-foreground">
              So erscheinen dynamische Antworten im Chat. Alle Werte rechnen lokal neu.
            </p>
            {sent && (
              <p className="text-sm" role="status">
                Folgenachricht: „{sent}“
              </p>
            )}
          </header>
          {Object.entries(DYNAMIC_UI_FIXTURES).map(([key, spec]) => (
            <article key={key} className="plum-api-answer" data-fixture={key}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Plum</p>
              <Suspense fallback={null}>
                <DynamicUi spec={spec} onSendMessage={setSent} />
              </Suspense>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
