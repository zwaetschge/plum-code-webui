# Dynamic UI (Generative UI) im Modell-Chat · v2

Antworten im Modell-Chat (`/chat`) können neben Text eine interaktive Oberfläche enthalten: Rechner, Dashboards,
Vergleiche, Pläne mit Checklisten, Quiz und Lernkarten, Live-Daten wie Wetter, Kurse und Wechselkurse, Steckbriefe,
Nachrichten und Bilder. Dazu kommen Folgefragen als Chips unter der Antwort. Das Modell entscheidet selbst, wann das
sinnvoll ist; einfache Fragen bleiben Text. Vertrag und Hintergrund: `docs/plans/dynamic-ui-v2-2026-11-07.md`.

## Ablauf

````
Nachricht → apiChats (Systemprompt + dynamicUiInstructions(answerDisplay)) → Modell
  → Antworttext + optional ein ```plum-ui-Block (JSON, Schema v1 oder v2)
  → gespeichert unverändert in assistant_api_turns.response
  → beim Auslesen: extractDynamicUi() trennt Text/Block, liest Teil-JSON, löst Änderungen auf,
    zieht `followups` heraus
  → recoverDynamicUi() isoliert Komponentenfehler; validateDynamicUi() prüft strikt
  → Turn liefert response (Text), ui (validiert), uiError, uiPending (Block streamt noch),
    followups (0–3 Chips, leer solange gestreamt wird) und uiResults (Live-Daten)
  → Live-Bausteine: sobald der Block vollständig ist, löst der Server sie auf (dynamicUiLive.ts),
    speichert das Ergebnis (ui_results_json) und pusht `assistant:ui-result` in den Raum user:<id>
  → Frontend validiert erneut und rendert DynamicUi + Folgefragen in der Assistant-Nachricht
````

- **Anbieterneutral:** Der Block funktioniert mit allen Protokollen (OpenAI, Anthropic, Gemini) und streamt mit der
  Antwort. Kein separates Structured-Output-Feature nötig.
- **Fallback:** Ungültiges JSON oder globale Daten-/Formelfehler → Text mit Hinweis. Fehler in einzelnen Komponenten
  → lokaler Platzhalter; gültige Nachbarn bleiben bedienbar. Ein Renderfehler im Browser trifft nur den einen
  Baustein (Fehlergrenze pro Knoten).
- **Nicht aktiv** für Dokumentrecherche (Antwort ist JSON), Textauswahl-Bearbeitung und Sprach-Turns.
- **„Darstellung: Einfach“** (Personalisierung, `answerDisplay: 'simple'`): keine Ansichten, nur Folgefragen. Die
  Einstellung wird pro Turn fixiert; ältere Antworten ändern sich nicht nachträglich.
- Gespeicherte Ergebnisse, Erinnerungen und „Kopieren“ übernehmen nur den Text, nie Block oder Folgefragen.

## Schema (`packages/shared/src/utils/dynamicUi.ts`)

`{ version: 1|2, title?, layout?, state?, computed?, data?, views?, followups?, root }` (API ergänzt `viewId`).
Version 2 ist eine Obermenge von Version 1; beide werden angenommen. Ein Block darf **nur** `followups` enthalten
(dann ohne `root`): so bekommen auch reine Textantworten Chips.

- `state`: Eingabewerte; Eingabekomponenten binden per `bind`.
- `computed`: Formeln über State, andere Formeln und Aggregate (`sumOf`, `avgOf`, `minOf`, `maxOf`, `countOf` …).
- `data` / `views`: Datensätze und abgeleitete Sichten (Filter, Gruppierung, Aggregation, Sortierung, generierte Reihen).
- `followups`: 1–3 kurze Folgefragen (je ≤ 80 Zeichen).
- Grenzen: 250 Komponenten, Tiefe 10, 500 Zeilen pro Datensatz, höchstens 6 Live-Bausteine, Formeln max. 400 Zeichen;
  alle Werte in `DYNAMIC_UI_LIMITS`.

Komponenten (Signaturen und Pflichtfelder: `dynamicUiCatalog.ts`):

| Gruppe              | Bausteine                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Layout              | `stack row grid card tabs accordion calculator`                                                      |
| Inhalt              | `heading text markdown badge divider carousel list timeline callout progress rating image code math` |
| Daten               | `kpi table chart compare`                                                                            |
| Eingaben            | `slider input select segmented checkbox button stepper radio textarea date form`                     |
| Lernen & Pläne      | `checklist quiz flashcards` (Zustand bleibt pro Nachricht erhalten)                                  |
| Live (Server füllt) | `weather currency stock entity news gallery`                                                         |

Verbesserte v1-Bausteine: `chart` mit `kind: "scatter"`, `ranges` + `rangeBind` (Segment über dem Diagramm), Legende
blendet Reihen ein/aus, Vollbild, CSV und PNG; `table` sortierbar (Standard ab 6 Zeilen, `tableSortable`), Suchfeld
ab 10 Zeilen, Vollbild, CSV; `card` mit `image`, `expandable` (Vollbild) und bis zu zwei `actions`; `kpi` mit `delta`
(farbige Veränderung) und `spark` (Mini-Linie aus einer Sicht).

### Aktionen

`sendMessage` (Folgenachricht im selben Chat), `set`, `reset`, `copy` (Bestätigung „Kopiert“), `openUrl` (nur
`https:`, neuer Tab ohne Opener/Referrer), `prefill` (füllt den Composer, sendet nicht), `openEntity` (öffnet den
Wikipedia-Steckbrief). Unbekannte Aktionen tun nichts. `sendMessage`, `set` und `reset` sind gesperrt, solange im
Chat eine Antwort läuft; alles ist gesperrt, solange die eigene Ansicht noch streamt.

## Live-Bausteine (`packages/shared/src/utils/dynamicUiLive.ts`)

Das Modell nennt nur Parameter, nie Zahlen: `{"type":"weather","id":"w1","location":"Zürich"}`. Der Server löst den
Knoten auf und legt pro Knoten-ID einen Umschlag in `turn.uiResults` ab:
`{type, key, status: pending|resolved|failed, data?, error?, retryable?, fetchedAt?}`. Ein Ergebnis gilt nur,
solange `result.key === uiLiveKey(node)` (geänderte Parameter durch eine Änderung → wieder `pending`).

| Typ        | Parameter                        | Quelle                     | Cache  |
| ---------- | -------------------------------- | -------------------------- | ------ |
| `weather`  | `location`, `days?` (1–10)       | Open-Meteo                 | 10 min |
| `currency` | `from`, `to`, `amount?`          | Frankfurter (EZB)          | 60 min |
| `stock`    | `symbol`, `range?` (1M/6M/1Y/5Y) | Stooq (Yahoo als Ausweich) | 15 min |
| `entity`   | `title`, `lang?`                 | Wikipedia REST             | 24 h   |
| `news`     | `query`                          | SearXNG `news`             | 30 min |
| `gallery`  | `query`                          | SearXNG `images`           | 24 h   |

- `data`-Felder sind snake_case; `*_text` ist für de-CH vorformatiert, `change_tone` färbt Veränderungen. Für
  Hover-Werte formatieren Clients selbst mit `formatUiPrice`, `formatUiChange`, `formatUiTemperature`, `uiWeatherCode`.
- Live-Push: Socket-Event `assistant:ui-result` `{chatId, turnId, id, result}`. Die WebUI hört in
  `services/socket.ts` (`socketService.onUiResult`) und mischt das Ergebnis in den gecachten Turn (`ApiChatPage`).
- „Erneut versuchen“: `POST /api/assistant/chats/:chatId/turns/:turnId/ui/:id/refresh` (`uiResultRefreshPath`),
  Antwort `{success, data: AnyUiResult}`; pusht zusätzlich das Socket-Event.
- Bilder ausschliesslich über den Proxy `GET /api/assistant/ui/image?url=` (`uiImageProxyUrl`): nur `https`, nur
  `image/*`, ≤ 8 MB, ≤ 3 Weiterleitungen, keine privaten Adressen, Cache 24 h. Die WebUI lädt sie mit dem
  API-Token als Blob (`dynamic-ui/host.ts`), es gibt keine Anfragen vom Browser an Fremdseiten.
- Steckbriefe: `GET /api/assistant/ui/entity?title=&lang=` → `{success, data: UiResult<'entity'>}`.
- Inline-Entitäten im Antworttext: `[Ada Lovelace](entity:Ada_Lovelace)` (`parseUiEntityHref`). WebUI: Hover-Karte
  bei feinem Zeiger (Öffnen nach ~220 ms, Schliessen nach 150 ms, Esc schliesst, Tastaturfokus öffnet), auf Touch
  ein Bottom-Sheet.

## Eigene Kacheln (`type: "widget"`, v2.1)

Für alles, was der Katalog nicht gut kann (Werkzeuge, Spiele, Simulationen, eigene Diagramme), schreibt das Modell
eine eigene Kachel: eigenständiges HTML mit `<style>`/`<script>` in einem Block ` ```plum-widget <id> title="…" `,
platziert per `{"type":"widget","id":"<id>",…}` oder ohne Ansicht unter dem Text. `extractDynamicUi` verschiebt den
Code nach `node.html`; Clients sehen nur geprüfte Knoten. Vertrag: `docs/plans/dynamic-ui-widgets-2026-11-07.md`.

- **Grenzen** (`DYNAMIC_UI_LIMITS`): 4 Kacheln pro Ansicht, Code ≤ 60 000 Zeichen, `props`/`state` je ≤ 16 000
  JSON-Zeichen, Höhe 80–1200 px, `live` ≤ 4 Eingänge (zählen zu den 6 Live-Bausteinen). Gespeicherter Zustand
  ≤ 32 KB, `plum.image` ≤ 24 Bilder pro Kachel und ≤ 2 MB, Fehlermeldungen nur die ersten 3.
- **Laufzeit** `packages/frontend/public/ui-widget.html` (Android: identische, erzeugte Kopie in
  `assets/dynamic-ui/`): stellt `window.plum` bereit (`props`, `live`, `state`/`setState`, `sendMessage`, `prefill`,
  `copy`, `openUrl`, `openEntity`, `image`, `refresh`, `requestFullscreen`, `format`, `on('live'|'theme'|…)`),
  Grundstile für Buttons (`.primary` für Hauptaktionen), Felder, Tabellen, `.card` und die Variablen `--plum-*`.
- **Protokoll** (`postMessage`, Android JSON-String): Kachel → Host `ready`, `rendered`, `height`, `state`,
  `sendMessage`, `prefill`, `copy`, `openUrl`, `openEntity`, `refresh`, `display`, `image`, `error`; Host → Kachel
  einmal `render` (Code, `props`, `live`, gespeicherter Zustand, Theme, Anzeige), danach `live`, `theme`, `display`
  und Bild-Antworten. Live-Eingänge sind gewöhnliche Live-Ergebnisse mit der ID `<kachel>__<name>`
  (`uiWidgetLiveId`); fehlend heisst `pending`.
- **Sicherheitsmodell:** Der Code läuft nie im Ursprung der App. WebUI: iframe mit `sandbox="allow-scripts"` und
  `src="/ui-widget.html"`, ohne `allow-same-origin`/Popups/Formulare/Modals, `allow=""`, `referrerpolicy="no-referrer"`;
  der Server liefert die Datei mit CSP `sandbox allow-scripts; connect-src 'none'; img-src data: blob:` (keine
  Cookies, kein Speicher, kein Netz, kein Zugriff auf `parent`). Die App-CSP `frame-src 'self'` verhindert, dass eine
  Kachel ihren Rahmen auf fremde Seiten lenkt. Der Host nimmt nur Nachrichten seines eigenen Rahmens mit Ursprung
  `null` an und prüft jedes Feld; `sendMessage`, `prefill`, `copy`, `openUrl`, `openEntity` und Vollbild brauchen eine
  Nutzergeste in der Kachel (User Activation), `sendMessage` zusätzlich die neueste Antwort des Chats, keine laufende
  Antwort und höchstens 1 pro 3 s; `refresh` nur für fehlgeschlagene Eingänge (1 pro 5 s). Bilder lädt der Host über
  den Bild-Proxy mit dem App-Token und reicht sie als `data:`-URL weiter.
- **WebUI** (`WidgetTile.tsx`, `dynamic-ui-widget.css`): native Karte mit Titel und Werkzeugleiste („Code anzeigen“
  als Sheet mit Kopieren, „Neu starten“ erzeugt den Rahmen neu und behält den Zustand, „Vollbild“ legt die Karte per
  Popover in die oberste Ebene, ohne den Rahmen im DOM zu verschieben; Esc schliesst). Höhe: `node.height`, sonst die
  gemeldete Höhe auf 60–900 px begrenzt (darüber scrollt der Rahmen, „Ganze Kachel im Vollbild zeigen“). Platzhalter
  bis `rendered`; kommt 6 s nach dem Sichtbarwerden kein Start, erscheint „Diese Kachel konnte nicht gestartet
  werden.“ mit „Neu starten“. Theme-Variablen stammen aus den WebUI-Tokens und folgen hell/dunkel live; der Rahmen
  bekommt `color-scheme` passend zum Modus und einen transparenten Hintergrund.
- Rahmen ausserhalb des Bildschirms werden vom Browser gedrosselt: ihre Höhe stimmt erst, wenn sie sichtbar sind
  (die Laufzeit misst zusätzlich nach jeder Host-Nachricht).

## Sicherheit

- Katalog-Bausteine: kein `eval`, kein HTML, keine Skripte (eigene Kacheln laufen nur in der Sandbox, siehe oben).
  Formeln laufen über einen eigenen Parser und Interpreter
  (`packages/shared/src/utils/dynamicUiExpr.ts`) mit fester Funktionsliste. Nur eigene Namen sind erreichbar, nie die
  Prototyp-Kette.
- Texte werden als Text oder eingeschränktes Markdown (ohne HTML, ohne Bilder) gerendert; `math` nutzt KaTeX mit
  `trust: false`; `code` färbt per eigenem Tokenizer, ohne Markup aus dem Quelltext.
- Externe Ziele: `openUrl` und Bilder nur mit öffentlicher `https`-Adresse (`isUiHttpsUrl`, serverseitig erneut
  geprüft). CSV-Exporte entschärfen Formel-Präfixe (`=`, `+`, `-`, `@`).

## WebUI (`packages/frontend/src/components/assistant/dynamic-ui/`)

| Datei                                                                 | Inhalt                                                                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `DynamicUi.tsx`                                                       | Einstieg: Validierung, gemeinsamer State, Aktionen, Registry, Fehlergrenze pro Knoten; lädt `chart.tsx` und `live/` erst bei Bedarf |
| `context.ts`, `host.ts`                                               | `Ctx` für Renderer; `DynamicUiHost` (Bild-Proxy, Steckbriefe; Demo tauscht ihn aus)                                                 |
| `basic.tsx`                                                           | v1-Bausteine, `SegmentedControl`, `kpi` mit Delta/Spark, `stepper radio textarea date form`                                         |
| `layout.tsx`, `content.tsx`, `Carousel.tsx`, `table.tsx`, `chart.tsx` | Karten/Tabs/Akkordeon, Inhaltsbausteine, Karussell, Tabelle, Diagramme (Recharts)                                                   |
| `learning.tsx`                                                        | `checklist`, `quiz`, `flashcards`                                                                                                   |
| `live/`                                                               | `LiveFrame` (Platzhalter/Fehler/Quelle), `Weather`, `Stock`, `Currency`, `News`, `Gallery`, `WeatherIcon`                           |
| `media.tsx`, `LineChart.tsx`                                          | Proxy-Bild mit Platzhalter, Lightbox, Vollbild; leichtes SVG-Liniendiagramm mit Hover                                               |
| `EntityCard.tsx`, `EntityLink.tsx`, `Followups.tsx`                   | Steckbrief, Hover-Karte/Sheet, Folgefragen-Chips (auch ausserhalb einer Ansicht)                                                    |
| `state.ts`, `persist.ts`, `runtime.ts`                                | Eingabe-State pro Gespräch, localStorage, Formel-/Sicht-Laufzeit                                                                    |
| `dynamic-ui*.css`                                                     | Tokens und Overlays (`-inline`), v1 (`dynamic-ui.css`), v2-Bausteine (`-v2`), Live-Widgets (`-live`)                                |
| `WidgetTile.tsx`, `dynamic-ui-widget.css`                             | Eigene Kacheln: Sandbox-Rahmen, Nachrichtenprüfung, Aktionen, Vollbild, Code-Sheet                                                  |
| `fixtures.ts`, `fixtures-v2.ts`, `fixtures-widgets.ts`, `demoHost.ts` | Beispiele v1/v2 mit Live-Ergebnissen, vier handgemachte Kacheln; Demo-Bilder als erzeugte SVGs                                      |

Gestaltung: Ansichten sitzen bündig im Antworttext; erhabene Glas-Karten (Radius 18–22 px) nur für Karten, Quiz,
Lernkarten, Steckbriefe und Karussell-Elemente. Semantische Tokens (`--dui-*`) für hell/dunkel, Status-Töne
info/success/warning/danger/tip. Platzhalter haben die Endgrösse des Widgets; ein Fehler zeigt eine leise Zeile mit
„Erneut versuchen“. Bewegung: Text 0.7 s einblenden, Zeilen 0.42 s gestaffelt einschieben, Linien ~1.2 s zeichnen,
Easing `cubic-bezier(.16,1,.3,1)`; `prefers-reduced-motion` und E-Ink zeigen sofort den Endzustand.

Folgefragen erscheinen nur unter der letzten abgeschlossenen Antwort, so viele (1–3) wie in eine Zeile passen; ein
Klick sendet die Frage.

### Zustand pro Nachricht

Alles liegt in `localStorage` unter dem Präfix `plum-dui:` (höchstens ~400 Einträge, älteste fallen weg):

- `plum-dui:<turnId>:<nodeId>` — Häkchen der `checklist`, Fortschritt des `quiz` (Frage, Antworten, Hinweise),
  Reihenfolge/Position/Markierungen der `flashcards`, gesendetes `form`, `plum.state` eigener Kacheln.
- `plum-dui:<viewId>:state` — geänderte Eingabewerte einer Ansicht (`viewId` ist der Turn, der sie erzeugt hat).
- `plum-dui:pref:temperature-unit` — °C/°F des Wetter-Widgets.

## Eingabewerte

WebUI und Android halten explizit geänderte Eingabewerte pro Ansicht im jeweiligen Gespräch; die WebUI sichert sie
zusätzlich in `localStorage`, Android in DataStore. Revisionen derselben `viewId` übernehmen kompatible Werte; neue
Felder erhalten ihre neuen Vorgaben. Ein Wechsel des Feldtyps übernimmt keinen inkompatiblen Wert. Zurücksetzen
verwendet die Vorgaben der aktuellen Revision. Eine neue vollständige Ansicht und ein anderer Chat teilen keinen
Eingabezustand. Eine geräteübergreifende Synchronisation von Eingaben ist nicht Teil dieses Protokolls.

## Demo

**`/chat/ui-demo`** zeigt jedes Element wie eine echte Antwort, ohne Modellaufruf und ohne Netz zu Fremdseiten:
Wetter, Aktie, Wechselkurs, Steckbrief mit Inline-Entitäten, Nachrichten und Galerie (aufgelöst), Ladezustand und
Fehler mit „Erneut versuchen“, Rezept (Stepper, Checkliste, Zeitleiste, Hinweis), Quiz, Lernkarten, E-Bike-Vergleich
(Karussell, Tabs, Vergleich, Akkordeon), Inhaltsbausteine, Formular, Daten-Dashboard (KPI mit Delta/Spark, Bereich,
Streudiagramm, sortierbare Tabelle, Karte mit Bild/Aktionen), reine Folgefragen und die drei v1-Beispiele. Der
Abschnitt „Eigene Kacheln“ zeigt vier handgemachte Kacheln als Qualitätsmassstab: Fokus-Timer, Regen-Würfel (Live-Wetter,
kommt verzögert wie per Socket), Hypothek-Rechner (SVG-Diagramm, Regler, `props`) und Schweizer Memory (`plum.state`).
`?only=wetter,quiz` begrenzt die Seite auf einzelne Beispiele, `?only=kacheln` auf die Kacheln.

## Neue Komponente hinzufügen

Vertrag in `packages/shared/src/utils/dynamicUiCatalog.ts`, Typ in `UiNode`, semantische Prüfung in `checkNode`,
Renderer in WebUI (Registry in `DynamicUi.tsx`) und Android, Beispiel in `fixtures-v2.ts`. Modell-Signaturen und
Pflichtfelder stammen aus dem Katalog; Androids Namen/Pflichtfelder werden daraus erzeugt:

```bash
node_modules/.bin/pnpm --filter @plum-code-webui/shared build
node scripts/generate-dynamic-ui-catalog.mjs
```

`test:dynamic-ui` prüft, dass die eingecheckte Android-Datei aktuell ist.

## Tests

`pnpm --filter @plum-code-webui/backend test:dynamic-ui` — Formeln, Fixtures, ungültige Beschreibungen, Extraktion
inkl. Streaming und Fallback, gemeinsamer State, Formatierung, v2-Validierung aller neuen Typen, Patches,
Live-Auflösung mit Fake-Quellen, Bild-Proxy-Schutz, Prompt im Budget.

## Schrittweiser Aufbau

Der begrenzte Teil-JSON-Parser übernimmt nur bereits empfangene Werte, ohne `eval` oder erfundene String-Inhalte.
Vollständige gültige Kinder erscheinen vor dem Ende des Blocks; unvollständige Komponenten warten. Metadaten, State
und Datensätze sollten vor `root` stehen. Teilansichten und Aktionen bleiben während des Antwortlaufs gesperrt.
Live-Bausteine zeigen ihren Platzhalter, bis das Ergebnis kommt. Ein abgebrochener/unvollständiger Block wird nach
Laufende nicht als bedienbare Ansicht freigegeben.

## Gezielte Änderungen

Stabile Komponenten-IDs ermöglichen Änderungen an der zuletzt abgeschlossenen Ansicht desselben Chats:

```json
{
  "version": 2,
  "patch": [
    {
      "op": "replace",
      "target": "summary",
      "node": { "type": "text", "text": "Neue Zusammenfassung" }
    },
    {
      "op": "append",
      "target": "panel",
      "node": { "type": "text", "id": "extra", "text": "Ergänzung" }
    },
    { "op": "remove", "target": "obsolete" }
  ],
  "state": { "newInput": 1 }
}
```

`replace` erhält die alte ID, sofern keine neue angegeben ist; `append` benötigt einen Container mit `children`
(auch einen Tab oder Akkordeon-Abschnitt mit `id`). `remove` darf die Wurzel nicht entfernen. Maximal 50
Operationen; unbekannte Ziele werden gemeldet. Optionale `state`, `computed`, `data`, `views` ergänzen/ersetzen
einzelne benannte Einträge, `title` ändert den Titel, `followups` setzt neue Chips. Es gibt keine beliebigen
Objektpfade und keine Skripte.

Die API fixiert die validierte Basis im vorhandenen `profile_json` des neuen Turns (`dynamicUiBase`). Änderungen
bleiben dadurch auch nach Neuladen, Seitenwechsel und erneutem Abruf reproduzierbar. Vollständige neue Ansichten
bekommen eine neue serverseitige `viewId`; Änderungen behalten die bestehende Identität. Bestehende gespeicherte
v1-Blöcke funktionieren weiter.

## Konfiguration

Keine. Greift für alle Modell-Chat-Anbieter, sobald Backend und Frontend neu gebaut sind
(`bash scripts/plum-rebuild.sh`). Android rendert dieselben Ansichten nativ
(`packages/android/.../ui/components/dynamicui/`).
