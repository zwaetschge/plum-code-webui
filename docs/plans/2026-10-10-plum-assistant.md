# Detailplan für Plum Chat, Plum Task und Plum Code

Stand: 2026-10-10. Status: Planung abgeschlossen; Produktumbau und Migration sind noch nicht gestartet.

Plum wird die gemeinsame Anwendung für den persönlichen Assistenten. Plum Chat dient Gesprächen, Plum Task verfolgt Ergebnisse und Plum Code arbeitet an Projekten. Die bisherige Schwarm-App wird mit sämtlichen Funktionen, Daten und Einstellungen in Plum aufgenommen und durch Plum ersetzt. Der bestehende Schwarm einschliesslich Hermes wird vollständig angebunden und seine Steuerung anschliessend schrittweise in Plum übernommen. Die eigene Laufzeit und das Gedächtnis eines Agenten bleiben erhalten.

Die aktuelle Aufgabenliste liegt in [plum-assistant-todo.md](plum-assistant-todo.md). Der [Gesamtumsetzungsplan auf dem bestehenden Plum](2026-10-10-plum-integration-roadmap.md) ist die verbindliche Lieferreihenfolge für alle nun eingeplanten Funktionen einschliesslich neuer Domain. Der [Domain-Rollout](2026-10-10-plum-domain-migration.md) beschreibt Traefik, Authelia, Android und den Übergang von der bisherigen Adresse. Der verbindliche Funktionsabgleich mit der bestehenden App steht in [schwarm-app-ingestion.md](schwarm-app-ingestion.md). Der [ChatGPT-/Claude-Funktionsvergleich](</mnt/user/appdata/claude-code-webui/reports/ChatGPT Claude und Plum Funktionsvergleich.md>) liefert 66 konsolidierte Familien zum Stichtag 10.10.2026. B01–B14 und die ausgewiesenen ergänzenden Fachabläufe sind jetzt vollständig in der Planung enthalten. Offene Implementierungsaufgaben sind keine bereits gelieferten Funktionen.

## 1. Verbindliche Produktentscheidungen

| Entscheidung | Festlegung |
| --- | --- |
| Marke | Dachmarke Plum; Arbeitsbereiche Plum Chat, Plum Task und Plum Code |
| Hauptadresse | `https://plum.zwaetschge-webui.ch`; vorhandene Installation hinter Traefik und Authelia |
| Domainübergang | Alte Adresse als befristeter echter Alias; Android-JWT-Gateway und Authübergabe erhalten; Vorschau auf `preview-plum.zwaetschge-webui.ch` |
| Anwendung | Gemeinsames Konto, Backend, Nachrichtenmodell, Dateien, Suche und Gerätesync |
| Aufteilung | Unterschiedliche Einstiege, Standardkontexte und Arbeitsregeln; gemeinsame Komponenten |
| Schwarm | Gemeinsame Ausführungsebene, aus allen Bereichen erreichbar |
| Schwarm-App | Vollständige funktionale Übernahme; nach der Abnahme ist die separate App für keinen bisherigen Arbeitsablauf mehr erforderlich |
| Hermes | Tatsächliche Gespräche und Aufträge in Hermes; keine Kopie seiner Persönlichkeit auf eine fremde Laufzeit |
| Agenten | Identität, Laufzeit, Modell, Fähigkeiten und Berechtigungen sind getrennte Eigenschaften |
| Task | Dauerhaftes Ziel mit Versuchen, Ergebnissen und Unteraufträgen |
| Migration | Additiv, bestehende Kennungen und Links erhalten; je Auftrag ein zuständiger Koordinator |
| Clients | Web und Android erhalten dieselben Begriffe, Zustände und Kernabläufe |
| Erste Lieferung | Drei Einstiege, wirksame Personalisierung, echter Brian-Chat und ein dauerhafter Task |

Der explizite Nutzerauftrag ersetzt für diese Weiterentwicklung die bisherige AGENTS.md-Regel für eine einzige Code-/Task-Oberfläche. Diese Regel wird bei der Implementierung aktualisiert; die gemeinsame Nachrichten- und Werkzeugdarstellung bleibt erhalten.

## 2. Bestehende Grundlagen und notwendige Änderungen

| Grundlage | Beleg | Konsequenz |
| --- | --- | --- |
| Sessions haben `surface=code|task` | `packages/shared/src/types/session.ts`, `packages/backend/src/routes/sessions.ts` | Enum und Validierung additiv um `chat` erweitern; Ausführungsweg separat modellieren |
| Mehrere Chats je Session und dauerhafter Sync existieren | Session-Routen, `services/sessionSync.ts`, Web-Store, Android-Chatcontroller | Bestehende `sessionId` und `chatId` nicht umdeuten oder ersetzen |
| Ausführungsregeln sind derzeit auf Plum Code ausgerichtet | `services/sessionExecutionContext.ts`, `services/claude/ClaudeProcessManager.ts` | Bereichsspezifische Regeln und gemeinsame Kontextzusammenstellung einführen |
| `customSystemPrompt` wird gespeichert | `routes/settings.ts`; kein Konsument im durchsuchten Ausführungscode gefunden | Prompt-Verwendung implementieren und über echtes Modellverhalten prüfen |
| Vorlagen und Benachrichtigungen existieren | `routes/workspace.ts` | Bestehende Daten weiterverwenden und um Bereich/Profil ergänzen |
| Subagentenläufe sind persistent | `services/subagentHistory.ts`, `session_agent_runs` | Herkunfts- und Task-Verknüpfungen ergänzen; temporäre Runs bleiben eigenständige Runs |
| Peer-Delegation und Watchdogs existieren | `services/session-mesh/PeerService.ts`, `services/watchdogs/WatchdogService.ts` | Bestehende Arbeit und Zustellung in das neue Auftragsmodell einordnen |
| Workspace-Gedächtnis existiert | `services/memoryOptimizer.ts` | Projektgedächtnis erhalten; persönliches Gedächtnis separat behandeln |
| Schwarm hat persistente Zustände, Leases und Inbox/Outbox | `bot-council/packages/matrix/migrations/0001_swarm.sql` | Bestehenden Auftragseigner anbinden und Kernlogik übernehmen; keinen konkurrierenden Scheduler starten |
| Routinen, Abläufe, Gedächtnis, Rat und Not-Aus existieren | Schwarm-Migrationen und Matrix-Hub-Module | Bestehende Funktionen und Daten in der Übernahme vollständig abdecken |

