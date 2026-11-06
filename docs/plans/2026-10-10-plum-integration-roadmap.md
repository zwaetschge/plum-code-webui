# Gesamtumsetzung auf dem bestehenden Plum

Stand: 10.10.2026. Vollständig ausgearbeiteter Umsetzungsplan; Quellimplementierung läuft gemäss Aufgabenliste. Rebuild, Redeploy und Änderungen am laufenden Dienst bleiben auf Wunsch zurückgestellt. Die neue Domain ist `plum.zwaetschge-webui.ch`.

Dieser Plan verbindet den [Architekturplan](2026-10-10-plum-assistant.md), die [vollständige Schwarm-App-Übernahme](schwarm-app-ingestion.md), den [Funktionsvergleich](</mnt/user/appdata/claude-code-webui/reports/ChatGPT Claude und Plum Funktionsvergleich.md>) und den [Domain-Rollout](2026-10-10-plum-domain-migration.md). Der [Aufgabenstand](plum-assistant-todo.md) bleibt die laufende Abschlussliste. Die bisherigen B01–B14 sind jetzt alle in die Gesamtplanung aufgenommen; ihre Umsetzung folgt der unten beschriebenen Reihenfolge. Unbestätigte Anbieterfunktionen erhalten eigene geplante Plum-Abläufe, keine erfundenen Paritätszusagen.

## 1. Produkt und erste durchgängige Lieferung

Plum bleibt eine Anwendung mit einem Konto, gemeinsamen Daten und derselben Android-App. Drei Einstiege unterscheiden die Arbeit:

| Bereich | Start und Hauptablauf | Ergebnis |
| --- | --- | --- |
| Plum Chat | Frage stellen, Profil oder echten Agenten wählen, Wissen/Medien/Voice hinzufügen | Gespräch, Erinnerung oder überarbeitbares Ergebnis; Übergang zu Task |
| Plum Task | Ziel und gewünschtes Ergebnis vergeben, Agenten/Frist/Budget wählen, Fortschritt und Rückfragen bearbeiten | Dauerhafter Auftrag mit Versuchen, Teilaufträgen, Ergebnis und Historie |
| Plum Code | Projekt öffnen, CLI/Modell wählen, Code/Git/Tests/Vorschau nutzen | Projektänderung mit Herkunft, Diff, Prüfung und bestehendem Releaseweg |

`/` zeigt Übersicht und Inbox; `/chat`, `/tasks` und `/code` zeigen die jeweiligen Bestände. `/session/:id` bleibt als kompatibler Link nutzbar und öffnet den richtigen Bereich. Agenten, Wissen, Ergebnisse und Einstellungen sind gemeinsame Bibliotheken, keine weiteren voneinander getrennten Apps.

Die erste Lieferung ist konkret: Auf der neuen Domain ein Gespräch ohne Repository mit einem wirksamen Profil oder Brian starten, ein PDF hochladen, daraus einen Auftrag erstellen, eine Rückfrage beantworten, das fertige Dokument öffnen und im Ursprungsgespräch weiterarbeiten. Derselbe Ablauf wird auf Web und Android gezeigt. Das ist der erste Meilenstein, nicht der Abschluss der vollständigen Schwarm-Übernahme.

## 2. Bestand weiterverwenden und gezielt erweitern

| Bestehende Grundlage | Zieländerung | Konkreter Codepfad |
| --- | --- | --- |
| React-App, Layout, Sidebar, Dashboard | Drei Einstiege, Inbox und Bereichsfilter; bestehende Listen/Navigation weiterverwenden | [App](../../packages/frontend/src/App.tsx), [Layout](../../packages/frontend/src/components/layout/Layout.tsx), [Sidebar](../../packages/frontend/src/components/layout/Sidebar.tsx), [Dashboard](../../packages/frontend/src/pages/DashboardPage.tsx) |
| SessionPage und Chatkomponenten | Repositorypflicht für Chat entfernen, Profile/Wissen/Agenten darstellen, Nachrichtenaktionen ergänzen | [SessionPage](../../packages/frontend/src/pages/SessionPage.tsx), [Sessions](../../packages/backend/src/routes/sessions.ts) |
| `SessionSurface` code/task | Additiv chat ergänzen; existierende Bereichszuordnung behalten | [Shared-Typ](../../packages/shared/src/types/session.ts) |
| CLI-/ACP-/RPC-Prozesse | Adapterfähigkeiten und Task-/Agentenherkunft ergänzen; bestehendes Streaming/Resume behalten | [Prozessmanager](../../packages/backend/src/services/claude/ClaudeProcessManager.ts) |
| Benutzergebundene Provider/Upstreams | Eigener API-Chatadapter zusätzlich zu CLI-Wege; keine Abos in API-Keys umdeuten | [Settings](../../packages/backend/src/routes/settings.ts), [Provider](../../packages/shared/src/types/cli-providers.ts) |
| Agentendefinitionen/Skills/MCP | Weiterverwendbare Profile von tatsächlichen dauerhaften Laufzeiten unterscheiden | [Agentendefinitionen](../../packages/backend/src/routes/agents.ts), [MCP](../../packages/backend/src/routes/mcp.ts), [Katalog](../../packages/backend/src/routes/claude-config.ts) |
| Session-Agentenläufe und Panel | Dauerhafte Schwarmruns anzeigen und Herkunft/Versuch hinzufügen | [Panel](../../packages/frontend/src/components/session/SubagentPanel.tsx) |
| Volltext, Archiv, Export, Uploads und Sync | Gemeinsame Assistenzsuche, Quellenbezug, Ergebnisressourcen und Bereichsfilter ergänzen | [Sessions](../../packages/backend/src/routes/sessions.ts), [Dateien](../../packages/backend/src/routes/files.ts) |
| HTML-/Devservervorschau und Monaco | Ergebnisbibliothek plus typgerechte Renderer/Editoren hinzufügen | [Preview](../../packages/frontend/src/components/preview/WebPreview.tsx), [Codeeditor](../../packages/frontend/src/components/code-editor/CodeEditor.tsx) |
| Android Compose/Room/Netzwerk | Drei Bereiche, Agenten/Tasks/Artefakte, vorhandene Offline-/Outbox-/Socketlogik weiterführen | [Android-Prüfanleitung](../../packages/android/TESTING.md), [Socket](../../packages/android/app/src/main/java/com/claudewebui/app/core/network/SocketManager.kt) |
| Postgres und vorhandene Migrationen | Neue Tabellen additiv, bestehende IDs und SQL-Konventionen beibehalten | [Migrationen](../../packages/backend/src/db/migrations.ts), [DB](../../packages/backend/src/db/index.ts) |
| Repair-Bot und Compose-Overlay | Neue Origin und Router; Releases weiterhin ausserhalb des Hauptcontainers | [Overlay](../../docker-compose.override.yml), [Rebuildweg](../../scripts/plum-rebuild.sh) |

