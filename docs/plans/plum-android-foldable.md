# Android: Foldables und Tablets

Stand 2026-10-15. Auslöser: Auf dem aufgeklappten Fold 8 zeigt `AdaptiveSessionWorkspace` links das komplette
Phone-Dashboard (inklusive Bereichswähler und Modell-Chat in einer 30-%-Spalte) und rechts automatisch die zuletzt
geänderte Session – egal aus welchem Bereich. Links Chat, rechts eine Code-Session: beide Spalten haben nichts
miteinander zu tun.

## Grundidee

Aufgeklappt verhält sich die App wie die WebUI am Desktop: **links die Liste des gewählten Bereichs, rechts genau ein
Element aus dieser Liste.** Der Bereich (Chat · Task · Code · Schwarm) bestimmt beide Spalten. Zugeklappt bleibt
alles wie am Phone.

## Zustände

| Fenster | Layout |
|---|---|
| Kompakt (< 600 dp, Fold-Aussendisplay, Phones) | Unverändert: Bereichswähler oben, eine Spalte, Liste → Detail per Push. |
| Breit (≥ 600 dp, Fold-Innendisplay, Tablets) | Zwei Spalten pro Bereich (siehe unten). Die schmale Navigationsleiste ganz links (Aktivität, Analytics, Bibliothek, Einstellungen) bleibt. |

### Zwei Spalten pro Bereich

| Bereich | Linke Spalte (~ 300 dp) | Rechte Spalte |
|---|---|---|
| Chat | Bereichswähler + Gesprächsverlauf (Modell-Chats) mit Suche und „Neuer Chat“ | Das gewählte Gespräch; ohne Auswahl der Start-Composer („Was beschäftigt dich heute?“) |
| Task | Bereichswähler + Aufgabenliste mit Filtern | Die gewählte Aufgabe; ohne Auswahl „Neue Aufgabe“ |
| Code | Bereichswähler + Session-Liste | Die gewählte Session; ohne Auswahl „Neue Session“ |
| Schwarm | – | Volle Breite: die Schwarm-Übersicht ist selbst schon ein Board |

Regeln:
- Die rechte Spalte zeigt **nie** ein Element eines anderen Bereichs.
- Auswahl wird **pro Bereich** gemerkt: Chat → Task → Chat bringt das vorher offene Gespräch zurück.
- Kein „letzte Session über alle Bereiche“-Autostart mehr. Beim ersten Öffnen eines Bereichs ist dessen zuletzt
  geöffnetes Element offen, sonst der Start-/Neu-Zustand des Bereichs (kein „Wähle links eine Session“-Leerraum).
- Bereichswechsel gleitet in Reihenfolge des Wählers (wie WebUI und Phone).
- Die linke Spalte lässt sich wie bisher für den Fokusmodus einklappen.

### Auf- und Zuklappen

- **Zuklappen** mit offener Auswahl: das Element bleibt offen, jetzt im Vollbild; Zurück führt zur Liste des Bereichs.
  Ohne Auswahl: die Liste des Bereichs.
- **Aufklappen** aus einem Vollbild-Detail: derselbe Bereich mit diesem Element rechts ausgewählt.
- Der Bereich bleibt über Faltwechsel hinweg erhalten.

### Aufklapp-Animation „Milchglas wird scharf“

Prinzip wie beim Referenz-GIF (Inhalt bleibt, neue Fläche schärft sich), mit Plum-eigener Glasnote:

1. **Der Inhalt bleibt stehen.** Das offene Element landet ohne Gleiten direkt in der rechten Spalte – dort, wo der
   Blick schon ist. Kein Neuaufbau, Scrollposition und Composer-Text bleiben.
2. **Die neue Fläche ist Milchglas.** Die Listenspalte erscheint sofort an ihrem Platz, aber stark weichgezeichnet
   (Blur 36 dp), leicht vergrößert (104 %) und von einem violett getönten Schleier überzogen.
3. **Sie wird scharf.** In ~760 ms (abbremsend) klären sich Blur, Zoom und Tint gemeinsam zur fertigen Liste.

Zuklappen: Die Liste verschwimmt in ~260 ms und verschwindet, das Element füllt danach den kleinen Screen. Keine
Linie, keine Drehung. Bei „Animationen entfernen“ sofortiger Wechsel; unter Android 12 ohne Blur (nur Tint/Zoom).

### Später (nicht Teil dieses Schritts)

- Tabletop-Haltung (halb geöffnet, waagrechtes Scharnier): Gespräch oben, Composer und Tastatur unten.
- Ziehbarer Spaltenteiler.

## WebUI-Parität

Die WebUI hat dieses Muster am Desktop bereits (Sidebar = Liste des Bereichs, Inhalt = Element). Schmale Fenster
bleiben bei der Mobile-Navigation. Keine WebUI-Änderung nötig.
