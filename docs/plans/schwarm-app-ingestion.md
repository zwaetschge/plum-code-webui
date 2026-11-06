# Vollständige Übernahme der Schwarm-App in Plum

Stand: 2026-10-10. Status: Ergänzung des Detailplans; Implementierung und Live-Abnahme sind offen.

Plum übernimmt die bisherige Schwarm-App mit allen ihren Funktionen. Nach der vollständigen Abnahme soll der Nutzer seine bisherigen Gespräche, Aufträge, Agenten, Räume, Medien, Routinen und Einstellungen über Plum bedienen können, ohne zusätzlich die Schwarm-App zu benötigen. Die Backend-Anbindung allein erfüllt dieses Ziel nicht.

Diese Festlegung ergänzt den [Detailplan](2026-10-10-plum-assistant.md) und die [Todo-Liste](plum-assistant-todo.md). Die bisherige App ist die Referenz für funktionale Vollständigkeit. Die Darstellung wird an Plum Chat, Plum Task und Plum Code angepasst; bestehende Funktionen und Daten werden dabei erhalten.

## 1. Erfasste Grundlage

Das Builder-Projekt der Schwarm-App ist `53352e53-8e5c-4390-a93a-70818a435bf8`, Paket `ch.zwaetschge.schwarm`. Der ermittelte Workspace liegt unter `/mnt/user/AI/plum-code/android-app-creator/projects/53352e53-8e5c-4390-a93a-70818a435bf8`. Im gelesenen `app/build.gradle.kts` stehen Version 2.10.1 und versionCode 20. Die tatsächlich installierte Version ist noch abzugleichen.

Die Funktionsliste beruht auf Manifest, vorhandenen UI-/Datenmodulen, Methoden des SchwarmViewModel und der aktuellen Betriebsanleitung unter `/mnt/cache/AI/plum-code/matrix/ANLEITUNG-SCHWARM.md`. Frühere Entwurfspläne gelten nicht automatisch als Beschreibung der gelieferten App. Insbesondere wird eine früher geplante spezielle Rat-Oberfläche nicht als bereits vorhandene Funktion vorausgesetzt.

Quellmodule liegen unter `app/src/main/java/ch/zwaetschge/schwarm`. Die Matrix nennt relativ dazu die wichtigsten Belege. Die Methodeninventur bestätigt vorhandene Aktionen; ihre erfolgreiche Live-Ausführung und die Parität in Plum sind noch nicht geprüft. Neue im tatsächlichen App-Betrieb gefundene Funktionen erweitern den Pflichtumfang.

## 2. Verteilung auf Plum

| Bisheriger Einstieg | Ziel in Plum |
| --- | --- |
| Aktuell | Gemeinsame Übersicht und Inbox mit Tagesbericht, Rückfragen, Freigaben und Alarmen |
| Chat | Plum Chat mit echtem Brian/Hermes, Modellauswahl, Medien und Sprachmodus |
| Räume | Gemeinsame Gespräche/Arbeitsräume und Threads; zugehörige Aufträge in Plum Task |
| Schwarm | Agenten und Werkzeuge aus allen Bereichen, ausführliche Steuerung in Plum Task |
| Projektarbeit und Patches | Plum Code mit Herkunftsbezug zum Task und beteiligten Agenten |
| Einstellungen und Geräteeinrichtung | Gemeinsame Konto-Einstellungen plus gerätespezifische Android-Einstellungen |

Bestehende Matrix-Räume, Threads, Reaktionen und Mitgliedschaften bleiben während der Migration erreichbar. Die neue Oberfläche braucht keine separate reine Matrix-App zu sein. Sie muss die bestehenden Inhalte, Handlungsmöglichkeiten und Identitätsbezüge vollständig abdecken.

## 3. Verbindliche Funktionsmatrix

Für sämtliche Zeilen gilt: im Quell-/Dokumentationsumfang erfasst; Plum-Implementierung und Live-Paritätsabnahme offen. Android-Systemfunktionen werden nativ in der Plum-App übernommen. Web stellt den entsprechenden Arbeitsablauf bereit, soweit die Browserplattform ihn unterstützt; beispielsweise werden Android-Widgets nicht als Webfunktion ausgewiesen.