Die externen Schwarm-Quellen liegen auf diesem Deployment unter `/mnt/cache/AI/plum-code/matrix` und `/mnt/cache/AI/plum-code/bot-council`. Konfigurationsdateien und spätere Betriebsanleitung unterscheiden sich bei einzelnen Worker-Rollen; die tatsächliche Verfügbarkeit wird vor dem Import erhoben.

## 3. Bereiche und Navigation

| | Plum Chat | Plum Task | Plum Code |
| --- | --- | --- | --- |
| Einstieg | Nachricht schreiben | Ziel beschreiben | Projekt öffnen |
| Hauptobjekt | Unterhaltung | Auftrag | Projektsession |
| Kontext | Profil, Erinnerungen, gewählte Unterlagen | Ziel, Grenzen, Quellen und Ergebnisse | Repository, Projektregeln und Dateien |
| Standardarbeit | Antworten, erklären und besprechen | Ausführen und ein Ergebnis liefern | Implementieren und prüfen |
| Arbeitsverzeichnis | Für Nutzer nicht erforderlich | Arbeitsmaterial oder eigener Auftragsordner | Explizites Projektverzeichnis |
| Abschluss | Antwort fertig | Abschlussbedingungen erfüllt | Änderung umgesetzt und geprüft |

Die linke Navigation erhält Übersicht, Chat, Task und Code. Suche, Agenten, Aktivitäten und Einstellungen sind gemeinsam. Der Schwarm ist eine gemeinsame Funktion und kein vierter konkurrierender Produktbereich.

Die Übersicht priorisiert Rückfragen/Freigaben, Fehler, neue Ergebnisse, laufende Arbeit und zuletzt genutzte Inhalte. Bestehende Kategorien und Favoriten bleiben nutzbar; keine automatische Umklassifizierung anhand von Namen oder LLM-Vermutungen.

Desktop-Ansichten verwenden die bestehende linke Navigation. Task-Details und Code-Werkzeuge öffnen daneben und reservieren ihre Breite. Mobile Ansichten verwenden dieselben Einstiege; Details werden als eigene Ansicht oder vorhandenes Sheet geöffnet. Der Composer bleibt erreichbar und wird nicht von einem Panel überlagert.

Die vorhandenen Theme-Tokens und Glassmorphism-Flächen bleiben Grundlage. Lesbare opake Fallbacks, Tastaturfokus, Textskalierung und reduzierte Bewegung gehören zur Abnahme. Native Android-Tokens werden weiterverwendet. Der erste gerenderte Entwurf wird auf Desktop und schmalem Bildschirm geprüft, bevor die übrigen Ansichten ausgebaut werden.

## 4. Plum Chat und Personalisierung

### 4.1 Gesprächsablauf

Ein neuer Chat benötigt weder Sessionnamen noch Repository. Plum erzeugt den internen Session-/Chat-Rahmen automatisch. Nutzer wählen optional ein Profil, ein Modell oder einen tatsächlichen Agenten.

Die erste Chat-Version enthält Streaming, Stopp, erneutes Generieren, Bearbeiten einer Nachricht mit erhaltener vorheriger Version, Anhänge, Suche, Archiv, Favoriten und Export. Eine einfache aktive Antwortversion reicht zuerst; ein vollständiger verzweigter Gesprächseditor folgt erst bei Bedarf. Bestehende Nachrichtenzuordnungen und Replay-Garantien gelten auch für Ersatzantworten.

Modellgespräche und Agentengespräche sind sichtbar unterscheidbar. In einem Modellgespräch antwortet der ausgewählte API-/CLI-Weg. In einem Brian-Gespräch erhält Hermes die Nachricht mit seiner Gesprächskennung, seinen Werkzeugen und seinem Gedächtnis. Bei Agentengesprächen zeigt Plum sowohl Agentenidentität als auch tatsächlich gemeldetes Modell.

Uploads bleiben benutzergebunden. Ein Adapter meldet, ob er Bilder, Originaldateien, extrahierten Text oder andere Medien versteht. Dateivorverarbeitung wird als solche angezeigt und darf keine erfolgreich übergebene Originaldatei vortäuschen.

### 4.2 Kontextebenen

1. Technisch durchgesetzte Produkt- und Berechtigungsregeln.
2. Arbeitsweise von Chat, Task oder Code.
3. Anwendbare persönliche Einstellungen.
4. Versioniertes Profil beziehungsweise native Agentenkonfiguration.
5. Gewählte Erinnerungen, Unterlagen und Projektregeln.
6. Aktuelle Nachricht oder Auftrag.

Fremde Dokumente, Webseiten und Agentenergebnisse bleiben Arbeitsmaterial. Freigaben können nur authentifizierte Entscheidungen verändern, nicht Text in diesem Material.

Persönliche Einstellungen enthalten Sprache, Schweizer Rechtschreibung, Antwortlänge und Umgang mit Rückfragen. Ein Assistentenprofil enthält Name, Beschreibung, Anweisungen, bevorzugtes Modell, freigegebene Werkzeuge, Wissensquellen, Gedächtniseinstellung und optional Stimme. Profile sind zunächst privat und kontogebunden.

Profilversionen werden gespeichert. Laufende Aufträge verwenden einen Snapshot; Änderungen wirken für neue Arbeit oder nach ausdrücklicher Übernahme ab der nächsten Nachricht. Die Herkunft des effektiven Kontexts lässt sich anzeigen, ohne Zugangsdaten offenzulegen.

