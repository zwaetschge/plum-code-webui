# Aufgabenliste für Plum als persönlichen Assistenten

Stand: 2026-10-11. Vollständige Planung abgeschlossen; die Quelllieferungen im belegten Umfang sind unten dokumentiert. Der anschliessend autorisierte Web-Rollout ist erfolgt; Migrationen 010–012 und die echten Webeinstiege sind live geprüft. Die jüngste Chatgestaltung wird ohne Neustart aktiver Providersitzungen über statische Assets veröffentlicht. Vollabnahme und zusätzliche nicht verfügbare Host-/Dienstadapter bleiben separat offen.

## Aktueller Implementierungsstand

- [x] Additive Assistenzmigration in einer isolierten PostgreSQL-Testdatenbank zweimal ausgeführt; anschliessend wurden die additiven Migrationen im autorisierten Rollout produktiv angewandt (23 Assistenztabellen).
- [x] Ressourcenrechte, immutable Profilversionen, parallele Revisionskonflikte und Memory-Kontext mit Regressionen geprüft.
- [x] Shared-, Backend- und Frontend-Typprüfung ohne Build bestanden.
- [x] Webeinstiege und eigene Bibliothek quellseitig liefern und tatsächliche Desktop-/Mobilrender nach den Korrekturen prüfen. Native Fachparität und Live-Abnahmen bleiben separat offen.
- [x] Native Matrix-Agenten, Brian-Gespräche, Medien und Taskzuordnung quellseitig liefern; echte Identität/Epoch, Native-Task-Receipts und Originalmedien isoliert geprüft. Externe Worker-Liveabnahme bleibt offen.
- [x] Koordinator, Routinen, Freigaben und unabhängigen Not-Aus im vollständigen nativen Quellstand übernehmen. Produktiver Koordinatorwechsel und signierte Geräteabnahme bleiben offen.
- [x] Android-Einstiege und vollständige native Schwarm-Library quellseitig übernehmen; Kompilierung, Manifest-Merge und Geräteprüfung bleiben entsprechend der Build-Zurückstellung offen.
- [x] Wissen, Ergebnisbearbeitung und die belegten B-/C-Quellpfade liefern; Umfang, besondere Host-/Adaptergrenzen und Nachweise stehen in der Quellabdeckungsmatrix.
- [x] Domainmigration, lokale Browserzustände und Clientkompatibilität quellseitig vorbereiten; öffentliche Versionen und Office-Bootstrap getrennt vom normalen Authelia-Zugang, standardmässig deaktiviert. Live-Umschaltung bleibt separat offen.

Bereits im Quellcode: drei Bereiche; isolierte Chat-/Task-Arbeitsverzeichnisse; versionierte Profile, Quellen, Erinnerungen und Ergebnisse; Assistenz-MCP; CLI-Taskversuche mit idempotenten Commands und Executor-Lease; persönliche Matrix-Verbindung, Räume/Threads und native Agentenstatusevents; erste Android-Einstiege. Die Domain-Override-Datei liegt separat unter `deploy/` und wird nicht automatisch angewendet. Diese Zwischenstände sind keine vollständigen I-/B-/S-Abnahmen. Weder produktive Migration noch Provider-Testturn, Android-Build, App-Ablösung oder Domainumschaltung haben stattgefunden.

Der [aktuelle Quellabgleich](plum-assistant-source-coverage.md) ordnet sämtliche B01–B14, C01–C13 und S01–S37 den tatsächlichen Quellpfaden und isolierten Nachweisen zu. Er benennt verbleibende externe Adapter und zurückgestellte Live-/Geräteabnahmen. Die pauschalen I-/B-/S-Haken unten verlangen weiterhin die vollständige reale Abnahme; sie werden nicht allein wegen vorhandener Dateien gesetzt.

Der [Detailplan](2026-10-10-plum-assistant.md) enthält Architekturentscheidungen. Der [Gesamtumsetzungsplan](2026-10-10-plum-integration-roadmap.md) verbindet sämtliche Funktionen mit den aktuellen Codepfaden und Lieferwellen W0–W10. Der [Domain-Rolloutplan](2026-10-10-plum-domain-migration.md) enthält den Wechsel auf `plum.zwaetschge-webui.ch` mit Traefik/Authelia. Die [Schwarm-App-Funktionsmatrix](schwarm-app-ingestion.md) gehört verbindlich zum Umfang. Sämtliche B01–B14 aus dem [Funktionsvergleich](</mnt/user/appdata/claude-code-webui/reports/ChatGPT Claude und Plum Funktionsvergleich.md>) sind jetzt eingeplant. Diese Liste wird bei jeder späteren Lieferung aktualisiert; ein Haken bedeutet belegten Abschluss, nicht nur vorhandene Konfiguration.

## Geprüfte Quelllieferungen seit dem ersten Zwischenstand