| ID | Bisherige Funktion | Ziel in Plum und Mindestabnahme | Beleg im App-Projekt |
| --- | --- | --- | --- |
| S01 | Aktuell, Tagesberichte, dringende Arbeit und Abo-Vorschläge | Übersicht zeigt dieselben relevanten Informationen; Berichte weglegen und gezielte Modellumstellung funktionieren | `ui/Ansichten.kt`, `ui/SchwarmViewModel.kt`, `data/Hubstand.kt` |
| S02 | Brian-Chats, echte Threads, Stoppen und weitere Nachrichten | Plum Chat spricht mit demselben Agenten; bestehender Verlauf und neue Folgefragen bleiben zugeordnet | `ui/AllgemeinUi.kt`, `data/Allgemein.kt` |
| S03 | Raum-/Thread-Navigation, Einladungen, ältere Nachrichten und Lesestatus | Räume und Auftragsgespräche sind zugänglich; Historie nachladbar; Ungelesen-Markierung korrekt | `ui/Raeume.kt`, `ui/Verlauf.kt`, `data/Ungelesen.kt` |
| S04 | Bilder, Kamera, Video, Audio, Dateien, Öffnen, Teilen und Speichern | Vollständige Medienauswahl und Wiedergabe; bestehende Anhänge abrufbar; Download/Teilen funktionieren | `ui/Anhaenge.kt`, `data/Medien.kt`, `data/Bilder.kt` |
| S05 | PDF-/Word-Vorverarbeitung für Brian | Einstellungen und nachvollziehbare Aufbereitung erhalten; Original und abgeleitete Inhalte eindeutig verknüpft | `data/BrianHilfe.kt`, `ui/SchwarmViewModel.kt` |
| S06 | Sprachnachricht aufnehmen, senden und verwerfen | Native Aufnahmebedienung und Transkription funktionieren; Verwerfen sendet nichts | `ui/Klang.kt`, `ui/AllgemeinUi.kt` |
| S07 | Laufender Sprachmodus, automatische Sendung, Unterbrechung und Beenden | Gesprächsrunden, Aufnahme, OmniVoice-Ausgabe und kontrolliertes Beenden vollständig nutzbar | `ui/AllgemeinUi.kt`, `ui/Klang.kt`, `ui/VorlesenUi.kt` |
| S08 | Vorlesen, Pause, Fortsetzen, Stoppen, Audio-Fokus und Stückausgabe | OmniVoice-Wiedergabe mit denselben Bedienmöglichkeiten und korrekter Unterbrechung bei neuen Eingaben | `ui/VorlesenUi.kt`, `ui/SchwarmViewModel.kt` |
| S09 | Stimmen je Agent und Hub samt Vorschau | Vorhandene Zuordnungen übernehmen; Stimme wählen, Probe und Speicherung funktionieren | `ui/VorlesenUi.kt`, `ui/SchwarmBereich.kt` |
| S10 | Modell pro Chat, Agentenmodelle, Denkaufwand und Ersatzmodelle | Tatsächliche Runtimekonfiguration; Reichweite pro Chat/Agent/neuem Auftrag sichtbar und korrekt | `ui/ModelleUi.kt`, `data/Modelle.kt` |
| S11 | LiteLLM-Modelle, Ausgaben, Budget, Ersatzkette und Bildmodell | Gemeinsame Provider-/Modellansicht übernimmt Information und mögliche Aktionen | `ui/LiteLlmUi.kt`, `data/Hubstand.kt` |
| S12 | Auftragsformular mit Agent, Ziel, Budget und Frist | Plum Task bildet alle Felder und bestehenden Standardwerte ab | `ui/Ansichten.kt`, `data/Vorlagen.kt` |
| S13 | Vorlagen, Platzhalter, Favoriten und Bedenkzeit mit Rückgängig | Vorlagen importieren; Platzhalter bearbeiten; verzögerten Auftrag vor Versand zurücknehmen | `ui/Vorlagen.kt`, `data/Vorlagen.kt`, `ui/SchwarmViewModel.kt` |
| S14 | Board, Filter, Fristen, Eltern-/Kinderbaum und Priorität | Task-Liste und Baum erhalten Zuordnung und Bedienung einschliesslich Vorziehen | `ui/Ansichten.kt`, `ui/Details.kt` |
| S15 | Abbruch, Wiederholung, Bewertung und Auftragsresultate | Eindeutige Aktionen mit bestätigtem Status; historische Resultate und Bewertungen erhalten | `ui/Details.kt`, `ui/SchwarmViewModel.kt` |
| S16 | Chat als Auftrag und Auftrag mit Brian besprechen | Beide Übergänge erhalten Quelle, Gesprächsbezug und auswählbaren Kontext | `ui/AllgemeinUi.kt`, `ui/SchwarmViewModel.kt` |
| S17 | Rückfragen und Freigaben, Ablehnung und direkte Antwort | Gemeinsame Inbox und atomare Entscheidungen; Antworten kommen im richtigen Thread an | `ui/Entscheidungen.kt`, `data/Lebenslauf.kt`, `FreigabeActivity.kt`, `Antwort.kt` |
| S18 | Alarme, Lebenslauf, Quittieren, Stummschalten und Wieder laut | Alarmquelle, Fingerabdruck, Historie und bestehende Stummschaltdauer übernehmen | `ui/Details.kt`, `data/Lebenslauf.kt` |
| S19 | Agentenliste, Zustand, pausierte Agenten, Fähigkeiten und fehlende Anmeldung | Echte Agentenidentität mit Health und Konfigurationsaktionen, keine blosse Karte | `ui/SchwarmBereich.kt`, `data/Schwarm.kt` |
| S20 | Routinen, Abläufe und Status ihrer Ausführungen | Lesen, konfigurieren und vorhandene Aktionen ausführen; genau ein Scheduler | `ui/Werkzeuge.kt`, `data/Hubstand.kt` |
| S21 | Rat-Befehle, Beiträge, Runden und Synthese | Bestehende Rat-Arbeitsweisen und Ergebnisse über strukturierte Oberfläche oder Befehlspalette erreichbar | `ui/Befehle.kt`, `ui/Raeume.kt`, `ui/Werkzeuge.kt` |
| S22 | Gedächtnis, Merken und Nachschlagen | Vorhandene Notizen und Ergebnisse suchbar; Quellenbezug und Agenten-Geltungsbereich erhalten | `ui/Befehle.kt`, `ui/Werkzeuge.kt`, Schwarm-Gedächtnisschnittstelle |
| S23 | Patchanzeige, Prüfung, Anwenden und Zusammenführen | Plum Code erhält originale Patchdatei, Diff und Handlungsabläufe mit bestehender Autorisation | `ui/PatchAnsicht.kt`, `data/Patch.kt` |
| S24 | Betrieb, Containerfilter, Zustand, Logs und freigegebene Aktionen | Vorhandene Funktionen und Zielbeschränkungen vollständig bedienbar | `ui/Betrieb.kt`, `ui/SchwarmViewModel.kt` |
| S25 | Türsteher, Hub-Release, Werkzeuge und Betriebsinformationen | Bestehende Anzeigen und zulässige Aktionen im gemeinsamen Werkzeugbereich | `ui/Werkzeuge.kt`, `data/Hubstand.kt` |
| S26 | Verlauf, Kennzahlen, Budgets und Kontingente | Historische Werte und Zeiträume erhalten; Kostenquellen und unbekannte Werte korrekt darstellen | `ui/Kennzahlen.kt`, `ui/Verlauf.kt`, `data/Hubstand.kt` |
| S27 | Not-Aus, Weiter, signierter Kontrollweg und Geräteverwaltung | Kontrolle ohne normalen Matrix-/Plum-Chat erreichbar; Registrierung und Abbruchbestätigung korrekt | `ui/NotAus.kt`, `data/NotAus.kt`, `NotAusKachel.kt` |
| S28 | Anmeldung, Homeserver-Erkennung, Abmelden und Rollen | Bestehende Identität zuordnen; Raumzugriff, Gastrechte und Entzug korrekt übernehmen | `ui/Anmeldung.kt`, `data/Sitzung.kt`, `data/Hubstand.kt` |
| S29 | Biometrie, App-Sperre und Screenshot-/App-Vorschau-Schutz | Geräteschutzfunktionen nativ erhalten; Zustand und Einstellungen korrekt übernommen | `ui/Wurzel.kt`, `FreigabeActivity.kt`, `ui/SchwarmViewModel.kt` |
| S30 | Push/UnifiedPush, Hintergrund-Rückfall und direkte Benachrichtigungsaktionen | Neue Plum-Geräteregistrierung; einmalige Zustellung; Antwort und Entscheidung richtig zugeordnet | `hintergrund/Push.kt`, `hintergrund/Hintergrund.kt`, `Antwort.kt` |
| S31 | Ruhezeit und Ausnahme für Dringendes | Bestehende Zeitfenster und Kritikalitätsregeln erhalten; Ende der Ruhezeit korrekt behandeln | `hintergrund/Ruhe.kt`, `data/Hubstand.kt` |
| S32 | Offline-Schnappschuss, verschlüsselter lokaler Verlauf, Suche und Lesemarker | Offline lesbar; angemessener Geräteschutz; Sync ersetzt keinen neueren lokalen Lesemarker | `data/Schnappschuss.kt`, `ui/Verlauf.kt`, `data/Ungelesen.kt` |
| S33 | Kontoeinstellungen, Vorlesen, PDF-Seiten und Einrichtungsfortschritt | Konfiguration aus dem Matrix-Konto importieren und in Plum kontogebunden synchronisieren | `data/KontoEinstellungen.kt`, `ui/SchwarmViewModel.kt` |
| S34 | Widgets, Favoritenwidget, Not-Aus-Kachel, Launcher-Kürzel und Share-Ziel | Android-Plum ersetzt sämtliche Einstiege mit korrekten Deep Links und Zielzuordnung | `widget/AktuellWidget.kt`, `widget/FavoritenWidget.kt`, `NotAusKachel.kt`, `TeilenActivity.kt`, Manifest |
| S35 | Einrichtung, Diagnose, Test-Weckruf und Jetzt prüfen | Vollständige Diagnosekette inklusive Geräteberechtigungen, Push, Backend und Appstand | `ui/Einrichtung.kt`, `ui/SchwarmViewModel.kt` |
| S36 | APK-Update, Download-/Prüfpfad und inhaltsfreie Absturzmeldung | Bestehende Nutzermöglichkeit auf den Plum-Releaseweg übertragen; keine fremde APK als Plum-Update installieren | `data/AppRelease.kt`, `data/Absturz.kt`, `ui/SchwarmBereich.kt` |
| S37 | Fold-/Tablet-Layouts, Barrierefreiheit, Theme und Befehlspalette | Vollständige Bedienbarkeit schmal/breit, TalkBack und Schriftvergrösserung; bestehende Befehle erreichbar | `ui/Wurzel.kt`, `ui/Thema.kt`, `ui/Befehle.kt`, `ui/Bausteine.kt` |

