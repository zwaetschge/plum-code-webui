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
- [x] Über repair-bot ausliefern; Desktop-Autoupdate und echte Oberfläche/Interaktionen prüfen.
- [x] Lesbarkeit auf dem echten kleinen Bildschirm korrigieren: ganze nutzbare Fläche, explizite Text-/Bediengrösse, Dock oben freihalten; in WebUI und Android einstellbar.

## Auslieferungsstand

Companion **0.6.2**, Commit `0715e4e`, ist auf dem Geekom verbunden. repair-bot hat am 18.10.2026 um 14:30 UTC erfolgreich ausgeliefert; `/health/ready` bestätigt Datenbank und Frontend. Die zehn Erweiterungen sind in `4ed9ec6` implementiert, Android-Serialisierung in `11680c9`, die Geometriekorrektur in `d93535b`.

Backend- und Frontend-Typecheck sowie ESLint sind grün. Zehn Python-Verhaltenstests prüfen unter anderem physische Eingabeübergabe, Sitzungsisolation, Fortschritt, Verlauf und Monitorgeometrie; zwei Backend-Tests prüfen Zustandsgrenzen und Benutzer-/Verbindungsisolation. Echte Qt-Widgets sowie WebUI bei 1440/390 Pixeln wurden geprüft. Live-API: ohne Anmeldung 401, ungültige Anordnung 400, unbekannter Computer 409. Beide Client-Karten sind in den bestehenden Desktop-Settings erreichbar.

Android: finaler android-builder-Build am 18.10.2026 um 14:33 UTC erfolgreich, inklusive `DesktopLayoutSerializationTest` (1 Test, 0 Fehler). Dieser Test prüft die explizite Übertragung auch von Standardwerten bei `encodeDefaults=false`. APK nach `/mnt/user/Zwischenspeicher/plum-code-android-app-debug.apk` kopiert; SHA-256 Original/Kopie identisch:

`5e2e169d6a6a9825a29e933116a9688b50f719ecad573b0b90752e16a638437d`

Builder-Claim freigegeben. Die APK wurde nicht auf dem Android-Testgerät installiert; Gerätesichtprüfung der Android-Karte bleibt eine Verifikationsgrenze.

## Echte Desktop-Prüfung und Lesbarkeit

Der ursprüngliche native Test bestätigte Chat, Sitzungswahl, Eingabefokus und Ausblenden: Testentwurf eingegeben und gelöscht, keine Nachricht gesendet; Deck bleibt zugänglich. Spectacle lieferte dabei bei gemischter Skalierung abweichende Bildschirmkoordinaten. Seit 0.6.1 werden KWin-Ausgänge einzeln aufgenommen und mit einer gemeinsamen Skalierung an den Qt-Positionen zusammengesetzt. Ein echter Screenshot bestätigt die korrigierte Geometrie (1568×985; DP-1 bei 769,656); Tests decken auch Monitore links vom Ursprung ab.

Auf die Nutzerrückmeldung zur Lesbarkeit folgt 0.6.2: `full` nutzt die ganze verfügbare Bildschirmfläche, `chatZoom` erlaubt 100–250 %, `chatInsetTop` hält 0–200 px für ein Dock frei. Schrift wird explizit auf Widgets und QTextDocument angewendet. Kopfzeilen sind zusammengefasst, Pause/Weiter und Stoppen direkt im Chat erreichbar. Dieselben Einstellungen bestehen in WebUI und Android.

Geekom-Profil angewendet und vom Companion bestätigt: **secondary / full / 200 % / 80 px oben / sichtbar**. Einstellungen bleiben pro Computer gespeichert; andere Monitorgrössen und Aufteilungen bleiben frei wählbar. Abschliessend am echten Gerät geprüft: Kopfzeile, Text und Eingabefeld sind bei 200 % lesbar, das Retroid-Dock oben bleibt frei. Einen Testentwurf im nativen Feld eingegeben, visuell bestätigt und mit Ctrl+A/Backspace gelöscht; nichts gesendet. Die separate verschiebbare Plum-Steuerleiste auf den Hauptmonitor gezogen und damit den Chat-Titel freigegeben. Das Ergebnisfeld nutzt bei Bedarf den äusseren Scrollbereich. Endzustand: **pausiert**, Chat sichtbar mit unverändertem Profil.

