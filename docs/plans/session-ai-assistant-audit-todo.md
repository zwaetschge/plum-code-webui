# KI-Assistenten: Browserprüfung und Plum-Vergleich

Ziel: Alle erreichbaren Hauptseiten, Einstellungsrubriken und relevanten Unterdialoge in ChatGPT, Claude, Gemini, Open WebUI und Mistral Vibe prüfen; Gedächtnisverhalten erklären und belegte Lücken in Plum Chat bestimmen.

Regeln: Nur lesend, keine Einstellungen ändern, Chats senden, Daten löschen oder Modellaufrufe auslösen. Keine Geheimniswerte oder persönlichen Erinnerungsinhalte übernehmen. Browsersteuerung seriell mit Abstand zwischen Eingaben. Produktfunktionen, Dokumentation und statischen Codeabgleich getrennt belegen.

- [x] Vorherige Teilprüfung und offene Bereiche gesichert: `reports/Plum Chat Funktionsvergleich.md`.
- [x] Firefox-Zugriff nach vorheriger Sicherheits-Pause freigeben — Nutzer hat „Fortsetzen“ gewählt; Browserstatus bestätigt `control` ohne `stopped`. Restprüfung mit genau einer Browserführung läuft.
- [ ] ChatGPT: sämtliche offenen Einstellungen, Hauptseiten und Unterdialoge prüfen.
- [ ] Claude: offene Hauptseiten, Projekte, Artefakte, Anpassungen und Einstellungs-Unterdialoge prüfen.
- [ ] Gemini: offene Hauptseiten, Notebooks, Medien, Activity und Einstellungsdetails prüfen.
- [ ] Mistral Vibe Work/Code: offene Kontext-, Konnektoren-, Bibliotheks-, Projekt- und Planungsbereiche prüfen.
- [ ] Open WebUI: Arbeitsbereich, Hauptfunktionen und alle erreichbaren Admin-Einstellungen prüfen.
- [x] Plum-Gedächtnis und Kernfunktionen im Code abgeglichen; erste konkrete Unterschiede belegt.
- [x] Bekannte Lückenkandidaten gegen Plum-Code und Web-/Android-Einstiegspunkte verifiziert; Ergebnisse in `research_notes/Plum Chat Gesamtvergleich/plum_gap_verification.md` (keine erneute Laufzeitprüfung).
- [ ] Zusätzliche Befunde aus der noch offenen Browserrunde gegen Plum abgleichen.
- [x] Aktuelle Herstellerdokumentation zu Gedächtnis, Kontext, Löschung und sensiblen Daten gegengeprüft; `research_notes/Plum Chat Gesamtvergleich/memory_semantics.md`.
- [x] Restprüfungsinventar mit geöffneten/gesehenen/offenen Zweigen erstellt: `research_notes/Plum Chat Gesamtvergleich/coverage_inventory.md` und `coverage.json`.
- [ ] Neue UI-Befunde und Gedächtnisregeln abschliessend zusammenführen.
- [x] Vertieften Code-/Dokumentationsstand im neuen Gesamtbericht konsolidiert: `reports/Plum Chat Gesamtvergleich.md` (ausdrücklich Zwischenstand; noch kein Abschluss der Browserprüfung).
- [ ] Vollständiges Abdeckungsraster, priorisierte Lücken und Abschlussbericht liefern.

Aktueller Stand: Firefox wurde vom Nutzer fortgesetzt, `control` ohne `stopped` ist bestätigt. Die übrigen Kontoansichten werden seriell geprüft; individuelle Verbindungsfehler werden erneut gegen den Status geprüft und nicht umgangen. Die unabhängige Herstellerdokumentation, der vertiefte Plum-Codeabgleich und das Restprüfungsinventar sind abgeschlossen. Der bisherige Gesamtbericht bleibt ein Zwischenstand. Neue Browsernotizen: `research_notes/Plum Chat Browserabschluss/`; frühere Notizen bleiben unverändert.

## Bestätigte Korrekturen umsetzen

- [x] Voice-Antworten an das gewählte Chatmodell binden; konfiguriertes Haiku darf keinen automatischen Providerwechsel auslösen.
- [x] Memory-/History-Freigaben auch auf direkte Projektchatauszüge und Legacy-Erinnerungsnotizen anwenden.
- [x] Unabhängige Lese-/Lernschalter pro Chat in Backend, Web und Android einbauen; temporär bleibt gesperrt.
- [x] Vier Kombinationen, globale Sperren, Lernstornierung und spätere Wiederfreigabe in isolierten Backend-Tests prüfen.
- [x] Neue und bestehende Webchats bei 1440/390 px gerendert prüfen, Speichern und Reload verifizieren.
- [ ] Android-Build 1.9.5 abschliessen, APK sichern und SHA-256 prüfen.
- [ ] Backend/Web-Rollout mit laufender Schwarm-Integration abstimmen und verifizieren; APK erst danach freigeben.
- [ ] Weitere bestätigte Lücken nach vollständigem Kontovergleich umsetzen und abnehmen.

Implementierungsnachweise und Grenzen: `docs/plans/session-chat-memory-controls-2026-10-25.md`. Kein tatsächlicher Voice-/Claude-Modellaufruf, kein paralleler Produktionsneustart.

## Wiederaufnahme

Wiederaufnahme bestätigt: Nutzer hat „Fortsetzen“ gewählt und Firefox meldet keinen Stop mehr. Die übrige Browserprüfung läuft seriell; neue Belege und die fortgeschriebene Abdeckung liegen in `research_notes/Plum Chat Browserabschluss/`. Frühere Berichte bleiben als Zwischenstände erhalten. Der Android-Builder-Claim dieser Session wurde für die separate Schwarm-Erweiterung freigegeben und anschliessend als `unclaimed` bestätigt.

Nach Nutzer-Fortsetzung zuerst Firefox-Status prüfen. Genau eine Browserführung, mindestens 2,5 Sekunden Abstand zwischen Werkzeugaufrufen, bestehende Tabs 237 ChatGPT, 238 Claude, 239 Gemini, 240 Mistral, 241 Open WebUI, 242 Plum. Restzweige aus `coverage.json` nacheinander abarbeiten und ihren Belegstatus aktualisieren. Kein Autoresume und kein Umgehen der Browserpause. Keine bereits geprüften privaten Inhalte erneut auslesen.