- [x] Schwarm-Hub als Workspace-Paket `packages/swarm` übernommen: Broker, Rat, Freigaben, Routinen, Gedächtnis, Voice, Alarmierung und signierter Not-Aus; Originaldateien mit Hashinventar dokumentiert.
- [x] Quellseitige Umschaltung abgesichert: standardmässig deaktiviert, tatsächlichen Alt-Hub-Stopp prüfen, reservierter PostgreSQL-Lock, laufende Schreiber vor Freigabe beenden. Typprüfung bestanden; 70 übernommene native Regressionen auch nach der Shutdown-Anpassung bestanden.
- [x] Vollständigen Android-Schwarm-Client 2.10.1 als eingebettete Library übernommen, im Plum-Einstieg verlinkt, Lifecycle/Manifest/Widgets/Push integriert und Schwarm-APK-Updateweg gesperrt.
- [x] Native Android-Ressourcen/Namespaces und XML statisch geprüft; keine Signierschlüssel oder APKs übernommen. Gemeinsamer Not-Aus-Schlüssel, gezielte Backup-Ausschlüsse und Builder-Sync dokumentiert.
- [x] Gesprächsabzweigungen mit Originalverlauf, Anhängen und frischem Provider-Kontext implementiert; Eigentümerprüfung, Schnittgrenze, Unabhängigkeit und Kontext mit isolierten PostgreSQL-Regressionen belegt.
- [x] Profilbindung und Diktat im Gespräch erreichbar; diktierten Text direkt senden oder als Task-Entwurf übernehmen. Zweigaktivierung verwendet den bestehenden Thread-/Socket-Abgleich.
- [x] Persönliche Kurse/Lektionen, Sammlungsbezüge und Meeting-zu-Protokoll/Task-Einstieg ergänzt; Quelldatei im Original abrufbar.
- [x] UTF-8-/PDF-Quellenimport mit gespeicherten Originalbytes, Eigentümerrechten, Dedup und nachvollziehbaren Grenzen umgesetzt; Textimport/Original/Dedup getestet.
- [x] Versionierte Ergebnisbearbeitung, CSV-Zellen, Folien, Markdown/LaTeX, sandboxierte HTML-Vorschau und Datei-Export umgesetzt. DOCX/XLSX/PPTX mit unabhängigen Python-Lesern, XML und Relationships geprüft; Formeltext wird nicht ausgeführt.
- [x] Widerrufbare, zeitlich begrenzte Ergebnis-Snapshots mit eigener Nur-Lese-Ansicht und Authentifizierung umgesetzt. HTTP-Abnahme mit eigener Testinstanz bestanden: Anmeldung, Fremdbesitz, Revisionbindung, Widerruf und Ablauf.
- [x] Kontodatenexport auf konsistenten Snapshot samt Chats, Nachrichten, Revisionen, Originaldateien und Importbilanz erweitert; Eigentümertrennung des Snapshots getestet. ZIP-Originalbytes/Prüfsummen und ehrliche Fehlbilanz mit eigenem HTTP-Test geprüft; echter Matrix-Medienpfad noch separat abnehmen.
- [x] Codex-Temporärmodus mit `--ephemeral`, ohne native Resume-ID, ohne dauerhafte MCP-Bibliothekseinträge, 24-Stunden-Ablauf und gezielter Löschung des eigenen Arbeitsbereichs umgesetzt und isoliert getestet. Verbrauchswerte bleiben inhaltsfrei erhalten. Externe Dienste behalten ihre eigenen Datenregeln.
- [x] Browsertransfer von Entwürfen/Outbox für identische Installation und Konto vorbereitet; importierte Nachrichten benötigen aktive Prüfung. Authentifizierungsdaten werden nicht exportiert.
- [x] Assistenz-Outbox für unbestätigte Task-/Matrix-Zustellungen ergänzt; Wiederholen behält dieselbe Befehlskennung. Browser-Fixture prüft Netzwerkausfall, Reload, unveränderte Transaktion, explizite Wiederholung und Kontowechsel.
- [x] Neue Domain, Preview-Alias, Callback/CORS-Übergang und Android-App-Link-Route im Quellcode vorbereitet. Fingerprints werden nur aus echter Betreiberkonfiguration publiziert; keine Platzhalterzuordnung.
- [x] Webübersicht, Chat, Tasks und Schwarm erneut in unabhängiger Fixture-Instanz auf Desktop bzw. 390-Pixel-Ansicht gerendert: keine Error-Boundary und kein horizontaler Seitenüberlauf.
- [x] Ergebnis-, Lern- und Nur-Lese-Freigabeansichten in eigener Web-Fixture gerendert; mobile Freigabe über REA dokumentiert. Evidence enthält keine produktive Sitzung.
- [x] OmniVoice-/Whisper-Vertrag mit Wort-Zeitmarken, vollständigem abschnittsweisem Vorlesen und Turn-basierter Sprachbedienung ergänzt; Browser-Fixture prüft Verwerfen, Chatwechsel, Mikrofonabbruch und automatische Beiträge. Noch kein echtes Mikrofon-/Vocarium-Abnahmeturn.
- [x] Quellengebundene Quizfragen und gespeicherte Versuche mit Eigentümertrennung, Revisionskonflikt und dauerhafter Versuchskennung implementiert und isoliert geprüft.
- [x] Berechenbares Plum-Tabellenmodell mit Rohwerten, Formeln, begrenztem lokalen Interpreter und Excel-Resultaten ergänzt; Arithmetik, IF, Bereiche, Zyklen, Fehler und Export geprüft. Vollständiger Office-Roundtrip bleibt offen.
- [x] Quellenabschnitte mit Offsets/Seitenbezug, dateibasierte Revisionen, unveränderte Originale und aktuelle Retrievalrevision isoliert geprüft; archivierte Quellen verschwinden aus der Suche.
- [x] Quellenänderungen erzeugen idempotente Task-Entwürfe für aktivierte Abos; die Eingangsrevision eines gestarteten Tasks bleibt gebunden. Öffentliche URL-Beobachtung ist separat implementiert und isoliert geprüft; der Hintergrundabruf wird erst beim späteren Rollout aktiv.
- [x] Recherchebelege werden gegen exakte Zitate aus eigenen unveränderlichen Quellenrevisionen geprüft; Modelle können keine menschliche Prüfung bestätigen. Ein vollständiger Rechercheablauf bleibt offen.
- [x] DOCX/XLSX/PPTX-Originalimport mit begrenzter ZIP-/XML-Verarbeitung, bearbeitbaren Kopien und unverlierbarer Importherkunft umgesetzt; echte Office-Dateien mit isolierten Tests geprüft. Layout-/Medien-Roundtrip und vollständige Office-Fachabläufe bleiben offen.
- [x] Kontogebundene Matrix-Zustellungen, Einladungen und Raummitgliedschaft ergänzt; Identitätswechsel während laufender Anfragen und Wiederholung nach verlorener Antwort isoliert geprüft. Native Auftragswiederholung behält tatsächlichen Worker, Event und Quellenrevision.
- [x] Websteuerung für native Modell-/Fallback-/Reasoningwahl und Fachaktionen ergänzt; Befehle werden bewusst im bestehenden Composer vorbereitet. Kurs-/Quizeditor, Quellensuche, Office-Übernahme und Kontocachetrennung im Browser geprüft.
- [x] HTML-App-Vorschau über eigene Einmal-Route mit tatsächlichen Produkt-CSP-Headers geprüft; gespeicherte App-Revision, persönliche Zustandsspeicherung, Reload, Widerruf/Archivierung und Kontosperre im isolierten HTTP-/Browser-Test belegt.
- [x] Eigenständigen Modellchat über persönliche API-Verbindungen umgesetzt: OpenAI-kompatibles und natives Anthropic-Streaming, versionierte Profile, private Erinnerungen, Dokumentretrieval, dauerhafte Turn-Kennungen und vollständiger Verlauf. Secret-freier Modellkatalog, Teilantworten, Abbruch, Wiederholung und Nachladen während neuer Beiträge isoliert geprüft; keine echten kostenpflichtigen Testturns.
- [x] Modellchat-Abzweigungen, Antwort-zu-Ergebnis/Task/Erinnerung, Herkunftskontext für tatsächliche CLI-/native Tasks und Kontodatenexport ergänzt; Frontend-/Backend-Regressionen für den direkten Modellchat bestanden.
- [x] Geprüfte Auswahländerungen mit gebundener Textstelle und Zielrevision implementiert; unveränderte Umgebung, Revisionskonflikt, Eigentümertrennung und dauerhafte Zustellungsquittung mit isolierten PostgreSQL-Regressionen geprüft.
- [x] Quellengebundene Dokumentrecherche mit strukturiertem Bericht und Belegregister implementiert; exakte alte Quellenrevisionen, idempotentes Speichern und Abweisung erfundener Zitate/Revisionen/menschlicher Prüfungen isoliert geprüft.
- [x] Neue Auswahl-/Rechercheabläufe und aktualisierte Loginansichten auf Desktop/Mobil geprüft; Quellenberichte bleiben bearbeitbar und Aussagen verlangen eine eigene Prüfung.
- [x] Eigenes inhaltsfreies Modellchat-Verbrauchsregister samt API-Verbindung/Modell, bestätigten Tokenzählern, unbekannten Preisen und eigenem Bereich in Analytics ergänzt. Gesprächskopien buchen keinen zweiten Verbrauch; die ursprüngliche Verbindung bleibt bei einem Modellwechsel erhalten. Zeitraum und Mobilansicht geprüft.
- [x] Temporäre API-Chats mit 24-Stunden-Ablauf, ohne persönliche/Projekt-Erinnerungen, ohne dauerhafte Übernahme und mit Löschung von Verlauf, Kontext und Befehlsquittungen isoliert geprüft. Inhaltsfreie Verbrauchswerte bleiben erhalten; abgelaufene Browserzustellungen werden beim Öffnen ohne erneutes Senden entfernt.
- [x] Private Bildanhänge mit Originalbytes, Dedup, Kontorechten, OpenAI-/Anthropic-Payloads, Verlauf/Abzweigungen und Bereinigung temporärer Originale isoliert geprüft. Upload, Vorschau und vererbte Bilder in Abzweigungen im echten Browserpfad geprüft.
- [x] CLI-Tasks lesen ausgewählte Originalbilder über `plum_read_task_image`; isolierte Regression weist fremde und nicht ausgewählte Bilder ab. Native Matrix-Bildweitergabe wurde inzwischen separat ergänzt und isoliert geprüft.
- [x] Android-Modellchat im Quellcode ergänzt: eigene API-Verbindungen, versionierte Profile/Quellen, temporäre Gespräche, Verlauf, Teilantworten, Abbruch, Bildanhänge, Abzweigungen und Ergebnisübernahme. Kontogebundene verschlüsselte Zustellung speichert die Kennung vor dem Request und wiederholt nur ausdrücklich. Noch nicht kompiliert oder auf einem Gerät geprüft.
- [x] Datenworkspace mit CSV-/JSON-Originalimport, unveränderten Originalbytes, Notebook-Schritten, Statistik, Pivot-Gruppen, Histogramm, Pearson-Korrelation und geordneten Filtern ergänzt. Bestätigte Läufe sind an Eingaberevision/SHA-256 gebunden; Speichern, Diagramme, Berichte und Desktop-/Mobilansicht isoliert geprüft. Neue MCP-Werkzeuge erlauben Agenten die Erstellung und Ausführung.
- [x] Domainübertragung um die Assistenz-Outbox erweitert: Instanz-/Kontoprüfung, ursprüngliche Befehlskennungen, Konfliktprüfung, temporärer Ablauf und keinerlei automatische Zustellung. Browser-Test über zwei echte lokale Origins bestanden; keine Credentials exportiert.
- [ ] Reale native Bildverarbeitung und noch fehlende Fachabläufe abnehmen. Android-Sprachbedienung ist quellseitig ergänzt; Geräteprüfung bleibt zurückgestellt. Vorhandene CLI-Abos werden nicht als API-Zugang ausgegeben.
- [ ] Native Android-Library kompilieren, Manifest-Merge und S01–S37 auf dem ausgewählten Gerät prüfen; Builds weiterhin zurückgestellt.
- [ ] Zusätzliche nicht vorhandene Fach-/Plattformadapter bei tatsächlich verfügbarem Host oder Dienst ergänzen; ein allgemeiner Editor oder konfigurierbarer Taskweg ist keine gesicherte Vendor-/Hostparität.
- [ ] Vollständige Datenübernahme, reale Providerturns, Koordinatorübergang, DNS/TLS/Authelia und App-Ablösung nach dem zurückgestellten Build-/Deployment-Schritt abnehmen.