Der bisher gespeicherte globale Systemprompt wird beim Import als vorhandene Einstellung dargestellt. Er wird nicht stillschweigend erstmals für alle bestehenden Sessions aktiviert. Neue Profile und deren Aktivierung werden nachvollziehbar zugeordnet.

Die Bereichsregeln gelten über alle unterstützten Ausführungswege. Ein API-Profil wird im unterstützten System-/Developer-Kontext übergeben. CLI-Adapter nutzen ihre tatsächlich verfügbaren Konfigurationsmöglichkeiten. Einschränkungen des Dateizugriffs und der Werkzeuge müssen im Adapter durchgesetzt werden; ein Systemprompt allein ist dafür keine Zugriffskontrolle.

### 4.3 Gedächtnis und Sprache

Gedächtnisbereiche sind persönlich, assistentenbezogen, projektbezogen und auftragsbezogen. Einträge besitzen Eigentümer, Geltungsbereich, Quelle und Änderungszeit. Nutzer können sie lesen, korrigieren und entfernen. Automatisches Merken ist je Bereich konfigurierbar; bewusstes Merken funktioniert über eine eigene Aktion.

Hermes bleibt Eigentümer seines nativen Gedächtnisses. Plum bindet unterstützte Such-/Merkfunktionen an und kennzeichnet deren Herkunft. Schwarm-Ergebniswissen und Projektwissen bleiben getrennte Quellen. Volltextsuche reicht für die erste Lieferung; vorhandene Embeddings können später ergänzt werden, ohne die Quellenzuordnung zu ändern.

Vorlesen verwendet Vocarium mit OmniVoice. Agenten behalten vorhandene Stimmenzuordnungen, Profile können eigene wählen. Diktat verwendet den vorhandenen Transkriptionsweg. Der bereits in der Schwarm-App vorhandene laufende Sprachdialog mit Aufnahme, Ausgabeunterbrechung und Audio-Fokus ist Pflichtumfang der App-Übernahme. Er kann nach dem überprüften Text-/Dateipfad geliefert werden, muss vor der Ablösung der Schwarm-App vollständig funktionieren. Vorhandene externe Sprachwege werden inventarisiert und nicht als bereits vereinheitlicht bezeichnet.

## 5. Plum Task und Routinen

Ein Task enthält Ziel, Ergebnisanforderung, Arbeitsmaterial, Grenzen, Verantwortlichen, Herkunft und Abschlussbedingungen. Optional kommen Frist, Zeitbudget, Kostenbudget und Zeitplan hinzu. Die Erstellung beginnt mit einem Zielfeld; Routineentscheidungen trifft der Assistent selbst. Konkrete Rückfragen sind nur bei fehlender notwendiger Information vorgesehen.

Die Task-Ansicht verbindet Ziel, Fortschritt, beteiligte Agenten, Rückfragen und Ergebnisse mit einem Gespräch. Artefakte zeigen Ersteller, Versuch und Quellenbezug. Änderungen des Ziels während laufender Arbeit erhalten eine Revision; bereits laufende Arbeit wird kontrolliert gesteuert oder als neuer Versuch fortgesetzt.

### 5.1 Zustände und Versuche

| Sichtbarer Zustand | Bestehender Schwarmzustand oder neue Bedeutung |
| --- | --- |
| Entwurf | Noch kein Auftrag an den Koordinator übergeben |
| Warteschlange | `submitted` |
| Läuft | `working` |
| Wartet auf dich | `input-required` oder `auth-required`, mit getrenntem Grund |
| Abgeschlossen | `completed`, Ergebnis vorhanden und notwendige Kinder beendet |
| Fehlgeschlagen | `failed` |
| Abgebrochen | `canceled` |
| Abgelehnt | `rejected` |
| Pausiert | Neue Steuerungseigenschaft, nur mit klarer Adaptersemantik |

Task, Versuch und Laufzeitstatus sind getrennt. Ein erneuter Versuch erhält eine eigene Versuchshistorie; alte Ergebnisse werden nicht überschrieben. Bestehende historische `attempts` werden als belegte Daten übernommen, ohne nicht vorhandene Einzelläufe zu erfinden.

Eine echte Prozesspause wird nur angeboten, wenn die Laufzeit sie unterstützt. Andernfalls unterscheidet Plum zwischen Warteschlange pausieren, an einem sicheren Punkt unterbrechen und später mit neuem Versuch fortsetzen. Ein unsupported Adapter erhält keinen funktionslosen Pauseknopf.

Nach Ausfall oder Neustart wird aktive Arbeit anhand von Laufkennungen, Leases und tatsächlicher Laufzeit abgeglichen. Unbekannter Zustand wird als unbekannt beziehungsweise unterbrochen angezeigt. Ein verschwundener Prozess oder abgeschlossener Wait-Aufruf beweist keinen Erfolg.

### 5.2 Wiederkehrende Arbeit

Routinen enthalten Zielvorlage, Agent, Zeitplan, Zeitzone, nächste Ausführung und Überlappungsregel. Jede Ausführung erzeugt einen eigenen Task-Versuch. UTC wird gespeichert, die nächste lokale Ausführung wird in der Oberfläche gezeigt. Verhalten bei Sommerzeit und ausgefallenen Terminen ist festgelegt: zunächst höchstens einen verpassten Lauf nachholen und gleichartige Läufe standardmässig nicht überlappen.

Vorhandene Routinen und Abläufe bleiben beim bisherigen Koordinator, bis ihr Eigentumswechsel erfolgt. Die neue Oberfläche kann sie schon vorher anzeigen, auslösen und pausieren. Ein zweiter Scheduler darf nicht gleichzeitig dieselbe Routine bedienen.

## 6. Vollständige Agentenanbindung

### 6.1 Adaptervertrag

Jeder Adapter veröffentlicht Fähigkeiten und deren tatsächlichen Prüfstatus. Der gemeinsame Vertrag umfasst:

