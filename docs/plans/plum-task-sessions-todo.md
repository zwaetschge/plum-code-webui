# Plum Task als Sessionverwaltung

Nutzerziel: Aufgabenorientierte bestehende Sessions (zum Beispiel Cache-Platte prüfen) gehören in Plum Task. Plum Code verwaltet Coding-Sessions. Derselbe Verlauf, Provider, Arbeitsordner und laufende Prozess bleiben erhalten; Zuordnung ist kein neuer Auftrag und kein Neustart.

- [x] Ist-Zustand prüfen: `/tasks` öffnet bisher strukturierte Aufträge statt CLI-Sessions; Code-Dashboard filtert nur Code, Sidebar zeigt noch alle Sessions.
- [x] Desktop und schmale Ansicht des Ist-Zustands rendern.
- [x] Gemeinsames Dashboard und dieselbe Sidebar für Task und Code verwenden; Sessions bereichsweise filtern.
- [x] Neue Task-Sessions direkt im Task-Bereich starten, inklusive Provider, Modell, Berechtigungen und optionalem Arbeitsordner.
- [x] Bestehende Sessions einzeln und gesammelt zwischen Code und Task verschieben; tatsächliche Identität, Verlauf und Prozess erhalten.
- [x] Strukturierte Aufträge/Schwarm unter zusätzlichem Einstieg erhalten und vorhandene Links kompatibel halten.
- [x] Zuordnung, Suche, Erstellen ohne Coding-Ordner, Einzel-/Mehrfachübernahme mit Teilfehler, Reload und getrennte Sidebar auf 1440/390/320 px geprüft. Typprüfung und Lint bestanden; finaler Produktionsbuild bestanden.
- [x] Android-Einstieg auf `/tasks` ändern, aktuelles Frontend bündeln, APK 1.6.5 bauen und im Unraid-Share mit geprüftem SHA-256 liefern.
- [x] Aktuelle Weboberfläche ohne Containerneustart veröffentlicht; Produktionsoberfläche auf 1440/390/320 px und tatsächliche Task → Code → Task API-Zuordnung mit eigenem Test geprüft. Live-Rendering mit echten Sessionlisten auf `/tasks` und `/code` bestanden; APK 1.6.5 mit 148 JVM-Prüfungen, 247 geprüften Webdateien und identischem SHA-256 im Unraid-Share geliefert.

Keine automatische Einordnung allein aus Sessionnamen: Der Nutzer kann seine bestehenden Sessions gezielt zuordnen. Keine Geräteinstallation. Android hat einen fest eingebauten alten Task-Einstieg und gebündelte Webdateien; deshalb wird die APK mit dem neuen Einstieg und dem geprüften Frontend ebenfalls aktualisiert.

Abschlussnachweis: `reports/plum-task-sessions-completion-2026-10-11.json`. Geräteausführung bleibt unbestätigt; die ausgewählte Geräteadresse verweigerte die Verbindung. Keine Installation durchgeführt.

## Nachtrag: Chat-Seitenleiste angleichen

- [x] Screenshot und aktuelle Routen geprüft: Chat hatte weiterhin eine separate Sidebar.
- [x] Gemeinsamen Code-/Task-Rahmen auch für Chat, Personalisierung und Bibliothek verwenden; CLI- und API-Gespräche, Projekte und Bibliothek erhalten.
- [x] Desktop und schmale Ansicht früh gerendert; Chat-Historie, Suche, mobile Navigation und Task-Trennung in privater Fixture geprüft.
- [x] Finalen Produktionsbuild und Chat-Regressionen bestanden; gemeinsame Sidebar und Sessionzuordnung auf 1440/390/320 px geprüft. Webdateien ohne Neustart atomisch veröffentlicht; tatsächliche Live-Abnahme von Chat, Task und Code mit Sessionlisten und Personalisierungs-/Projektrouten bestanden.
- [x] Android-Webpaket aktualisiert; APK 1.6.6 mit 148 JVM-Prüfungen, 247 geprüften Webdateien, identischer Signatur und SHA-256 im Unraid-Share geliefert.

Nachtrag abgeschlossen: `reports/plum-shared-sidebar-completion-2026-10-11.json`. Keine Geräteinstallation; tatsächliche Geräteausführung bleibt unbestätigt.