## Planung

- [x] P01 Produktaufteilung Plum Chat, Plum Task und Plum Code festlegen.
- [x] P02 Bestehende Sessions, Personalisierung, Sync, Subagenten und Watchdogs prüfen.
- [x] P03 Bestehenden Schwarm samt Hermes-Varianten, Agentenrollen und Schnittstellen untersuchen.
- [x] P04 Chat-, Task-, Code-, Gedächtnis- und Berechtigungsmodelle ausarbeiten.
- [x] P05 Vollständigen Adaptervertrag und Integrationsmatrix für alle Agenten definieren.
- [x] P06 Datenmodell, API, Migration, Ownership-Umschaltung und Rückweg planen.
- [x] P07 Arbeitspakete, Abhängigkeiten, Lieferwellen und reale Abnahmekriterien ausarbeiten.
- [x] P08 Plan und Aufgabenliste auf Vollständigkeit, Quellenpfade und Statusangaben prüfen.
- [x] P09 Schwarm-App-Quellprojekt identifizieren und ihre Funktionen vollständig in den Übernahmeumfang einordnen.
- [x] P10 Ergänzte App-Funktionsmatrix, Migration und Abschlussbedingungen auf Konsistenz prüfen.
- [x] P11 ChatGPT-/Claude-Funktionsvergleich zum 10.10.2026 recherchieren, mit Plum abgleichen und priorisiertes Zusatzbacklog dokumentieren.
- [x] P12 REA-MCP-Abgleich vorhandener APK-/Frontend-Artefakte mit Evidence und ausdrücklich dokumentierten Nachweisgrenzen durchführen.
- [x] P13 Alle Vergleichsfamilien und ergänzenden Fachabläufe dem bestehenden Plum, Datenmodell, API und vollständigen Lieferwellen zuordnen.
- [x] P14 Bestehendes Traefik-/Authelia-/Mobile-Deployment read-only prüfen und Domain-/Originmigration samt Rollout/Rückweg durchplanen.
- [x] P15 Gesamtplan, Domainplan, Familienabdeckung, Quellenpfade und Aufgabenstatus abschliessend auf Konsistenz prüfen.

- [x] Öffentliche HTTPS-Webquellen mit DNS-/Netzprüfung, Originaldokument, HTTP-Dekompression und revisionsgebundener Beobachtung ergänzt; Quellenänderungen erzeugen Task-Entwürfe. Isolierte Rechte-/Race-/HTTP- und mobile Browserprüfungen bestanden; tatsächliche Python-Dokumentation erfolgreich gelesen. Kein produktiver Beobachter gestartet.
- [x] Kamera-/Bildschirmvorschau für Modellchats mit ausdrücklicher Einzelbildübernahme ergänzt. Echter Canvas-/Videopfad auf Desktop und schmalem Browser geprüft; kein automatischer Upload, Tracks werden bei Abbruch, Kontowechsel, Hintergrundwechsel und Verlassen beendet. Physische Kameras und native Android-Aufnahmen bleiben separat abzunehmen.

- [x] Bildoriginale aus Modellchat-Tasks auch als native Matrix-Bildereignisse mit referenziertem Auftragskontext zugestellt. Bestätigte Uploads, Ereignisse, ursprüngliches Ziel und Quellen bleiben bei verlorenen Antworten erhalten; Kontowechsel während Upload wird isoliert geprüft. Kein externer Worker-Testturn.

- [x] Formatierte Dokumente mit kanonischen Blöcken, exakter Textformatierung, Weblinks, Listen, Ausrichtung, Tabellen und Undo/Redo ergänzt; unterstützten DOCX-Ausschnitt mit tatsächlichem Export/Reimport sowie Desktop-/Mobilbearbeitung geprüft. Vollständiger Medien-/Layout-Office-Roundtrip bleibt offen.

- [x] CLI-Taskkosten über alle Versuche, Budget-/Fristprüfung vor neuen und vorgemerkten Beiträgen sowie ehrliche Grenzen bei unbekannten Preisen umgesetzt; tatsächliche Queue-Methoden von Claude, Codex, OpenCode, Kimi und Vibe ohne Providerstart isoliert geprüft. Native Auftragsdaten mit Budget/Frist und echte Hub-Ablehnungen im Quellcode übernommen; produktiver Hub-Rollout bleibt aus.

- [x] Revisionsgebundenen PDF-Export für Dokumente, Recherche, Tabellen, Notebooks, Folien und KaTeX-Formeln ergänzt; echte Chromium-Dateien mit unabhängigem PDF-Leser, Umlaute, berechnete Werte, Laufherkunft, Diagramme, Querformat und Fehler bei zu breiten Formeln geprüft. Kein externer Renderdienst oder Produkt-Rebuild.
- [x] Strukturierte Folien mit Titel-/Aufzählungs-/Spaltenlayout und separaten Sprechernotizen ergänzt; Bearbeitung, Reihenfolge, Speicherung und Desktop-/Mobilvorschau geprüft. Tatsächlicher PPTX-Export wird vom unabhängigen PowerPoint-Leser gelesen und erhält den eigenen unterstützten Modell-Ausschnitt beim Reimport. Vollständiger Layout-/Medien-Roundtrip bleibt offen.

- [x] Persönliche Sammlungen mit Suche, Favoriten, Reihenfolge und kontrollierter Speicherung ergänzt; fremde/archivierte Verweise, unveränderte Originale, konkurrierende Revisionen und Desktop-/Mobilbedienung isoliert geprüft. Die schmale Anordnung wurde nach Sichtprüfung korrigiert.

- [x] Produktvergleiche mit exakt geprüftem Preis-/Belegauszug, Angebotslink, Quellenrevision und Datum, Favoriten und eigener Entscheidung ergänzt. Verlorene Erstellungsantworten, fremde/erfundene Belege, alte Stände nach Aktualisierung/Archivierung sowie Webbearbeitung und echter PDF-Export isoliert geprüft. Ein illustrativer Anprobe-Task mit zwei Referenzoriginalen ist inzwischen separat ergänzt und geprüft. Echte Bildgenerierung und vollständige Shopping-Abnahme bleiben offen.

- [x] Direkte private Task-Bilder mit revisionsgebundenen Originalen, Eigentümer-/Workerrechten, SHA-Wiederholung, Zustellungssperre bei unklarer Antwort und nativer Matrix-Weitergabe ergänzt. Echte Multipart-/HTTP-/MCP- sowie Desktop-/Mobilprüfungen bestanden; kein externer Worker-Testturn.
- [x] Android-Sprachbedienung im direkten Modellchat quellseitig ergänzt: bestätigtes lokales Diktat über Whisper und abschnittsweise OmniVoice-Wiedergabe mit frei wählbarem Stimmklon. Kein Android-Build oder Geräte-/Vocarium-Abnahmeturn; diese Nachweise bleiben offen.
- [x] Android-Kameraaufnahme mit lokaler Vorschau, ausdrücklicher Originalübernahme, Datei-/Kontogrenze und Cleanup im Quellcode ergänzt; Geräteabnahme bleibt zurückgestellt.
- [x] KI-Auswahländerungen auf formatierte Dokumentabsätze und einzelne Tabellenzellen erweitert; übrige Formatierung, Links, Ausrichtung und Blöcke bleiben erhalten. Rechte, exakter Pfad/Text, Revisionbindung, geprüfte Übernahme und tatsächliche Desktop-/Mobilbedienung isoliert geprüft.
- [x] Bearbeitbare zweidimensionale Animation mit Timeline, Elementen, Vorschau und revisionsgebundenem PNG-/SVG-/MP4-Export ergänzt. Echte lokale H.264-Datei, Dauer/Frames/Codec und sichtbare Anfangs-/Endpositionen unabhängig geprüft; Webbedienung auf Desktop/Mobil ebenfalls. Audiospuren und einfache Physiksimulation sind inzwischen separat ergänzt und geprüft; generatives Video bleibt offen.