Die Umsetzung erzeugt kein zweites Frontend, keinen Ersatz für sämtliche Providertransporte und keinen neuen Schwarm von Grund auf. Der vorhandene Matrix-Hub wird zunächst bedient; seine transportunabhängigen Kernmodule gehen anschliessend in einen Plum-Ausführungsdienst über. Die frühere entfernte `orchestration_*`-Implementierung und ihre Worker-Pools werden nicht zurückgebracht.

## 3. Gemeinsame Daten und Laufzeitverträge

### 3.1 Datenmigrationen

Alle folgenden neuen Namen sind Zielentwürfe, keine bereits vorhandenen Tabellen. Ihre Nummern werden erst anhand des dann aktuellen Migrationsregisters vergeben. Bestehende TEXT-UTC-Zeitstempel, 0/1-Booleans, Fremdschlüssel- und Ownershipkonventionen bleiben erhalten.

| Etappe | Entwurf | Regeln |
| --- | --- | --- |
| A: Bereich und Profil | Bestehende Sessions: surface, profile_version_id, runtime_binding_id, context_project_id; `assistant_profiles`, `assistant_profile_versions` | Altwerte unverändert; neue Profile versioniert, keine rückwirkende Veränderung früherer Turns |
| B: Laufzeit und Import | `assistant_runtime_bindings`, `assistant_source_mappings`, Task-/Attemptprojektionen | Benutzer, native Conversation/Run-ID, Quelle und Revision getrennt; unique Quelle+ID+Besitzer |
| C: Gesprächsversion | `conversation_branches`, revisionsgebundene Nachrichtenbezüge | Bestehende Nachrichten bleiben Defaultzweig; Rewind kein Ersatz; aktive Streams pinnen Zweig/Turn |
| D: Kontext und Wissen | `assistant_context_projects`, Quellen-/Chunk-/Indexregister, strukturierte Memoryobjekte | Herkunft, ACL, Stand und Löschmarkierung; persönliches, Agenten-, Projekt- und Raumwissen getrennt |
| E: Ergebnisse | `assistant_artifacts`, `assistant_artifact_revisions`, Quellen-/Run-/Nachrichtenbezüge | Unveränderliche Revision, Besitzer, Typ, Originaldatei, Editormodell, Hash und Erzeugungsstatus |
| F: Teilen und Events | Freigabesnapshots, Connectorverbindungen, Ereignisabos und Zustellbezüge | Widerruf, kontogebundene Credentials, idempotente Ereignisse; bestehende Outbox-/Replaymechanik erweitern |
| G: Spezialisierungen | Lernfortschritt, Meetingregister, Datensätze, persönliche Sammlungen | Erst in entsprechender Lieferwelle; generische Ergebnisse/Quellen wiederverwenden |

Task-/Runprojektionen bleiben zunächst Ansichten des zuständigen Hubs. Ein lokaler Zustand darf nicht unabhängig vom Hub eine zweite Realität erzeugen. Erst nach dem Ownershipwechsel ist der native Plum-Koordinator autoritativ. `session_agent_runs`, `message_deliveries`, Chat-/Medienbezüge und Usagegeschichte werden nicht pauschal ersetzt.

Jeder Befehl trägt `commandId`; jeder Send trägt `clientMessageId`; externe Vorgänge tragen native Kennungen. Dieselbe ID mit verändertem Payload ist ein Konflikt. Ein erfolgreich zugestellter Befehl ist noch kein erfolgreich erledigter Auftrag. Erforderliche Kinder und Deliverables müssen terminal erfolgreich sein, bevor das Ziel abgeschlossen wird.

### 3.2 Profil und Kontext

Profilfelder: Name, Beschreibung, versionierte Instructions, Runtimepräferenz, erlaubte Fähigkeiten, Wissensbereiche, Memory-Lese-/Schreibverhalten, Stimme, Sprache und Antwortstil. Persönliche Defaults können pro Projekt und Gespräch ausdrücklich angepasst werden. Ein Profil namens Brian ersetzt nicht den echten Brian-Agenten.

