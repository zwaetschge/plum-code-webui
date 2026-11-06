# ChatGPT-Web-App vs. Plum Chat: Funktions- und Layout-Inventar

Stand 20.10.2026. Geprüft im angemeldeten Firefox (Pro-Konto, deutsche Oberfläche) über den Firefox-MCP; Layout per `getBoundingClientRect`, Beschriftungen per Accessibility-Baum. REA-MCP war in dieser Sitzung getrennt; statische REA-Belege der Projekt-/Einstellungsmodule liegen aus der Vorsitzung unter `.logs/chatgpt-rea-20261019/`. Farben/Branding bewusst ausgelassen.

Messgrenzen: ChatGPT bei 3388×1325 CSS-px (Fenstergrösse liess sich nicht ändern), Plum bei 1758×935. Schmale Breite (~400 px) nicht live geprüft; Mobilaussagen aus CSS-Klassen. Testinhalte nur in einem Temporären Chat und einem eigenen Testchat im Projekt «Plum UI-Analyse» (danach gelöscht). Nebenwirkung: Das Öffnen des Teilen-Dialogs erzeugte sofort einen öffentlichen Link für den Testchat; der Chat ist gelöscht, der Link nachweislich tot. Denkaufwand kurz auf «Instant» und zurück auf «Pro».

## 1. Globales Layout

- Zweistufige Navigation: Icon-Leiste links (52 px; Startseite, Space, Planen, Plugins, Entdecken …, angepinnte Bereiche, unten Avatar) plus Kontext-Panel (288 px), dessen Inhalt vom Bereich abhängt.
- Panel «Startseite»: Kopf «ChatGPT» mit Suche und Seitenleiste ein/aus; «Neuer Chat»; «Angeheftet» (nur wenn belegt); «Projekte» (einklappbar, Chats eingerückt darunter); «Letzte» als flache Liste ohne Datumsgruppen/Icons (36-px-Zeilen, 14 px Schrift); unten Nutzungskarte.
- Hover an Abschnittstiteln: Optionen (Organisieren nach Projekt/Liste, Sortieren zuletzt aktualisiert/manuell, Anzeigen: Projekte), Filter, Neuer Chat / Neues Projekt.
- Panel einklappen (Ctrl+Shift+S): Icon-Leiste bleibt, Kopfzeile zeigt links «Neuer Chat».
- Kopfzeile: leerer Chat → Mitte «Chat | Work», rechts «Temporärer Chat»; aktiver Chat → links nur bei Projekt-Chats Breadcrumb (Ordner + Projekt), rechts «Teilen» und «…». Kein Chattitel, kein Modellwähler in der Kopfzeile.
- Inhaltsspalte 768 px (Nachrichten = Eingabefeld). Leerer Chat: Überschrift «Was beschäftigt dich heute?» + Eingabefeld vertikal zentriert. Aktiver Chat: Eingabefeld unten (24 px), Hinweis «ChatGPT kann Fehler machen …» direkt darüber.
- Touch: Hover-Aktionen per `@media(hover:none)` immer sichtbar.

## 2. Chatzeile im Verlauf

- Rechts zwei 20-px-Icons «Chat-Aktionen» (…) und «Chat anpinnen», nur bei Hover/Fokus/offenem Menü.
- Menü in Reihenfolge (| = Trenner): Umbenennen, Anpinnen | Teilen | Archivieren, Löschen (rot) | In Projekt verschieben › (Neues Projekt, Projektliste); bei Projekt-Chats «Aus Projekt entfernen».
- Umbenennen = Dialog «Chat umbenennen» (Untertitel «Verwende einen kurzen und einprägsamen Namen», Feld vorbefüllt+fokussiert, Abbrechen/Speichern).
- Anpinnen: Abschnitt «Angeheftet» oben; Chat verschwindet aus Projekte/Letzte.
- Löschen: Dialog «Chat löschen?» – «Dadurch wird ‹Titel› endgültig gelöscht. Dieser Vorgang kann nicht rückgängig gemacht werden.» Buttons «Abbrechen» (fokussiert) und «Chat löschen» (rot). Danach Spinner, Zeile abgedunkelt, Weiterleitung auf neuen Chat (auch bei Projekt-Chats). Kürzel Ctrl+Shift+Delete. Teilen-Links werden ungültig.
- Suche (Ctrl+K): Modal 720 px, ohne Eingabe «Letzte Chats», mit Eingabe Filter-Chips (Alle/Chats/Bilder/Dokumente/Pages/Projekte), Treffer mit fettem Treffer im Titel + Ausschnitt + Datum, erste Zeile vorausgewählt.

