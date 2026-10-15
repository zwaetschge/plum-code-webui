# Chat-Seite: 20 Bewegungs-Verbesserungen

Stand 2026-10-14. Gilt für `/chat` (Start: `ChatPage.tsx`, Gespräch: `ApiChatPage.tsx`) und die Code-Chat-Fläche
in der Assistant-Shell (`.session-surface-chat`). Grundlage: die Skills `webui-motion-foundation`,
`webui-microinteractions`, `webui-stepout-menu`, `webui-rail-glide`, `webui-page-transitions`, `webui-page-flood`,
`webui-launch-flood`, `webui-artwork-backdrop`, `webui-focus-glide`, `webui-spatial-navigation`, `animate-frontends`.

## Ausgangslage

- Keine Motion-Bibliothek installiert; Bewegung besteht aus verstreuten `cubic-bezier`-Werten in
  `components/layout/assistant-shell.css` (Effort-Schiene, Agent-Puls).
- Nachrichten erscheinen ohne Übergang; laufende Antwort zeigt nur `…`.
- „Weitere Aktionen“ unter Antworten ist ein `<details>` und schiebt beim Öffnen das Layout.
- +-Menü (`ComposerPlusMenu`), Schreibstil- und Modellwahl sind generische Dropdowns/Sheets.
- Glasflächen liegen auf flachem Hintergrund – der Blur hat wenig, was er weichzeichnen kann.

## Technische Entscheidung

Kein neues Paket. Federn über den Standalone-Treiber aus `webui-motion-foundation/assets/spring.mjs`, sonst CSS
und Web Animations API. Begründung: Bestand ist reines CSS, kein Bedarf für `AnimatePresence` in der Breite, und
keine neue Abhängigkeit im Bundle. Falls Punkt 14/15 ohne Exit-Lifecycle zu fummelig werden, `motion` mit
`LazyMotion` nachträglich nur für diese Stellen prüfen.

Durchgängige Regeln: nur `transform`/`opacity` animieren; beim Laden eines bestehenden Verlaufs nichts
einfliegen lassen; `prefers-reduced-motion` plus Personalisierungsschalter → sofortiger Zustandswechsel;
Glas-Blur in Firefox nicht zusätzlich animieren.

## Welle 1 – Fundament und Nachrichtenfluss (größter Gefühlsgewinn)

1. **Motion-Tokens + Feder-Treiber** — `src/lib/motion/{tokens.ts,spring.ts,reducedMotion.ts}`.
   Federpresets aus der Skill-Tabelle (Menü `ratio .8/k 380`, Marker `.85/k 480`), Dauer-/Easing-Tokens,
   ein `useReducedMotion()` aus `matchMedia` + Personalisierung. *Skill: motion-foundation.*
2. **CSS-Variablen und Bereinigung** — `--plum-dur-fast/base/slow`, `--plum-ease-enter/exit` in `index.css`;
   bestehende Ad-hoc-Kurven in `assistant-shell.css` (Effort-Pop, Schiene, Puls) darauf umstellen.
   *Skill: motion-foundation, animate-frontends.*
3. **Rise für neue Nachrichten** — neu abgeschickte Nutzerblase steigt aus Richtung Composer auf
   (`y 10→0`, Fade, ~280 ms); nur für während der Sitzung angehängte Turns, nicht beim History-Load.
   *Skill: microinteractions.*
4. **Antwort-Lebenszyklus** — Antwortkarte erscheint per Rise; `…` wird zu drei pulsierenden Punkten
   („denkt nach“), während des Streamings ein dezenter Live-Cursor am Textende; bei `completed` einmaliger
   Shine über die „Plum“-Kopfzeile. Ein Effekt pro Zustand. *Skill: microinteractions.*
5. **Einheitliches Press-Feedback** — eine `.plum-press`-Klasse (`scale .96`, 120 ms) für Senden, Stopp,
   Chips, Nachrichtenaktionen, Toolbar-Buttons, Sidebar-Einträge. *Skill: microinteractions, rail-glide.*
6. **Senden ↔ Stopp-Morph** — Pfeil-Icon überblendet beim Start in das Stopp-Quadrat mit Farbtint,
   statt zweier getrennter Buttons (`plum-send-button`/`plum-stop-answer`). *Skill: microinteractions.*
7. **Kopier-Rückmeldung** — Copy-Icon wird mit kleinem Pop zum Häkchen und nach 1,6 s zurück
   (heute bleibt „Kopiert“ stehen). *Skill: microinteractions.*
8. **Agent-Statusblase über dem Composer** — Ein-/Ausblenden per Feder-Rise, Textwechsel als Crossfade,
   Puls nur bei `is-live`, statisch bei Reduced Motion. *Skill: microinteractions, motion-foundation.*
9. **„Nach unten“-Button** — erscheint mit Rise, sobald hochgescrollt wird, Badge mit Anzahl neuer Antworten
   (einmaliger Pop, kein Dauerpuls), Klick scrollt per Feder. *Skill: microinteractions.*

