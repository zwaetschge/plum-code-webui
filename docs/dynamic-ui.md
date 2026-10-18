# Dynamic UI (Generative UI) im Modell-Chat

Antworten im Modell-Chat (`/chat`) können neben Text eine interaktive Oberfläche enthalten: Rechner, Dashboards,
Vergleiche, Tabellen. Das Modell entscheidet selbst, wann das sinnvoll ist; einfache Fragen bleiben Text.

## Ablauf

```
Nachricht → apiChats (Systemprompt + DYNAMIC_UI_INSTRUCTIONS) → Modell
  → Antworttext + optional ein ```plum-ui-Block (JSON, Schema v1)
  → gespeichert unverändert in assistant_api_turns.response
  → beim Auslesen: extractDynamicUi() trennt Text/Block, liest Teil-JSON und löst Änderungen auf
  → recoverDynamicUi() isoliert Komponentenfehler; validateDynamicUi() prüft strikt
  → Turn liefert response (Text), ui (validiert), uiError, uiPending (Block streamt noch)
  → Frontend validiert erneut und rendert DynamicUi in der Assistant-Nachricht
```

- **Anbieterneutral:** Der Block funktioniert mit allen Protokollen (OpenAI, Anthropic, Gemini) und streamt mit der
  Antwort. Kein separates Structured-Output-Feature nötig.
- **Keine Migration:** Der Block bleibt im gespeicherten Text; Verlauf und Neuladen zeigen die Ansicht wieder.
- **Fallback:** Ungültiges JSON oder globale Daten-/Formelfehler → Text mit Hinweis. Fehler in einzelnen Komponenten → lokaler Platzhalter; gültige Nachbarn bleiben bedienbar.
- **Nicht aktiv** für Dokumentrecherche (Antwort ist JSON) und Textauswahl-Bearbeitung.
- Gespeicherte Ergebnisse und Erinnerungen übernehmen nur den Text ohne Block.

## Schema v1 (`packages/shared/src/utils/dynamicUi.ts`)

`{ version: 1, title?, layout?, state?, computed?, data?, views?, root }` (API ergänzt `viewId`)

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

Neue Komponente hinzufügen: Vertrag in `packages/shared/src/utils/dynamicUiCatalog.ts`, Typ in `UiNode`, semantische Prüfung in `checkNode`, Renderer in WebUI und Android. Modell-Signaturen und Pflichtfelder stammen aus dem Katalog; Androids Namen/Pflichtfelder werden daraus erzeugt:

```bash
node_modules/.bin/pnpm --filter @plum-code-webui/shared build
node scripts/generate-dynamic-ui-catalog.mjs
```

`test:dynamic-ui` prüft, dass die eingecheckte Android-Datei aktuell ist.

## Tests

`pnpm --filter @plum-code-webui/backend test:dynamic-ui` — Formeln, Fixtures, ungültige Beschreibungen, Extraktion
inkl. Streaming und Fallback, gemeinsamer State/Neuberechnung, Formatierung, Beispiel im Prompt.

## Konfiguration

Keine. Greift für alle Modell-Chat-Anbieter, sobald das Backend neu gebaut ist (`bash scripts/plum-rebuild.sh`).
Android rendert dieselben Ansichten nativ (`packages/android/.../ui/components/dynamicui/`: Kotlin-Port von Formel-Engine,
Validierung und Laufzeit, Compose-Komponenten, Canvas-Diagramme; Unit-Tests in `src/test/.../dynamicui/`).

## Schrittweiser Aufbau

Der begrenzte Teil-JSON-Parser übernimmt nur bereits empfangene Werte, ohne `eval` oder erfundene String-Inhalte. Vollständige gültige Kinder erscheinen vor dem Ende des Blocks; unvollständige Komponenten warten. Metadaten, State und Datensätze sollten vor `root` stehen. Teilansichten und Aktionen bleiben während des Antwortlaufs gesperrt. Ein abgebrochener/unvollständiger Block wird nach Laufende nicht als bedienbare Ansicht freigegeben.

## Gezielte Änderungen

Stabile Komponenten-IDs ermöglichen Änderungen an der zuletzt abgeschlossenen Ansicht desselben Chats:

```json
{"version":1,"patch":[{"op":"replace","target":"summary","node":{"type":"text","text":"Neue Zusammenfassung"}},{"op":"append","target":"panel","node":{"type":"text","id":"extra","text":"Ergänzung"}},{"op":"remove","target":"obsolete"}],"state":{"newInput":1}}
```

`replace` erhält die alte ID, sofern keine neue angegeben ist; `append` benötigt einen Container mit `children`. `remove` darf die Wurzel nicht entfernen. Maximal 50 Operationen; unbekannte Ziele werden gemeldet. Optionale `state`, `computed`, `data`, `views` ergänzen/ersetzen einzelne benannte Einträge, `title` ändert den Titel. Es gibt keine beliebigen Objektpfade, Skripte oder neuen externen Aktionen.

Die API fixiert die validierte Basis im vorhandenen `profile_json` des neuen Turns (`dynamicUiBase`). Änderungen bleiben dadurch auch nach Neuladen, Seitenwechsel und erneutem Abruf reproduzierbar. Der Basis-Snapshot steht dem Modell zusätzlich im begrenzten Gesprächskontext zur Verfügung. Vollständige neue Ansichten bekommen eine neue serverseitige `viewId`; Änderungen behalten die bestehende Identität. Bestehende gespeicherte v1-Blöcke funktionieren weiter.

## Eingabewerte

WebUI und Android halten explizit geänderte Eingabewerte pro Ansicht im jeweiligen Gespräch. Revisionen derselben `viewId` übernehmen kompatible Werte; neue Felder erhalten ihre neuen Vorgaben. Ein Wechsel des Feldtyps übernimmt keinen inkompatiblen Wert. Zurücksetzen verwendet die Vorgaben der aktuellen Revision. Eine neue vollständige Ansicht und ein anderer Chat teilen keinen Eingabezustand. Android sichert diesen lokalen Zustand zusätzlich über `rememberSaveable`; eine geräteübergreifende Synchronisation von Eingaben ist nicht Teil dieses Protokolls.

## Prüfung

Regressionsfälle prüfen jeden Präfix einer gestreamten Antwort, unterbrochene Blöcke, lokale Fehler, gesperrte Aktionen, gezielte Änderungen, unveränderte Historie und kompatible Eingaben. API-Integrationstests prüfen Basis-Snapshots ausserhalb der aktuellen Verlaufseite, Wiederholung desselben Befehls und Isolation zwischen Chats. Browser-Prüfung bei 1440/390 px: tatsächliche Teilansicht, Fokus- und Werterhalt, Aktionsinhalt und kein horizontaler Überlauf.
