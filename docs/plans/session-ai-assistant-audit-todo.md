# KI-Assistenten: Browserprüfung und Plum-Vergleich

Ziel: Alle erreichbaren Hauptseiten, Einstellungsrubriken und relevanten Unterdialoge in ChatGPT, Claude, Gemini, Open WebUI und Mistral Vibe prüfen; Gedächtnisverhalten erklären und belegte Lücken in Plum Chat bestimmen.

Regeln: Nur lesend, keine Einstellungen ändern, Chats senden, Daten löschen oder Modellaufrufe auslösen. Keine Geheimniswerte oder persönlichen Erinnerungsinhalte übernehmen. Browsersteuerung seriell mit Abstand zwischen Eingaben. Produktfunktionen, Dokumentation und statischen Codeabgleich getrennt belegen.

- [x] Vorherige Teilprüfung und offene Bereiche gesichert: `reports/Plum Chat Funktionsvergleich.md`.
- [x] Firefox-Zugriff nach Sicherheits-Pause und späterer Verbindungstrennung wiederherstellen; Fortsetzung mit genau einer Browserführung abgeschlossen. Letzter Status `connected/control`, ohne `stopped`.
- [x] ChatGPT: bekannte lesend erreichbare Einstellungen, Hauptseiten und Dialogtypen geprüft, einschliesslich Cloud/Codex/Review/Work/Space/Planung, Speicher, Projektgedächtnis, Suche, Modell-/Anhangmenü, Sprach-/Temporär-Controls. Keine ungelesenen bekannten Zweige; Lade-/Onboarding-Grenzen und im Kontozustand unerreichbare Projektansichten einzeln dokumentiert.
- [x] Claude: bekannte lesend erreichbare Bereiche und Dialogtypen geprüft, einschliesslich Datenschutzverwaltungen, Themen-Gedächtnis, Projekt-/Design-Editoren, Funktionen/Domainlisten, Chrome-Richtlinie und Plugin-/MCP-Dialogen. Vier frühere Blockaden durch tatsächliches Rendern aufgelöst; keine ungelesenen bekannten Zweige. Fehlende Beispieldatensätze und ausführende Import-/Erstellen-Schritte getrennt dokumentiert.
- [x] Gemini: bekannte lesend erreichbare Bereiche geprüft, einschliesslich Skill-/Empfehlungseditoren, vorhandenem Canvas-/Medien-/Aufgabendetail, Composer-/Modell-/Denkaufwandslisten, Hilfe und Feedback. Leere App-/Skillansichten wieder erreichbar. „Mehr“ und Aktivitäten bleiben konkret dokumentierte Navigationsgrenzen; Daten-, Sprach-, Import- und Generierungsschritte gesondert begrenzt.
- [x] Mistral Vibe Work/Code: bekannte lesend erreichbare Bereiche und Dialogtypen geprüft; Code-Webansicht und Erweiterungen separat erfasst, Projektanweisungen mit optionalen globalen Vorgaben, Kontext, Planung, Skills, Bibliotheken und Connectorrechte gelesen. Keine ungelesenen bekannten Zweige; leere Dokumentvorschau als Ansichtsgrenze, nicht vorhandenes Code-Projekt/Detaildaten und ausführende Schritte gesondert dokumentiert.
- [x] Open WebUI: bekannte erreichbare Restdialoge und Hauptfunktionen lesen — 16/16 Adminrubriken, 5/5 Arbeitsbereich-Tabs und deren sichere Unterdialoge, Composer, Ordner, Memory-Editor und Verbindungs-/Aufgabenmodellparameter erfasst. 86 gelesene Zweige, keine ungeöffneten bekannten Zweige; ComfyUI-Workfloweditor nach erfolglosem Öffnen als konkrete Ansichtsgrenze dokumentiert. Keine Funktionsausführung.
- [x] Plum-Browserrest: fünf Provider-Unterseiten und sieben sichere Bibliotheksformulare gelesen. Keine ungelesenen bekannten Zweige; fehlende bestehende Freigabe-/Auswahlkontexte und die ausführende Python-/HTML-Ansicht gesondert begrenzt. Integration zeigt weiter eine Fehleransicht, die Unterrubrik „Originalgedächtnisse von Hermes und Schwarm“ weiter „Laden“; andere Gedächtnisabrufe sind getrennt.
- [x] Plum-Gedächtnis und Kernfunktionen im Code abgeglichen; erste konkrete Unterschiede belegt.
- [x] Bekannte Lückenkandidaten gegen Plum-Code und Web-/Android-Einstiegspunkte verifiziert; Ergebnisse in `research_notes/Plum Chat Gesamtvergleich/plum_gap_verification.md` (keine erneute Laufzeitprüfung).
- [x] Zusätzliche Browserbefunde gegen Plum abgeglichen; Quellen-/Bibliotheksrollen, Anweisungsvererbung, Toolladen und Medien-/Lernpfade präzisiert. Zusätzliche statische Ladepfadprüfung begrenzt die Originalgedächtnis-Beobachtung, ohne eine Produktionsursache zu behaupten.
- [x] Aktuelle Herstellerdokumentation zu Gedächtnis, Kontext, Löschung und sensiblen Daten gegengeprüft; `research_notes/Plum Chat Gesamtvergleich/memory_semantics.md`.
- [x] Restprüfungsinventar mit geöffneten/gesehenen/offenen Zweigen erstellt: `research_notes/Plum Chat Gesamtvergleich/coverage_inventory.md` und `coverage.json`.
- [x] Neue UI-Befunde und Gedächtnisregeln abschliessend zusammengeführt.
- [x] Vertieften Code-/Dokumentationsstand im neuen Gesamtbericht konsolidiert: `reports/Plum Chat Gesamtvergleich.md` (ausdrücklich Zwischenstand; noch kein Abschluss der Browserprüfung).
- [x] Abdeckungsraster, priorisierte Lücken und Abschlussbericht geliefert: `reports/Plum Chat Browserabschluss.md`; bekannte erreichbare Ansichten sind geprüft, konkrete Restgrenzen ausdrücklich dokumentiert.
- [x] Früheren Zwischenstand gesichert und nach Wiederverbindung durch den Abschlussbericht ersetzt. Die früheren Berichte bleiben datierte Zwischenstände.

