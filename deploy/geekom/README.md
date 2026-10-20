# Geekom: SSD-Cache mit Unraid-Array als Speicherebene

Wie der Unraid-Mover: Der Geekom (`/srv/plum`, SSD) ist die Arbeitsebene, das
Array (`/mnt/user/Backup/Geekom-Plum`, Share ohne Cache) die Speicherebene.

- `project-writeback.sh` (root, `plum-project-writeback.timer`, alle 15 min)
  spiegelt `/srv/plum/projects` aufs Array und ruft danach höchstens einmal pro
  Tag `plum-mover.py run` auf.
- `plum-mover.py` verschiebt Einheiten, die lange unverändert und von keinem
  Prozess geöffnet sind, aufs Array und ersetzt sie lokal durch einen Symlink.
  Der WebUI-Container bindet `/mnt/user` unter demselben Pfad ein, die Pfade
  funktionieren in Sessions also weiter (nur langsamer).
  Einheiten und Schwellen stehen in `TIERS` (Projekte 10 Tage/1 GB,
  Skyrim-`.work` 5 Tage, Skyrim-Agentenordner 3 Tage, Codex-Sitzungen/-Bilder
  21 Tage). Registry: `/srv/plum/tiered.json`, Log: `/srv/plum/logs/plum-mover.log`.
- Zurückholen auf die SSD (als root): `python3 /srv/plum/deploy/plum-mover.py promote <pfad>`.
  Übersicht: `... plum-mover.py status`.
- Writeback und nächtliches State-Backup (`backup-geekom-state.sh`) überspringen
  ausgelagerte Einheiten, damit der Symlink nie die Array-Kopie ersetzt.

Sicherheitsnetz pro Einheit: Massenkopie, Umbenennen in einen Staging-Ordner,
Symlink setzen, Nachsynchronisieren, Prüfung per rsync-Dry-Run und Dateizählung;
erst dann wird lokal gelöscht, sonst wird zurückgerollt. Mindestens 50 GB plus
120 % der Einheit müssen auf dem Array frei sein.