## Welle 2 – Menüs, die aus ihrem Auslöser wachsen

10. **`StepOutMenu`-Komponente + +-Menü** — `components/motion/StepOutMenu.tsx` nach dem Skill: ein SVG-Pfad
    mit Schulter am Auslöser, Ausdehnung nach oben (Composer sitzt unten), Scrim, Einträge ab 260 ms mit
    55 ms Staffel, Pfeiltasten/Escape/Fokus-Rückgabe. Zuerst `ComposerPlusMenu` umstellen. *Skill: stepout-menu.*
11. **„Weitere Aktionen“ als StepOut** — `<details>` unter Antworten durch einen `⋯`-Auslöser mit
    StepOut-Menü ersetzen; kein Layout-Sprung mehr. *Skill: stepout-menu.*
12. **Modell- und Effort-Wahl** — `ModelEffortPicker` öffnet als StepOut vom Modell-Chip; der Marker der
    Effort-Schiene läuft über die Marker-Feder statt CSS-Kurve und behält Geschwindigkeit beim schnellen
    Umwählen. `WritingStyleMenu` nutzt dieselbe Komponente. *Skill: stepout-menu, rail-glide.*

## Welle 3 – Navigation und räumliche Kontinuität

13. **Gleitender Marker in der Sidebar** — ein einziger Auswahlhintergrund wandert federnd zwischen
    `assistant-primary-nav`-Einträgen und dem aktiven Chat im Verlauf; Hover/Fokus getrennt sichtbar.
    *Skill: rail-glide.*
14. **Chatwechsel-Übergang** — Gesprächsbereich keyed per Chat-ID: alter Inhalt 170 ms raus (`y -8`),
    neuer 300 ms rein (`y 16→0`); Scrollposition definiert (neuer Chat unten, zurück = gemerkte Position),
    Fokus auf Chat-Titel. *Skill: page-transitions.*
15. **Start → Gespräch als Shared Element** — beim ersten Absenden bleibt der Composer räumlich erhalten
    und gleitet (FLIP) von der Mitte der Startseite an den unteren Rand, Begrüßung und Vorschläge blenden
    nach oben aus, die erste Nutzerblase steigt auf. Signaturmoment der Seite. *Skill: page-flood, page-transitions.*
16. **Bibliothek/Artefakt per Page-Flood** — Klick auf Bibliothekseintrag oder Artefaktkarte: Fläche wächst
    vom angeklickten Rechteck zum `ArtifactViewer`, Schließen schrumpft zurück auf die neu gemessene Karte,
    Fallback-Fade wenn sie weg ist. *Skill: page-flood.*
17. **Launch-Flood für Bereichswechsel** — Aktionen, die den Chat verlassen („Als Task-Entwurf übernehmen“,
    Wechsel in Code/Schwarm): farbige Fläche deckt vom Button aus den Viewport ab, Navigation erst nach
    voller Abdeckung und genau einmal, Rückkehr als Fade. *Skill: launch-flood.*

## Welle 4 – Atmosphäre und Tastatur

18. **Ambient-Backdrop hinter dem Glas** — `aria-hidden`-Layer unter der Shell aus weichgezeichneten
    Farbflächen (keine fremden Bilder), Farbe aus Profil/Projekt des Chats abgeleitet, Crossfade 650 ms bei
    Chatwechsel, Kontrast-Overlay für WCAG AA. Gibt dem Frosted Glass erst Tiefe. Statisches Blur-Asset statt
    Live-`filter: blur` wegen Firefox. *Skill: artwork-backdrop.*
19. **Elastischer Fokusrahmen (nur Tastatur)** — ein SVG-Overlay folgt `:focus-visible` im Chatbereich mit
    Lead/Trail-Kanten; bei Maus unsichtbar, bei offenen Menüs/Floods ausgeblendet. *Skill: focus-glide.*
20. **Tastaturnavigation durch den Verlauf** — `Alt+↑/↓` springt zwischen Turns (echter Fokus auf
    `article`), Enter öffnet Aktionen, Escape schließt die oberste Fläche; nie in Textfeldern abfangen.
    Gamepad-Teil des Skills bewusst weggelassen. *Skill: spatial-navigation.*

## Android-Parität (Folgearbeit, `android-premium-motion`)

Übertragbar und sinnvoll: 3, 4, 5, 6, 7, 8, 12 (Effort-Sheet existiert schon in `ModelEffortSheet.kt`), 14.
Nicht übertragen: 18–20 (Web-spezifisch) und 16/17 nur, falls die App dieselben Ziele hat.

## Abnahme pro Welle

- Gerenderter Check Desktop + schmales Viewport in Firefox und Chromium, vor dem Commit.
- Reduced Motion: alle Abläufe ohne Wartezeit bedienbar.
- Lange Chats (200+ Turns) öffnen ohne Einflug-Animation und ohne Scroll-Ruckeln.
- Schnelles Doppelklicken/Umschalten erzeugt keine verwaisten Overlays, Menüs oder Doppelnavigation.