Aktueller Stand: Die lesende Untersuchung ist mit dokumentierten Grenzen abgeschlossen. Alle ursprünglich 32 offenen Punkte wurden geprüft oder mit konkreter Zugangs-/Ausführungsgrenze eingeordnet; nach Wiederverbindung wurden auch vormals blockierte Ansichten erneut erreichbar. Herstellerdokumentation und Plum-Codeabgleich sind zusammengeführt. Der Abschlussbericht beschreibt vorhandene Funktionen, tatsächliche Ergänzungen und gesonderte Liefergrenzen. Er bestätigt keinen vollständigen funktionalen Ersatz oder vollständige Implementierung aller Vergleichsfunktionen.

Validierter Endstand: **478 eindeutige Inventareinträge = 409 gelesen + 9 Ansichts-/Zugangsgrenzen + 14 kontobedingt nicht verfügbar + 46 Ausführungs-/Datenschutzgrenzen; 0 ungeprüft offen.** Keine Funktionszahlen oder Vollständigkeitsprozente. Die neun Ansichtsgrenzen betreffen ChatGPT (3), Gemini (2), Mistral (1), Open WebUI (1) und Plum (2); sie sind keine neun nachgewiesenen Produktfehler. Alle Browserinventareinträge haben `execution_tested=false`.

## Bestätigte Korrekturen umsetzen

