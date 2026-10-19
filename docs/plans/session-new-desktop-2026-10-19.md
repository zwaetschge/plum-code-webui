# Neuer Desktop 192.168.1.112

- [x] SSH-Anmeldung und System bestimmen: Fedora44 KDE/Wayland, Benutzer zwaetschge, Firefox153 und Chrome150.
- [x] Plum Desktop0.6.5 mit Abhängigkeiten, Eingaberechten und Autostart installieren.
- [x] Firefox- und Chrome-Erweiterung installieren und separat koppeln.
- [x] Echte Anzeige sowie Desktop-/Browser-Verbindungen und kleine Testaktion prüfen.

Zugangsdaten nur aus dem Nutzerauftrag verwenden, nicht in Dateien oder Ausgaben speichern. SSH als Benutzer funktioniert; Root-Direktanmeldung nicht bestätigt. Adminarbeiten über sudo-Root-Shell. Steuerverbindung über lokalen SSH-Multiplex-Socket in /tmp; Unix-Sockets auf dem Unraid-Workspace funktionieren nicht zuverlässig. Bestehende alte Geekom-Verbindungen erhalten.

## Ergebnis

- Desktop0.6.5, Firefox-/Chrome-Erweiterung0.9.3 auf dem neuen Fedora44-KDE-Rechner installiert. Companion startet über `~/.config/autostart/plum-desktop.desktop`; Eingabe-/Screenshot-/OCR-Abhängigkeiten installiert, uinput-Regeln und Modulstart eingerichtet.
- Produktive Verbindungen um 17:25UTC bestätigt: Desktop `TsPKv-Y-Nl` (control), Firefox `vv-bHTHlKI`, Chrome `nMr767VyCD`. Alle drei Label enden auf192.168.1.112; Beleg `.logs/new-desktop-result.json`.
- Companion-SHA256 im Repository und auf dem Rechner: `f6698a8757e015f3b68acd4b9b2151deb30336b8b0d0d615198599864f12875f`.
- Echte Chrome-Bedienung erfolgreich (URL eingeben, Entwicklermodus, Verzeichnis wählen, Erweiterung laden). Firefox-Sitzung nach kontrolliertem Neustart wiederhergestellt; ungültigen Profil-Token durch neue produktive Kopplung ersetzt. Keine Passwörter oder Tokenwerte in Protokollen/Repository.
- Reeller Skalierungsfehler behoben: XWayland-Qt meldet eDP-1-Ursprung840/2160, KWin-Eingabe560/1440; zusätzlich verschiebt XWayland die Overlay-Geometrie.0.6.5 wandelt Fenster/Pointer monitorbezogen um und berücksichtigt den Screenshot-Ursprung. Dreizehn Verhaltenstests und Syntaxprüfung grün; korrekter Klick und Rahmen am Gerät geprüft.
- Temporärer SSH-Rückkanal für die alte Sitzung entfernt, temporärer Token widerrufen. Permanente Verbindungen gehen direkt an produktives Plum; kein Tunnel für den Betrieb nötig.

## Produktionsroute beachten

Die öffentliche Instanz läuft auf dem Geekom192.168.1.124:4545; diese ältere CLI-Sitzung läuft noch am Unraid-Backend. Neu-Kopplungen daher über die authentifizierte öffentliche API erzeugt. Irreguläre lokale Testkopplungen widerrufen; zwei zuvor lokal widerrufene unbenutzte Links wiederhergestellt. Produktiv zwei nie verwendete Chrome-Links vom29.09. und01.10. für die Token-Obergrenze freigegeben; aktive alte Geekom-Kopplungen erhalten.

Gleich priorisierte alte Docker- und neue Datei-Router führten /mobile zur Produktivinstanz, angemeldete direkte Firefox-WebSockets teils zur alten Datenbank. Nur die Prioritäten der bereits als produktiv definierten Geekom-Router wurden um1000 erhöht; Auth/TLS/Middlewares unverändert. Aktive Datei: `/mnt/user/appdata/brian/traefik/config/dynamic/plum-geekom-prod.yml`; Original liegt daneben als `plum-geekom-prod.pre-desktop-20261019.bak`. YAML und ausschliessliche Prioritätsänderung geprüft; danach Firefox sofort produktiv verbunden. Kein Backend gestoppt, keine Datenbanken zusammengeführt.

Weitere Steuerung aus einer neuen Sitzung auf dem produktiven Backend starten: bestehende MCP-Prozesse dieser alten Sitzung bleiben am vorherigen localhost gebunden.0.6.5 ist auf dem neuen Rechner und im Repository; das öffentliche Backend verteilt bis zum nächsten regulären Rollout noch seine bisherige Companion-Version.
