# KI-Assistenten: Browserprüfung und Plum-Vergleich

Ziel: Alle erreichbaren Hauptseiten, Einstellungsrubriken und relevanten Unterdialoge in ChatGPT, Claude, Gemini, Open WebUI und Mistral Vibe prüfen; Gedächtnisverhalten erklären und belegte Lücken in Plum Chat bestimmen.

Regeln: Nur lesend, keine Einstellungen ändern, Chats senden, Daten löschen oder Modellaufrufe auslösen. Keine Geheimniswerte oder persönlichen Erinnerungsinhalte übernehmen. Browsersteuerung seriell mit Abstand zwischen Eingaben. Produktfunktionen, Dokumentation und statischen Codeabgleich getrennt belegen.

- [x] Vorherige Teilprüfung und offene Bereiche gesichert: `reports/Plum Chat Funktionsvergleich.md`.
- [x] Firefox-Zugriff nach vorheriger Sicherheits-Pause freigeben — Nutzer hat „Fortsetzen“ gewählt; Browserstatus bestätigt `control` ohne `stopped`. Restprüfung mit genau einer Browserführung läuft.
- [x] ChatGPT: bekannte lesend erreichbare Einstellungen, Hauptseiten und Dialogtypen geprüft, einschliesslich Cloud/Codex/Review/Work/Space/Planung, Speicher, Projektgedächtnis, Suche, Modell-/Anhangmenü, Sprach-/Temporär-Controls. Keine ungelesenen bekannten Zweige; Lade-/Onboarding-Grenzen und im Kontozustand unerreichbare Projektansichten einzeln dokumentiert.
- [ ] Claude: Hauptbereiche, Projekte mit Kontext/Gedächtnis, Artefakte mit Kommentar/Freigabe, Planung, Design, Anpassungen und Composer gelesen; einzelne Einstellungs-/Projekt-Unterdialoge noch offen.
- [ ] Gemini: Bilder, Chatsuche/-filter, Workspace-Verbindungen, Skills, Mediathek, Planung, Memory-Anweisungs-/Importdialog, Freigabeliste, Nutzungslimits und Design-/Wasserzeichenmenüs gelesen; Notebookbereich nur mit Neuerstellen-Einstieg, einzelnes Skilldetail blieb leer. Weitere Detailansichten offen; zuletzt waren App-/Bilderseite sichtbar leer.
- [x] Mistral Vibe Work/Code: bekannte lesend erreichbare Bereiche und Dialogtypen geprüft; Code-Webansicht und Erweiterungen separat erfasst, Projektanweisungen mit optionalen globalen Vorgaben, Kontext, Planung, Skills, Bibliotheken und Connectorrechte gelesen. Keine ungelesenen bekannten Zweige; leere Dokumentvorschau als Ansichtsgrenze, nicht vorhandenes Code-Projekt/Detaildaten und ausführende Schritte gesondert dokumentiert.
- [x] Open WebUI: bekannte erreichbare Restdialoge und Hauptfunktionen lesen — 16/16 Adminrubriken, 5/5 Arbeitsbereich-Tabs und deren sichere Unterdialoge, Composer, Ordner, Memory-Editor und Verbindungs-/Aufgabenmodellparameter erfasst. 86 gelesene Zweige, keine ungeöffneten bekannten Zweige; ComfyUI-Workfloweditor nach erfolglosem Öffnen als konkrete Ansichtsgrenze dokumentiert. Keine Funktionsausführung.
- [x] Plum-Gedächtnis und Kernfunktionen im Code abgeglichen; erste konkrete Unterschiede belegt.
- [x] Bekannte Lückenkandidaten gegen Plum-Code und Web-/Android-Einstiegspunkte verifiziert; Ergebnisse in `research_notes/Plum Chat Gesamtvergleich/plum_gap_verification.md` (keine erneute Laufzeitprüfung).
- [ ] Zusätzliche Befunde aus der noch offenen Browserrunde gegen Plum abgleichen.
- [x] Aktuelle Herstellerdokumentation zu Gedächtnis, Kontext, Löschung und sensiblen Daten gegengeprüft; `research_notes/Plum Chat Gesamtvergleich/memory_semantics.md`.
- [x] Restprüfungsinventar mit geöffneten/gesehenen/offenen Zweigen erstellt: `research_notes/Plum Chat Gesamtvergleich/coverage_inventory.md` und `coverage.json`.
- [ ] Neue UI-Befunde und Gedächtnisregeln abschliessend zusammenführen.
- [x] Vertieften Code-/Dokumentationsstand im neuen Gesamtbericht konsolidiert: `reports/Plum Chat Gesamtvergleich.md` (ausdrücklich Zwischenstand; noch kein Abschluss der Browserprüfung).
- [ ] Vollständiges Abdeckungsraster, priorisierte Lücken und Abschlussbericht liefern.
- [x] Neuen konsolidierten Zwischenstand mit dem bestätigten Verbindungsblocker und der konkreten Restliste bereitstellen: `reports/Plum Chat Browserabschluss.md` ist ausdrücklich als Zwischenstand gekennzeichnet; vollständiger Abschluss bleibt offen.