- [x] Taskbaum-/Listenansicht, serverseitige Status-/Prioritäts-/Fristfilter vor Pagination und mobile Elternnavigation ergänzt; tatsächliche Browser- und isolierte Rechte-/Sortierprüfungen bestanden.
- [x] Python-Quelltext als sichere Codevorschau und echte `.py`-Datei ergänzt; Backend-Dateibytes und tatsächlichen Browserdownload mit exaktem Dateinamen und sicheren Textbytes geprüft.
- [x] Eigene Uploadoriginale ohne Generierung an Ergebnisse gebunden; Konto-/SHA-Rechte, HTML-/App-Einbettung und tatsächliche Word-/PDF-Pixel geprüft.
- [x] Kanonische Dokumentbildblöcke mit atomarem Upload, UUID-Wiederholung nach verlorener Antwort, Alternativtext, Caption und Reihenfolge auf Desktop/Mobil geprüft. Tatsächlicher Word-Export/Reimport erhält den eigenen unterstützten Bild-/Caption-/SHA-Ausschnitt; vollständige Office-Layout-/Medienparität bleibt offen.

- [x] Lokalen Fensterverlauf für ein ausdrücklich gewähltes Appfenster ergänzt: Zeit-/PNG-/Grössenbindung, lokale 30-Minuten-Retention, Einzelbildauswahl und bearbeitbarer Anleitungsentwurf ohne automatische Installation/Ausführung. Reale Canvas-/Videopixel, Stop/Kontowechsel/Verlassen und Desktop-/Mobilansicht geprüft; native OS-Auswahl bleibt separat.
- [x] Eigenen Word-Add-in-Start mit getrackter Auswahl, einmaliger Origin-/Verifier-Verbindung, eng begrenzter Office-Capability, temporärem API-Dialog und dauerhaftem Task-Entwurf ergänzt. Tatsächliche HTTP-/PostgreSQL-/SSE-Abbruch-/UUID-Races und 330-Pixel-Taskpane/Portal geprüft. Word/M365-Host und produktive Installation bleiben offen; kein Rebuild/Redeploy.

- [x] Persönliche Google-Verbindungen als native Gemini-Modellchats eingebunden: Text/Bild/System/Verlauf, fragmentiertes SSE, Cache-/Reasoningverbrauch und Abbruch-/Tool-/Blockfehler mit eigener verschlüsselter Konfiguration und tatsächlicher PostgreSQL-Turnspeicherung geprüft. Kein externer Modellturn.

- [x] Gemeinsame Dokumentansicht mit ausdrücklich vergebenen Leser-/Editorrechten, Historie ab Freigaberevision, geschützten Bildoriginalen und Änderungsprotokoll ergänzt. Eigene PostgreSQL-Prüfungen für Rollen, Fremdbesitz, parallele Revisionen und Widerruf bestanden; tatsächliche Desktop-/Mobilbedienung, verlorene Antworten und bewusster Neuabruf ebenfalls. Keine produktiven Mitgliedschaften oder Tabellen geändert.

- [x] Audiospuren für gespeicherte Animationen mit Originalretention, UUID-/Revisionsbindung, geschützter Wiedergabe und lokalem H.264/AAC-Export ergänzt. Tatsächliche Samples, aufgefüllte Stille, Rechte, historische Originale und Desktop-/Mobilbedienung geprüft; kein Vocarium-/Providerturn.
- [x] Lokale Schwerkraft-/Randkollisionssimulation mit bearbeitbaren Geschwindigkeiten und Rückprall ergänzt. Reproduzierbarkeit, unabhängiger freier Fall, elastische Reflexion sowie echte exportierte MP4-Pixel und Webbedienung geprüft.
- [x] Illustrierenden Anprobe-Task aus einem Produktvergleich mit eigenen Personen-/Produktoriginalen, Angebotsrevision und Rollen ergänzt. Tatsächliche PNG-Bytes/SHA, konkurrierende UUIDs, Multipartzustellung, verlorene Antwort und Desktop-/Mobilübergang geprüft. Echte GPU-/Worker-Anprobe bleibt zur späteren Abnahme offen.

- [x] Ausdrücklich aktivierbare App-Vorschläge mit prüfbarem Hostformular und versioniertem Taskübergang ergänzt. Eigene SQL-/HTTP-/CSP-Browserprüfungen belegen stabile UUIDs bei verlorenen Antworten, Konto-/Versionsrechte, Zustandstrennung und genau ein neues Iframe nach Revisionswechsel. Kein generischer MCP-Aufruf oder automatischer Agentenstart.

- [x] Native Matrix-Kontoeinstellungen im Web ergänzt: Vorlagen, Platzhalter, sechs Favoriten, Vorlesen/PDF/Geräteschutzoptionen, Hash-/Epoch-/UUID-Speicherung und kontrollierter Composerübergang. Eigene SQL-/HTTP-/Browserprüfungen belegen unverlorene unbekannte Einstellungen, Teiländerungen, konkurrierende Commands und verlorene native Antworten ohne zweiten PUT. Matrix besitzt keinen geräteübergreifenden CAS-Vertrag; Live-/Geräteabnahme bleibt offen.

- [x] Gesundheits-/Finanzunterlagen als atomar erzeugte getrennte Wissensbereiche und Dokumentprofile ergänzt. Tatsächlicher CLI- und API-Kontext schliesst andere Projektquellen/persönliche Erinnerungen aus; eigene Originaltexte/Einheiten, Rechte, UUID und Desktop-/Mobilbedienung isoliert geprüft. Keine Bank-/Healthkonto- oder Traderanbindung erfunden.
- [x] Fünf Sekunden Bedenkzeit und Rücknahme für native `!auftrag`-Nachrichten im tatsächlichen Webcomposer ergänzt; vor Ablauf/Undo erfolgt keine Zustellung. Raum, Thread, Konto, Epoch, Text, Anhänge und UUID werden gebunden. Normale Folgefragen gehen direkt; Ziel-/Kontowechsel verwirft die Bedenkzeit. Reale Browserbedienung und Matrixregressionen bestanden, keine Live-Nachricht versendet.
- [x] Öffentliche feste HTML-/App-/Design-/Dokumentversion mit expliziter Öffentlichkeitsbestätigung, Ablauf und Widerruf ergänzt. Tatsächliche SQL-/HTTP-/Browserprüfungen belegen Originalbilder, unveränderte alte Version, Tokenverschlüsselung, Export ohne Tokens, opake interaktive Offline-Sandbox, verlorene Antwort und Widerruf. Additive Migration 012 und eng begrenzte Traefik-Route nur vorbereitet; öffentliches Feature bleibt standardmässig aus.
- [x] Native Hub-Unit-Tests mit festem lokalem Fixture-Runner reproduzierbar gemacht: 72/72 bestanden (70 übernommene Tests und zwei Plum-Auftragsprüfungen); keine produktive Laufzeitkonfiguration geerbt.
- [x] Vollständigen Quellabgleich B01–B14, C01–C13 und S01–S37 mit tatsächlichen Dateien, Testbelegen und verbleibenden Host-/Adapter-/Rolloutgrenzen erstellt.

## Implementierung nach der Planung

- [x] Gemeinsame eigene Bibliotheks-/API-/CLI-Suche mit Bereichsfilter, Revision-/Threadlinks und Pagination ergänzt; Fremdbesitz, temporäre/archivierte Inhalte, Verbindungsdaten und wörtliche Suchzeichen isoliert geprüft. Tatsächliche Desktop-/Mobilbedienung bestanden; native Matrix-Raumsuche bleibt separat.
- [x] Plum Mini als geschützten Browser-Modellchat mit Bild-/Livequellen, Profil-/Modelloptionen und eigenen Gesprächsrouten ergänzt und auf 390/460 Pixeln geprüft. Desktop-Tray, globale Tastenkombination, eigenes Fenster und genaue Server-Originprüfung quellseitig ergänzt; Desktop-Typprüfung bestanden, native OS-Abnahme bleibt zurückgestellt.
- [x] Maskierte Bildbearbeitung mit Originalvorschau, Maus-/Finger-/Tastaturbereichen und neuem Task-Entwurf ergänzt; tatsächliche Originalmassen/Maskenpixel, SHA-Wiederholung, Archivierungsquittung, eigene ComfyUI-Dateirechte und Desktop-/Mobilbedienung geprüft. Original und Maske bleiben gebunden; native Zustellung enthält ihre Rollen. Reale GPU-Generierung/Workerabnahme bleibt zurückgestellt.
- [x] Persönliche Briefingvorlagen in der tatsächlichen Routinenbibliothek ergänzt und mit nativer Aktivierung/Pause/Fortsetzen/Einmallauf verbunden. Echter Hub-Stand bestätigt den Zeitplan; lokale Vorlagen oder fremde State-Events gelten nicht als Aktivierung. UUID-Wiederholung, Zürcher Zeitvertrag, Kontowechsel und Desktop-/Mobilbedienung geprüft. Kein produktiver Scheduler gestartet oder geändert.
- [x] Generierte Bildoriginale an eigene Ergebnisrevisionen gebunden, authentifizierte Blob-Vorschau/Download und Ergebnis-zu-Bild-Task ergänzt. Eigene Bytes nach Renderdateilöschung, historische Retention, tatsächlicher ZIP-Originalexport, widerrufbare Snapshot-Bildrechte und Desktop-/Mobilbedienung geprüft. Alte Einträge werden nicht automatisch migriert; reale GPU-/Workerabnahme bleibt zurückgestellt.