## 4. Daten- und Einstellungsmigration

Die Übernahme erfasst die vollständige verfügbare Historie im Konto und Backend, nicht nur die letzten 120 lokal gecachten Nachrichten. Dazu gehören Chats, Räume, Threads, Auftragskarten, Eltern-/Kinderbezüge, Rückfragen, Entscheidungen, Alarme, Ergebnisse, Medien, Patches, Bewertungen, Routinen, Abläufe, Gedächtnis, Tagesberichte und Kennzahlen.

Quellkennungen für Raum, Event, Thread, Task, Agent und Medium bleiben in einer Mapping-Tabelle erhalten. Links und Antworten dürfen nach der Übernahme nicht auf einen anderen Inhalt zeigen. Der Import ist wiederholbar und dedupliziert. Ein laufender Abgleich überbrückt die Zeit zwischen initialem Import und Umschaltung. Gelöschte oder nicht mehr zugängliche Inhalte werden nicht erfunden; der tatsächlich migrierbare Umfang wird mit einer Importbilanz ausgewiesen.

Vorlagen, Favoriten, Stimmen, Modelle, Ersatzketten, Ruhezeit, Vorlesen, PDF-Aufbereitung, Screenshot-Einstellung und Einrichtungsstand werden in gleichwertige Plum-Einstellungen übertragen. Kontoeinstellungen liegen bisher teilweise in `ch.zwaetschge.schwarm.einstellungen`; sie werden mit einer dokumentierten Konfliktregel zugeordnet.

