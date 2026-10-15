# Dynamic UI (Generative UI) im Modell-Chat

Antworten im Modell-Chat (`/chat`) können neben Text eine interaktive Oberfläche enthalten: Rechner, Dashboards,
Vergleiche, Tabellen. Das Modell entscheidet selbst, wann das sinnvoll ist; einfache Fragen bleiben Text.

## Ablauf

```
Nachricht → apiChats (Systemprompt + DYNAMIC_UI_INSTRUCTIONS) → Modell
  → Antworttext + optional ein ```plum-ui-Block (JSON, Schema v1)
  → gespeichert unverändert in assistant_api_turns.response
  → beim Auslesen: extractDynamicUi() trennt Text und Block, validateDynamicUi() prüft
  → Turn liefert response (Text), ui (validiert), uiError, uiPending (Block streamt noch)
  → Frontend validiert erneut und rendert DynamicUi in der Assistant-Nachricht
```

- **Anbieterneutral:** Der Block funktioniert mit allen Protokollen (OpenAI, Anthropic, Gemini) und streamt mit der
  Antwort. Kein separates Structured-Output-Feature nötig.
- **Keine Migration:** Der Block bleibt im gespeicherten Text; Verlauf und Neuladen zeigen die Ansicht wieder.
- **Fallback:** Ungültiges JSON oder Schemaverstösse → nur der Text wird gezeigt, plus ein kurzer Hinweis.
- **Nicht aktiv** für Dokumentrecherche (Antwort ist JSON) und Textauswahl-Bearbeitung.
- Gespeicherte Ergebnisse und Erinnerungen übernehmen nur den Text ohne Block.

## Schema v1 (`packages/shared/src/utils/dynamicUi.ts`)

`{ version: 1, title?, layout?, state?, computed?, data?, views?, root }`

- `state`: Eingabewerte; Eingabekomponenten binden per `bind`.
- `computed`: Formeln über State, andere Formeln und Aggregate.
- `data` / `views`: Datensätze und abgeleitete Sichten (Filter, Gruppierung, Aggregation, Sortierung, generierte Reihen).
- Komponenten-Registry: `stack row grid card calculator heading text markdown badge divider kpi slider input select
  segmented checkbox button table chart compare`. Alles andere wird verworfen.
- Grenzen: 250 Komponenten, Tiefe 10, 500 Zeilen pro Datensatz, Formeln max. 400 Zeichen.

## Sicherheit

- Kein `eval`, kein HTML, keine Skripte. Formeln laufen über einen eigenen Parser und Interpreter
  (`packages/shared/src/utils/dynamicUiExpr.ts`) mit fester Funktionsliste (min, max, round, pmt, fv, sumOf …).
  Nur eigene Namen sind erreichbar, nie die Prototyp-Kette.
- Aktionen: `sendMessage` (normale Folgenachricht im selben Chat), `set`, `reset`. Keine externen Aktionen.

## Frontend (`packages/frontend/src/components/assistant/dynamic-ui/`)

- `DynamicUi.tsx`: Registry-Renderer, ein gemeinsamer State pro Nachricht, Fehlergrenze. Lazy geladen (Recharts).
- `runtime.ts`: `UiRuntime` löst Formeln, Sichten und Platzhalter `{{formel|format}}` auf; Zyklen ergeben `null`.
- `dynamic-ui.css`: Glas-Material der Shell, Dark/Light, mobil einspaltig, reduzierte Bewegung.
- `fixtures.ts`: Beispiele A (Zinseszins), B (Umsatz-Dashboard), C (Produktvergleich).
- Demo ohne Modellaufruf: **`/chat/ui-demo`**.

Neue Komponente hinzufügen: Typ in `UiNode` + `UI_NODE_TYPES`, Prüfung in `checkNode`, Renderer in `REGISTRY`,
eine Zeile in `DYNAMIC_UI_INSTRUCTIONS`.

## Tests

`pnpm --filter @plum-code-webui/backend test:dynamic-ui` — Formeln, Fixtures, ungültige Beschreibungen, Extraktion
inkl. Streaming und Fallback, gemeinsamer State/Neuberechnung, Formatierung, Beispiel im Prompt.

## Konfiguration

Keine. Greift für alle Modell-Chat-Anbieter, sobald das Backend neu gebaut ist (`bash scripts/plum-rebuild.sh`).
Android zeigt vorerst nur den Text (der Block wird serverseitig entfernt); ein nativer Renderer folgt.
