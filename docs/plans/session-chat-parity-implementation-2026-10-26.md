# Plum Chat: Umsetzung der bestätigten Vergleichslücken

Auftrag: Die bestätigten Lücken aus `reports/Plum Chat Browserabschluss.md` umsetzen. Keine Datenmigration. Web und Android gehören jeweils zum selben Lieferumfang. GLM 5.3 Flash bleibt API-Chatstandard, Auto-Accept bleibt Vorgabe; keine Claude-API-Aufrufe.

## Umsetzung

- [x] Antwortbelege: tatsächlich übergebene Erinnerungen, Recall und Projektchats sowie bestätigte Lernergebnisse anzeigen; Vergessen darf Fakten nicht über Belege zurückbringen.
- [x] Lebende Themendokumente als fortlaufende Sicht auf Originalfacts mit Bearbeitung, Herkunft, Revisionsvergleich und Vergessen. Web geprüft; native Umsetzung vorhanden, Build läuft noch.
- [x] Lange API-Chats: dauerhafte FIFO-Warteschlange und quellgeprüfte rollende Verdichtung in beiden Clients eingebaut. Backend-/Webprüfung bestanden; Android-Queue kompiliert, Build für Verdichtung läuft.
- [x] Fachliche Skills kombinieren und bedarfsgerecht laden; bestehenden Skilldateispeicher verwenden.
- [x] Grosse MCP-Werkzeugbestände durchsuchen und gezielt laden.
- [x] Optionale Funktionsrechte und Einzelgenehmigungen; Auto-Accept bleibt Standard.
- [x] Globale Chat-Anweisungen pro Projekt/Profil auslassen können, unabhängig vom Gedächtnis.
- [x] Profile als Fähigkeitsbündel; Revisionsdiffs für Wissen/Projekte/Profile sowie Mehrdatei-Skilleditor mit geschützten Textdateien, neuen Unterdateien und unveränderlichen Dateiversionen. Web und nativer Skilleditor vorhanden; Skill-Build abgeschlossen.
- [x] Andere Chats explizit referenzieren; Mehrfachauswahl, Verschieben, Archivieren und Wiederherstellen in beiden Clients. Lese-/Projektgrenzen bleiben wirksam, laufende und wartende Chats sind geschützt.
- [x] Chatplanung über Routine-Ressourcen und dauerhafte Occurrence-Outbox in die normale Chatqueue; Intervall/einmal/täglich/Wochentage/Zeitzone/Enddatum, Pause/Start/Bearbeiten. Wissensnotebooks auf vorhandenen Quellensammlungen; bewusste Quellenauswahl und GLM-Modellwahl. Eingebettete MCP-Dateien im Chat anzeigen/herunterladen und dauerhafte Ergebnisoriginale erhalten; temporäre Dateien werden bereinigt. Android: native Datei-/Medienbedienung, Wissen/Planung über eingebettete Arbeitsoberflächen erreichbar; endgültiges Webbundle im APK steht noch aus.
- [x] Quellen-/Sammlungsrollen owner/editor/viewer bis Quelle, Picker, revisionsgebundenem Retrieval und Originaldownload; Entziehen wird erneut geprüft. Gemeinsame Dokumente mit automatischer Speicherung, Remote-Aktualisierung und Zusammenführen unabhängiger Änderungen; Überschneidungen erhalten den lokalen Entwurf als Konflikt. Beide Clients erreichen den Editor.
- [ ] Native Gedächtnis-Ladepfade und bestehende Integrationskorrektur im Zielsystem prüfen. Lokale Korrektur: ein authentifiziertes Matrix-`whoami` statt vollständiger Raumabfrage, begrenzte SQL-Lesezeit und parallele Hermes-Lesezugriffe; Client-Zeitlimit und erneutes Laden. Identitäts-/Widerrufs-/Epochenschutz separat geprüft; Produktivnachweis offen.

## Abnahme und Auslieferung

- [ ] Aussagekräftige Backendregressionen und erforderliche Typ-/Lintprüfungen.
- [ ] Reale gerenderte Webansichten auf Desktop und Mobil prüfen, früh nach dem ersten durchgängigen Schritt.
- [ ] Android-Builder: Quellen synchronisieren, Build abschliessen, APK exportieren und SHA-256 prüfen.
- [ ] Web-/Backendauslieferung mit bestehender Schwarmarbeit koordinieren; tatsächliches öffentliches Ziel prüfen.
- [ ] Native Laufzeit auf dem Fold8 prüfen, soweit Verbindung und bestehende Installationsautorisierung reichen.
- [ ] Abschluss mit tatsächlich geliefertem Umfang und konkreten Restgrenzen dokumentieren.

Stand: Erste durchgängige Implementierungen lokal vorhanden und geprüft; noch kein Rollout bestätigt. Haken im Umsetzungsabschnitt bezeichnen lokale Implementierungen, keine Produktionsabnahme. Fremde Änderungen an Schwarm, Routen und gemeinsamen Modellen bleiben erhalten.

