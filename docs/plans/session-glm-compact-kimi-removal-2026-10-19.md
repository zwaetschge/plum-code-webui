# GLM-Compact und Kimi-Code-Ausbau

- [x] Betroffenen GLM-Pfad aus echten Ereignissen ermitteln: Z.AI/Claude-Transport; Kontextlimit beendet Prozess, kein automatisches Weiterarbeiten.
- [x] Übergabe mit ursprünglichem Auftrag, aktuellen Nutzeranweisungen und jüngstem Stand statt abgeschnittenem Verlauf bauen.
- [x] Übergabe dauerhaft sichern und nach Neustart wiederherstellen; Fortsetzung begrenzen und bei Stopp/neuer Nachricht abbrechen.
- [x] Kimi Code als aktiven Harness mit Anmeldung, Einstellungen, Laufzeit und Installation ausbauen; vorhandene Chats/Nutzungsverlauf erhalten.
- [x] WebUI-/Android-Parität und fokussierte Regressionsprüfungen.
- [ ] Android bauen, APK kopieren/hashprüfen; über repair-bot ausliefern und Live-Status prüfen.

Bestehende fremde Änderungen in AGENTS.md und piConfig.ts erhalten. Keine laufende fremde GLM-Sitzung zum Testen unterbrechen. Kimi-Modelle über allgemeine OpenCode/Pi/API-Verbindungen sind keine eigenständige Kimi-Code-CLI und bleiben nutzbar.

## Android-Build

- Status: Build gestartet am 2026-10-18 um 22:42 UTC via android-builder MCP.
- Main-Quellen und die zwei geänderten kanonischen Provider-Tests sind synchronisiert.
- Zusätzlicher TestsourceSet `plum-tests/java` bleibt entfernt; kein Geräte-Installieren.
- Ergebnis/Hash folgen in `.logs/glm-kimi-android-result.json`.

## Visuelle Provider-Prüfung

- Echte `SetupPage` mit produktiven `CLI_PROVIDER_LABEL`/`CLI_PROVIDER_DEFAULT_MODEL` und isoliert vorgeladenem Setup-Status in Chromium gerendert; keine Live-API oder Zugangsdaten.
- Desktop (1000 px) und schmal (390 px): Claude Code, Z.AI Code, Codex, OpenCode, Pi und Mistral Vibe sichtbar, kein Kimi-Code-Eintrag, keine Browser-Ausnahmen oder horizontales Überlaufen. Schmale Karten umbrechen lesbar.
- Screenshots: `.screenshots/kimi-removal-providers.png` und `.screenshots/kimi-removal-providers-mobile.png`; beide visuell geöffnet und geprüft. Status-/Anmeldewirkung gegen Backend bleibt durch dessen Regressionstests abzudecken.

## Regressionsstand

- Claude/Z.AI-Kontextgrenze: priorisierte Übergabe, dauerhafter Checkpoint, genau eine Fortsetzung, dreimalige Grenze, Stopp während Aufbau/Start und zwischen Prozessen, Eigentümerprüfung, späte Ausgabe und Kimi-Migration mit erhaltenem Verlauf geprüft.
- Mistral Vibe: ACP-Modi, Anmeldung, Kontingente, Streaming/Tools und Ultracode-Workflow offline erfolgreich.
- Subagent-/Task-Budget-Prüfungen erfolgreich; Provider-Gesamtsuite sowie Backend-/Frontend-Produktions-Build erfolgreich.
- Shared-/Frontend-/Backend-Typprüfung erfolgreich. ESM-Spezifizierer geprüft.
- Keine laufende GLM-Nutzersitzung unterbrochen oder künstlich überfüllt. Das Verhalten bei einem echten langen GLM-API-Lauf bleibt nach Auslieferung zu beobachten.

## Umsetzung

- Migration 016 fügt `sessions.context_handoff_json` hinzu; Migration 017 stellt alte Kimi-Code-Sitzungen auf Codex mit frischem nativen Kontext um. Nachrichten und Usage-Zeilen werden nicht angefasst.
- GLM/Z.AI: ursprünglicher Auftrag + letzte Nutzersteuerung + jüngster Verlauf; Checkpoint vor Prozessende, bis zu drei automatische Neuansätze, Abbruch bei neuer Nachricht/Stopp/explizitem Neustart. Checkpoint wird nach Abschluss entfernt und bei späterem Session-Start provider-/chatgebunden wiederhergestellt.
- Kimi Code aus Registry, Spawn-/Anmelde-/Update-Pfaden, WebUI-/Android-Auswahl, Kontingenten, Docker-Installation und Mounts entfernt. Vibe-ACP bleibt mit neutralen Feld-/Methodennamen erhalten. Keine Zugangsdatenverzeichnisse gelöscht.
- Bestehende veraltete Annahmen der Provider-Suite an zentralen Reasoning-Helper, Tool-Search-Env und Assistant-MCP-Seeding angepasst; Tests sind wieder grün.