Belege im Workspace:
- `.claude-webui-images/desk-1792345153917.jpg`: beide echten Monitore, freie Deck-Leiste und Chat auf DP-1.
- `.claude-webui-images/desk-1792345153292.jpg`: vergrösserter Ausschnitt des kleinen Displays nach der Korrektur.

Verifikationsgrenzen: Android gebaut und Serialisierung geprüft, nicht auf Gerät installiert. Die während Werkzeug-Aufrufen kurz sichtbare Statusblase kann Teile des Chats überlagern; sie läuft nach der Aktivität aus. Physische Lesbarkeit hängt zusätzlich von Betrachtungsabstand und Displaygrösse ab; die Schrift lässt sich lokal und in beiden Clients weiter anpassen.

## Integration mit „oled control“

Bestehendes Projekt `/mnt/user/AI/plum-code/oled control` bleibt unverändert. Der Companion legt `~/.local/share/applications/ch.zwaetschge.plum-chat.desktop` an. Das Retroid-Panel kann „Plum Chat“ als normale Programm-Kachel wählen. Alternativ eine Befehl-Kachel:

```sh
gdbus call --session --dest ch.zwaetschge.PlumDesktop --object-path / --method ch.zwaetschge.PlumDesktop.desktop toggle_chat
```

Andere Aktionen: `show_chat`, `hide_chat`, `pause`, `resume`, `stop`, `context`. Dieselbe Schnittstelle funktioniert für andere Decks/KDE-Kurzbefehle. Monitorwahl: `primary`, `secondary` (= kleinster Zusatzmonitor) oder Ausgangsname. Anordnung: `full` für die ganze Fläche, `left`/`right` für geteilte Nutzung; `floating` merkt die verschobene Position. Schriftgrösse und freier Platz oben sind unabhängig einstellbar. Keine Änderungen an Auflösung, Rotation, KDE-Leisten oder Videoplayer.

## Separate Steuerleiste – Nutzerkorrektur

0.6.3 blendet das zusätzliche schwebende Steuerfenster standardmässig aus, auch bei Sitzungswechsel, Verbindung und Werkzeug-Aufrufen. Im Tray kann „Separate Steuerleiste anzeigen“ bei Bedarf aktiviert werden; die Auswahl wird lokal gespeichert. Pause/Weiter/Stoppen bleiben im Chat sowie die Moduswahl im Tray. Keine Änderung der WebUI-/Android-Bedienung erforderlich. Syntaxprüfung und zehn Desktop-Verhaltenstests grün. Diese Zwischenlösung wird mit 0.6.4 durch ein einziges gemeinsames Fenster ersetzt (siehe unten).

## Ein gemeinsames Fenster – Nutzerkorrektur

0.6.4 erstellt nur noch ein Desktop-Fenster: Chat, Status, Ergebnis und Bedienung sind darin zusammengefasst. Die zusätzliche Steuerleiste und ihre Tray-Option entfallen vollständig. Das Fenster hat normale Fenstermanager-Dekoration, erscheint als normales Fenster und lässt sich gemeinsam verschieben, minimieren und schliessen. Schliessen blendet den Chat aus; Companion/Tray bleiben verbunden. Pause/Weiter, Stoppen und Verlauf stehen in einer festen Fussleiste ausserhalb des Scrollbereichs. Auch „Nachricht an Plum“ im Tray fokussiert dieses Fenster statt eines zusätzlichen Eingabedialogs. Schriftgrösse, Monitorwahl und Platz fürs Deck bleiben erhalten. Syntaxprüfung und zehn Verhaltenstests grün. Am echten Geekom nach Auslieferung um 21:05 UTC bestätigt: Version 0.6.4 verbunden, normale KDE-Titelleiste, Chat/Status/Eingabe und feste Fussleiste im gemeinsamen Fenster; keine separate Steuerleiste auf den beiden Monitoren. Retroid-Dock oben bleibt frei. Profil weiterhin secondary/full/200 %/80 px/sichtbar; nach der Aufnahme wieder pausiert. Belege: `.claude-webui-images/desk-1792357523364.jpg` (kleiner Bildschirm) und `.claude-webui-images/desk-1792357523154.jpg` (beide Monitore). Minimieren und Schliessen wurden dabei nicht zusätzlich betätigt.