Die Zusammensetzung folgt dem Architekturplan: übergeordnete Regeln, Bereich, Profilversion, berechtigtes Wissen/Gedächtnis, Taskziel und aktueller Turn. Repositoryanweisungen kommen bei Plum Code oder ausdrücklich ausgewähltem Repositorykontext hinzu. Chat und allgemeine Tasks übernehmen nicht automatisch sämtliche Regeln des aktuellen Coding-Arbeitsverzeichnisses. Der verwendete Kontext ist verständlich einsehbar, ohne Credentials offenzulegen.

Der Adaptervertrag erklärt `conversation`, `history`, `attachments`, `tools`, `memory`, `cancel`, `pause`, `resume`, `steer`, `nativeUsage` und Parallelitätsgrenzen. Die Oberfläche zeigt nur tatsächlich unterstützte Aktionen. Profilwirksamkeit wird für jeden ausgewählten Adapter mit einem realen Testturn belegt; gespeicherter Settingswert allein genügt nicht.

### 3.3 API und Ereignisse

Neue Assistenzressourcen liegen unter `/api/assistant`. Bestehende `/api/sessions`, `/api/agents` für Definitionen, `/api/gateway` und vorhandene Authendpunkte bleiben kompatibel. Die alten entfernten `/api/tasks`-/`/api/automation`-Pfade werden nicht als frühere Implementierung reaktiviert.

| Endpunktentwurf | Methoden und Zweck |
| --- | --- |
| `/api/assistant/profiles` und `/:id/versions` | GET/POST/PATCH: Profile und Versionen; PATCH mit erwarteter Revision |
| `/api/assistant/agents` und `/:id/conversations` | GET Inventar/Fähigkeiten; POST echte native Unterhaltung |
| `/api/assistant/tasks` und `/:id/attempts` | GET/POST: Ziele, Filter und explizite Versuche |
| `/api/assistant/tasks/:id/commands` | POST idempotentes Start/Cancel/Input/unterstütztes Pause/Resume/Steer |
| `/api/assistant/routines` | GET/POST/PATCH: vorhandene Zeitpläne und ihre Läufe |
| `/api/assistant/actions/:id/decision` | POST atomare Frage-/Freigabeantwort mit Revision |
| `/api/assistant/projects`, `/sources`, `/memory` | Kontogebundene Wissens-/Memoryobjekte und Ingestionsstand |
| `/api/assistant/artifacts` und `/:id/revisions` | Ergebnisse, immutable Revisionen und versionierte Bearbeitung |
| `/api/assistant/shares` | POST Snapshot erstellen; DELETE widerrufen; getrennte kontrollierte Abrufroute |
| `/api/assistant/connections` und `/event-subscriptions` | Persönliche Integrationen und Trigger; Secrets nie im Leseresultat |
| `/api/assistant/overview` | Inbox, Agenten, Aufträge, Alarme und aktueller Kontrollzustand |

Beispiel für einen geplanten Taskstart:

```json
{
  "commandId": "stable-client-command-id",
  "expectedRevision": 3,
  "action": "submit",
  "origin": { "sessionId": "existing-session-id", "chatId": "existing-chat-id" },
  "goal": "Erstelle einen deutschsprachigen Bericht aus dem ausgewählten PDF",
  "deliverables": [{ "type": "document", "format": "docx" }],
  "agentId": "registered-agent-id",
  "sourceIds": ["owned-source-id"]
}
```

Eine 202-Antwort enthält `taskId`, `attemptId`, `commandId`, `revision` und `status: accepted`; der spätere terminale Zustand kommt über den vorhandenen seriellen Sync-/Replaykanal. 400 bedeutet ungültige Eingabe, 401 fehlende Auth, 403 fehlende Befugnis, 404 nicht zugängliches/nicht vorhandenes Objekt, 409 Revision-/ID-Konflikt, 429 begrenzte Kapazität und 503 nicht erreichbare Runtime. Fachliche Fehler zeigen verständliche Meldung plus stabilen Code. Pagination und Fehlerhülle folgen den bestehenden Shared-Verträgen.

Assistant-Ereignisse werden im bestehenden Transport publiziert: `task.changed`, `agent.changed`, `action.changed`, `artifact.changed`, `memory.changed`. Jede Änderung enthält Objekt-ID, Revision, Besitzer-/Zugriffsscope, Zeitpunkt und publizierte Ereignissequenz. Clients bestätigen erst nach erfolgreicher Anwendung. Konflikte zwischen Geräten werden serverseitig entschieden; gelöschte Quellen und terminale Runs dürfen nicht durch ältere Events wieder erscheinen.

## 4. Sämtliche Vergleichsfamilien in konkreten Paketen

Die folgende Tabelle ordnet F01–F66 vollständig zu. Mehrfachzuordnung ist bewusst: z.B. Räume gehören zu Wissen und Schwarm, Geräteschutz zum Domainwechsel und zur App-Parität. Die Referenz bleibt der Funktionsvergleich; seine Quellen-/Datumsgrenzen gelten weiter.

