import { Fragment, lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DynamicUiSpec, UiResults } from '@plum-code-webui/shared';
import { DYNAMIC_UI_FIXTURES } from '@/components/assistant/dynamic-ui/fixtures';
import {
  DEMO_DELAYED_RESULTS,
  DEMO_TURNS,
  FOLLOWUPS_ONLY,
  WIDGET_TURNS,
  demoRefresh,
  type DemoTurn,
} from '@/components/assistant/dynamic-ui/fixtures-v2';
import { DynamicUiHostContext } from '@/components/assistant/dynamic-ui/host';
import { demoDynamicUiHost } from '@/components/assistant/dynamic-ui/demoHost';
import { Followups } from '@/components/assistant/dynamic-ui/Followups';
import { ChatRichText } from '@/components/assistant/ChatRichText';
import '@/components/assistant/dynamic-ui/dynamic-ui.css';
import { StartScene } from '@/components/assistant/StartScene';
import { START_SUGGESTIONS } from '@/components/assistant/startSuggestionData';
import '@/components/assistant/start-suggestions.css';

const DynamicUi = lazy(() => import('@/components/assistant/dynamic-ui/DynamicUi'));

const V1_TURNS: DemoTurn[] = Object.entries(DYNAMIC_UI_FIXTURES).map(([key, spec]) => ({
  key,
  prompt: (spec as DynamicUiSpec).title ?? key,
  answer: '',
  spec: spec as DynamicUiSpec,
}));

/**
 * Every Dynamic UI element rendered exactly like an assistant message, with
 * fixture live results (resolved, pending, failed) and no model or network
 * call. `?only=wetter,quiz` limits the page to some examples (`kacheln` = all
 * custom tiles).
 */
export function DynamicUiDemoPage() {
  const [params] = useSearchParams();
  const only = params.get('only')?.split(',').filter(Boolean) ?? null;
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<Record<string, UiResults>>(() =>
    Object.fromEntries(
      [...DEMO_TURNS, ...WIDGET_TURNS].map((turn) => [turn.key, turn.results ?? {}])
    )
  );
  // Like the server's socket push: a tile's live input resolves after a moment.
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setResults((current) => {
          const next = { ...current };
          for (const [key, delayed] of Object.entries(DEMO_DELAYED_RESULTS))
            next[key] = { ...next[key], ...delayed };
          return next;
        }),
      1400
    );
    return () => window.clearTimeout(timer);
  }, []);
  const shown = (turn: DemoTurn) =>
    !only ||
    only.includes(turn.key) ||
    (only.includes('kacheln') && turn.key.startsWith('kachel-'));
  const turns = [...DEMO_TURNS, ...WIDGET_TURNS, FOLLOWUPS_ONLY, ...V1_TURNS].filter(shown);
  const refresh = (key: string) => async (nodeId: string) => {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    const next = demoRefresh(nodeId);
    if (next) setResults((current) => ({ ...current, [key]: { ...current[key], [nodeId]: next } }));
  };
  return (
    <DynamicUiHostContext.Provider value={demoDynamicUiHost}>
      <main className="plum-api-conversation">
        <div className="plum-api-scroll">
          <div className="plum-api-content space-y-10 pb-24">
            <header className="space-y-2">
              <h1 className="text-lg font-semibold">Interaktive Ansichten · Beispiele</h1>
              <p className="text-sm text-muted-foreground">
                So erscheinen dynamische Antworten (v2) im Chat. Alle Werte rechnen lokal neu;
                Live-Daten sind Beispieldaten.
              </p>
              {!only && (
                <nav className="flex flex-wrap gap-1.5 pt-1" aria-label="Beispiele">
                  {turns.map((turn) => (
                    <a
                      key={turn.key}
                      href={`#demo-${turn.key}`}
                      className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {turn.key}
                    </a>
                  ))}
                </nav>
              )}
              {notice && (
                <p className="text-sm" role="status">
                  {notice}
                </p>
              )}
            </header>
            {turns.map((turn) => (
              <Fragment key={turn.key}>
                {turn.key === turns.find((entry) => entry.key.startsWith('kachel-'))?.key && (
                  <header className="space-y-1 border-t pt-8">
                    <h2 className="text-base font-semibold">Eigene Kacheln</h2>
                    <p className="text-sm text-muted-foreground">
                      Vom Modell geschriebene Mini-Apps (HTML, CSS, JavaScript) in einer
                      abgeschotteten Sandbox: ohne Netz, ohne Zugriff auf Plum. Zustand bleibt bei
                      der Nachricht gespeichert.
                    </p>
                  </header>
                )}
                <article
                  id={`demo-${turn.key}`}
                  className="min-w-0 space-y-3"
                  data-fixture={turn.key}
                >
                  {turn.answer && (
                    <div className="plum-api-user-row">
                      <div className="plum-api-user">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Du</p>
                        <p className="whitespace-pre-wrap break-words">{turn.prompt}</p>
                      </div>
                    </div>
                  )}
                  <div className="plum-api-answer">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Plum</p>
                    {turn.answer && <ChatRichText text={turn.answer} />}
                    {turn.spec && (
                      <Suspense fallback={null}>
                        <DynamicUi
                          spec={turn.spec}
                          stateKey={`demo-${turn.key}`}
                          turnId={`demo-${turn.key}`}
                          results={results[turn.key]}
                          onSendMessage={(text) => setNotice(`Folgenachricht: „${text}“`)}
                          onPrefill={(text) => setNotice(`In die Eingabe übernommen: „${text}“`)}
                          onRefreshResult={refresh(turn.key)}
                        />
                      </Suspense>
                    )}
                    {!!turn.followups?.length && (
                      <Followups
                        items={turn.followups}
                        onSelect={(text) => setNotice(`Folgefrage: „${text}“`)}
                      />
                    )}
                  </div>
                </article>
              </Fragment>
            ))}
            {!only && (
              <section className="space-y-3" aria-label="Startvorschläge">
                <h2 className="text-sm font-semibold">
                  Startvorschläge · alle {START_SUGGESTIONS.length}
                </h2>
                <div className="plum-start-deck">
                  {START_SUGGESTIONS.map((item) => (
                    <div key={item.key} className="plum-start-card" data-scene={item.key}>
                      <span className="plum-start-preview" aria-hidden>
                        <StartScene name={item.key} />
                      </span>
                      <span className="plum-start-copy">
                        <span className="plum-start-title">
                          <item.icon size={15} aria-hidden />
                          {item.title}
                        </span>
                        <span className="plum-start-hint">{item.hint}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </DynamicUiHostContext.Provider>
  );
}