- [x] Freie Python-Analyse direkt aus einem Notebook als Task-Entwurf ergänzt: unveränderte Eingaberevision/SHA, MCP-Revisionbindung, native Eingabeweitergabe, Nachvollziehbarkeit der Skript-/Berichtergebnisse und stabile Zustellung. Tatsächlicher lokaler Python-Lauf und Desktop-/Mobilweg geprüft; keine Provider-/Workeranfrage gestartet.
- [x] PNG-/JPEG-Originale im Markdown-Word-Bericht eingebettet; Bildbezüge, MIME, Position, Bildunterschrift und unveränderte SHA mit ZIP/XML und unabhängigem Word-Leser geprüft. PDF-Bildexport mit tatsächlichen Bildmassen/-punkten unabhängig geprüft. Vollständiger Office-Medien-/Layout-Roundtrip bleibt offen.
- [x] Präsentieransicht mit Navigation, Home/End, Escape/Fokusrückgabe, optionalem Vollbild und ausdrücklich eingeblendeten Sprechernotizen ergänzt; Desktop-/Mobilweg geprüft, gespeicherte Revision bleibt unverändert.
- [x] Verbindliche Ergebniszuordnung für CLI-Task-Abschluss ergänzt: fehlende Artefakte, Fremdbesitz, falscher Task, unvollständige/doppelte Zuordnungen und geänderte Eingaben verhindern Abschluss. Bestätigte Ergebnisrevisionen, Command-Wiederholung und Prüfungsaufhebung beim neuen Versuch isoliert geprüft. Webbedienung geprüft; Android-Bedienung quellseitig ergänzt und noch nicht kompiliert.

- [ ] I01 Live-Inventar und native Fähigkeiten vollständig verifizieren.
- [ ] I02 Shared-Typen, additive Datenmigration und bereichsspezifischen Kontext einführen.
- [ ] I03 Drei Einstiege und Übersicht auf Web und Android liefern.
- [ ] I04 Versionierte Profile und wirksame Prompt-Zusammenstellung implementieren.
- [ ] I05 Modellchat mit echten Nachrichtenaktionen und Anhängen liefern.
- [ ] I06 Brian/Hermes mit eigener Laufzeit, Gesprächen und Gedächtnis vollständig anbinden.
- [ ] I07 Dauerhafte Tasks über den bestehenden Koordinator anbinden.
- [ ] I08 Trader, Hermes Phone, CLI-Agenten, Git, Betrieb, Melder und Rat vollständig integrieren.
- [ ] I09 Gemeinsame Inbox, Freigaben, Routinen, Abläufe und Not-Aus liefern.
- [ ] I10 Schwarm-Kernlogik und alleinige Auftragskoordination in Plum übernehmen.
- [ ] I11 Persönliches Wissen, gemeinsame Suche, OmniVoice und Bereichsübergänge vervollständigen.
- [ ] I12 Migration, Sync, Ausfälle, Desktop-/Mobilansichten und Rollout je Lieferwelle prüfen.
- [ ] I13 Sämtliche Schwarm-App-Funktionen S01–S37 samt Daten, Einstellungen und Geräteeinrichtung in Plum übernehmen und die separate App vollständig ablösen.
- [ ] I14 Sämtliche nun eingeplanten B01–B14 und ergänzenden Fachabläufe über die gemeinsamen Grundlagen und Lieferwellen W2–W10 umsetzen.
- [ ] I15 Auf `plum.zwaetschge-webui.ch` mit Traefik/Authelia wechseln; Mobile-JWT, Preview, alte Links und lokale Clientzustände erhalten.

## Funktionslieferungen aus dem Vergleich

Die B-Pakete überlappen bewusst mit I02–I13; sie sind Funktionsabnahmen, keine doppelt gezählten unabhängigen Implementierungen.

- [ ] B01 Persönlicher Chat, wirksame Profile und tatsächlich unterstützte Laufzeitwahl.
- [ ] B02 Verlustfreie Nachrichten-/Antwortversionen und Verzweigungen.
- [ ] B03 Temporärmodus, widerrufbare Freigabe, definierte Retention und vollständiger Export.
- [ ] B04 Sichtbares getrenntes Gedächtnis und kontrollierter Transfer.
- [ ] B05 Wissensprojekte, Quellenstand, Rechte und Retrieval.
- [ ] B06 Strukturierte Recherche mit Belegregister und bearbeitbarem Bericht.
- [ ] B07 Versionierte Ergebnisobjekte, Auswahländerungen und Bibliothek.
- [ ] B08 Dokumente, Tabellen, Folien, Datenanalyse und LaTeX als native Produktabläufe.
- [ ] B09 Design, Visualisierungen, Simulationen, zustandsbehaftete Apps und Veröffentlichung.
- [ ] B10 Kontoverbindungen, Skills/Plugins, interaktive Oberflächen und Officekontext.
- [ ] B11 Ereignistrigger, proaktive Hinweise und Quellenbeobachtung.
- [ ] B12 Vollständige Medien-/Voiceabläufe, Bildreview und OmniVoice.
- [ ] B13 Geräte-/Browser-/Phoneaktionen, Alltagseinstiege und optionale lokale Kontextquellen.
- [ ] B14 Dauerhafte vollständige Schwarmassistenz, Identität, Rollen, Kosten und Ausfallverhalten.

Ergänzende Fachabläufe C01–C13 sind paketgenau in Abschnitt 4.2 des Gesamtumsetzungsplans verankert: Lernen, Einkaufen/Anprobe, Meetings, Datenworkspace, Livequellen, persönliche Fachunterlagen/Connectoren, Sammlungen, Räume, Briefings, Video/Motion, Computerhistorie/Quickentry, Office-/Organisations-/Plattformwege und kleine Assistenzansichten. Anbieterstatus bleibt dort offen, wo die Quellen keine gesicherte Aussage erlauben; der eigene Zielablauf ist trotzdem geplant.

## Offene Live-Prüfungen

- [ ] Brians direkte API-Fähigkeiten und native Gesprächs-/Gedächtnisschnittstellen prüfen.
- [ ] Tatsächlichen Status registrierter und eventuell stillgelegter Worker abgleichen.
- [ ] Bestehende Daten, Artefakte, Supervisorzuordnung und Kanäle vollständig inventarisieren.
- [ ] Android-Gerät verbinden und echte mobile Oberflächen prüfen.
- [x] Schmale Webansicht der ersten Assistenzwege tatsächlich rendern und prüfen; erweiterte Detailwege weiterhin offen.
- [ ] Tatsächlich installierte Schwarm-App-Version mit dem Quellstand vergleichen und weitere Funktionen in die Pflichtmatrix aufnehmen.
- [ ] Alle Funktionsabläufe S01–S37 in der Schwarm-App erfassen und nach der Übernahme in Plum real prüfen.

- [ ] Ausgewählte zusätzliche Funktionen gegen konkrete Anbieter-/Kontoverfügbarkeit prüfen; L-Details und offene Consumer-Familien gezielt verifizieren.
- [ ] Widersprüchliche Claude-Mobile-/Plattformdetails und eigene Datenschutz-/Retention-Verträge vor der betreffenden Lieferung klären.
- [ ] Öffentliche DNS-/IPv6-/TLS-Erreichbarkeit, Authelia-Kontoablauf und Web-/Mobile-Sockets auf der neuen Domain live abnehmen.
- [ ] OAuth-Callbackregistrierungen, Android-App-Link-Signaturen, neue Push-/PWA-Registrierung und lokale Originmigration im I15-Rollout prüfen.