Gerätegeheimnisse und Keystore-Schlüssel bleiben gerätespezifisch. Android-Paket `ch.zwaetschge.schwarm` und das bestehende Plum-Paket sind getrennte Anwendungen: Plum kann deren privaten Speicher oder nicht exportierbare Schlüssel nicht einfach kopieren. Für den neuen Plum-Client werden Not-Aus-/Push-Gerätezugänge neu registriert. Bestehende Registrierungen werden erst nach erfolgreichem Test und kontrollierter Umstellung abgemeldet.

Falls lokaler App-Speicher den einzigen verfügbaren Inhalt enthält, erfolgt die Übernahme über eine geschützte Export-/Importfunktion der Quell-App oder einen unterstützten serverseitigen Weg. Zugangsdaten werden nicht in normale Inhalts-Exporte geschrieben. Biometrische Freigaben werden im neuen Client mit dessen eigenen Schlüsseln durchgeführt.

## 5. Technische Übernahme statt dauerhafter Doppelbedienung

Bestehende fachliche Logik und bewährte Parser werden soweit sinnvoll portiert. Android-Oberflächen werden auf Plums Navigation, Theme und Netzwerk-/Sync-Schichten übertragen; für Web entstehen funktional gleichwertige Ansichten. Es wird keine zweite vollständige Navigation oder konkurrierende Hintergrund-Synchronisation in die Plum-App eingebaut.

