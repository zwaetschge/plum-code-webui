# Dynamic UI: OpenUI-Ideen umsetzen

- [x] Bestehendes Format und beide Renderer prüfen; kompatibles v1-Format behalten.
- [x] Schrittweisen Aufbau aus empfangenen JSON-Werten und gesperrte Teilansichten implementieren.
- [x] Begrenzte Änderungen per Komponenten-ID, gespeicherte Basis und wiederholbaren Abruf implementieren.
- [x] Eingaben zwischen Revisionen in WebUI/Android erhalten, Typwechsel und Zurücksetzen behandeln.
- [x] Gemeinsamen Komponenten-Katalog für Prompt, Namen und Pflichtfelder verwenden; Android-Datei generieren und prüfen.
- [x] Fehlerhafte Komponenten isolieren; globale Daten/Formeln weiterhin strikt prüfen.
- [x] Browser auf 1440/390 px mit echtem Renderer prüfen: Werte/Fokus/Aktionen/Überlauf.
- [x] Shared-/Frontend-/Backend-Typecheck und UI-/API-Regressionsfälle prüfen.
- [x] Finalen Android-Build/Test-Ergebnis und APK-Kopie mit SHA-256 prüfen.
- [x] Änderungen committen, über repair-bot ausliefern und aktive Endpunkte prüfen.

Keine OpenUI-SDK-/Cloud-Abhängigkeit, kein React-Upgrade, keine neuen externen UI-Aktionen. Die vier besprochenen Verbesserungen sind in unserem bestehenden Protokoll umgesetzt. Unabhängige Änderungen in AGENTS.md und piConfig.ts nicht anfassen.

Browserbelege: `.screenshots/dynamic-ui-stream-1440.png`, `.screenshots/dynamic-ui-patched-390.png`, `.screenshots/dynamic-ui-recovered-390.png`. Android gebaut und Unit-Tests geprüft; keine Installation auf dem Testgerät autorisiert.

Implementierung: `8eb64d0`; verständliche Teilfehler-Hinweise: `034167b`. Shared-/Backend-/Frontend-Typechecks, ESLint und elf Dynamic-UI-Regressionsgruppen grün. Isolierter API-Integrationstest inklusive neuer Verlauf-/Snapshot-/Chat-Isolation bestanden. Browser auch gegen Shared-dist geprüft; Wiederherstellungs-Hinweis anschliessend erneut auf 390/1440 px visuell geprüft.

Android: Build am 18.10.2026 um 21:35 UTC erfolgreich abgeschlossen. 102 Unit-Tests in 41 Test-Suites, keine Fehler oder übersprungenen Tests; darunter acht aktuelle DynamicUiTest-Fälle (XML-Zeitstempel 21:35:18 UTC). APK nach `/mnt/user/Zwischenspeicher/plum-code-android-app-debug.apk` kopiert, SHA-256 von Original und Kopie identisch: `a0a3200e41db741bc6e575ddc3113d54a8983cb4b0c71f1657a18c9ca8004218`. Dateigrösse 48 864 456 Bytes; APK wurde nach der Quellkopie neu paketiert (21:20:52 UTC) und im abschliessenden erfolgreichen Lauf wiederverwendet. Projekt-Claim freigegeben. Nicht auf dem Testgerät installiert. Nachweis: `.logs/dynamic-ui-android-result.json`, `.logs/dynamic-ui-android-build.log`.

Korrektur des Testaufbaus (`6d039cd`): Der zusätzliche Quellordner `plum-tests/java` duplizierte 41 der 42 kanonischen `app/src/test`-Dateien; kein zusätzlicher Test existierte ausschliesslich dort. Ursache der vorigen Test-Kompilierungsfehler war die doppelte Quellordner-Registrierung. Diese eine Registrierung ist im Repository und Builder entfernt; sämtliche kanonischen Tests und der separate androidTest-/swarm-Testlauf bleiben aktiv. Wiederholung erfolgreich. WebUI-Auslieferung über repair-bot am 18.10.2026 um 21:38:50 UTC erfolgreich; kein Rollback. Abschlusskontrolle: `/health/ready` grün, laufendes Shared-Artefakt enthält Teilparser/Änderungen/Fehlerisolierung, laufendes Backend enthält Basis-Snapshots; HTTP-Asset `DynamicUi-CXVOv999.js` liefert den neuen Renderer und Eingabestore. Alle Todo-Punkte abgeschlossen.
