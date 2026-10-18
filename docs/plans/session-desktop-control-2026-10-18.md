# Desktop-Modus: Umsetzung und Todo

Ziel: alle zehn gewünschten Verbesserungen im Desktop-Companion, WebUI und Android ausliefern. Chat, Steuerung und Status flexibel platzieren; beim Geekom den kleinen Bildschirm als geteilte Fläche für Chat, Taskleiste, Stream-Deck und Videos berücksichtigen. Bestehende Session „oled control“ zuerst lesen; keine fremden Änderungen überschreiben.

- [x] Ausgangszustand am echten Geekom ansehen (0.5.0, zwei Monitore).
- [x] Backend-/Companion-/Client-Anbindung prüfen.
- [x] Bestehende Arbeit „oled control“ prüfen und gemeinsame Schnittstelle festlegen (separates Retroid-Panel; generischer DBus-/Desktop-Starter statt Änderung seiner Konfiguration).
- [x] Monitorwahl und getrennte, gespeicherte Positionen für Chat/Steuerung; kompakte oder geteilte Fläche ohne Vollbildzwang. Zwölf Varianten in Qt geprüft, kleiner Bildschirm mit langem Ergebnis/Verlauf bleibt scrollbar.
- [x] Live-Chat mit Antwortmöglichkeit und Sitzungswahl implementiert.
- [x] Aktionsvorschau vor Eingaben; Klick- und Scrollmarkierungen implementiert.
- [x] Pause/Weiter/Stoppen und automatische Übergabe bei physischen Eingaben implementiert; Verhaltenstests grün.
- [x] Fortschritt, Wartezustände und Verlauf der letzten Schritte implementiert.
- [x] „Hier weitermachen“ mit ausgewähltem Fenster/Bildschirmbereich implementiert.
- [x] Monitorwechsel und Status beim bearbeiteten Fenster implementiert.
- [x] Abschluss mit Ergebnis, Öffnen und Nachbessern implementiert.
- [x] WebUI und Android: Live-Aktivität, Steuerung, Nachrichten, Monitor-/Layout-Einstellungen implementiert und bestehende Settings-Einstiegspunkte geprüft.
- [x] Verhaltenstests und Typechecks; Android über android-builder bauen, APK kopieren und SHA-256 prüfen.
- [ ] Über repair-bot ausliefern; Desktop-Autoupdate und echte Oberfläche/Interaktionen prüfen.

Stand: Version 0.6.0 in Commit `4ed9ec6`; repair-bot hat am 18.10.2026 um 10:45 UTC erfolgreich ausgeliefert, /health/ready bestätigt. Backend- und Frontend-Typecheck, ESLint, acht Python-Verhaltenstests und zwei Backend-Tests grün. Echte Qt-Widgets mit simulierten Daten sowie WebUI bei 1440/390 Pixeln geprüft; Bedienaktionen und Layout passen. Echte Geekom-Prüfung läuft: Companion meldet 0.6.0, Chat ist auf secondary/right/visible eingestellt und im Screenshot auf dem kleinen DP-1 zu sehen. Fremde Änderungen in AGENTS.md und piConfig.ts bestehen bereits.

Android: finaler Build (Commit `11680c9`) erfolgreich, inklusive DesktopLayoutSerializationTest (1 Test, 0 Fehler). `encodeDefaults=false` liess zunächst Layoutwerte primary/floating/true aus; DesktopLayout-Felder haben jetzt keine Konstruktor-Defaults mehr, damit explizite Änderungen vollständig übertragen werden. Finale APK nach `/mnt/user/Zwischenspeicher/plum-code-android-app-debug.apk` kopiert, SHA-256 Original/Kopie identisch: `5309661bef01f0e124905b4c7347dfb3ed6d5372d53d7711fae7febed8e67b73`. Nicht installiert.

Live-API geprüft: ohne Anmeldung 401, ungültige Anordnung 400, unbekannter Computer 409. Status liefert die Monitorwahl des richtigen verbundenen Companions.

Realer Geekom-Test: Chat rechts auf DP-1, Retroid/Taskleiste bleiben erreichbar. Entwurf in natives Eingabefeld getippt und gelöscht, nicht gesendet; Ausblenden gibt das Panel frei; Endzustand pausiert, Chat sekundär/rechts/sichtbar. Dabei vorhandenen Skalierungsfehler bestätigt: Spectacle lieferte 6880×3360 mit DP-1 an einer anderen Pixelposition als die Qt-Eingabegeometrie. 0.6.1 nimmt deshalb jeden Ausgang über KWins CaptureScreen auf und setzt alle Ausgänge mit einer gemeinsamen Pixel-Skalierung anhand ihrer echten Qt-Positionen zusammen. Zehn Python-Tests grün, inklusive Geekom-Geometrie und Monitor links vom Ursprung. Zweite Auslieferung und Nachtest der Screenshot-Klickkoordinaten stehen noch aus.

## Integration mit „oled control“

Bestehendes Projekt `/mnt/user/AI/plum-code/oled control` bleibt unverändert. Der Companion legt `~/.local/share/applications/ch.zwaetschge.plum-chat.desktop` an. Das Retroid-Panel kann „Plum Chat“ als normale Programm-Kachel wählen. Alternativ eine Befehl-Kachel:

```sh
gdbus call --session --dest ch.zwaetschge.PlumDesktop --object-path / --method ch.zwaetschge.PlumDesktop.desktop toggle_chat
```

Andere Aktionen: `show_chat`, `hide_chat`, `pause`, `resume`, `stop`, `context`. Dieselbe Schnittstelle funktioniert für andere Decks/KDE-Kurzbefehle. Monitorwahl: `primary`, `secondary` (= kleinster Zusatzmonitor) oder Ausgangsname. Geteilte Anordnung: `left`/`right`; `floating` merkt die verschobene Position. Keine Änderungen an Auflösung, Rotation, KDE-Leisten oder Videoplayer.
