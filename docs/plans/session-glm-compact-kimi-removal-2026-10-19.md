# GLM-Compact und Kimi-Code-Ausbau

- [x] Betroffenen GLM-Pfad aus echten Ereignissen ermitteln: Z.AI/Claude-Transport; Kontextlimit beendet Prozess, kein automatisches Weiterarbeiten.
- [x] Übergabe mit ursprünglichem Auftrag, aktuellen Nutzeranweisungen und jüngstem Stand statt abgeschnittenem Verlauf bauen.
- [x] Übergabe dauerhaft sichern und nach Neustart wiederherstellen; Fortsetzung begrenzen und bei Stopp/neuer Nachricht abbrechen.
- [x] Kimi Code als aktiven Harness mit Anmeldung, Einstellungen, Laufzeit und Installation ausbauen; vorhandene Chats/Nutzungsverlauf erhalten.
- [x] WebUI-/Android-Parität und fokussierte Regressionsprüfungen.
- [x] Android bauen, APK kopieren/hashprüfen; über repair-bot ausliefern und Live-Status prüfen.

Bestehende fremde Änderungen in AGENTS.md und piConfig.ts erhalten. Keine laufende fremde GLM-Sitzung zum Testen unterbrechen. Kimi-Modelle über allgemeine OpenCode/Pi/API-Verbindungen sind keine eigenständige Kimi-Code-CLI und bleiben nutzbar.

## Android-Build

- Erfolgreich am 2026-10-18 um 22:52 UTC: `BUILD SUCCESSFUL in 10m 11s`, via android-builder MCP.
- Main-Quellen und die zwei geänderten kanonischen Provider-Tests synchronisiert; zusätzlicher `plum-tests/java`-TestsourceSet bleibt entfernt.
- App: 91 Tests in 37 Suiten, Swarm: 55 Tests in 11 Suiten, jeweils 0 Fehler. Die beiden geänderten Provider-Tests wurden neu ausgeführt (je 5 Tests, 0 Fehler).
- Vier unveränderte Suiten haben in diesem inkrementellen Lauf keinen aktuellen XML-Bericht (`AppearanceSettingsTest`, `ReasoningLevelTest`, `DashboardFilterTest`, `ChatSynchronizationTest`); deren Dateien sind in Repository und Builder vorhanden. Die Zählung oben beansprucht nur tatsächlich vorliegende Reports.
- APK-Mtime: 2026-10-18 22:50:04 UTC, 48 864 289 Bytes. Kopie unter `/mnt/user/Zwischenspeicher/plum-code-android-app-debug.apk`.
- SHA-256 von Original und Kopie identisch: `e38be050745ee75ae5fc75d1b82686bf89d817230c2431aa0cf2841a9ee562fd`.
- Claim freigegeben; nichts auf dem Testgerät installiert. Beleg: `.logs/glm-kimi-android-result.json`, Buildlog `.logs/glm-kimi-android-build.log`.

## Visuelle Provider-Prüfung

- Echte `SetupPage` mit produktiven `CLI_PROVIDER_LABEL`/`CLI_PROVIDER_DEFAULT_MODEL` und isoliert vorgeladenem Setup-Status in Chromium gerendert; keine Live-API oder Zugangsdaten.
- Desktop (1000 px) und schmal (390 px): Claude Code, Z.AI Code, Codex, OpenCode, Pi und Mistral Vibe sichtbar, kein Kimi-Code-Eintrag, keine Browser-Ausnahmen oder horizontales Überlaufen. Schmale Karten umbrechen lesbar.
- Screenshots: `.screenshots/kimi-removal-providers.png` und `.screenshots/kimi-removal-providers-mobile.png`; beide visuell geöffnet und geprüft. Status-/Anmeldewirkung gegen Backend bleibt durch dessen Regressionstests abzudecken.

## Regressionsstand