## 3. Nachrichten

- Nutzer: rechtsbündig, max. 70 %, Radius 22 px, kein «Du»-Label. Hover-Leiste darunter rechtsbündig: Kopieren, Prompt teilen, (Versionen anzeigen), Bearbeiten.
- Bearbeiten: Blase wird Inline-Editor in voller Spaltenbreite mit «Abbrechen»/«Senden»; nach Senden verschwindet alles ab dieser Stelle, neue Antwort streamt an Ort und Stelle.
- Assistent: kein Avatar/Name, volle Breite. Aktionsleiste linksbündig, auch bei älteren Antworten sichtbar, Icon-only: Kopieren, Bewerten (ein Button → Gut/Schlecht), Teilen, (Zu Projektquellen hinzufügen), Vorlesen, Neu generieren, ….
- «…»: Zeitstempel (inaktiv), «Gespräch verzweigen › In den Work-Modus / In neuem Chat».
- Temporärer Chat: nur Kopieren, Bewerten, Vorlesen, Neu generieren.
- Zeittrenner bei grösserem Abstand zentriert («gestern, 15:29»).
- Menü «Neu generieren» (Popover 280 px): Freitext «Um eine andere Antwort bitten» ↑ | «Erneut versuchen • ‹Modell/Aufwand›», «Thinking verwenden», «Pro-Modus verwenden» | «Im Web suchen». Keine «kürzer/länger»-Optionen mehr.
- Neu generieren: alte Antwort verschwindet, neue streamt an derselben Stelle; Senden → «Stoppen».
- Versionen: im Temporären Chat «‹ 2/2 ›» in der Antwort-Aktionsleiste rechts vom Neu-generieren-Button; im normalen Chat stattdessen Hover-Icon «Versionen anzeigen» an der Nutzernachricht → Modal «Versionen» mit Vorschau, «Zurück zur aktuellen Version» und «In neuem Chat fortsetzen». (Teilweise unsicher, siehe unten.)

## 4. Eingabefeld

- Pill 768×52, einzeilig wachsend: «+» | Text | Modell-Chip (Aufwand) | Diktieren | Sprachchat/Senden/Stoppen.
- Platzhalter «ChatGPT fragen», im Projekt «Neuer Chat in ‹Projekt›».
- Während Streaming: Stoppen, Textfeld bleibt bearbeitbar.
- «+» öffnet Inline-Liste unter dem Feld mit Titel+Beschreibung: Fotos und Dateien, Aus Bibliothek, Bild erstellen, Websuche, «Tippen, um nach Plugins zu suchen».
- Nach-unten-Button: rund 32 px, mittig 24 px über dem Eingabefeld.

## 5. Modellwähler

- Chip im Eingabefeld; einfache Ansicht = Regler «Leistung» mit 5 Stufen (Instant … Pro), Pfeiltasten; Klick auf Kopf → erweiterte Ansicht mit Modellliste. Ctrl+Shift+M.

## 6. Projekte

- Seitenleiste: Projektzeile mit Aktionen (Teilen, Umbenennen, Einstellungen, Startseite, Anpinnen, Löschen) und «Neuer Chat in X»; Projekt-Chats eingerückt und zusätzlich in «Letzte».
- Projektseite (Spalte ~632 px): Kopf mit Icon, Name, Teilen, …; direkt darunter Eingabefeld «Neuer Chat in ‹Projekt›»; Pill-Tabs Chats | Quellen; zweizeilige Chatzeilen.
- Projekteinstellungen = Modal ohne Speichern-Button: Name, Anweisungen, Erinnerung (bei geteilten/Business-Projekten nur lesbar), Space-Zugriff, Projekt löschen.
- Chat-Kopfzeilen-Menü: Umbenennen, Anpinnen, Plugins › | Dateien im Chat | Archivieren, Löschen | Projekt / Aus Projekt entfernen.

## 7. GPTs / Bilder

- GPTs-Seite mit Banner «GPTs werden am 11. Dezember eingestellt» → Plugins. Bilder-Seite mit Galerie und fixiertem Eingabefeld. Beide über «Entdecken», an die Leiste anpinnbar.