## Prüfstand des ersten Schritts

- Isoliertes PostgreSQL: Memoryrechte/Belege/Vergessen, Anweisungsvererbung, paginierter 140-Funktionen-Katalog, optionale Entscheidungen und Skilltext-/Dateigrenzen bestanden.
- FIFO-Regression: Reihenfolge, stabile IDs, doppelte Zustellung, Anhänge/Denkaufwand, bereits abgeschlossene Vorgängerantwort, Abbruch sowie konkurrierende Wiederaufnahme nach abgelaufener Vorbereitung bestanden.
- Bestehende API-Chat-Regression und Workbench-Regression bestanden; bezahlte Modellaufrufe werden durch kontrollierte Fixtures ersetzt.
- Gerenderte Webprüfungen bei 1440/390 px: Belege/Lernen/Vergessen, Skills/Funktionsrechte/Genehmigung, Queue/Senden/Reload/Entfernen bestanden. Dabei blockierendes Composer-Menü nach Dialogschluss korrigiert (`modal=false`).
- Android 1.9.6 / vc58 ohne Queue gebaut, Export `/mnt/user/Zwischenspeicher/plum-1.9.6-receipts-tools.apk`, 52’000’782 Bytes, SHA-256 `91e90c26858520b6718313059d38b7e1824fda5cb2b5714237837c179d2b9e2d`. Zweiter Build umfasst Queue und aktualisierte Konstruktor-/API-Deklarationen; läuft noch. Keine neue Installation/Veröffentlichung bestätigt.
- Fold8 verbunden; erste Aufnahme zeigte die fremde Dateianwendung, deshalb daraus kein Plum-Laufzeitnachweis abgeleitet. Builder-Screenshot enthielt eine Displaywarnung vor dem PNG; für das unveränderte PNG wurden diese Textbytes entfernt.
- Zweiter Android-Build (mit Queue) abgeschlossen: `/mnt/user/Zwischenspeicher/plum-1.9.6-queue.apk`, 53’382’583 Bytes, SHA-256 `ca8194d1a3e0c44abe84af71254818371acc0ea8e0cab1382848805dd2f6de0f`. Erster Stand mit Queue als `1f7d267` committet. Dritter Build für Themen läuft; noch keine Installation/Veröffentlichung.
- Themenregression bestanden: Scope-/Eigentümertrennung, vollständig gezählte Suchtreffer, Live-Korrekturen, unveränderliche Revisionsdiffs, Konfliktschutz, vollständiges Vergessen einschliesslich alter Revisionen. Web bei 1440/390 px: Thema lesen/korrigieren, Herkunft, Vorher/Nachher, Thema vergessen und Reload bestanden.
- Dritter Android-Build (Themen, noch vor letztem Auto-Refresh und Fähigkeitsvorgaben) abgeschlossen: `/mnt/user/Zwischenspeicher/plum-1.9.6-topics.apk`, 53’440’549 Bytes, SHA-256 `d7f1203dfeadf0dfa331d098ddb0a09d2e88a43bc2d5e277325e0ee5ccf49836`. Vierter Build umfasst diese weiteren Android-Änderungen; läuft noch.
- Profilvorgaben: Backendvererbung bei ausgelassenen/leeren Optionen und gezielte Überschreibung ohne Verlust anderer Parameter bestanden. Web bei 1440/390 px: Fachskill/Parameter als Profilvorgaben speichern, Reload und keine Chat-Exportcontrols im Fähigkeitsdialog bestanden.
- Separate Native-Memory-Regression bestanden: ein `whoami`, isoliertes PostgreSQL/Hermes, fremder/widerrufener Principal und Epochwechsel während des Requests. Die ältere umfassende Memory-Completion-Suite konnte hier wegen `ENOTFOUND schwarm-plum-relay` ihren echten bge-m3-Test nicht ausführen; keine Erfolgsmeldung für diese Suite.
- Zweiter Funktionsstand als `5b64e1c` committet. Vierter Android-Build (vollständige Themenansicht/Auto-Refresh und Profilvorgaben) abgeschlossen: `/mnt/user/Zwischenspeicher/plum-1.9.6-profile-defaults.apk`, 53’445’309 Bytes, SHA-256 `0c743e92f181d12849d7e186e0b4043e4225e5392b30fa81bc5a4608942bf2c6`.
- Verdichtung: gewähltes Modell, bestätigte Quellprefixe, unveränderliche Zwischenstände und getrennte Abrechnung. Maximal vier zusätzliche Aufrufe und 90 Sekunden pro Antwort; fehlende Abdeckung sowie gekürzte Ursprungsauszüge werden angezeigt, Folge-Turns setzen fort. Kontextbelege referenzieren den gespeicherten Zwischenstand; Vergessen löscht ihn und unterbindet alte Fakten über den Beleg. Aktuelles Chattranskript bleibt entsprechend bisheriger Vergessen-Grenzen erhalten.
- Verdichtungsregression bestanden: Notiz tatsächlich im Modellkontext, Tokenaddition, Cache ohne erneute Abrechnung, geänderter Branch, Vergessen/Tombstones, Abbruch vor primärem Aufruf, vier Aufrufe bei begrenzter Abdeckung und deklarierte Kürzungen. Web bei 1440/390 px: Abdeckung, tatsächliche Notiz und nicht mehr verfügbare Notiz nach Vergessen/Reload bestanden. Bestehende API-/Memoryrechte-/Workbench-Suiten mit Migration 022 bestanden. Fünfter Android-Build umfasst Verdichtung und Schalter; läuft noch.