Die Android-Decompilation per REA blieb wegen fehlendem JADX-Adapter offen; dies ist eine Nachweisgrenze, kein zusätzliches Pflichtpaket. Der Quellcodeabgleich und spätere reale S01–S37-Abnahmen bleiben massgeblich.

Diese Live-Prüfungen sind Voraussetzungen ihrer jeweiligen Implementierungspakete. Für den Plan sind sie als offene Abnahmearbeit ausgewiesen; sie gelten nicht als bestandene Tests.

Planprüfung vom 10.10.2026: 154 lokale Dokument-/Codeverweise auf Existenz geprüft, F01–F66 und S01–S37 vollständig Lieferpaketen zugeordnet, W0–W10 konsistent vorhanden, keine fehlenden Links oder nachlaufenden Leerzeichen; `git diff --check` bestanden. Produkt- und Geräteprüfungen sind damit nicht ersetzt.

## Live-Rollout 11.10.2026 (läuft)

- [x] Livegang durch Supervisor autorisiert; vorheriges Rebuildverbot aufgehoben.
- [x] Bisherige Container-Image-IDs, Compose/Env-Konfiguration privat gesichert; Plum-DB-Backup (45 Tabellen) und nativer Schwarm-DB-Backup (28 Tabellen) verifiziert.
- [x] Öffentliche DNS-Auflösung für App und preview-plum bestätigt; kein AAAA-Eintrag vorhanden.
- [x] Bestehende Authelia-2FA-/Deny-Regeln decken die neuen Hosts ab.
- [x] Domain-Overlay mit befristeten Althost-Aliasrouten angewandt; OAuth-Callbacks bleiben bis zur Providerregistrierung auf funktionierendem Alias.
- [x] Repair-Bot-Build, produktive Migrationen 010–012, fünf HTTP-Endpunkte und sieben Einstiege auf Desktop/Mobil live geprüft. Echter Codex-Chatturn inklusive sichtbarer Antwort und erreichbarer Gesprächswerkzeuge bestanden; eigene Testsitzung anschliessend gelöscht.
- [x] Nativer Hub auf den Plum-eigenen Compose-Dienst `plum-swarm-coordinator` umgeschaltet; Legacy-Writer gestoppt, seine automatische Wiederaufnahme deaktiviert. Bestehende interne Endpoints und Datenbank bleiben erhalten. Health und die zuvor verbundenen Worker `betrieb`, `git`, `hermes-phone`, `trader` wieder verbunden; bereits zuvor offline befindliche Worker bleiben als offline ausgewiesen. Die Haupt-WebUI musste dafür nicht neu starten.
- [ ] Android-Build mit eingebettetem Schwarm; Supervisor wünscht ausschliesslich APK-Build, keine Installation/Geräteänderung.

## Chatgestaltung nach den Referenzen des Supervisors

- [x] Schmale Seitenleiste, kompakter Chat-/Task-/Code-Umschalter, Suche und neuer Chat, reale Projekte, nach Datum gruppierter Gesprächsverlauf und Konto am unteren Rand implementiert.
- [x] Ruhige Startansicht mit Begrüssung, kompaktem automatisch wachsendem Eingabefeld, Modellauswahl und tatsächlich übernommener CLI-Denkstufe implementiert. Profile, Systemanweisungen, temporäre Gespräche und Quellenrecherche über einen zugänglichen Optionsdialog erreichbar.
- [x] Referenziteration im echten Browser bei 2048, 390 und 320 Pixeln geprüft: Modell-/Denkstufenwahl, Optionsdialog, Escape, Menü, Feldwachstum und kein horizontaler Überlauf. API-Chat mit Anhängen, Teilantworten, Abzweigen, Ergebnisspeicherung, Recherche und temporärem Ablauf regressionsgeprüft. Frontend-Typprüfung und Produktionsbuild bestanden.
- [x] Referenziteration nach bestandenem Produktionsbuild atomar veröffentlicht; bisherige Assetdateien für offene Tabs erhalten. Echter Codex-Chat über den neuen UI-Einstieg gestartet: gewählte Denkstufe gespeichert, Antwort und Composer auf Desktop/Mobil sichtbar; eigene Testsitzung gelöscht. Keine laufende Providersitzung neu gestartet. Abschliessende Live-Einstiegsprüfung aller sieben Oberflächen auf Desktop/Mobil bestanden; Neues Containerimage `2716c2314b5b` erfolgreich gebaut; die Frontend-Einstiegsdatei im Image, im lokalen Build und im laufenden Dienst ist per SHA-256 identisch. Das Haupt-WebUI wurde dafür nicht neu gestartet. Die APK wird separat gebaut.

Android: Ausschliesslich APK-Build autorisiert. Keine Installation, kein Launch und keine Geräteänderung; die Geräteabnahmen bleiben daher ausdrücklich offen. Der erste Versuch scheiterte beim Löschen alter Wear-Builddateien. Ein weiterer Versuch ohne Compilerfortschritt wurde abgebrochen; die Bereinigung ist im Builder deaktiviert. Der nächste Lauf scheiterte an fehlenden Schreibrechten für `swarm/build`; das dedizierte Ausgabeverzeichnis wurde dem tatsächlichen Builder-Nutzer UID/GID 1100 zugewiesen, und der Build erneut gestartet. Noch keine neue APK als bestanden ausweisen.

Öffentliche Edge-Prüfung nach der Veröffentlichung: HTTPS-Zertifikatsprüfung erfolgreich; `/chat` und `/api/assistant/overview` leiten an `auth.zwaetschge-webui.ch` weiter (302), der nicht angemeldete Mobile-API-Zugriff wird mit 401 abgewiesen, der öffentliche Office-Bootstrap liefert 200. Das ist kein Nachweis eines interaktiven 2FA-Kontoablaufs.

Android-Kompilierung: Der erste Compilerlauf deckte verbliebene vollständig qualifizierte Klassenverweise im alten Schwarm-Namespace, kollidierende private JSON-Helfer und zwei fehlende Berechtigungsfunktionen auf. Diese wurden in sieben nativen Kotlin-Dateien korrigiert und zum Builder synchronisiert. Matrix-Account-Daten, Push-Identitäten und Intent-Schlüssel in Strings bleiben dabei unverändert. Erneuter MCP-Build läuft; die APK ist weiterhin erst nach bestandener Kompilierung und JVM-Tests abzunehmen.

Chat-Referenziteration abgeschlossen: Typprüfung, Lint, Produktionsbuild, echte Codex-Erstellung über die neue Oberfläche samt gespeicherter Denkstufe und Antwort, API-Chatregressionen sowie die Desktop-/Mobil- und zusätzliche helle Browseransicht sind bestanden. Die Live-Oberfläche ist veröffentlicht, das identische Image fertig gebaut. Screenshot: `reports/plum-chat-2026-10-11.png`. APK/JVM-Abnahme bleibt unabhängig davon offen; derzeitiger MCP-Build nach den sieben Compilerkorrekturen läuft weiter. Keine Android-Installation ausgeführt.


### Kontoweite Personalisierung – 11. Oktober 2026

