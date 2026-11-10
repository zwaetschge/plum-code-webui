# Dynamic UI v2 — auf ChatGPT-Niveau (Vertrag, 2026-11-07)

Auftrag: „Dynamic UI ist noch sehr primitiv. Das muss viel besser werden. Nutz REA und Recherche, um das genau so gut
wie ChatGPT zu machen.“ Grundlage: Web-Recherche (ChatGPT „Intelligent UI“ seit 2026-10-07, Apps-SDK-Richtlinien) und
REA-Analyse der öffentlichen chatgpt.com-Bundles (311 DIL-Widgets, ~60 Primitive). Referenzmaterial liegt
**ausserhalb** des Repos unter `/mnt/cache/appdata/plum-research/` (OpenAI-Code: nur Muster studieren, nie kopieren).

Bestehend (v1, `docs/dynamic-ui.md`): ```` ```plum-ui ````-Block mit JSON, 20 modellgenerierte Komponenten, State,
Formeln, Sichten, Patches, Validierung in `packages/shared/src/utils/dynamicUi.ts`, Renderer WebUI + Android.

## 1. Leitlinien (aus der Recherche übernommen)

1. **Feste Bausteine plus Props, nie HTML.** Bleibt so; v2 erweitert den Katalog.
2. **Live-Daten füllt der Server, nicht das Modell.** Das Modell nennt ein Live-Widget mit Parametern
   (`{"type":"weather","id":"w1","location":"Zürich"}`); der Server löst es über eine Datenquelle auf und liefert das
   Ergebnis getrennt (`uiResults`). Zahlen wie Temperaturen, Kurse, Wechselkurse tippt das Modell nie ab.
3. **Platzhalter in Endgrösse**, solange ein Teil streamt oder Daten lädt; bei Fehler ein leiser lokaler Ersatz mit
   „Erneut versuchen“. Ein defekter Baustein reisst nie die ganze Antwort mit (wie v1).
4. **Bündig statt Kästchen:** Ansichten sitzen flush im Antworttext; hervorgehobene Karten (Glas, Radius 20–24 px)
   nur wo es zählt. Semantische Farbtokens hell/dunkel, Status-Töne info/success/warning/danger/accent.
5. **Folgefragen als Chips** unter der Antwort (1–3, je nach Breite), nicht Teil des kopierten Texts.
6. **Bewegung wie ChatGPT:** Text 0.7 s einblenden, Zeilen 0.42 s einschieben, Charts 1.2–1.8 s zeichnen;
   Easing `cubic-bezier(.16,1,.3,1)`; `prefers-reduced-motion` schaltet ab.
7. **Apps-SDK-Grenzen:** höchstens 2 Aktionen pro Karte, Karussell 2–10 Elemente, feste Bildformate, Alt-Text Pflicht,
   WCAG-AA-Kontrast.
8. **Hover-Karten nur bei feinem Zeiger** (Maus), 150 ms Schliessverzögerung, Esc schliesst; Touch öffnet ein Sheet.
9. **Nutzer-Einstellung „Darstellung: Standard / Einfach“** (Personalisierung): Einfach = keine Ansichten ausser
   Folgefragen.

## 2. Schema v2 (abwärtskompatibel)

`version` darf `1` oder `2` sein; v1-Specs bleiben gültig. Neu auf oberster Ebene:

- `followups?: string[]` — 1–3 kurze Folgefragen (je ≤ 80 Zeichen). Eine Spec darf **nur** `followups` enthalten
  (dann ist `root` optional); so bekommen auch reine Textantworten Chips.

Alle neuen Knoten erben `id?` (Pflicht bei Live-Widgets und zustandsbehafteten Bausteinen). Grenzen wie v1
(250 Knoten, Tiefe 10); Texte ≤ 300 Zeichen ausser `markdown`/`text` (≤ 2000).

### 2.1 Neue modellgenerierte Bausteine

| Typ | Signatur | Verhalten |
|---|---|---|
| `tabs` | `{"type":"tabs","bind"?:"state","tabs":[{"label","children":[..]}]}` (2–6 Tabs) | Segmentierte Leiste, Wechsel ohne Neuladen; `bind` hält den aktiven Index |
| `accordion` | `{"type":"accordion","items":[{"title","children":[..],"open"?:bool}]}` (1–12) | Auf-/zuklappen, animiert |
| `carousel` | `{"type":"carousel","aspect"?:"16:9\|4:3\|1:1\|3:4","items":[{"title","subtitle"?,"meta"?:[str],"badge"?,"image"?:{"src","alt"},"action"?:Action}]}` (2–10; `meta` ≤ 3) | Horizontal, Snap, Pfeile nur Desktop, Ziehen mit Trägheit, Punkte, Pfeiltasten |
| `list` | `{"type":"list","items":[{"title","subtitle"?,"trailing"?,"icon"?,"image"?,"action"?}]}` (≤ 30) | Zeilen mit optionalem Bild/Icon und rechtem Wert |
| `timeline` | `{"type":"timeline","items":[{"time"?,"title","text"?,"status"?:"done\|current\|upcoming"}]}` (≤ 20) | Vertikale Zeitleiste mit Status-Punkten |
| `checklist` | `{"type":"checklist","id","title"?,"items":[{"id","label","detail"?}],"copyable"?:bool}` (≤ 40) | Abhaken mit Fortschritt; Zustand bleibt pro Nachricht erhalten (Abschnitt 4); `copyable` → „Liste kopieren“ |
| `stepper` | `{"type":"stepper","bind","label","min"?,"max"?,"step"?,"format"?}` | −/+ mit Zahl, bindet Zahl-State (z. B. Portionen) |
| `radio` | `{"type":"radio","bind","label","options":[{"value","label"}]}` | Einfachauswahl, vertikal |
| `textarea` | `{"type":"textarea","bind","label","rows"?:2-8,"placeholder"?}` | Mehrzeiliger Text-State |
| `date` | `{"type":"date","bind","label","min"?,"max"?}` | Datum `YYYY-MM-DD` als String-State |
| `form` | `{"type":"form","title"?,"children":[Eingaben..],"submit":{"label","message":"Vorlage mit {{state}}"}}` | Sammelt Eingaben, Senden schickt `message` als Folgenachricht |
| `quiz` | `{"type":"quiz","id","title"?,"questions":[{"q","kind"?:"choice\|text","options"?:[str],"answer":index\|"text","hint"?,"explanation"?}]}` (1–20) | Eine Frage nach der anderen, Hinweis-Knopf, Auflösung erst nach Antwort, Punktzahl, „Nochmal“ |
| `flashcards` | `{"type":"flashcards","id","cards":[{"front","back"}]}` (1–50) | Umdrehen per Klick/Tippen, Weiter/Zurück, Mischen, gewusst/nicht gewusst |
| `callout` | `{"type":"callout","tone":"info\|success\|warning\|danger\|tip","title"?,"text"}` | Hinweisbox mit Icon |
| `progress` | `{"type":"progress","value":"formula","max"?:"formula","label"?,"format"?,"kind"?:"bar\|ring"}` | Fortschritt/Anteil |
| `rating` | `{"type":"rating","value":0-5,"count"?,"label"?}` | Sterne mit halben Schritten |
| `image` | `{"type":"image","src":"https-URL","alt","caption"?,"aspect"?}` | Über Bild-Proxy (Abschnitt 3.3), Klick → Lightbox; Fehler blendet aus |
| `code` | `{"type":"code","language","code","title"?}` | Kopieren-Knopf, Syntaxfarben (wie Chat-Codeblöcke) |
| `math` | `{"type":"math","tex","display"?:bool}` | KaTeX (WebUI wie Markdown-Formeln) |

### 2.2 Live-Widgets (Server füllt die Daten)

Das Modell gibt nur Parameter; `id` ist Pflicht. Der Server legt das Ergebnis unter `uiResults[id]` ab.

| Typ | Parameter | Datenquelle (frei, ohne Schlüssel) | Darstellung |
|---|---|---|---|
| `weather` | `location`, `days?: 1-10` (Standard 7) | Open-Meteo Geocoding + Forecast | Aktuell (Temp, gefühlt, Symbol, Wind, Feuchte), 24-h-Diagramm mit Umschalter Temperatur/Niederschlag, Tagesliste; °C/°F |
| `currency` | `from`, `to`, `amount?` | Frankfurter (EZB) inkl. 30-Tage-Reihe | Zwei gekoppelte Felder, Kurs, Mini-Verlauf |
| `stock` | `symbol` (z. B. `AAPL`, `NESN.SW`) | Stooq Tagesdaten (CSV) | Kurs, Veränderung, Zeitraum 1M/6M/1J/5J (Segment), Hover setzt die Kopfzahl, Kennzahlen-Raster |
| `entity` | `title`, `lang?` | Wikipedia REST `page/summary` | Karte mit Bild, Kurzbeschreibung, Auszug, Link |
| `news` | `query` | SearXNG Kategorie `news` | Karussell aus Artikeln (Titel, Quelle, Datum, Vorschaubild, Link) |
| `gallery` | `query` | SearXNG Kategorie `images` | Bildraster (2–3 Spalten), Lightbox mit Vor/Zurück und Quelle |

Ergebnisformat pro Widget (`uiResults[id]`):
`{"status":"pending"|"resolved"|"failed","data"?:{…},"error"?:string,"retryable"?:bool,"fetchedAt"?:iso}`.
Die `data`-Felder je Typ sind in `packages/shared/src/utils/dynamicUiLive.ts` als Typen definiert (vorformatierte
Texte wie `price_text`, `change_text` wo sinnvoll, Rohwerte für Diagramme). Caching serverseitig:
weather 10 min, currency 60 min, stock 15 min, entity 24 h, news 30 min, gallery 24 h.

**Inline-Entitäten:** Im Antworttext (Markdown) dürfen Links `[Albert Einstein](entity:Albert_Einstein)` stehen.
WebUI: Hover-Karte (feiner Zeiger) / Sheet (Touch) mit Wikipedia-Zusammenfassung über
`GET /api/assistant/ui/entity?title=&lang=`; Android: Bottom-Sheet.

### 2.3 Aktionen v2

Bestehend: `sendMessage`, `set`, `reset`. Neu:
- `{"type":"copy","text":"Vorlage"}` — kopiert, Bestätigung „Kopiert“.
- `{"type":"openUrl","url":"https://…"}` — nur `https:`, neuer Tab / Custom Tab.
- `{"type":"prefill","text":"Vorlage"}` — füllt den Composer, ohne zu senden.
- `{"type":"openEntity","title":"…"}` — öffnet die Entitätskarte.

### 2.4 Verbesserte v1-Bausteine

- `chart`: zusätzlich `kind: "scatter"`, `ranges?: [{"label","value"}]` + `rangeBind?` (Segment über dem Diagramm,
  bindet State, Sichten können danach filtern), Tooltips mit Format, Legende blendet Serien ein/aus, „Vergrössern“
  (Vollbild) und Download CSV (WebUI zusätzlich PNG). Höchstens 6 Serien.
- `table`: Spalten sortierbar (`sortable?: true` Standard bei > 5 Zeilen), Suchfeld ab 10 Zeilen, Vollbild, CSV.
- `card`: `expandable?: bool` → Vollbild-Knopf; `image?: {"src","alt"}` als Kopfbild; `actions?: [Action-Knöpfe]` (≤ 2).
- `kpi`: `delta?: "formula"` + `deltaFormat?` (farbige Veränderung), `spark?: "viewName"` + `sparkKey?` (Mini-Linie).

## 3. Backend

1. **Validierung/Schema** (`packages/shared`): Typen + `checkNode` für alle neuen Typen, Katalog-Einträge mit Signatur
   (Modell-Anleitung und Android-Katalog werden daraus erzeugt, `scripts/generate-dynamic-ui-catalog.mjs`),
   `followups`, Aktionen, `uiResults`-Typen in `dynamicUiLive.ts`.
2. **Live-Auflösung** (`packages/backend/src/services/assistant/dynamicUiLive.ts`): sobald ein Live-Knoten vollständig
   gestreamt ist (oder spätestens beim Turn-Ende), wird er aufgelöst; Ergebnis im Turn gespeichert
   (Spalte/JSON neben `response`, Migration falls nötig) und per Socket-Event `assistant:ui-result`
   `{chatId, turnId, id, result}` gepusht. `GET`-Turn liefert `uiResults`. Neu-Laden zeigt die gespeicherten Daten;
   „Erneut versuchen“: `POST /api/assistant/chats/:chatId/turns/:turnId/ui/:id/refresh`.
   Zeitlimit pro Quelle 8 s, Fehler → `failed` mit `retryable`.
3. **Bild-Proxy** `GET /api/assistant/ui/image?url=`: nur `https`, nur `image/*`, ≤ 8 MB, Weiterleitungen ≤ 3,
   keine privaten Adressen (SSRF-Schutz wie `web_fetch`), Cache 24 h. Alle `image`/`carousel`/`gallery`/`news`-Bilder
   laufen darüber (keine Tracking-Anfragen vom Browser zu Fremdseiten).
4. **Entitäten** `GET /api/assistant/ui/entity?title=&lang=` (Wikipedia REST, Cache 24 h).
5. **Modell-Anleitung** (`dynamicUiPrompt.ts`): v2-Katalog, wann welches Widget (Wetter/Kurse/Wechselkurse/Personen
   & Orte → Live-Widgets statt Zahlen im Text; Lernen → quiz/flashcards; Pläne/Rezepte/Anleitungen → checklist,
   timeline, stepper; vielschichtige Vergleiche → tabs/compare; Produkte/Orte/Artikel → carousel), Folgefragen auf den
   meisten Antworten (2–3, konkret, keine Floskeln), Grenzen aus Abschnitt 1. Weiterhin keine Ansicht bei
   Sprach-Turns; „Einfach“-Einstellung → nur Folgefragen.
6. **Tests:** `test:dynamic-ui` erweitert (Validierung aller neuen Typen, Patches, Live-Auflösung mit
   Fake-Quellen, Bild-Proxy-Schutz, Prompt-Länge im Budget).

## 4. Clients (WebUI und Android, gleichzeitig)

- Renderer für alle neuen Bausteine und Live-Widgets, Platzhalter in Endgrösse, Fehler-Ersatz mit „Erneut versuchen“,
  Bewegung nach Abschnitt 1.6.
- Folgefragen-Chips unter der letzten Antwort (Klick sendet), nicht im Kopiertext.
- Lightbox (Bilder), Vollbild (Karte/Chart/Tabelle), Hover-Karten (WebUI) / Bottom-Sheets (Android).
- Zustand von `checklist`, `quiz`, `flashcards` und Eingaben bleibt pro Nachricht erhalten: lokal gespeichert
  (WebUI `localStorage`, Android DataStore) unter `turnId:nodeId`.
- Einstellung „Darstellung: Standard/Einfach“ in Personalisierung (beide Clients).
- `/chat/ui-demo` zeigt jedes neue Element (Fixtures inkl. Live-Widgets mit Beispieldaten); Android-Vorschau analog.

## 5. Abnahme

- Demo-Seite: jedes Element hell/dunkel, 1440 px und 390 px, Screenshots.
- Echte Modellturns (Claude Sonnet/Opus über die Anthropic-Verbindung): „Wie wird das Wetter in Zürich?“ → weather,
  „Wie steht die Nestlé-Aktie?“ → stock, „100 Euro in Franken“ → currency, „Quiz mich zu den Planeten“ → quiz,
  „Rezept Risotto für 4“ → stepper + checklist, „Wer war Ada Lovelace?“ → entity + Folgefragen, „Vergleiche drei
  E-Bikes“ → tabs/compare/carousel. Jede Antwort mit sinnvollen Folgefragen.
- Android: dieselben Turns im Emulator/Gerät, Screenshots.
- `pnpm typecheck`, `lint`, `format:check`, `test:dynamic-ui` grün.

## 6. Später (nicht in dieser Runde)

Karten/Orte (MapLibre + OpenFreeMap, Android osmdroid), Sport (OpenLigaDB/TheSportsDB), Flüge, serverseitige
Speicherung des UI-Zustands, Diagramm-Zoom.