Aktueller Stand: Nach der erfolgreichen Nutzer-Fortsetzung wurde die Prüfung seriell weitergeführt. Jetzt ist die Browserverbindung getrennt: Sowohl der letzte Aufruf als auch der anschliessende Statuscheck melden `No browser is connected`. Weitere Browseraufrufe sind gestoppt; Wiederverbinden ist beim Nutzer angefragt. Claude-, Gemini- und Plum-Restzweige bleiben ausdrücklich offen. ChatGPT, Mistral und Open WebUI haben keine ungelesenen bekannten Zweige mehr; individuelle Konto-/Ansichtsgrenzen sind dokumentiert. Die unabhängige Herstellerdokumentation und der vertiefte Plum-Codeabgleich sind abgeschlossen. Neue Browsernotizen: `research_notes/Plum Chat Browserabschluss/`; frühere Berichte bleiben Zwischenstände.

Letzter gesicherter Abdeckungsstand: 370 gelesene Inventarzweige, 32 ungeöffnet (Claude 11, Gemini 6, Plum 15), 23 technisch blockiert, 10 kontobedingt unerreichbar, 37 ausgeschlossene Ausführungen. Dies sind keine Funktionszahlen oder Prozentangaben. Plum enthält zusätzlich die bisher noch nicht browserbelegten sieben sicheren Bibliotheks-Formulartypen und fünf Provider-Unteransichten. Die Browserführung ist beendet; kein weiterer Statusversuch bis zur Nutzer-Rückmeldung über die Verbindung.

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

## Wiederaufnahme

Die frühere „Fortsetzen“-Pause wurde behoben. Der neue Blocker ist eine getrennte Browserverbindung, keine erneute Pause. Nach bestätigtem Wiederverbinden den Status einmal prüfen und ausschliesslich die offenen Restzweige fortsetzen. Neue Belege und die fortgeschriebene Abdeckung liegen in `research_notes/Plum Chat Browserabschluss/`. Frühere Berichte bleiben Zwischenstände. Der Android-Builder-Claim dieser Session wurde für die separate Schwarm-Erweiterung freigegeben und anschliessend als `unclaimed` bestätigt.

Genau eine aktive Browserführung (`browser_audit_resume`), mindestens 2,5 Sekunden Abstand zwischen Werkzeugaufrufen, bestehende Tabs 237 ChatGPT, 238 Claude, 239 Gemini, 240 Mistral, 241 Open WebUI, 242 Plum. Keine parallele Übernahme. Restzweige aus `coverage.json` nacheinander abarbeiten und ihren Belegstatus aktualisieren. Bei erneuter Browserpause kein Autoresume/Umgehen; bei einzelnen Eingabefehlern einen sicheren alternativen Navigationsversuch, dann konkrete Ansichtsgrenze dokumentieren. Keine bereits geprüften privaten Inhalte erneut auslesen.

Nach Abschluss der Browserführung: aktuelle Notizen samt `new_ui_plum_comparison.md` und `openai_work_docs.md` im vorgesehenen Abschlussbericht `reports/Plum Chat Browserabschluss.md` zusammenführen. Frühere Berichte nur als Baseline verwenden, spätere Korrekturen haben Vorrang. Keine alte Quellen-/Skill-/Gedächtnisfunktion pauschal als fehlend wiederholen. Browserabdeckung, tatsächliche Funktionsausführung, lokaler Code-/Teststand und produktive Lieferung getrennt ausweisen. Der ausstehende koordinierte Rollout ist kein abgeschlossener Liefernachweis.