- [x] Eigene Seite `/chat/personalization`, erreichbar über Chat, Sidebar und Einstellungen; Gesprächsprofile bleiben separate Optionen.
- [x] Erinnerungen ein-/ausschalten, verwalten, ergänzen und entfernen; accountweite Freigabe und temporäre Ausschlüsse in CLI/API-Kontext sowie MCP-Lese-/Schreibzugriffen. Bestehende explizite Profilfreigaben bleiben bis zum ersten Speichern erhalten. Code erhält ohne ausgewähltes Profil keine Chat-Erinnerungen.
- [x] Schreibprobe, Spitzname, Beruf und persönliche Angaben; Basisstil, Herzlichkeit, Begeisterung, Emoji, visuelle Elemente sowie Überschriften/Listen.
- [x] Getrennte Chat-/Task-/Code-Anweisungen; kontoweite Änderungen werden pro Antwort neu gelesen und API-Turns halten die verwendete Personalisierungsrevision fest.
- [x] Private Portrait-/Ganzkörperfotos mit Upload, Ersetzen/Entfernen, Eigentümerprüfung und begrenzter Grösse; expliziter Chat-Anhang sowie `plum_read_reference_photo` für CLI-Bildaufträge. Keine automatische Übertragung jedes Fotos an jede Antwort.
- [x] Kurze Antworten, Startseitenvorschläge, frühere gespeicherte Sprachnotizen und Sprachchat; Präferenzen für automatische Web-/Konnektorsuche und konkrete Erweiterung der MCP-Projektsuche. API-Chats bekommen dadurch keine erfundenen Browser-/MCP-Fähigkeiten.
- [x] Revisionskonflikte, paralleles Speichern, fremde Konten, Erhalt anderer Einstellungen, Kontextentzug und Foto-Lebenszyklus in isoliertem PostgreSQL geprüft. Bestehende Assistant-/API-Regressionen weiter grün.
- [x] Echte gerenderte Oberfläche mit tatsächlichen isolierten REST-Endpunkten bei 1440, 390 und 320 Pixeln geprüft: Speichern/Neuladen, Dialoge/Escape, Erinnerungen, Foto-Anhänge, Chat-Begrüssung, Sprach-/Vorschlagsoptionen, kein horizontaler Überlauf; helle und dunkle Ansicht sowie die unteren Stilfelder geprüft. Screenshot: `reports/plum-personalisierung-2026-10-11.png`.
- [x] REA-MCP: `list_browser_targets` und `inspect_web_page` für laufendes Plum sowie die neue gerenderte Personalisierung. Die ChatGPT-Referenz stammt aus den vom Nutzer bereitgestellten Screenshots, nicht aus einem angemeldeten ChatGPT-Runtime-Zugriff.
- [x] Shared-Build und Frontend-Produktionsbuild, beide Typprüfungen, Lint/Format sowie HTTP-Auth/413-/409-Grenzen erfolgreich. Verifikation: `reports/plum-personalisierung-verifikation.json`.
- [ ] Live-Aktivierung der neuen Backend-Routen und Kontextpfade. Diese Änderung benötigt einen Backend-Neustart; laufende andere Sessions werden dafür in dieser Iteration nicht beendet.
- [x] Sprachchat-Entzug während Mikrofonfreigabe/Aufnahme sowie Gesprächswechsel während Transkription im echten Browser geprüft: Mikrofon freigegeben, verworfene Aufnahme nicht hochgeladen, spätes Transkript nicht angewandt; normaler Ablauf bleibt funktionsfähig.
- [x] App-APK 1.5.22-debug gebaut (`:app:assembleDebug`) und mit ZIP-/Versions-/SHA-256-Prüfung unter `data/apks/plum-1.5.22-assistant-debug.apk` bereitgestellt. Alle 89 App- und 55 Schwarm-JVM-Tests grün, einschliesslich korrigierter Vibe-/Ultracode-Erwartung. Keine Installation; native Personalisierung ist nicht enthalten.
- [ ] Android-Gesamtbuild: abschliessende Instrumentierungs-APK-/Wear-Modul-Schritte laufen im Builder weiter. Der erfolgreiche App-APK-Bau ist davon gesondert dokumentiert in `reports/plum-android-build-2026-10-11.json`.

### Stilkorrektur nach Supervisor-Feedback

- [x] Referenzen gelten für das Layout; originale Plum-Themenfarben und gewählte Hintergrundanimation für Chat/Personalisierung wiederhergestellt. Keine neutrale Chat-Sonderpalette mehr.
- [x] Frosted Glass für Sidebar, mobile Navigation, Composer, Dialoge, Personalisierungsgruppen und Speicherleiste; Deckflächen als Blur-Fallback und E-Ink-Ausnahme erhalten. Lesbare helle/dunkle Texte und sichtbarer Fokus bleiben erhalten.
- [x] Gerenderte Desktop-/Mobilansichten (1440/390/320px), originaler Wellen-/Wassertröpfchen-/Neon-Hintergrund, Dialoge/Escape und Navigation in isolierter Vorschau geprüft; kein horizontaler Überlauf. Screenshots: `reports/plum-chat-glass-2026-10-11.png`, `reports/plum-personalisierung-glass-2026-10-11.png`.
- [x] Produktionsbuild der abschliessenden CSS-Fassung inklusive Prüfung der erzeugten CSS-Datei sowie API-Chat-Regression bestanden. Keine Live-Veröffentlichung der frontendseitigen Personalisierung ohne die zugehörigen Backend-Routen. Verifikation: `reports/plum-glass-verifikation-2026-10-11.json`.


### Plum Task im übernommenen Glasdesign – 11. Oktober 2026

- [x] Originale Plum-Themen und gewählter App-Hintergrund erhalten; gemeinsame Frosted-Glass-Materialien für Such-/Filterleiste, Aufgaben, Erstellung und Details. Deckende Blur-Fallbacks sowie E-Ink-Ausnahme vorhanden.
- [x] Klarer Einstieg „Neue Aufgabe“, Status-Badges und sichtbare Auswahl; Liste und Details auf breiten Bildschirmen nebeneinander, auf Mobilgeräten untereinander. Erstellung ordnet Felder auf Desktop in zwei Spalten und auf Mobilgeräten in einer Spalte an.
- [x] Bestehende Task-Board- und Ergebnisregressionen im echten Browser bestanden: Pagination, Teilaufträge, fehlende Eltern, Status/Sortierung, Fristen, Navigation, revisionsgebundene Ergebnisabnahme und identische Wiederholung nach verlorener Bestätigung. Bildanhänge und späte Antworten nach Auftragswechsel ebenfalls geprüft.
- [x] Gerenderte Vorschau bei 1440/390/320 Pixeln mit Wellen-, Wassertröpfchen- und Neon-Hintergrund geprüft. Erstellen mit Hermes und gewünschten Ergebnissen speichert einen Entwurf; Auswahl und Speichern starten keinen Agenten. Kein horizontaler Überlauf. Gemeinsame Nicht-Task-Ressourcen bestehen ihre Browserregression weiterhin.
- [x] Abschliessender Produktionsbuild, Typprüfung, Lint/Format und erzeugtes Task-CSS geprüft. Finaler Build nach Kontrastkorrektur bestanden; Screenshots und Verifikation unter `reports/plum-task-*2026-10-11.*`.
- [x] Live-Aktivierung am 11. Oktober nach ausdrücklicher Freigabe; zusammen mit Personalisierung über repair-bot deployed und anhand des APK-Frontends live geprüft.


### Android-Update 1.6.0 · 11. Oktober 2026

- [x] Aktuelle Chat-/Task- und vollständige Arbeitsflächen im APK gebündelt; bestehende native Code-/Schwarm-Funktionen erhalten.
- [x] Native kontoweite Personalisierung mit Revision, Fotos und persönlichen Sprachregeln umgesetzt.
- [x] Mobile Anmeldung, Upload-/Download-/Navigationspfade und responsive Oberfläche mit isolierten Browserprüfungen verifiziert.
- [x] APK über Android Builder gebaut: 146 JVM-Tests erfolgreich, Assets und Update-Signatur geprüft.
- [x] APK bereitgestellt; keine Installation oder Serveränderung durchgeführt.

Geräteabnahme und ausstehende Serveraktivierung bleiben separat; siehe [Android-Stand und Grenzen](plum-android-1.6.0.md).

## Langzeitgedächtnis (11. Oktober 2026)

- [x] Gemeinsame Erinnerungen, opt-in Lernen, Verlauf und Schreibstil für CLI/API/Tasks.
- [x] Herkunft, Korrekturen, sensible Vorschläge und echte Löschung mit Wiederanlegeschutz.
- [x] Eigene API-Extraktion mit dauerhaftem Jobstatus und Verbrauchserfassung.
- [x] Kontrollierte Schwarm-/Hermes-Kontextweitergabe und Agentenübernahme.
- [x] Web- und native Android-Einstellungen ergänzt.
- [x] Finale Verwaltungs-/HTTP-Prüfungen: 38 Backend-Fälle und gerenderte Produktionsoberfläche bei 1440/390/320 px. APK 1.6.1: 147 JVM-Tests, 246 Assets und Update-Signatur verifiziert.
- [x] Backend-/Frontend-Rollout nach ausdrücklicher Freigabe am 11. Oktober; Memoryrouten und Migrationen 013/014 live geprüft.

Details: [Langzeitgedächtnis](plum-long-term-memory.md).


## Gedächtnis vervollständigen · 11. Oktober 2026