- Claude/Z.AI-Kontextgrenze: priorisierte Übergabe, dauerhafter Checkpoint, genau eine Fortsetzung, dreimalige Grenze, Stopp während Aufbau/Start und zwischen Prozessen, Eigentümerprüfung, späte Ausgabe und Kimi-Migration mit erhaltenem Verlauf geprüft.
- Mistral Vibe: ACP-Modi, Anmeldung, Kontingente, Streaming/Tools und Ultracode-Workflow offline erfolgreich.
- Subagent-/Task-Budget-Prüfungen erfolgreich; Provider-Gesamtsuite sowie Backend-/Frontend-Produktions-Build erfolgreich.
- Shared-/Frontend-/Backend-Typprüfung erfolgreich. ESM-Spezifizierer geprüft.
- Für die Tests wurde keine laufende GLM-Nutzersitzung unterbrochen oder künstlich überfüllt. Das Verhalten bei einem echten langen GLM-API-Lauf bleibt nach Auslieferung zu beobachten.

## Umsetzung

- Migration 016 fügt `sessions.context_handoff_json` hinzu; Migration 017 stellt alte Kimi-Code-Sitzungen auf Codex mit frischem nativen Kontext um. Nachrichten und Usage-Zeilen werden nicht angefasst.
- GLM/Z.AI: ursprünglicher Auftrag + letzte Nutzersteuerung + jüngster Verlauf; Checkpoint vor Prozessende, bis zu drei automatische Neuansätze, Abbruch bei neuer Nachricht/Stopp/explizitem Neustart. Checkpoint wird nach Abschluss entfernt und bei späterem Session-Start provider-/chatgebunden wiederhergestellt.
- Kimi Code aus Registry, Spawn-/Anmelde-/Update-Pfaden, WebUI-/Android-Auswahl, Kontingenten, Docker-Installation und Mounts entfernt. Vibe-ACP bleibt mit neutralen Feld-/Methodennamen erhalten. Keine Zugangsdatenverzeichnisse gelöscht.
- Bestehende veraltete Annahmen der Provider-Suite an zentralen Reasoning-Helper, Tool-Search-Env und Assistant-MCP-Seeding angepasst; Tests sind wieder grün.

## Auslieferung

- Implementierung: Commit `8a54b23`; repair-bot über `bash scripts/plum-rebuild.sh --no-wait` am 2026-10-18 um 22:53 UTC gestartet. Android-Build war vorher erfolgreich abgeschlossen.
- Statusdatei: `/app/packages/backend/data/rebuild-robot-status.json` (Host-Spiegel `data/rebuild-robot-status.json`), Log daneben `rebuild-robot.log`. Rollback-Basis `sha256:1e6bced304394aa7e19ba00d346edff407d8c1029a1f0e738b09914bec603475` geschützt.
- Live-Verifikation nach `ready`/`watching`: `node .logs/glm-kimi-verify-live.mjs`; Ergebnis wird in `.logs/glm-kimi-rollout-result.json` gespeichert. Prüfung umfasst Readiness auf Port 3001, aktive Registry/Auth-Auswahl, Migrationen 016/017, Übergabe-Code im tatsächlichen `/app`-Build und ausgelieferte Frontend-Assets.
- Stand vor Neustart: Imagebau läuft; konkrete Dockerfile-Stufen sind bis Build-Ende im Repair-bot gepuffert. Noch kein erfolgreiches Live-Ergebnis behauptet.

## Live-Auslieferung abgeschlossen

Commit `8a54b23` ist ausgeliefert. Nachprüfung am 19.10.2026 um 16:56 UTC: `/health/ready` grün; aktive Registry und Auth-Auswahl enthalten Codex/OpenCode/Pi/Claude/Z.AI/Vibe ohne Kimi Code. Migrationen 016/017 und Übergabespalte vorhanden, keine Sitzung mit aktivem Kimi-Code-Provider mehr. Laufendes Backend enthält den neuen Wiederherstellungspfad; HTTP-Assets stimmen per SHA-256 mit `/app` überein. Vollständiger Nachweis: `.logs/glm-kimi-rollout-result.json`. Android nicht installiert, echter GLM-Langlauf weiterhin zu beobachten.