## 8. Einstellungen

- Eigene Seite `/settings/…`, Panel wird Einstellungsnavigation mit Suche. Gruppen Persönlich / Integrationen / Programmierung.
- Personalisierung (768 px): Erinnerung (Schalter, Zusammenfassung «Verwalten», Links zu Anweisungen/gespeicherten Erinnerungen), Schreibstil, Referenzfotos, Basisstil, Visuelle Antworten, Benutzerdefinierte Anweisungen, weitere Schalter.

## 9. Tastenkürzel (Ctrl+/, anpassbar)

Shift+Esc Fokus Chat · ⏎ Senden · Ctrl+⏎ im Hintergrund senden · Ctrl+Shift+M Aufwand · Ctrl+U Anhängen · Ctrl+Shift+Delete Chat löschen · Ctrl+Shift+O Neuer Chat · Ctrl+/ Kürzel · Ctrl+K Chat wechseln · Ctrl+Shift+S Seitenleiste.

## 10. Weiteres

- Temporärer Chat: Icon oben rechts, Info-Popover, leerer Zustand mit Hinweis, gestrichelte Nutzerblasen, weniger Aktionen.
- Teilen-Dialog mit Vorschau; Link entsteht bereits beim Öffnen.
- Automatisch generierte kurze Chattitel nach der ersten Antwort.

## Umgesetzt in Plum (20.10.2026)

- Neu generieren an Ort und Stelle, Bearbeiten als Inline-Editor, Versionswechsel «‹ n/m ›», der den ganzen Folgeverlauf wiederherstellt (Commit `93355ec`).
- Chat-Menü in der Seitenleiste mit Umbenennen, In Projekt verschieben, Archivieren und Löschen mit Bestätigung; endgültiges Löschen serverseitig.
- Layoutangleich: siehe folgender Commit (Icon-Aktionsleisten, Hover-Leiste an der Nutzernachricht, Menüreihenfolge, Umbenennen-/Löschen-Dialog wie ChatGPT).

## Lückentabelle (Rest, nach Priorität)

| Feature | ChatGPT | Plum | Priorität |
|---|---|---|---|
| Automatische Chattitel | kurz, generiert | erste Nachricht | hoch |
| Neu-generieren-Menü | Freitext «andere Antwort», Erneut versuchen mit Modell/Aufwand, Websuche | nur direktes Neu generieren | mittel |
| Anpinnen | Abschnitt «Angeheftet» | fehlt | mittel |
| Eingabefeld im leeren Chat | zentriert unter Überschrift | unten fixiert | mittel |
| Modell-Chip | zeigt Aufwand, 5 Stufen, Modelle in Zweitansicht | rohe Modell-ID | mittel |
| Suche | Modal mit Ausschnitten, Datum, Ctrl+K | Titel-Filter | mittel |
| Projekte in der Seitenleiste | Abschnitt mit eingerückten Chats | Link «Projekte» | mittel |
| Eingabefeld auf der Projektseite | direkt | Auswahl + Button | mittel |
| Kopfzeile im Chat | Breadcrumb, Teilen, … | Arbeitsbereich-Zeile | mittel |
| Temporärer Chat in der Oberfläche | Icon oben rechts | nur serverseitig | mittel |
| Bewerten | Gut/Schlecht | fehlt | niedrig |
| Teilen per Link | Dialog | fehlt | niedrig |
| Zeittrenner | zentriert | fehlt | niedrig |
| Tastenkürzel-Dialog | Ctrl+/ | nicht geprüft | niedrig |

## Unsichere Beobachtungen

1. Versionswechsel im Temporären Chat schaltete bei synthetischen Klicks nicht um.
2. Nach Bearbeiten zeigte das Versionen-Modal nur «Aktuelle Version»; nach Neuladen fehlte «Versionen anzeigen». Plum behält dagegen alle Versionen dauerhaft umschaltbar.
3. Hintergrund-Tab (`document.hidden`) pausiert CSS-Animationen: Antworttexte fehlten in Screenshots; in Plum blieben geschlossene Menüs im Exit-Zustand sichtbar (wahrscheinlich nur Testumgebung).
4. Ungeprüft: schmale Breite, Archivieren, Canvas, gespeicherte Erinnerungen.