- Gesprächsreferenzen und Verlaufsverwaltung: isolierte Backendregression und Webprüfung bei 1440/390 px bestanden. Sechster Android-Build abgeschlossen, `/mnt/user/Zwischenspeicher/plum-1.9.6-management.apk`, 53’490’381 Bytes, SHA-256 `59a2e34623b013e2052babaa835e489ee2aa002e0b4a01624b1a64d9844bca59`.
- Fünfter Android-Build mit Verdichtung abgeschlossen, `/mnt/user/Zwischenspeicher/plum-1.9.6-compaction.apk`, 53’452’252 Bytes, SHA-256 `bba54223e035de0593b98dc487d4568bd0f5c1a444b0bbac18af4664b663b12f`.

## Weitere lokale Prüfungen

- Skilldateien: Unterdateien, echte Bytes, SHA-Konflikte, unveränderliche Versionen, Verzeichnis-/Symlinkgrenzen und verwaltete Skills geprüft. Gerenderter Editor bei 1440/390 px: Datei speichern, Vorher/Aktuell, Unterdatei und erneute Auswahl.
- Bibliotheksrechte: isoliertes PostgreSQL prüft Besitzer/Editor/Leser, Sammlung→Quelle, private Altversionen/Projektbezüge, normale Quellenauswahl, echtes Retrieval/Originaldownload, Entziehen und tatsächlichen Audit-Akteur. Notebook-UI bei 1440/390 px: Notizen, Quellen, Rechte, Entziehen und Übergabe einer Frage an GLM mit gemocktem Modell.
- Live-Dokumente: bestehende Rechte-/Widerrufs-/CAS-/Originalbildsuite plus unabhängige und überlappende gleichzeitige Änderungen bestanden. Web bei 1440/390 px: automatisches Speichern, Weitertippen während fehlender Antwort, nächste Revision, fremder Remote-Stand und Widerruf bestanden; bestehende manuelle Abläufe bleiben geprüft.
- Geplante Chats: Sommerzeitlücke und doppelte lokale Uhrzeit, Zeitzone/Wochentag, konkurrierende Dispatcher, verlorene Bestätigung/Neustart ohne doppelte Nachricht, manuell, Pause und Entfernen geprüft. Web bei 1440/390 px: Speichern/Pause/Fortsetzen/Jetzt/Bearbeiten/Entfernen und Ergebnislink bestanden. Keine bezahlten Modellaufrufe.
- MCP-Dateien: exakte Byte-/SHA-Erhaltung, Chat-/Ergebnisdownload, fremde Konten, Duplikate, keine automatischen URI-Abrufe, Abbruch und temporäre Bereinigung geprüft. Web bei 1440/390 px: tatsächliche Chatkarten, Bildvorschau, exakter CSV-Download, Ergebnislink und Reload bestanden. Eingebettete Resultate sind pro Aufruf auf 3 MB begrenzt; externe `resource_link`-URLs werden nicht ungefragt heruntergeladen.
- Android-Skill-/Wissens-Quellstand kompiliert und exportiert: `/mnt/user/Zwischenspeicher/plum-1.9.6-knowledge-skills.apk`, 53’493’412 Bytes, SHA-256 `cf295e31ed6c675e72a10606de61e4864c5bc5a8a5d0cad7f6197c8238c409fb`. Das endgültige APK muss anschliessende native Medien-/Planungsänderungen und das aktuelle gebündelte Web-UI noch enthalten.
- Bestehende grosse API-/Memoryrechte-/Workbench-/MCP-Fähigkeiten-/Sammlungs- und Integrationssuiten mit Migrationen 023/024 bestanden. Backend und Frontend kompilieren; ein abschliessender Bundle-/Geräte-/Produktivnachweis steht aus.
- Öffentliche Traefik-Route erneut gelesen: Geekom `192.168.1.124:4545`, bereit. SSH als bestehender Geekom-Benutzer erreichbar, Repair Bot ist idle. Produktive Quellkopie `/srv/plum/appdata/plum-code-webui`, abweichender Git-/Arbeitsstand; Änderungen werden vor Übernahme einzeln abgeglichen. Keine parallele Übernahme und kein Rebuild ausgelöst. Firefox gegenwärtig nicht verbunden.