- Identität, Health, Anmeldung und verfügbare Modelle feststellen.
- Gespräch erstellen, Nachrichten senden und unterstützten Verlauf abrufen.
- Auftrag starten und native Gesprächs-/Laufkennung speichern.
- Fortschritt, Ergebnis, Dateien und Fehler normalisieren.
- Rückfrage beantworten und unterstützte Steuerung eines laufenden Laufs zustellen.
- Abbruch anfordern und Bestätigung beziehungsweise Fristablauf beobachten.
- Nach Wiederverbindung denselben Lauf abgleichen.
- Native Gedächtnis- und Konfigurationsfunktionen ansprechen, soweit unterstützt.
- Parallelität, Werkzeuge, Zugriffsumfang und Abrechnungsdaten melden.

Nicht alle Agenten sind Chatagenten. Bei einem Melder kann `events` unterstützt sein und `conversation` fehlen. Plum zeigt keine Funktionen, deren Adapterfähigkeit fehlt. Eine Verbindungskarte allein erfüllt den Vertrag nicht.

### 6.2 Integrationsmatrix

| Einheit | Einbindung | Zu erhaltende Eigenschaften | Abnahme |
| --- | --- | --- | --- |
| Brian / Hermes | Eigener Hermes-Adapter; zunächst vorhandener funktionierender Matrix-Transport, direkte API nach vollständiger Prüfung | Gesprächsidentität, Gedächtnis, Skills, Modell-/Ersatzkette, Kanäle und tatsächliche Werkzeuge | Echter Dialog, Datei, Rückfrage, Folgeantwort, Stopp, Reconnect und Gedächtnisbezug |
| Hermes Trader | Vorhandenen Worker und `/v1/runs` weiterverwenden | Fachwerkzeuge, Steer/Stop, Idempotenz und Antragsgrenzen | Analyseauftrag, gezielte Rückfrage, Abbruch, Wiederverbindung und fachliche Aktionsgrenze |
| Hermes Phone | Ausgehende Worker-WS und lokale Phone-Gesprächs-/Run-API | Geräteidentität, Offlinezustand, vorhandene Schutzregeln und native Chats | Phone-Auftrag, Funkloch, gleicher Lauf nach Rückkehr, Abbruch und Geräteblocker |
| Plum-Sessions | Session-/Gateway-Zustellung mit Task-/Run-Verknüpfung | Bestehender Verlauf, Provider, Modus, Chatbindung und aktive Nutzerarbeit | Auftrag landet im richtigen Chat und übersteuert keinen fremden Nutzerturn |
| CLI-Spezialisten | Vorhandene Codex-/Claude-/OpenCode-/Pi-/Kimi-/Vibe-Wege | Benutzeranmeldung, tatsächlicher Provider, Fähigkeiten, Usage und Cancel | Auftrag, echtes Ergebnis, Metadaten und korrekt gebuchte Nutzung |
| Git-Worker | Bestehende festen Git-Aktionen übernehmen | Repo-Freigaben, Patchherkunft, Prüfung und konkrete Aktionen | Patch prüfen, anwenden und zurückmelden; unzulässiges Repo abweisen |
| Betrieb | Bestehenden Fähigkeitenkatalog und Worker anbinden | Zielvalidierung, Aktionsfreigaben und geschützte Kerncontainer | Lesen und konkret autorisierte Aktion mit eindeutiger Rückmeldung |
| Sicherheitswache und Melder | Ereignis-/Alarmadapter | Lebenslauf, Schweregrad, Quelle, Quittierung und Routinen | Alarm wird einmal zugestellt und korrekt quittiert |
| Rat | Bestehende Schwarm-Rat-Logik übernehmen | Unabhängige Beiträge, Teilnehmer, Budget und Synthese | Beiträge bleiben getrennt und die Synthese verlinkt ihre Herkunft |
| Weitere Agenten | Registrierung plus vorhandener oder neuer Adapter | Eigene Laufzeit und Fähigkeitseinschränkungen | Fähigkeitsbezogener Vertragstest und echter Smoke-Test |

Die Fähigkeit von Brians aktueller Laufzeit zu einer vollständigen direkten API-Anbindung ist vor der Umstellung zu verifizieren. Die vorhandene Trader-API beweist diese Fähigkeit nicht für jede Hermes-Instanz. Brian wird bereits über den ersten funktionierenden Transport vollständig nutzbar; seine Einbindung ist kein späteres Komfortfeature.

Telegram, Discord und Matrix bleiben als Kanäle erhalten. Ein Agent wird nicht aufgrund seines Namens mehrfach angelegt. Kanalidentität, Agentenidentität und Gesprächskennung werden getrennt zugeordnet; verschiedene Gespräche werden nicht automatisch zusammengeführt.

## 7. Schwarmsteuerung und Grenzen

Agent ist eine dauerhafte Identität, AgentRun eine Ausführung und Delegation ein Teilziel. Temporäre CLI-Subagenten und dauerhafte externe Agenten werden gemeinsam sichtbar, behalten aber ihre unterschiedlichen Lebenszyklen.

Task-Koordination verwendet zuerst einen geeigneten Agenten. Mehrere Spezialisten oder der Rat kommen hinzu, wenn der Auftrag unterschiedliche Fähigkeiten oder unabhängige Beiträge benötigt. Agentenwahl kann ausdrücklich erfolgen oder anhand der registrierten Fähigkeiten, Verfügbarkeit und Grenzen vorgeschlagen werden.

Der Koordinator verwaltet Wurzel-/Elternbezüge, notwendige Kinder, Priorität, Fristen, Delegationsgrenzen und Ergebniszustellung. Bestehende Hop-/Fan-out-/Retry-Grenzen bleiben zunächst erhalten. Ergebnisrückmeldungen lösen nicht automatisch eine endlose Folge neuer Aufträge aus.

Parallelitätsgrenzen gelten je Agent, Benutzer/Provider, Gerät und gemeinsam genutzter Ressource. Bestehende Dateiabsprachen werden übernommen; parallele Projektänderungen verwenden bei Bedarf getrennte Arbeitskopien. GPU-Aufträge für ComfyUI und Vocarium werden mit den vorhandenen Ressourcenwegen koordiniert.