| Paket / Familien | Konkreter Nutzerablauf | Umsetzung und gespeicherter Zustand | Abnahme |
| --- | --- | --- | --- |
| B01: F01/F02/F09–F12 | Chat ohne Repo, Profil/Modell wählen, Dateien hinzufügen, stoppen | SessionSurface, Profilversion, eigener APIadapter und vorhandene CLIadapter; gemeinsame Vorlagen/Stile | Reales Gespräch und identischer Profiltest je Runtime; Kosten-/Transportquelle sichtbar |
| B02: F03–F05 | Nachricht ändern, Antwort neu erzeugen, Zweig wechseln; Archiv/Suche behalten | Nachrichten-/Antwortrevisionen und pinned Streams, bestehender Verlauf im Defaultzweig | Ursprung bleibt erreichbar; Änderung verliert keine Dateien und vermischt keine laufenden Turns |
| B03: F06–F08/F63 | Temporärmodus, Konto-/Projektexport, Snapshot teilen und widerrufen | Definierte Retention auch für Uploads/Memory/Logs; Freigaberessource; eigener Export mit Manifest | Export vollständig; Widerruf sperrt Zugriff; temporäre Daten nach definiertem Ablauf entfernt |
| B04: F13–F17 | Erinnerungen lesen, ändern, vergessen und transferieren | Strukturierte Memorybereiche über bestehenden Quellen-/Agentenbestand; kein automatischer Import unbestätigter Vendor-APIs | Löschung wirkt im nächsten Turn; Agenten-/Projekt-/private Bereiche bleiben getrennt |
| B05: F18–F20/F23 | Wissensprojekt mit PDFs/Links/Quellen, aktuelle und ältere Fassungen | Original, Text, Chunkindex, ACL und Indexstand; Volltext zuerst, lokale Embeddings ergänzen wo nötig | Neue Quelldatei ersetzt alten Stand; Antworten verweisen nur auf berechtigte aktuelle Quellen |
| B06: F21/F22 | Recherchefrage, Suchraum wählen, Fortschritt sehen, Quellen prüfen, Bericht bearbeiten | Tasktyp research mit Belegregister, Claim-/Auszugbezug und Artefakt | Originalstelle öffnen; Quellenfilter wirksam; Bericht bleibt nach Neustart bearbeitbar |
| B07: F37/F38/F47 | Ergebnis neben Chat öffnen, Stelle markieren, Änderung verlangen, ältere Revision ansehen | Generische Artifactressource, Bibliothek/Tags/Quelle und typgerechte Renderer | Auswahl bezieht sich auf richtige Revision; neue Antwort überschreibt alten Stand nicht |
| B08: F39–F41/F45/F46 | Dokument bearbeiten, Tabellen rechnen, Folien präsentieren, Daten analysieren, LaTeX als PDF sehen | Rich Text zuerst; kanonisches Blockmodell, Zell-/Formelmodell, Folienmodell; vorhandene Datei-/Python-/Exportwege | Autosave/Undo, unterstützte Roundtrips, Fehler und nicht unterstützte Formate ehrlich dargestellt |
| B09: F42–F44/F48/F49 | Design/Visual/Simulation reviewen, App mit Zustand bauen, Version veröffentlichen und zurücknehmen | Isolierte Preview, versioniertes App-/Designmodell, erlaubte Daten-/Toolrechte und Releaseobjekt | Publizierte Revision fixiert; Widget/App erhält keine fremden Rechte; Release widerrufbar |
| B10: F23/F59/F60 | Konto verbinden, Fähigkeiten auswählen, interaktives Plugin nutzen, Officekontext bearbeiten | Bestehende MCP-/Skillregistry plus kontogebundene Credentialbindings und kontrollierter UIhost; Officeeinbettung spätere Erweiterung | Kontoentzug deaktiviert Aufrufe; interaktive Aktion wirkt in richtigem Konto; keine CLIhome-Isolation vortäuschen |
| B11: F28/F31 | Quellenereignis/Termin löst Task aus; Tagesbericht/Alarm sehen, Vorschlag übernehmen | Bestehender Scheduler, Ereignisabos, Deduplizierung, Ruhezeit und begrenzte Wiederholung | Dasselbe Event einmal; ausgefallene Quelle ehrlich; Vorschlag startet keine unbestellte Folgeaktion |
| B12: F50–F54 | Bild erstellen/markiert bearbeiten, Audio aufnehmen, Voice und Vorlesen mit gewählter Stimme | Vorhandenes ComfyUI/Vocarium, Bildrevisionen/Maskeneditor, Recorder, Player; OmniVoice unverändert gesetzt | Maske/Originalzuordnung stimmt; verworfene Aufnahme nicht gesendet; Stop endet auch wartende Audiostücke |
| B13: F24/F33/F55–F58/F63 | Browser/Phone steuern, Gerät übernehmen, teilen, Widget/Quickentry nutzen, optional lokalen Kontext aufnehmen | Bestehende Erweiterung/Begleiter/Builder; native Intents, Rechte und Opt-in-Kontextquellen; S29–S37 | Reale Phone-/Browserabläufe, Offline/Push/Intents/Deep Links; Desktopkontext tatsächlich begrenzt |
| B14: F25–F27/F29/F30/F32/F34–F36/F61/F62/F64/F65 | Dauerhafte Arbeit mit Hermes, Rat/Spezialisten, Freigaben, Routinen und Kosten | Bestehenden Schwarm vollständig ingestieren; native Koordination übernehmen; Dienstidentitäten/Teamrechte bei Mehrnutzerablauf | Client-/Hubausfall, Phoneoffline und Koordinatorwechsel erzeugen keine Doppelarbeit; Ursprung und Usage nachvollziehbar |
| Ergänzende Fachabläufe: F66 | Persönliche Gesundheits-/Finanzunterlagen oder Plattformfunktionen gezielt nutzen | C06/C12 unten; klar getrennte Connector-/Gerätefähigkeiten | Eigene verfügbare Quellen und Exportwege geprüft; keine erfundene Vendorparität |

### 4.1 Editor- und Ausführungsdetails

