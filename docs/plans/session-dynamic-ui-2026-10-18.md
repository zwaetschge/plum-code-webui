# Dynamic UI: OpenUI-Ideen umsetzen

- [x] Bestehendes Format und beide Renderer prüfen; kompatibles v1-Format behalten.
- [x] Schrittweisen Aufbau aus empfangenen JSON-Werten und gesperrte Teilansichten implementieren.
- [x] Begrenzte Änderungen per Komponenten-ID, gespeicherte Basis und wiederholbaren Abruf implementieren.
- [x] Eingaben zwischen Revisionen in WebUI/Android erhalten, Typwechsel und Zurücksetzen behandeln.
- [x] Gemeinsamen Komponenten-Katalog für Prompt, Namen und Pflichtfelder verwenden; Android-Datei generieren und prüfen.
- [x] Fehlerhafte Komponenten isolieren; globale Daten/Formeln weiterhin strikt prüfen.
- [x] Browser auf 1440/390 px mit echtem Renderer prüfen: Werte/Fokus/Aktionen/Überlauf.
- [x] Shared-/Frontend-/Backend-Typecheck und UI-/API-Regressionsfälle prüfen.
- [ ] Finalen Android-Build/Test-Ergebnis und APK-Kopie mit SHA-256 prüfen.
- [ ] Änderungen committen, über repair-bot ausliefern und aktive Endpunkte prüfen.

Keine OpenUI-SDK-/Cloud-Abhängigkeit, kein React-Upgrade, keine neuen externen UI-Aktionen. Die vier besprochenen Verbesserungen sind in unserem bestehenden Protokoll umgesetzt. Unabhängige Änderungen in AGENTS.md und piConfig.ts nicht anfassen.

Browserbelege: `.screenshots/dynamic-ui-stream-1440.png`, `.screenshots/dynamic-ui-patched-390.png`, `.screenshots/dynamic-ui-recovered-390.png`. Android ist gebaut zu prüfen, keine Installation auf dem Testgerät autorisiert.

Implementierung: `8eb64d0`; verständliche Teilfehler-Hinweise: `034167b`. Shared-/Backend-/Frontend-Typechecks, ESLint und elf Dynamic-UI-Regressionsgruppen grün. Isolierter API-Integrationstest inklusive neuer Verlauf-/Snapshot-/Chat-Isolation bestanden. Browser auch gegen Shared-dist geprüft; Wiederherstellungs-Hinweis anschliessend erneut auf 390/1440 px visuell geprüft.

Android: Produktions-Kotlin und APK-Paketierung erfolgreich; erster Testlauf scheiterte an veralteten doppelten DynamicUiTest-/Fixture-Dateien im zusätzlichen Builder-Testquellordner. Nur diese Workspace-Duplikate werden bereinigt, kanonische app/src/test und Produktionscode bleiben erhalten; gecachter Wiederholungslauf wird abgewartet. Nicht installieren. Nach Erfolg APK kopieren/hashprüfen, Claim freigeben und repair-bot ausliefern.