- [x] Voice-Antworten an das gewählte Chatmodell binden; konfiguriertes Haiku darf keinen automatischen Providerwechsel auslösen.
- [x] Memory-/History-Freigaben auch auf direkte Projektchatauszüge und Legacy-Erinnerungsnotizen anwenden.
- [x] Unabhängige Lese-/Lernschalter pro Chat in Backend, Web und Android einbauen; temporär bleibt gesperrt.
- [x] Vier Kombinationen, globale Sperren, Lernstornierung und spätere Wiederfreigabe in isolierten Backend-Tests prüfen.
- [x] Neue und bestehende Webchats bei 1440/390 px gerendert prüfen, Speichern und Reload verifizieren.
- [x] Vergessene Ursprungsbeiträge auch vom automatischen Projektchatabruf ausschliessen; Originalchat bleibt erhalten, Regressionstest bestanden (`77d378a`).
- [x] Beobachteten Absturz der Integrationsseite beheben: asynchrone Konfigurationszugriffe abwarten, HTTP-/Postgres-Vertrag und Web-/Android-Konfigurationsabgleich prüfen (`7b27556`). Lokale Webansicht auf 1440/390 px geprüft; Produktivnachweis steht aus.
- [x] Android-Build 1.9.5 abschliessen, APK sichern und SHA-256 prüfen — vc57, 51’968’014 Bytes, Builder `built`, Exporthash stimmt; noch nicht installiert/veröffentlicht.
- [ ] Backend/Web-Rollout mit laufender Schwarm-Integration abstimmen und verifizieren; APK erst danach freigeben.
- [ ] Weitere bestätigte Lücken nach vollständigem Kontovergleich umsetzen und abnehmen.

Implementierungsnachweise und Grenzen: `docs/plans/session-chat-memory-controls-2026-10-25.md`. Kein tatsächlicher Voice-/Claude-Modellaufruf, kein paralleler Produktionsneustart.

Die offene Schwarm-Konsultation `DrQjsuDPygVjLzkojzXaF` ist über die bestehende Delegationsantwort abgeschlossen: Claim frei, neues APK gebaut, keine Veröffentlichung. Das aktuelle Paket umfasst acht Quelldateien einschliesslich Vergessen- und Integrationsfix unter `.probe/chat-memory-controls/7b275566.tar` samt Preimage-Manifest. Die bestehende Antwort enthält den aktuellen Paketstand für den gemeinsam abgestimmten Repair-Bot-Rollout. Keine neue Peer-Session angelegt und kein Neustart ausgelöst.

## Prüfabschluss

Die frühere „Fortsetzen“-Pause und die spätere getrennte Browserverbindung sind behoben. Letzter Firefox-Status: verbunden und steuerbar, keine Pause. Tabs 26 Plum, 28 Claude, 29 Gemini; keine bearbeiteten Entwürfe offen. Die Browserführung ist beendet, weitere Aufrufe für diesen Audit sind nicht geplant. Belege und Abschlussinventar liegen in `research_notes/Plum Chat Browserabschluss/`. Der Android-Builder-Claim dieser Session wurde freigegeben und als `unclaimed` bestätigt.

Bei weiterer Browserarbeit: Status erneut prüfen, eine einzige Browserführung, mindestens 2,5 Sekunden Abstand zwischen Aufrufen. Alte Tab-IDs 237–242 sind ungültig. Kein Autoresume oder Umgehen einer Pause/Verbindungstrennung; private Inhalte nicht unnötig erneut auslesen.

Abschlussbericht: `reports/Plum Chat Browserabschluss.md`, mit `new_ui_plum_comparison.md`, `openai_work_docs.md`, `memory_loading_source_check.md` und `gemini_media_source_check.md` als aktuellen Ergänzungen. Browserbeobachtungen, Herstellerangaben, Quellbelege, tatsächliche Tests und produktive Lieferung bleiben getrennt. Der ausstehende koordinierte Rollout und die weitere Implementierung sind gesonderte offene Arbeiten, kein fehlender Abschluss der Analyse.