Die bestehende Schwarm-App bleibt während der Übernahme eine nutzbare Referenz und Rückfallebene. Bridge- und Kompatibilitätswege sind Zwischenstufen. Die normale Bedienung nach Abschluss erfolgt vollständig über Plum; Backenddienste wie Hermes, Matrix oder Worker dürfen ihre eigenständige Laufzeit behalten.

Historische Rat- und Hub-Module werden anhand ihres aktuellen Betriebsstatus übernommen. Bereits abgelöste Dienste werden nicht allein aufgrund alter App-/Planreferenzen wieder gestartet.

## 6. Abnahme und Ablösung

Für jede Zeile S01–S37 wird ein realer Quell-App-Ablauf erfasst: Eingabe, Ausgangszustand, Aktion, Ergebnis und benötigte Daten. Derselbe Ablauf muss anschliessend in Plum funktionieren. Technische Unit- und Integrationstests unterstützen diese Prüfung; eine vorhandene Ansicht oder grüne Kompilierung allein genügt nicht.

Die Paritätsliste führt pro Funktion Quellversion, Beobachtung, Plum-Arbeitspaket, Testbeleg und Migrationsstand. Jede zusätzliche vorhandene Funktion erweitert diese Liste. Für plattformspezifische Funktionen wird das unterstützte Ziel ausdrücklich angegeben. Android-Nativfunktionen dürfen nicht durch einen Browserlink ersetzt werden, wenn dadurch die bisherige Fähigkeit verloren geht.

Die separate Schwarm-App gilt erst als abgelöst, wenn alle bestehenden Arbeitsabläufe in Plum nutzbar sind, Daten und Einstellungen übernommen wurden, native Push-/Not-Aus-Einrichtung geprüft ist und keine reguläre Aktion nur noch über die alte App funktioniert. Auch Sprachmodus, Räume, Offline-Speicher, Schutzfunktionen, Widgets, Diagnose und Updates sind Abschlussbedingungen.

Die alte App wird während der Planung nicht deinstalliert. Ihre späteren Hintergrundjobs, Push-Registrierungen und Bedienlinks werden kontrolliert umgestellt, damit weder Meldungen noch Aufträge doppelt ausgelöst werden. Der Rückweg bleibt bis zur vollständigen Abnahme verfügbar.

## 7. Umsetzung und Aufgabenstatus

I13 im Hauptplan ist das verbindliche Paket für die gesamte App-Übernahme. Seine Funktionen werden über alle Lieferwellen verteilt; I13 bleibt offen, bis die vollständige Parität und Migration belegt sind. Eine frühe nützliche Lieferung mit Chat und Agentenanbindung ist ein Zwischenstand und erfüllt die komplette App-Übernahme noch nicht.

| Funktionen | Zuständige Pakete | Lieferzuordnung |
| --- | --- | --- |
| S01, S03, S37 | I03, I13 | Welle 1: Einstiege, Räume, Übersicht und Navigation; vollständige Datenabnahme in I13 |
| S02, S04, S05, S06, S10 | I04, I05, I06, I13 | Welle 2: echtes Agentengespräch, Medien und Konfiguration |
| S12, S14, S15, S16 | I07, I13 | Welle 3: Aufträge und Übergänge |
| S11, S13, S17, S18, S19, S20, S21, S23, S24, S25, S26, S27 | I08, I09, I13 | Welle 4: gesamte fachliche Schwarm-Bedienung |
| S07, S08, S09, S22 | I06, I11, I13 | Welle 6: kompletter Sprachmodus und Gedächtnis; Pflicht vor App-Ablösung |
| S28, S29, S30, S31, S32, S33, S34, S35, S36 | I12, I13, bei Benachrichtigungen auch I09 | Native Systemintegration und Migration pro Welle; vollständig vor App-Ablösung |

Welle 5 übernimmt die Koordination für alle betreffenden Funktionen. Sie ersetzt die Funktionsabnahme der anderen Wellen nicht.

- [ ] S01–S37 gegen die tatsächlich installierte App vollständig beobachten und bei Bedarf ergänzen.
- [x] Jede erfasste Funktion einem konkreten Plum-Arbeitspaket und einer Lieferwelle zuordnen.
- [ ] Konto-, Backend-, Medien- und ausschliesslich lokale Daten samt Einstellungen migrieren.
- [ ] Native Geräteeinrichtung, Systemintegration, Schutzfunktionen und Updatepfad übernehmen.
- [ ] Reale Funktionsparität auf Android und den jeweils unterstützten Webwegen nachweisen.
- [ ] Vollständige Ablösung mit Importbilanz, Betriebsprüfung und Rückweg abnehmen.