## 8. Rückfragen, Freigaben und Not-Aus

Die gemeinsame Inbox enthält Rückfragen, Freigaben, Ergebnisse und Alarme. Jedes Objekt besitzt Quelle, Eigentümer und Link zum Auftrag/Gespräch. Rückfragen sind keine Tool-Freigaben und werden getrennt beantwortet.

Eine Freigabe bindet sich an Aktion, Ziel, Umfang, Version und Ablaufzeit. Die Entscheidung wird atomar gespeichert und einmal ausgeführt. Eine Antwort auf einem zweiten Gerät liefert den bereits entschiedenen Stand. Bereits gültige Nutzerautorisation wird nicht bei jeder Wiederholung erneut abgefragt. Agenten dürfen keine Supervisorentscheidung fingieren.

Code-Session-Modus und externe Agentenrechte bleiben getrennt. Ein danger-Modus macht einen Trader nicht zum beliebigen Hostagenten. Bestehende fachliche und technische Befugnisse werden beim Import erhalten und sichtbar konfigurierbar gemacht.

Stoppen hat drei Ebenen: Antwort/Lauf, Task mit notwendigen Kindern und Schwarm-Not-Aus. Bis zur Bestätigung zeigt Plum Abbruch angefordert. Ein abgebrochener Task darf keine verspäteten Resultate wieder als laufende Arbeit übernehmen.

Der bestehende signierte Not-Aus-Weg und seine Geräteanmeldung bleiben erhalten. Der Kontrollweg muss bei Ausfall der normalen Chat-/Weboberfläche funktionieren. Ein Not-Aus verhindert neue Starts und verteilt Cancel; noch nicht bestätigte Abbrüche bleiben sichtbar.

Android verwendet Systembenachrichtigungen auch im Vordergrund mit vorhandenen Kanal- und Berechtigungseinstellungen. Direkte Antwortaktionen binden sich an ihre ursprüngliche Frage. Discord und Matrix sind weitere Kanäle; gemeinsame Ereigniskennungen verhindern Schleifen und doppelte Entscheidungen. An externe Kanäle gehen keine Zugangsdaten.

## 9. Zielarchitektur und Datenmodell

Oberflächen verwenden gemeinsame Gespräche, Kontextzusammenstellung, Artefakte und Sync. Ein Runtime-Verzeichnis wählt Modell-API, CLI, Hermes oder Worker. Der Schwarm koordiniert Aufträge über diese Adapter.

Die Schwarm-Kernlogik wird als eigenständiger Plum-Ausführungsdienst übernommen. Sie muss nicht im Webprozess oder in jedem CLI-Respawn leben. Hermes, Phone und spezialisierte Worker dürfen weiterhin eigenständige Dienste bleiben. Vollständige Produktintegration verlangt keine Zusammenlegung aller Prozesse.

Für API-Chats werden vorhandene benutzergebundene Upstreams beziehungsweise ein ausdrücklich konfigurierter Gateway verwendet. CLI-Abos laufen weiterhin über unterstützte CLI-Wege. Modell, Transportprovider und Abrechnungsquelle bleiben unterscheidbar; keine automatische Umdeutung von CLI-OAuth in API-Zugang.

| Objekt | Kernfelder und Beziehungen |
| --- | --- |
| Session/Conversation | Bestehende sessionId/chatId, userId, surface, Profilversion, Agentenbezug, Kontext |
| AssistantProfile | userId, Name, Version, Instructions, Runtimepräferenz, Werkzeuge, Wissen, Stimme |
| ContextProject | Eigentümer, Unterlagen, Regeln; optional workingDirectory/Repository |
| Task | Ziel, Deliverable, Grenzen, ownerCoordinator, Verantwortlicher, Herkunft, Revision |
| TaskAttempt | taskId, Versuch, Zustand, Start/Ende, native Taskkennung, Ergebnis |
| Agent | Eigentümer, stabile Identität, Adapter, native ID, Fähigkeiten, Status, Grenzen |
| AgentRun | Agent, Versuch, externe Run-/Conversation-ID, Lifecycle, Activity, Revision |
| Delegation | Wurzel, Elternauftrag, Teilziel, zuständige Einheit, Zustellung und Ergebnis |
| Routine | Vorlage, Agent, Zeitplan, Zeitzone, Koordinator, Überlappungsregel |
| Artifact | Eigentümer, Quelle, Run/Versuch, Typ, Pfad/Objektreferenz und Version |
| MemoryEntry | Eigentümer, Geltungsbereich, Quelle, Text und Änderungszeit |
| ActionRequest | Typ Frage/Freigabe, Bezug, Version, Umfang, Status und Entscheidung |

Zunächst werden bestehende Session-, Subagenten- und Schwarmtabellen weiterverwendet. Externe Aufträge erhalten eine lokale Projektion mit `source`, `externalId`, `sourceRevision` und `ownerCoordinator`. Diese Projektion darf keine unabhängigen Auftragszustände schreiben; Änderungen laufen zum zuständigen Hub.

Der aktuelle Benutzer wird beim Legacy-Import ausdrücklich dem bisherigen Supervisor zugeordnet. Globale Schwarmdaten werden nicht automatisch für alle Plum-Konten freigegeben. Weitere Benutzer erhalten nur zugeordnete Agenten und Aufträge.

## 10. Schnittstellen und Ereignisse

Die folgenden API-Ressourcen sind geplant, noch nicht implementiert. Bestehende Session-/Nachrichtenendpunkte bleiben kompatibel.