Dokumente erhalten ein kanonisches strukturiertes Blockmodell mit Überschriften, Absätzen, Listen, Tabellen, Bildern und Quellen. HTML/Markdown/DOCX/PDF sind Ein-/Ausgabeformate, nicht vier unabhängig gepflegte Wahrheiten. Ein Standard-Editor auf ProseMirror-Basis ist eine geplante Komponentenentscheidung; vor Einbau werden aktuelle Lizenz, Version, vorhandene Abhängigkeiten und Bedienbarkeit geprüft. Die modulare, schemabasierte Grundlage ist im [offiziellen Projekt-README](https://github.com/ProseMirror/prosemirror) beschrieben; dessen Umzugshinweis ist bei der Quellenauswahl zu beachten. Kollaboratives gleichzeitiges Bearbeiten folgt nach revisionssicherem Speichern; bis dahin verhindern erwartete Revisionen stilles Überschreiben.

Tabellen bewahren Eingabewert, Typ und Formel getrennt vom berechneten Resultat. Ein erster definierter Formelkern umfasst Arithmetik, Zell-/Bereichsbezüge, SUM/AVERAGE/MIN/MAX/COUNT/IF und grundlegende Vergleiche; fremde komplexe Formeln werden nicht still entfernt. CSV/XLSX-Import/-Export verwendet vorhandene Wege. Erweiterter Formelkern, Pivot, Diagramme und direkte verbundene Daten sind eigene Schritte derselben Paketplanung. Eine heruntergeladene XLSX-Datei allein ist keine native Tabellenbearbeitung.

Folien speichern Layout, Text, Medien und Sprecherhinweise als versioniertes Modell; zuerst Vorlage, Folienliste, Bearbeitung, Präsentiermodus und PPTX/PDF. Design/SVG/HTML nutzt Auswahl und Vorschau zuerst; frei verschiebbare Canvasobjekte und Animation folgen auf dieser Grundlage. Compiler- und Exportadapter laufen als begrenzte Jobs und zeigen echte Fehler. Die vorhandenen `plum-python`, Vocarium-, Bild- und Browserwerkzeuge werden wiederverwendet, soweit ihre tatsächlichen Fähigkeiten passen.

Interaktive Plugin-/App-Oberflächen bekommen eine isolierte Laufumgebung mit Schema für erlaubte Aktionen, Quellen und Resultate. Ein clientseitiges Widget besitzt keine Provider-/MCP-/OAuth-Credentials. Ein Aufruf geht durch das besitzgeprüfte Backend. Öffentliche Veröffentlichung wird getrennt von privaten Ergebnissen und geschütztem Dev-Preview behandelt; der Publikationshost und sein Zugriff werden vor dem ersten echten Publish konkret konfiguriert.

### 4.2 Auch unverifizierte Spezialfamilien bekommen einen eigenen Plan

Diese C-Kennungen sind ergänzende Lieferinhalte innerhalb I14, keine neuen unabhängig laufenden Plattformen. Sie beschreiben gewünschte eigene Fähigkeiten; Anbieteraktivität oder ihr vollständiger Oktoberumfang bleibt dort offen, wo die Recherche das ausgewiesen hat.

| Familie | Eigener Plum-Ablauf und Daten | Welle / Voraussetzung | Abnahme |
| --- | --- | --- | --- |
| C01 Lernen | Lernprofil, Kurs-/Lektionsquellen, geführte Fragen, Quiz, Fortschritt und Wiederholung | W9; B01/B04/B05/B07 | Lernstand über Geräte erhalten, Fragen auf Quellen bezogen, Rücksetzen kontrolliert |
| C02 Einkaufen/Anprobe | Produktvergleich mit Preisdatum/Quelle, Favoriten, Beobachtung und optionale Bildanprobe über verfügbaren Bildadapter | W9; B06/B11/B12 | Originalangebote öffnen, Preisstand sichtbar, Originalbild erhalten; kein automatischer Kauf aus einer Empfehlung |
| C03 Meetings/Record | Audio hochladen/aufnehmen, ASR, Zeitmarken, editierbares Transkript, Protokoll und ausgewählte Tasks | W9; B07/B12/B14 | Audio/Transkriptstellen stimmen, Korrekturen erhalten, Tasks nicht doppelt; Sprechertrennung nur mit nachgewiesenem Backend |
| C04 Daten-/Notebookarbeit | Datensatz importieren, Code-/Berechnungsschritte, Diagramme, interaktive Tabelle und reproduzierbarer Bericht | W7; B07/B08/B09 | Eingabe und Ausführungsversion gebunden; erneuter Lauf und Export nachvollziehbar |
| C05 Live-Kamera/Screen/Video-Voice | Ausdrücklich gestartete Livequelle, Frames/Screenkontext, unterbrechbare Stimme, beenden | W10; B12/B13 | Quelle/Latenz sichtbar, Stop beendet Aufnahme/Übertragung, kein Hintergrundstream nach Ende |
| C06 Finanzen und Gesundheit | Persönliche Unterlagen zuerst; danach verfügbare eigene Bank-/Gesundheitsdatenadapter, Quellenstand und getrennte Kontexte | W10; B03/B05/B10 | Konto-/Datenquelle korrekt, Entzug wirksam, keine Annahme proprietärer Health-/Bank-Schnittstellen; Trader bleibt separate Fachruntime |
| C07 Persönliche Bibliothek | Sammlungen für Dokumente, Medien, Produkte, Orte und Favoriten mit Quellen/Tags | W7/W9; B07 | Suche/Favoriten synchron, Quelle/Revision erhalten, gelöschte Inhalte verschwinden aus Retrieval |
| C08 Räume/Gruppengespräche | Bestehende Räume/Threads/Mitglieder/Reaktionen ingestieren; gemeinsame Aufgaben und Wissensrechte | W4; S03/S28, B05/B14 | Raumhistorie und Rechte erhalten; keine neue generische Chatplattform anstelle der Migration |
| C09 Proaktive Briefings | Bestehende Tagesberichte/Routinen/Alarme, danach Quellenbeobachtung und persönliche Digestvorlage | W4/W8; B11/B14 | Dringlichkeit/Ruhezeit stimmen, dieselbe Meldung einmal, Empfehlungen als Vorschläge |
| C10 Video/Motion/Simulation | Vorhandene Medien-/Renderfähigkeiten zu versionierten Clips/Animationen/Simulationen verbinden | W10; B07/B09/B12 | Echter erzeugter Clip/Preview, reproduzierbare Revision und Export; kein Sora-/Atlas-Lebenszyklus behauptet |
| C11 Computerhistorie/Quickentry | Opt-in-Aufnahme ausgewählter Apps/Zeiträume, Stop/Löschen, schneller Desktopstart und Workflow→Skill/Makro | W10; B03/B10/B13 | Ausschlüsse und Retention funktionieren; Aufnahme nicht mit blossen Browserlogs gleichsetzen |
| C12 Office/Organisation/weitere Plattformen | Bestehende Officeconnectoren zuerst, danach eigener Add-in-Start mit gewählter Dokumentstelle; Rollen-/Audit- und iOSfähige Verträge | W10; B08/B10/B14 | Dokument-/Konto-/Rechtezuordnung, tatsächliches Officehost-Verhalten; iOS-spezifische Sensoren werden nicht als Android-Parität behauptet |
| C13 Erscheinungsbild/Mini/Pets | Bestehende Styles/Theme, schnelle kleine Assistenzansicht; optionale eigene Begleiterdarstellung | W10; B01/B13 | Tastatur/Skalierung/reduced motion und native Einstiege; Dekoration trägt keine Laufzeitidentität |

Lernen, Meetings und Bibliothek kommen vor speziellen Bank-/Health-/Officehost-Integrationen: Sie liefern mit vorhandenen Quellen und Tools früher eigenen Nutzen. Funktionsfamilien bleiben vollständig geplant; diese Reihenfolge ist keine Streichung ihres Umfangs.

## 5. Vollständige Schwarmaufnahme und Agenten

Brian/Hermes verwendet zuerst seinen vorhandenen funktionierenden Transport, ergänzt um echten Gesprächs-/Gedächtnis-/Datei-/Stopp-/Reconnectvertrag. Direkte APIs werden erst genutzt, wenn die jeweilige Hermes-Instanz diese wirklich anbietet. Hermes Trader übernimmt den vorhandenen Run-/Steer-/Stopweg; Hermes Phone seinen Worker-WS und native Run-/Gesprächskennungen. Codex, OpenCode, Pi, Kimi, Vibe, Claude und Z.AI behalten Anmeldung, Modelle, Transport und tatsächliche Abrechnung.

Git, Betrieb, Sicherheitswache, Melder, Rat und weitere registrierte Einheiten gehen über die Integrationsmatrix des Architekturplans. Registrierte, aber stillgelegte Einheiten bleiben als solche sichtbar. Der Live-Abgleich erweitert das Inventar um tatsächlich vorhandene weitere Agenten. Weder Namensgleichheit noch ein Profilpreset beweist gleiche Identität.

| Pflichtumfang | Lieferzuordnung |
| --- | --- |
| S01–S03 Übersicht, Brian und Räume | W2/W4: Inbox, Chat, Räume/Threads |
| S04–S11 Medien, Voice, Stimmen, Modelle und Budgets | W2/W4: vollständige Medien-/Player-/Agentenbedienung, OmniVoice |
| S12–S16 Taskformular, Vorlagen, Board/Baum, Wiederholung/Bewertung und Chatübergänge | W3/W4: dauerhafte Taskabläufe |
| S17–S22 Fragen, Freigaben, Alarme, Agenten, Routinen, Rat und Gedächtnis | W4: Operatoroberflächen und native Zustellung |
| S23–S28 Patches, Betrieb, Werkzeuge, Kennzahlen, Not-Aus und Identität | W4/W5: vorhandene Aktionen übernehmen; Koordination und Kontrollweg sichern |
| S29–S37 Schutz, Push, Ruhezeit, Offline, Einstellungen, Widgets, Diagnose, Updates und adaptive Bedienung | W4/W6: vollständige Android-Parität und Webentsprechung |

Alle 37 Zeilen besitzen vor Ablösung einen konkreten Bedienbeleg aus alter und neuer App. Ein funktionierender neuer Editor ersetzt kein fehlendes Widget. Android-Keystore-Privatschlüssel wechseln nicht zwischen App-Paketen; Not-Aus-Geräteregistrierung und Push werden neu eingerichtet. Der unabhängige Kontrollweg muss auch beim Ausfall des normalen Chats erreichbar bleiben.

Migration: vollständige verfügbare Historie samt Medien, Threads, Reaktionen, Entscheidungen, Bewertungen, Routinen, Patches, Budgets und Einstellungen; nicht nur ein lokaler Cache. Wiederholbarer Import mit Quell-ID-Mapping, Berechtigungsabgleich und laufender Nachsynchronisierung. Eine Bilanz zeigt gelesene/importierte/fehlende/unzugängliche Objekte. Native Verschlüsselungsschlüssel oder nicht exportierbare E2EE-Inhalte werden nicht geraten; nötige Entschlüsselung/Export über vorhandenes Konto oder Gerät ist ein konkreter Implementierungspunkt.

Koordination: Zustand/Taskgraph/Scheduler bleiben zunächst beim bestehenden Hub. Anschliessend werden Leases, Wiederholung, Inbox/Outbox, Entscheidungen und Scheduling transportunabhängig übernommen. Pro Auftrag/Routine gibt es genau einen Besitzer mit monotonem Ownership-Epoch/Fencing; alte Besitzer dürfen nach Wechsel nicht weiter vergeben. Rückmeldungen behalten Herkunft, und ein abgeschalteter Matrix-Transport darf den nativen Plum-Kontrollweg nicht lahmlegen. Dienste wie Hermes/Vocarium/Geräteworker können separat bleiben; ihre Funktion gehört dennoch vollständig zu Plum.

## 6. Lieferwellen mit Abhängigkeiten

Zeitangaben sind bewusst keine erfundenen Termine. Eine Welle endet mit ihrem realen Ergebnis und Prüfung; mehrere unabhängige Inhalte können während einer späteren Umsetzung parallel bearbeitet werden, ohne Koordinator-/Migrationsschritte zu überlappen.

| Welle | Pakete | Lieferung und tatsächlicher Nachweis |
| --- | --- | --- |
| W0 Bestand/Mapping | I01, I12-Vorbereitung | Liveagenten und Herkunft, Daten-/Quellbilanz, Server-/Geräteversionen, aktive Arbeit und vorhandene Profile; offene API-/Importfähigkeiten konkret entscheiden |
| W1 Domain und Einstiege | I15, I02/I03 | Neue Origin mit Authelia und Android-JWT; drei Bereiche, bestehende Links/Chats; echte Desktop- und schmale Ansicht |
| W2 Persönlicher Chat und Brian | I04–I06, B01/B02/B04, erster B07-Pfad | Wirksame Profile, echter Hermesdialog, Anhänge/Voice, verlustfreie Bearbeitung und Ergebnisansicht; Web-/Android-Dialog |
| W3 Dauerhafter Auftrag | I07, B14, B06/B07-Grundlage | PDF→Recherche-/Dokumenttask→Rückfrage→Artefakt→Ursprung; Neustart und Reconnect ohne Doppelauftrag |
| W4 Ganzer Schwarm bedienbar | I08/I09, B12/B13/B14, S01–S28 | Alle Agenten, Räume, Medien, Rat, Betrieb, Git, Routinen, Alarme, Freigaben und Not-Aus real bedienbar |
| W5 Koordination übernommen | I10, B11/B14 | Native Plum-Leases/Scheduler/Kontrollpfad; Ownershipwechsel, Matrix-Ausfall und Rückweg geprüft |
| W6 App vollständig ablösen | I11–I13, B03/B12/B13, S29–S37 | Vollständige Daten-/Settingsmigration, sichere Offlinehistorie, Push, Widgets/Kachel, Diagnose und Update; alte App nicht mehr erforderlich |
| W7 Wissen und Ergebnisse | I14, B05–B09, C04/C07 | RAG/Quellenregister, Library, Docs/Sheets/Slides, Diagramme/LaTeX und Designs; Bearbeiten/Version/Export als echte Produktabläufe |
| W8 Verbindungen/Events/Publishing | I14, B03/B09–B11 | Persönliche Connectoren und Plugin-UI, Quellenereignisse, freigegebene Appversionen, Widerruf und gemeinsame Dokumentarbeit |
| W9 Alltagspezialisierungen | I14, C01–C03/C07/C09 | Lernen, Shoppingrecherche, Meetingtranskript/Protokoll, persönliche Sammlungen und Briefings |
| W10 Erweiterte Geräte-/Facharbeit | I14, C05/C06/C10–C13 | Unterbrechbare Livequellen, Video/Motion, ausgewählte Fach-/Office-/Desktopadapter; tatsächliche Plattformgrenzen dokumentiert |

Die erste durchgängige Assistenzlieferung umfasst W1–W3. Die vollständige Schwarm-App-Ablösung umfasst W4–W6 zusätzlich. Die jetzt ebenfalls durchgeplante Produktvervollständigung läuft bis W10. Gemeinsame B07-/Kontextgrundlagen dürfen für W2/W3 klein beginnen und werden später ausgebaut; vorher keine vollständige Office-/Pluginplattform bauen, um überhaupt einen ersten Task zu liefern.

## 7. Domain, Marke und Geräte gehören zum selben Übergang

I15 wird nach dem [Domain-Rolloutplan](2026-10-10-plum-domain-migration.md) geliefert. Wichtig sind die wirklichen aktuellen Defaults: `FRONTEND_URL` schlägt `WEBUI_FRONTEND_URL`, CORS hat eine eigenständige Liste, Preview kennt aktuell einen Host und Android einen prefixfähigen Socketpfad. Nur einen DNSnamen auszutauschen würde diese Zustände nicht vollständig migrieren.

Die lokale neue Domain besitzt bereits DNS/TLS, liefert aber noch 404. Hauptapphost wird `plum.zwaetschge-webui.ch`, Dev-Preview `preview-plum.zwaetschge-webui.ch`. Althosts bleiben während Migration echte Aliasse; Webredirects kommen erst danach. Vorhandene Routennamen und Datenpfade müssen nicht mit der Marke umbenannt werden. Browserdrafts/Outbox, PWA/Push, Androidserverprofile/App-Links, Widgets und Schwarm-Brückenlinks gehören ausdrücklich zu dieser Migration.

Sichtbares Branding wird auf Plum mit Chat/Task/Code angepasst: Titel, Navigation, Androidname, Startbild, Einstellungen, Updatebeschreibung und Benachrichtigungen. Package-IDs, Datenbanknamen, Providerhomes, Custom-Scheme und Containeridentitäten bleiben kompatibel, solange eine Änderung keinen Nutzervorteil bringt. Die bestehende Produktgestaltung bleibt; Glastransparenz sparsam, lesbare Flächen und Fokus/Skalierung/reduced motion. Neue Fonts werden nur nach Prüfung wirklicher Dateien/Gewichte eingeführt.

## 8. Prüfung, Rollout und Rückweg je Lieferung

| Geänderter Pfad | Erforderliche Prüfung |
| --- | --- |
| Datenmodell | Wiederholbare Migration, Besitzer/Fremdschlüssel, alte Clients und Backup-/Restoreprobe |
| Profile/Chat | Wirkung je Runtime, aktive Thread-/Zweigbindung, Stop/Follow-up, Streaming und tatsächlicher Kostenprovider |
| Tasks/Schwarm | Reconnect, Retry, doppelte Commands, Ausfall, Freigabe von zwei Geräten, Not-Aus und echte Ergebnisse |
| Wissen/Ergebnisse | Quelllöschung/ACL, richtige Revision, Import-/Export-/Autosave und tatsächliche Renderer |
| Domain/Auth | SSO, JWT-Mobile, WebSockets/SSE, Upload/Media/Preview, lokale Zustände und alte Links |
| Android/UX | Reales ausgewähltes Gerät, Smartphone/Tabletbreite, TalkBack/Schriftgrösse, Offline/Push/Widgets und Fehlersituationen |
| Releases | Repair-Bot, Readiness mit echter DB, Image-ID und geschütztes Rollbackimage |

Die passenden vorhandenen Regressionsbefehle sind `pnpm run typecheck`, `pnpm run lint`, backend `test:providers`, `test:subagents`, `test:migrations`, `test:websocket-auth`, `test:durable-chat` und frontend `test:chat-sync`/`test:chat-delivery`. Es wird pro Änderung ausgewählt statt jeden Schritt blind vollständig zu wiederholen. Neue Tests prüfen tatsächlich riskante Zustandsübergänge, keine Kopie eines einfachen UI-Labels.

Android wird ausschliesslich über Android-builder gebaut/installiert/geprüft: Plum-Projekt `796aa064-f0bb-4031-bbf2-2da83a4bca94`; ausgewähltes Gerät `192.168.1.131:35023`. Der Builderpfad wird vor dem Kopieren gelesen, `app/src` nicht gelöscht. Kein rohes adb/gradle. Der aktuelle Erreichbarkeits-/Installationsstand bleibt vor einer echten Geräteabnahme zu prüfen.

UI-Abnahmen erfolgen früh in jeder Welle, damit echte Bildschirme die Umsetzung beeinflussen. Tests allein beweisen keine geeignete Oberfläche. Für jede Lieferung werden geändertes Verhalten, echte Prüfergebnisse und verbleibende Einschränkungen vermerkt. Die vorhandene Todo-Liste wird nur für nachgewiesen fertige Arbeit abgehakt.

Rückweg: additive Tabellen und Featurefreischaltung erlauben vorherige Oberfläche, während Daten erhalten bleiben. Ein Schema-Rollback entfernt keine neu entstandenen Ergebnisse. Domain kann auf alte Router/Origin zurückgehen. Koordinatorrückgabe braucht eigenen Epochwechsel und Abgleich laufender Arbeit. Die separate Schwarm-App wird erst nach sämtlichen S01–S37-Abnahmen ersetzt; ihre Datenquellen bleiben bis verifizierter Migration verfügbar.

## 9. Noch offene Ausführungsnachweise

Offen bleiben konkrete Livefähigkeiten/Exports einzelner Hermes-Instanzen, vollständige Agentenregistrierung, migrierbarer E2EE-/Gerätezustand, öffentliche DNS-/IPv6-Abnahme, OAuthproviderregistrierungen, mobile Signaturen und reale Geräteprüfung. Spezialisierte Health-/Bank-/Office-/Livevideoadapter werden anhand tatsächlich verfügbarer Konten und Tools konkretisiert. Diese Punkte sind in den jeweiligen Wellen verankert; sie verhindern nicht, die übrige Planung oder erste Assistenzlieferung vorzubereiten.

REA wurde im vorherigen Auftrag tatsächlich über MCP für APK-Inventar und einen begrenzten ausgelieferten JavaScript-Graph verwendet. Das ersetzt weder live geprüfte Agenten noch die S01–S37-App-Abnahme; Android-JADX fehlt weiterhin als optionaler Analyseunterbau. Der [REA-Nachweis](</mnt/user/appdata/claude-code-webui/research_notes/ChatGPT Claude und Plum Funktionsvergleich/rea.md>) bleibt verlinkt.

Dieser Plan autorisiert keine behaupteten bereits erfolgten Veröffentlichungen: fertig sind Planung, Zuordnung und read-only Deploymentprüfung. Produktcode, produktive Domain-/Authelia-/Traefikregeln, Dienste und Apps wurden hierfür nicht geändert.
