# Chat: eigene Assistenten und Projekte

- [x] Bestehende Profile/Projekte und tatsächlichen Chat-Einstieg prüfen.
- [x] WebUI: direkt sichtbare Auswahl, Anlegen/Bearbeiten/Archivieren von Assistenten und Projekten, Projektquellen und Gesprächsübersicht.
- [x] Backend: unabhängiger Projektbezug, Assistentenwissen aus fixierter Profilrevision, bestehende Eigentümerprüfung.
- [x] Android: erreichbare native Auswahl und Verwaltung derselben Ressourcen.
- [ ] Verhaltenstests: Projektisolation, Entfernen/Wechseln, Profilwissen und Versionsbindung.
- [ ] Desktop-/Mobilansicht rendern und Bedienpfad prüfen.
- [ ] Android bauen und APK mit SHA-256 ausliefern.
- [ ] Tatsächliche Produktionsinstanz ermitteln, regulär ausrollen und prüfen.

Gemeinsame Ressourcen statt neuer parallel geführter Stores: `profile` entspricht dem eigenen Assistenten (Gems/Custom-GPT-Prinzip), `project` bündelt Chatkontext. Kein Import oder Aufruf fremder gehosteter Gems/Custom GPTs. Modellgespräche bleiben beim gewählten API-Anbieter ohne CLI-/Browserwerkzeuge.

Produktion läuft laut letzter Prüfung auf Geekom192.168.1.124:4545; diese Sitzung arbeitet weiter auf dem Unraid-Checkout. Rollout erst als produktiv bezeichnen, wenn dort verifiziert. Fremde Änderungen in AGENTS.md und piConfig.ts erhalten.