| Ressource | Aktionen |
| --- | --- |
| `/api/assistant/profiles` | Auflisten, erstellen, versioniert ändern und archivieren |
| `/api/assistant/tasks` | Erstellen, filtern, anzeigen und zugehöriges Gespräch öffnen |
| `/api/assistant/tasks/:id/attempts` | Versuche lesen; expliziten Wiederholungsversuch starten |
| `/api/assistant/tasks/:id/commands` | Submit, Cancel, unterstütztes Pause/Resume und Input als idempotente Befehle |
| `/api/assistant/agents` | Laufzeitinventar, Health und Fähigkeiten lesen; autorisierte Konfiguration ändern |
| `/api/assistant/agents/:id/conversations` | Echte Agentengespräche erstellen und zuordnen |
| `/api/assistant/routines` | Zeitplan anzeigen/ändern, pausieren und jetzt ausführen |
| `/api/assistant/actions/:id/decision` | Frage/Freigabe mit erwarteter Revision atomar beantworten |
| `/api/assistant/memory` | Geltungsbereichsbezogen lesen, suchen, merken, korrigieren und entfernen |
| `/api/assistant/overview` | Agenten, offene Aufträge, Rückfragen, Alarme und Not-Aus-Stand |

Der neue Namespace vermeidet Konflikte mit bestehenden Agentendefinitionen und dem entfernten alten `/api/tasks`-/Orchestrierungsstack. Die vollständigen Wissens-/Artefakt-/Connectorverträge stehen im Gesamtumsetzungsplan; alle Ressourcen hier sind weiterhin Entwürfe.

Befehle tragen stabile `commandId`, Eigentümer, Ziel und erwartete Revision. Änderungen verwenden passende 201-/202-Antworten; 409 kennzeichnet Konflikt oder bereits überholte Revision. Keine freie Shell-Anweisung wird als Infrastrukturaktion aus dem API-Payload übernommen.

Eine neue strukturierte Hub-Steuerungsschnittstelle ist für Operator-Aktionen nötig. Bestehendes Agenten-MCP, Worker-WS und Matrix-Appservice sind vorhanden, stellen aber nicht automatisch ein vollständiges Plum-Management-API dar. Supervisorrechte erhalten einen eigenen authentifizierten Principal. Agententokens werden nicht als menschliche Freigabe verwendet.

Ereignisse umfassen TaskChanged, AgentRunChanged, ActionRequestChanged, ArtifactCreated und AgentHealthChanged. Sie enthalten userId beziehungsweise geprüften Zugriffsscope, Objektkennung, Revision, Quelle, Zeitpunkt und Ereignissequenz. Der vorhandene Socket-/Replay-Weg wird erweitert; die Clients wenden Ereignisse seriell an und bestätigen den Cursor nach erfolgreicher Persistierung.

Usage bleibt über einen gemeinsamen idempotenten Recorder gebucht. Eine Extraktion aus dem bisherigen zentralen Prozessmanager erhält die vorhandene Schreibsemantik. Kostenaggregation zählt einen Lauf einmal; Elternsummen erzeugen keine zusätzlichen Usage-Zeilen. Native Messungen, API-Äquivalente und Laufzeitschätzungen sind gekennzeichnet, unbekannte Werte werden nicht erfunden.

## 11. Migration und Rückweg

### 11.1 Bestehende Plum-Daten

Neue Felder sind additiv. Bestehende Code-Sessions und Linkziele behalten Identität, Repository, Verlauf und Provider. Bekannte Task-/Watchdog-Zuordnungen werden übernommen; andere Sessions bleiben zunächst in ihrem vorhandenen Bereich und sind gesammelt verschiebbar.

Verschieben ändert Bereich und künftige Arbeitsregeln. Als Task weiterführen erstellt dagegen ein neues Auftragsobjekt mit Herkunftsverweis und ausgewähltem Kontext. Ein laufender Turn wird nicht während des Wechsels auf eine neue Prompt-/Runtimekonfiguration umgeschrieben. Ein erforderlicher Laufzeitwechsel findet an einer sicheren Turngrenze statt.

Vorlagen, Favoriten, Kategorien, Anhänge, Drafts und Lesemarker bleiben erhalten. Alte `/session/:id`-Links führen zur passenden neuen Ansicht. Chat benötigt kein verpflichtendes Projekt; Code behält ein tatsächliches Arbeitsverzeichnis. Providerwechsel behält die bestehende Neustartsemantik und führt kein entferntes Handoff-Protokoll wieder ein.

### 11.2 Bestehender Schwarm

1. Tatsächliches Inventar mit Agenten, Laufzeiten, Anmeldestatus, offenen Aufträgen, Routinen, Gedächtnis, Dateien, Kanälen und Grenzen erstellen.
2. Operator-API und Ereignisstrom des bestehenden Hubs ergänzen. Plum wird zunächst Bedienoberfläche und Projektion; Hub bleibt Auftragseigner.
3. Brian und die übrigen Agenten in Plum vollständig bedienen und mit realen Abläufen prüfen.
4. Transportunabhängige Schwarm-Kernmodule und Protokolle in den Plum-Ausführungsdienst übernehmen. Matrix bleibt ein Adapter.
5. Neue Starts des zu migrierenden Bereichs kurz sperren, offene Arbeit auslaufen lassen oder kontrolliert übertragen und Daten konsistent übernehmen.
6. Eigentümer/Scheduler in einer definierten Umschaltgrenze ändern. Generation beziehungsweise Lease-Fencing verhindert Starts und Resultatannahme durch den alten Besitzer.
7. Worker-Endpunkte und Authentifizierung kontrolliert zuordnen; bei Reconnect native Run-IDs abgleichen.
8. Alte Steuerung erst nach nachgewiesener Funktionsgleichheit ablösen. Historische Daten bleiben lesbar.

Der Rückweg vor dem Eigentumswechsel schaltet die Oberfläche auf den alten Hub zurück. Nach dem Eigentumswechsel dürfen nicht beide Dienste wieder starten. Für einen Rückweg wird die neue Vergabe gesperrt, laufende Arbeit abgeglichen und der letzte konsistente Stand übertragen. Ein eingefrorener alter Hub bleibt bis zur Abnahme verfügbar.