- [x] Semantische Suche mit dem vorhandenen privaten bge-m3-Dienst und passenden Abschnitten langer Erinnerungen.
- [x] Gesamten erlaubten Verlauf dauerhaft, seitenweise und abbrechbar einlesen.
- [x] Neue CLI-Gespräche ohne zusätzliche API lernen lassen; vorhandenen Codex-Login für Hintergrundanalysen anbieten.
- [x] Alle gespeicherten Erinnerungen und gelernten Gesprächskontexte suchen/nachladen und einzeln vergessen.
- [x] Native Hermes-Dateien und Schwarm-Datenbank mit originalen Sperren, Revisionen und Tombstones verwalten.
- [x] Native Übernahme/Korrektur/Vergessen mit eigenen Plum-Kopien verbinden und persönliche Korrekturen schützen.
- [x] Vollständigen Memoryexport und kontrollierten Import von Fremdtexten bereitstellen.
- [x] Reale bge-m3-/Codex-Prüfung und native Speicheroperationen in privaten Fixtures bestehen lassen.
- [x] Finale Produktionsoberfläche bei 1440/390/320 px und APK 1.6.2 prüfen und liefern.

Der laufende Server bleibt unverändert; additive Migrationen 013/014 und native Migration 0027 sind für einen koordinierten Rollout vorbereitet. Keine Geräteinstallation.

Abgeschlossen: 38+19 Backendfälle, reale bge-m3-/Codex-Prüfung, 72 Schwarmfälle, 147 JVM-Prüfungen. APK: `data/apks/plum-1.6.2-memory-complete-debug.apk`, 246 final geprüfte Webdateien, bisherige Debug-Signatur. Nachweise: `reports/plum-memory-completion-verification-2026-10-11.json` und `reports/plum-android-1.6.2-memory-build-2026-10-11.json`.

## Android Chat/Task funktional korrigieren · 11. Oktober 2026

- [x] Tatsächlich laufende mobile API prüfen: Personalisierung und Memorysystem fehlen auf beiden Domains (404); APK und Serverstand stimmen nicht überein.
- [x] Chat mit echtem Codex über die mobile API bis zur sichtbaren Antwort verifizieren. Prüfung erfolgte im Browser mit dem gebündelten Frontend, nicht im installierten Android WebView.
- [x] Fehlerhafte Loginumleitung bei temporärem Serverausfall beheben; wiederholt verifizieren, Route erhalten, echte 401 weiterhin ablehnen.
- [x] Taskdetail nach Befehlen offen halten und unabhängig von gefilterten/paginierten Listen nachladen.
- [x] Produktionsoberfläche über echte mobile API bis sichtbarem Task-Ergebnis und expliziter Abnahme prüfen; Filter- und Wiederverbindungstests bestehen.
- [x] APK 1.6.4 bauen und in `/mnt/user/Zwischenspeicher/` mit identischem SHA-256 bereitstellen.
- [x] Fehlende Personalisierungs-/Memoryrouten nach ausdrücklicher Neustartfreigabe aktiviert; Speichern/Neuladen, Memory-CRUD/Vergessen und Migrationen 013/014 live geprüft.
- [ ] Geräteprüfung: ausgewählte Adresse `192.168.1.131:35023` verweigert Verbindung. Chat/Task/Personalisierung auf dem tatsächlichen Android-Gerät weiterhin unbestätigt.

## Autorisierter Server-Rollout · 11. Oktober 2026

- [x] Aktuellen Arbeitsstand über repair-bot rebuilt und deployed; Container mit Kandidaten-Image `9cff308838fb` läuft gesund.
- [x] Live-Personalisierung speichern/neuladen, Memorysystem/Modellkatalog und Erinnerungen anlegen/ändern/endgültig vergessen geprüft.
- [x] Exakte APK-1.6.4-Webdateien auf 390px mit tatsächlichem Backend: Chat bis sichtbarer Codex-Antwort und Task bis Ergebnis/ausdrücklicher Abnahme bestanden. Keine Geräteabnahme behauptet.
- [x] Eigene Testdaten bereinigt und temporären Abnahmecontainer entfernt; APK-SHA im Unraid-Share erneut bestätigt.

Nachweis: `reports/plum-assistant-deployment-verification-2026-10-11.json`. Ausgewählte Android-Adresse verweigert weiterhin Verbindung; Installation und tatsächlicher WebView-Test bleiben offen. Ältere Abschnitte beschreiben ihren damaligen Stand; diese Abnahme bestätigt die genannten Hauptpfade, keine Vollabnahme aller externen Integrationen.

- [ ] Separater Löschfehler: Ein mit einem Task-Versuch verknüpftes Gespräch liefert beim Löschen HTTP 500 (`assistant_attempts_session_id_fkey`). Start, Ergebnis und Abnahme funktionieren. Eigenen archivierten Testversuch gezielt von seinem Testgespräch getrennt und dieses über die API entfernt; keine fremden Tasks/Sessions geändert.

## Task als Sessionverwaltung · 11. Oktober 2026

- [x] Task und Code verwenden dasselbe Dashboard und dieselbe linke Seitenleiste mit getrennten Sessionlisten.
- [x] Neue Task-Sessions ohne Coding-Ordner starten; bestehende Sessions einzeln oder gesammelt zuordnen, ohne neuen Verlauf oder Prozessneustart.
- [x] Strukturierte Aufträge/Schwarm unter `/assistant/tasks` erhalten.
- [x] Desktop/schmale Produktionsoberfläche, tatsächliche Live-Sessionzuordnung und getrennte Live-Listen verifiziert; Web atomisch ohne Containerneustart veröffentlicht.
- [x] APK 1.6.5 mit neuem Task-Einstieg und denselben finalen Webdateien gebaut; 148 JVM-Prüfungen, Signatur und SHA-256 im Unraid-Share geprüft.

Details und Todo: [Task-Sessions](plum-task-sessions-todo.md). Abschlussnachweis: `reports/plum-task-sessions-completion-2026-10-11.json`. Tatsächliche Android-Geräteausführung weiterhin unbestätigt; keine Installation.

## Gemeinsame Chat-/Task-/Code-Seitenleiste · 11. Oktober 2026

- [x] Auch Chat, Personalisierung und Bibliothek nutzen den bestehenden Code-/Task-Navigationsrahmen; CLI-/API-Gespräche und Chatprojekte bleiben erreichbar.
- [x] Finalen Produktionsbuild auf 1440/390/320 px geprüft; Chat-Abläufe und Sessionzuordnung erneut verifiziert.
- [x] Webdateien ohne Containerneustart veröffentlicht und alle drei Live-Bereiche mit tatsächlichen Sessionlisten erfolgreich geladen.
- [x] Dieselben Webdateien als APK 1.6.6 im Unraid-Share geliefert; 148 JVM-Prüfungen, Signatur und SHA-256 geprüft.

Nachweis: `reports/plum-shared-sidebar-completion-2026-10-11.json`. Tatsächlicher Android-Gerätetest unbestätigt; keine Installation.

## API-Modelle in Chat · 11. Oktober 2026

- [x] Chat auf normale API-Zugänge umgestellt; Anthropic, Mistral, DeepSeek, GLM in dieser Reihenfolge.
- [x] Anthropic-Schlüssel verschlüsselt im Benutzerkonto gespeichert; vier authentifizierte Modellkataloge und Streaming-Transporte geprüft.
- [x] API-Auswahl auf Desktop und Mobil live geprüft; Task/Code behalten CLI-Harnesses, frühere Chat-Verläufe bleiben erhalten.
- [x] Backend-Parser und serverseitige Chat-Trennung deployen; vier echte Gespräche über Live-API prüfen.
- [x] Finale APK 1.6.8 nach WebView-Höhenkorrektur im Unraid-Share liefern und Hash gegen Build-Artefakt abgleichen.

Aktueller Ablauf: `docs/plans/plum-chat-api-models-todo.md`, Wiederaufnahme: `.probe/plum-chat-api/HANDOFF.md`.

### Android-Abnahme · 12. Oktober 2026

- [x] Drei feste Bereichstabs und kompakte Navigation ohne überlappende Personalisierung.
- [x] Task-/Code-Zuordnung im Room-Cache speichern (Schema 9), getrennte Listen und manuelles einzelnes/gesammeltes Verschieben.
- [x] Personalisierung: lesbare Überschriften, tatsächliche API-Anbieter/Modelle auswählen und speichern.
- [x] Leeren Chat beheben: eingebettete Viewport-Units ergaben 0 px; gemessene CSS-Pixel und Layout-gesteuertes Laden.
- [x] Fünf Emulator-Prüfungen und 148 JVM-Prüfungen bestanden; APK/Signatur/247 Web-Dateien und Share-Hash verifiziert.

Emulator: `emulator-5554`. Nachweis: `reports/plum-android-emulator-verification-2026-10-11.json`. Keine physische Geräteabnahme.
