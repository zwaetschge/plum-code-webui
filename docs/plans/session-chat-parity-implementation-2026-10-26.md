# Plum Chat: Umsetzung der bestätigten Vergleichslücken

Auftrag: Die bestätigten Lücken aus `reports/Plum Chat Browserabschluss.md` umsetzen. Keine Datenmigration. Web und Android gehören jeweils zum selben Lieferumfang. GLM 5.3 Flash bleibt API-Chatstandard, Auto-Accept bleibt Vorgabe; keine Claude-API-Aufrufe.

## Umsetzung

- [x] Antwortbelege: tatsächlich übergebene Erinnerungen, Recall und Projektchats sowie bestätigte Lernergebnisse anzeigen; Vergessen darf Fakten nicht über Belege zurückbringen.
- [x] Lebende Themendokumente als fortlaufende Sicht auf Originalfacts mit Bearbeitung, Herkunft, Revisionsvergleich und Vergessen. Web geprüft; native Umsetzung vorhanden, Build läuft noch.
- [ ] Lange API-Chats: Verdichtung offen. Dauerhafte FIFO-Warteschlange in beiden Clients eingebaut; Backend- und Webprüfung bestanden, zweiter Android-Build läuft.
- [x] Fachliche Skills kombinieren und bedarfsgerecht laden; bestehenden Skilldateispeicher verwenden.
- [x] Grosse MCP-Werkzeugbestände durchsuchen und gezielt laden.
- [x] Optionale Funktionsrechte und Einzelgenehmigungen; Auto-Accept bleibt Standard.
- [x] Globale Chat-Anweisungen pro Projekt/Profil auslassen können, unabhängig vom Gedächtnis.
- [ ] Profile als Fähigkeitsbündel (umgesetzt, Web geprüft): Skills, Werkzeuge und Modellparameter werden als Vorgaben neuer Chats gespeichert. Revisionsvergleich für Wissen/Projekte/Profile eingebaut. Mehrdatei-Skilleditor bleibt offen.
- [ ] Andere Chats explizit referenzieren; Mehrfachauswahl und Stapelaktionen.
- [ ] Chatplanung mit Ergebnisrückgabe, Wissensnotebooks und Medien-/Dateiübergabe an vorhandene Ergebnisse anbinden.
- [ ] Quellen-/Sammlungsrollen bis Retrieval/Dateizugriff und Live-Koedition durchziehen.
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