## 12. Konkrete Arbeitspakete und Abhängigkeiten

| Paket | Inhalt und betroffene Grundlage | Abhängigkeit | Lieferbares Ergebnis |
| --- | --- | --- | --- |
| I01 | Live-Inventar und native Fähigkeiten; bestehende Schwarm-Konfiguration/Worker | Planung | Tatsächliche Agenten- und Datenzuordnung, auch deaktivierte Einheiten |
| I02 | Shared-Typen, additive DB-Migration, Session-Routen, Gateway, Kontextregeln | I01 für externe Zuordnung | `chat|task|code` und getrennte Runtime-/Agentenreferenzen |
| I03 | Web-App-Routen, Sidebar, Dashboard, SessionPage; Android-Navigation und Modelle | I02 | Drei Einstiege, Übersicht und alte Links |
| I04 | Profile, Versionen, Kontextpipeline, Settings und Runtimefähigkeiten | I02 | Systemprompt wirkt und ist für den nächsten Turn nachvollziehbar |
| I05 | Chat-Erstellung, API-Chatadapter und vorhandene CLI-Wege, Nachrichtenaktionen | I03, I04 | Modellchat mit Verlauf, Anhängen und Stoppen |
| I06 | Hermes-Adapter, native Gesprächszuordnung, Gedächtnis und Medieneinbindung | I01, I03, I04 | Vollständig nutzbarer Brian-Chat auf Web und Android |
| I07 | Strukturierte Hub-Steuerung, Taskprojektion, Ereignisse und Versuchshistorie | I01, I02 | Dauerhafter Task mit zuständigem Koordinator |
| I08 | Integrationsmatrix für Trader, Phone, CLI, Git, Betrieb, Melder und Rat | I06, I07 | Alle vorhandenen Agenten mit geprüften Fähigkeiten |
| I09 | Inbox, Freigabeatomarität, Cancel/Not-Aus, Routine-/Ablaufoberflächen | I07, I08 | Schwarm vollständig aus Plum bedienbar |
| I10 | Transportunabhängige Schwarm-Kernmodule, Scheduler und Ownership-Umschaltung | I09 | Plum übernimmt die Koordination ohne Doppelstarts |
| I11 | Persönliches Wissen, gemeinsame Suche, Vocarium-Stimmen, bereichsübergreifende Übergänge | I05 bis I09 | Persönlicher Assistent im Alltag |
| I12 | Migration, Sync-/Ausfallprüfung, gerenderte Web-/Device-Abnahme und Rollout | Je Lieferwelle; finale Migration nach I10 | Verifizierte Lieferung mit belegtem Rückweg |
| I13 | Vollständige Schwarm-App-Parität, Daten-/Einstellungsmigration, native Geräteeinrichtung und Ablösung | I01 bis I12; Funktionsübernahme verteilt über alle Wellen | Sämtliche bisherigen App-Funktionen in Plum; separate App für diese Abläufe nicht mehr erforderlich |
| I14 | Vollständig eingeplante B01–B14 und ergänzende Fachabläufe liefern; gemeinsame Grundlagen mit I02–I05/I11 wiederverwenden | Lieferwellen W2–W10 des Gesamtumsetzungsplans | Native Assistenzabläufe für sämtliche Vergleichsfamilien und ausgewiesene Spezialfälle mit realer Abnahme |
| I15 | Domain-/Originwechsel auf `plum.zwaetschge-webui.ch` mit Traefik, Authelia, Mobile-JWT, Vorschau und Clientmigration | Domain-Rolloutplan; W1 und Clientabschluss in W6 | Neue kanonische Adresse ohne verlorene Anmeldung, Drafts, Outbox, WebSockets oder Geräteeinstiege |

Web-/Android-Parität und sinnvolle Tests erfolgen pro Lieferwelle; I12 wird nicht bis zum Ende aufgeschoben. Code-Provider und bestehende Werkzeuge werden dabei gezielt auf Regression geprüft.

## 13. Lieferwellen und Abnahmekriterien

Die verbindliche Gesamtlieferreihenfolge ist jetzt W0–W10 im [Gesamtumsetzungsplan](2026-10-10-plum-integration-roadmap.md). Sie umfasst den Domainwechsel früh und sämtliche zusätzlichen Funktionsfamilien. Die folgenden sechs Kernwellen erklären weiterhin die architektonischen Schritte der Assistenz-/Schwarmaufnahme; sie sind kein zweiter, davon unabhängiger Releaseplan.

### Welle 1: Getrennte Einstiege

I02/I03 liefern Chat, Task und Code mit weiter nutzbaren Altdaten. Abnahme: vorhandene Links, Projekte, Anhänge und Favoriten funktionieren; beide Clients zeigen denselben Bereich; Desktop und schmale Ansicht sind tatsächlich gerendert geprüft.

### Welle 2: Persönlicher Chat und Hermes

I04/I05/I06 liefern Profile, Modellgespräche und echten Brian-Chat. Abnahme: ein markanter Profilprompt beeinflusst eine reale Antwort; ein Brian-Dialog, Datei, Folgefrage, Stoppen und Wiederverbindung funktionieren in seiner Laufzeit. Bestehende Brian-Gedächtnisfunktion wird anhand eines dafür angelegten Eintrags verifiziert. Konfiguration ersetzt keine Ende-zu-Ende-Prüfung.

### Welle 3: Dauerhafter Auftrag

I07 liefert einen Task mit echtem Ergebnis. Abnahme: ein Dokumentauftrag geht vom Upload über den zuständigen Agenten bis zum Ergebnisartefakt; Neustart und Reconnect bewahren Zuordnung und Zustand; fehlende notwendige Ergebnisse verhindern erfolgreichen Abschluss.

### Welle 4: Gesamter Schwarm bedienbar

