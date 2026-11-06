# Session handover 2026-10-17 — Designs-Panel & HTML-Previews

## Ausgangslage (Nutzer-Report)

„Designs in Code werden nicht mehr richtig angezeigt, sollten als einer der 4 Punkte
neben Lauf stoppen / Verbindungen / Dateien sein; nur 8 von 39 Designs werden angezeigt."

Commit `da45a24` (P4) hatte das `SessionStyleLibraryPanel` aus der SessionPage entfernt
und durch `DesignPresetDialog` mit 8 kuratierten Presets ersetzt; 15 der 39 Designs
fielen zudem auf den generischen Token-Fallback, weil kein HTML-Preview-Template existierte.

## Umgesetzt (Commit `f5d0bd9`, main)

1. **Designs als eigenes Session-Panel** (WebUI): neuer DockablePanel-Key `designs`
   (`panelDockStore.ts`), Menü-Eintrag im `session-primary-tools`-Block neben
   Dateien/Vorschau/Verbindungen, mountet wieder das volle `SessionStyleLibraryPanel`
   (39 Presets, Suche, DESIGN.md-Import/Export, aktivierbar pro Session).
   Legacy-Pin `designStyle` migriert auf `designs`.
2. **DesignPresetDialog zeigt alle 39** statt 8 kuratierte (Kuratierte bleiben vorn,
   „N weitere über die Suche"-Hinweis entfällt).
3. **14 neue HTML-Preview-Templates** (400×300, wie bestehende): bento-modern,
   cel-anime-action, console-glass, console-shelf, friendly-playful, hand-drawn,
   immersive-storytelling, print-texture, refined-premium, retro-arcade,
   retro-vintage, sci-fi, spatial-perspective, terminal-cyber.
   Skeuomorphism mappt per Override auf das bestehende `preview-skeumorphism.html`.
   → Alle 39 Designs lösen jetzt auf ein echtes HTML-Preview auf (Skript-Check: 39/39).
4. **Android-Parity**: `DesignPresetSheet` listet die volle Bibliothek (kuratiert vorne),
   `preset_design_more`-Strings entfernt. Build via android-builder angestossen.

## Verifikation / Offen

- Frontend `tsc --noEmit` grün.
- `bash scripts/plum-rebuild.sh --no-wait` → repair-bot: Build 14:31 OK,
  Restart OK, Readiness 2/36 OK; neue Previews antworten 200.
- Android-Build OK (APK 16:33), kopiert nach
  `/mnt/user/Zwischenspeicher/plum-code-android-app-debug.apk`,
  SHA-256 `618c065a…f54811` (Quelle = Kopie). Kein Geräte-Install (nicht autorisiert).
- Offen: visueller Browser-Check des Designs-Panels durch den Nutzer.
- Nicht Teil dieses Commits: fremde laufende Änderungen in AGENTS.md,
  `packages/backend/src/utils/piConfig.ts`, ungetrackte docs/deploy-Dateien.
