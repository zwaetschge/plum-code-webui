# Chat: eigene Assistenten und Projekte

- [x] Bestehende Profile/Projekte und tatsächlichen Chat-Einstieg prüfen.
- [x] WebUI: direkt sichtbare Auswahl, Anlegen/Bearbeiten/Archivieren von Assistenten und Projekten, Projektquellen und Gesprächsübersicht.
- [x] Backend: unabhängiger Projektbezug, Assistentenwissen aus fixierter Profilrevision, bestehende Eigentümerprüfung.
- [x] Android: erreichbare native Auswahl und Verwaltung derselben Ressourcen.
- [x] Verhaltenstests: Projektisolation, Entfernen/Wechseln, Profilwissen und Versionsbindung.
- [x] Desktop-/Mobilansicht rendern und Bedienpfad prüfen.
- [x] Android bauen und APK mit SHA-256 ausliefern.
- [x] Tatsächliche Produktionsinstanz ermitteln, regulär ausrollen und prüfen.

Gemeinsame Ressourcen statt neuer parallel geführter Stores: `profile` entspricht dem eigenen Assistenten (Gems/Custom-GPT-Prinzip), `project` bündelt Chatkontext. Kein Import oder Aufruf fremder gehosteter Gems/Custom GPTs. Modellgespräche bleiben beim gewählten API-Anbieter ohne CLI-/Browserwerkzeuge.

Produktion läuft laut letzter Prüfung auf Geekom192.168.1.124:4545; diese Sitzung arbeitet weiter auf dem Unraid-Checkout. Rollout erst als produktiv bezeichnen, wenn dort verifiziert. Fremde Änderungen in AGENTS.md und piConfig.ts erhalten.

## Bisherige Verifikation

- `test:assistant-api-chat` vollständig grün, ergänzt um direkten Projektbezug ohne Profil, explizites Entfernen trotz Projekt im Profil, Projektwechsel, fremden Eigentümer und an Profilrevision gebundenes Assistentenwissen.
- Backend-/Frontend-Typechecks und Frontend-Produktionsbuild grün.
- `chat-workspace-browser-tests.py`: echte Komponenten mit isolierten HTTP-Fixtures, 390/1440px; Anlegen/Bearbeiten, Speicherfehler mit erhaltenen Eingaben, Quellen und Modellvorgabe, Chatstart, bestehender Chatwechsel, gefilterte Projektgespräche und Archivieren. Keine JavaScript-Fehler oder horizontales Scrollen. Bildschirmprüfung führte zu lesbaren Auswahlbreiten und kompakter Dialoghöhe.
- Älteres `assistant-api-chat-browser-tests.py` aktuell nicht grün: erwartet vorbestehende Combobox `Modellverbindung`, neuerer ModelEffortPicker verwendet bereits den Button `Modell und Denkaufwand`. Der neue gezielte Workspace-Test prüft den funktionierenden aktuellen Picker.
- Geekom verwendet Compose-Projekt `plum` und `/srv/plum/deploy/docker-compose.geekom.yml`; bisheriger Repair-Bot fehlte. Neue standortspezifische Datei `/srv/plum/deploy/docker-compose.repair.yml` ergänzt den offiziellen Sidecar und Build-Kontext. Normalisierte Konfiguration des Hauptdienstes davor/danach bis auf `build` identisch. Drei optionale `REBUILD_COMPOSE_*` Variablen im Robot ermöglichen das aktive Projekt, bei unveränderten Unraid-Defaults; Verhaltenstest einschliesslich explizit leerem Override grün.
- Android-Neubau enthält auch die explizite Trennung zwischen Assistentenwahl im neuen Entwurf und bestehenden Chats ohne Assistenten. Keine Geräteinstallation autorisiert oder durchgeführt.

## Produktiver Rollout

Geekom über offiziellen Repair-Bot ausgerollt; Readiness seit19:08:28UTC erfolgreich. Tatsächliches Image `0c78d12b2ce7fb845a4f6f926a9326705978b28484320dd97a6171d53cc52302` läuft gesund. Öffentliche Seite, Readiness sowie Profiles-/Projects-APIs mit gültigem Kontotoken jeweils HTTP200 geprüft. Öffentlicher Einstieg `index-DLD9BrDc.js` lädt `ChatPage-CbM_snue.js`; dessen SHA-256 `556353b75353fbc51b3ff273a3d2770437d9732e6a8814509bb9000791c84a8f` stimmt mit dem laufenden Container überein. Backendmodule und beide Opsskripte ebenfalls per Hash/Logik geprüft. Beleg: `.logs/chat-workspace-rollout-result.json`.

Der bisherige vollständige Dockerfile scheitert vor der Appkompilierung: aktuelles Alpine liefert Python3.14, PyMuPDF will aus Quellen kompilieren und findet im Runtime-Stage keinen `cc`. Keine zusätzliche Python-Toolchain nur für dieses Feature eingebaut. Standort-Datei `/srv/plum/deploy/Dockerfile.chat-workspace-release` verwendet stattdessen die unveränderte, bekannte Runtime `plum-code-runtime:9461dee7ea0d` und ersetzt gezielt zwei Backendmodule (`apiChats.js`, `resources.js`), Frontenddist und beide Opsskripte. Abhängigkeitsmanifeste unverändert; fremdes `piConfig.js` und native node_modules anhand vorheriger SHA erhalten. Dieser gezielte Code-Rollout läuft mit denselben Repair-Bot-Readiness-/Rollback-Prüfungen. Bei künftigen Abhängigkeits- oder Runtimeupdates zuerst den vollständigen Runtime-Build reparieren; diesen Standort-Dockerfile nicht blind für neue Abhängigkeiten verwenden.

Rebuild-Status-Race im bestehenden Sidecar behoben: Heartbeat und Watcher teilten im Subshell `$$` und damit denselben temporären Dateinamen. Nun eindeutiges `mktemp`, Modus0644, atomarer Rename. Echter Paralleltest mit zwölf Schreibern unter umask077 und bestehende Rollbacktests grün.

## Android-Auslieferung

Finaler Korrekturbau über android-builder MCP erfolgreich (8m21s); auch nach der letzten Auswahlkorrektur 91 frische App-Unit-Tests, null Fehler oder übersprungene Tests. APKmtime19:36:40UTC liegt nach Start des finalen Builds. Vier geänderte Android-Quelldateien im Builder per SHA-256 identisch mit dem Repository. Claim anschliessend freigegeben. Keine Installation und kein Gerätetest.

- APK: `/mnt/user/Zwischenspeicher/plum-code-android-app-debug.apk`, 47'807'795Bytes.
- SHA-256 von Builderoriginal und ausgelieferter Kopie: `79b0903a5ac5acc95d73601c4ee3fa307eadacd9c8024dbfc369e53a9ac3d139`.
- Belege: `.logs/chat-workspace-android-result.json`, persistenter Mitschnitt `.logs/chat-workspace-android-fix-build.log`.

Alle Aufgaben dieser Umsetzung abgeschlossen. Verbleibende Prüfgrenzen: Android nicht am echten Gerät getestet; keine kostenpflichtige Modellinferenz in der Produktionsprüfung. Der separate vollständige Runtime-Build benötigt weiterhin die oben beschriebene PyMuPDF/Python-Reparatur.