I08/I09 liefern alle Integrationen, Rat, Routinen, Rückfragen, Freigaben, Betrieb und Not-Aus. Abnahme: reale mehrstufige Arbeit über unterschiedliche Laufzeiten, Phone-Reconnect ohne Doppelstart, Trader-Fachgrenzen, Git-/Betriebsaktionen, zwei Geräte beantworten dieselbe Freigabe nur einmal und Abbruchstatus bleibt bis zur Bestätigung korrekt.

### Welle 5: Koordination in Plum

I10 übernimmt Kernlogik und Scheduler. Abnahme: genau ein Besitzer je Auftrag/Routine; alte Besitzer können nach Umschaltung nicht weiter vergeben; aktive Arbeit und verspätete Ergebnisse sind abgeglichen; Matrix-Ausfall blockiert den nativen Plum-Kontrollpfad nicht; Not-Aus und Rückweg sind geprüft.

### Welle 6: Assistentenkomfort

I11 vervollständigt Wissen, Suche, OmniVoice und Übergänge. Abnahme: Chat zu Task, Task zu Code und Ergebnis zurück ins Ausgangsgespräch; getrennte Gedächtnisbereiche; Vorlesen mit gewählter OmniVoice; gleiche Kernbedienung auf Android und Web.

Die erste nützliche Lieferung umfasst Welle 1, Welle 2 und den einfachen Taskpfad aus Welle 3. Der Umfang des Gesamtauftrags bleibt darüber hinaus die vollständige Schwarmübernahme.

Die vollständige Schwarm-App-Übernahme ist eine zusätzliche Abschlussbedingung über alle Lieferwellen hinweg. Die Funktionsmatrix S01–S37 ist verbindlich. Sprachmodus, Räume/Threads, Biometrie, Offline-Nutzung, Push-Diagnose, Widgets, Geräteeinrichtung und App-Updates dürfen nicht als optionale Komfortarbeit aus dem Umfang fallen. Reine Backend- oder Agentenanbindung reicht für den Abschluss nicht aus.

## 14. Prüfstand und noch zu belegende Annahmen

Der Plan beruht auf lokalen Quellcode-, Konfigurations- und Schnittstellenprüfungen sowie einem angesehenen realen Desktop-Dashboard. Zusätzlich wurden Builder-Metadaten, Manifest, UI-/Datenmodule und Aktionsmethoden der bestehenden Schwarm-App geprüft; der Quellstand nennt Version 2.10.1, versionCode 20. Die laufenden Container wurden inventarisiert, aber nicht alle Agenten live beauftragt. Das ausgewählte Android-Gerät war bei der Sichtprüfung nicht verbunden; eine schmale gerenderte Ansicht konnte durch den Resize-Versuch nicht hergestellt werden. Diese UI-Abnahmen bleiben offen.

Vor der Implementierung konkret zu verifizieren sind: der Live-Status alter Worker-Einträge, Brians direkte API-Fähigkeiten, lesbarer und exportierbarer Umfang seiner historischen Gespräche und Gedächtnisse, Zuordnung des bisherigen Supervisors zum Plum-Konto, vollständige Daten-/Artefaktpfade, bestehende Sprachwege sowie die Befugnisse des neuen Operator-API.

Öffentlicher Profilmarktplatz, neues Agentenframework und vollständiger Gesprächsbaum-Editor sind nicht Teil der ersten Lieferung. Sie sind für die gewünschte persönliche Assistenz und die vollständige Einbindung vorhandener Agenten nicht notwendig.

Produktcode, Runtimekonfiguration und laufende Dienste wurden für diesen Plan nicht verändert. Die Implementierungsliste bleibt ausdrücklich offen.


## 15. Vergleich mit ChatGPT und Claude am 10.10.2026

Der [Funktionsvergleich](</mnt/user/appdata/claude-code-webui/reports/ChatGPT Claude und Plum Funktionsvergleich.md>) trennt offizielle Produktfunktionen, lokale Implementierungsbelege, geplante native Abläufe und externe Pflichtübernahmen. Datierte Veröffentlichungen und aktuelle Hilfeseiten ohne historische Einzelverifikation sind getrennt markiert. Er ergänzt den Gesamtplan; die vollständige Aufnahme und Ablösung der Schwarm-App mit S01–S37 bleibt unverändert verbindlich.

Zusätzliche Priorität erhalten wirksame persönliche Profile, verlustfreie Nachrichten-/Antwortversionen, sichtbares Gedächtnis, nicht an Git gebundene Wissensprojekte, strukturierte Recherche und ein gemeinsames versioniertes Artefaktmodell. Darauf bauen Dokument-, Tabellen-/Folieneditoren, Veröffentlichungen und interaktive Connector-Oberflächen auf. Archiv, Textsuche, Markdownexport, Androidcache, bestehende Modellsteuerung, Browserwerkzeuge und Subagenten sind vorhanden und werden weiterverwendet.

B01–B14 sind auf die jüngste Anweisung hin vollständig in den Gesamtumsetzungsplan aufgenommen, zusammen mit eigenen Abläufen für zuvor unbestätigte Spezialfamilien. Überlappende Grundlagen werden den vorhandenen I-Paketen zugeordnet; I14 bleibt bis zur tatsächlich geprüften Lieferung offen. Geplant wird das ganze Produkt, umgesetzt wurde in diesem Planungsauftrag noch nichts. Bei Sprache bleibt Vocarium mit OmniVoice gesetzt; die vollständige Schwarm-Sprachbedienung ist Pflicht, Echtzeit-Full-Duplex ein späterer konkret geplanter Ausbau und keine bereits belegte Parität.

REA MCP wurde zum Abgleich eines Schwarm-APK und des ausgelieferten Plum-Frontend verwendet. APK-Inventar und begrenzter JavaScript-Graph sind dokumentiert; fehlende JADX-Capability, Timeout und ausstehende Live-/Geräteabnahme bleiben Nachweisgrenzen. Sie erzeugen keine zusätzliche obligatorische Infrastrukturphase. Anbieter-Rollouts, Einzelkonto-Verfügbarkeit und unbestätigte Consumer-Familien werden vor einer konkreten Umsetzung gezielt geprüft.
