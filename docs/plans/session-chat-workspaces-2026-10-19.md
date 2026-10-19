# Chat: eigene Assistenten und Projekte

- [x] Bestehende Profile/Projekte und tatsächlichen Chat-Einstieg prüfen.
- [x] WebUI: direkt sichtbare Auswahl, Anlegen/Bearbeiten/Archivieren von Assistenten und Projekten, Projektquellen und Gesprächsübersicht.
- [x] Backend: unabhängiger Projektbezug, Assistentenwissen aus fixierter Profilrevision, bestehende Eigentümerprüfung.
- [x] Android: erreichbare native Auswahl und Verwaltung derselben Ressourcen.
- [x] Verhaltenstests: Projektisolation, Entfernen/Wechseln, Profilwissen und Versionsbindung.
- [x] Desktop-/Mobilansicht rendern und Bedienpfad prüfen.
- [ ] Android bauen und APK mit SHA-256 ausliefern.
- [ ] Tatsächliche Produktionsinstanz ermitteln, regulär ausrollen und prüfen.

Gemeinsame Ressourcen statt neuer parallel geführter Stores: `profile` entspricht dem eigenen Assistenten (Gems/Custom-GPT-Prinzip), `project` bündelt Chatkontext. Kein Import oder Aufruf fremder gehosteter Gems/Custom GPTs. Modellgespräche bleiben beim gewählten API-Anbieter ohne CLI-/Browserwerkzeuge.

Produktion läuft laut letzter Prüfung auf Geekom192.168.1.124:4545; diese Sitzung arbeitet weiter auf dem Unraid-Checkout. Rollout erst als produktiv bezeichnen, wenn dort verifiziert. Fremde Änderungen in AGENTS.md und piConfig.ts erhalten.

## Bisherige Verifikation

- `test:assistant-api-chat` vollständig grün, ergänzt um direkten Projektbezug ohne Profil, explizites Entfernen trotz Projekt im Profil, Projektwechsel, fremden Eigentümer und an Profilrevision gebundenes Assistentenwissen.
- Backend-/Frontend-Typechecks und Frontend-Produktionsbuild grün.
- `chat-workspace-browser-tests.py`: echte Komponenten mit isolierten HTTP-Fixtures, 390/1440px; Anlegen/Bearbeiten, Speicherfehler mit erhaltenen Eingaben, Quellen und Modellvorgabe, Chatstart, bestehender Chatwechsel, gefilterte Projektgespräche und Archivieren. Keine JavaScript-Fehler oder horizontales Scrollen. Bildschirmprüfung führte zu lesbaren Auswahlbreiten und kompakter Dialoghöhe.
- Älteres `assistant-api-chat-browser-tests.py` aktuell nicht grün: erwartet vorbestehende Combobox `Modellverbindung`, neuerer ModelEffortPicker verwendet bereits den Button `Modell und Denkaufwand`. Der neue gezielte Workspace-Test prüft den funktionierenden aktuellen Picker.
- Geekom verwendet Compose-Projekt `plum` und `/srv/plum/deploy/docker-compose.geekom.yml`; bisheriger Repair-Bot fehlte. Neue standortspezifische Datei `/srv/plum/deploy/docker-compose.repair.yml` ergänzt den offiziellen Sidecar und Build-Kontext. Normalisierte Konfiguration des Hauptdienstes davor/danach bis auf `build` identisch. Drei optionale `REBUILD_COMPOSE_*` Variablen im Robot ermöglichen das aktive Projekt, bei unveränderten Unraid-Defaults; Verhaltenstest einschliesslich explizit leerem Override grün.
- Android-Neubau enthält auch die explizite Trennung zwischen Assistentenwahl im neuen Entwurf und bestehenden Chats ohne Assistenten. Keine Geräteinstallation autorisiert oder durchgeführt.
