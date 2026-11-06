# Plum Android 1.6.0

Die APK bringt den aktuellen Plum-Quellstand auf Android, ohne den laufenden Server neu zu bauen oder auszurollen. Chat und Task verwenden die im APK enthaltene aktuelle Plum-Oberfläche. Die bestehenden nativen Code-Sessions und das vollständige importierte Schwarm-Modul bleiben enthalten; der bisherige native Modellchat ist zusätzlich erreichbar.

## Funktionsumfang

| Bereich | Android-Einstieg und Umfang |
| --- | --- |
| Chat | Neue Startansicht mit Originalhintergründen und Glasflächen; CLI-/API-Modellwahl, Profile, Systemanweisungen, temporäre Chats, Recherche, Quellen, Bilder, Sprachfunktionen, Historie, Verzweigungen und Ergebnisspeicherung |
| Task | Vollständiges aktuelles Task-Board, Suche/Filter/Pagination/Baum, Hermes und weitere tatsächlich konfigurierte Agenten, persönliche Quellen/Profile, Unteraufträge, Frist/Budget, Originalbilder, Folgeanweisungen, Ergebnisprüfung und explizite Ausführung |
| Personalisierung | Native kontoweite Einstellungen mit dem vollständigen gemeinsamen Schema; Erinnerungen, Schreibprobe, Name/Beruf/Kontext, Tonfall/Stile, getrennte Chat-/Task-/Code-Anweisungen, Suche/Sprach-/Vorschlagsregeln und private Porträt-/Ganzkörperfotos |
| Arbeitsfläche | Bibliothek, Projekte, Quellen, Gedächtnis, Dokumente, Tabellen, Folien, Notebooks, Artefakte, Sammlungen, Kurse, Besprechungen, Routinen, Agenten/Ereignisse, Design/Motion, Import/Export und Freigaben über die aktuelle gebündelte Plum-Oberfläche |
| Code und Schwarm | Bestehende native CLI-Sessions, Streaming, Tools/Freigaben, Git, Agenten, Widgets und vollständige Schwarm-Activity samt bestehenden Funktionen |

Der APK-Build übernimmt einen lokalen Produktionsbuild mit `node scripts/sync-android-web.mjs`. `bundle-manifest.json` enthält die SHA-256-Werte aller enthaltenen Dateien; generierte Assets gehören nicht ins Git. Android Builder bleibt für Build und Geräteoperationen zuständig.

## Anmeldung und Gerätefunktionen

Die integrierte Fläche verwendet das in Android angemeldete Konto und dessen Serveradresse einschliesslich `/mobile`. Der JWT wird nur in den Arbeitsspeicher des vertrauenswürdigen gebündelten Frontends übernommen. Der native Auth-Persistenzadapter schreibt ihn nicht in Web-LocalStorage. API-/Socket-Verbindungen verwenden den mobilen Gatewaypfad. Fremde Hauptseiten öffnen ausserhalb dieser authentifizierten Fläche; lokale Skripte und Hintergründe werden aus dem APK geladen. Keine Weiterleitung des nativen Tokens an externe URLs.

Dateiuploads verwenden den Android-Dokumentwähler. Downloads mit bis zu 32 MB werden über den Android-Speicherdialog bestätigt und geschrieben. Kamera/Mikrofon brauchen die Android-Laufzeitfreigabe; Hintergrundwechsel beendet erfasste Kamerastreams. Native Personalisierung speichert mit `expectedRevision`; Fotoupdates haben eigene private Endpunkte. Bei Konflikten bleiben Änderungen zur Prüfung sichtbar. Der native Modellchat verwendet Sprachfunktionen erst nach bestätigter kontoweiter Freigabe und verwirft spätere Transkripte bei Widerruf.

## Nachweise und Grenzen

Browserprüfungen rendern die eingebettete Oberfläche bei 320, 390 und 1440 Pixeln und prüfen den mobilen APIpfad, den flüchtigen Zugangsschlüssel, Native-Logout und unveränderte Aufgaben beim Öffnen. Diese Screenshots belegen die eingebetteten Seiten, nicht ein installiertes Android-Gerät. Der Android Builder führt JVM-Regressionsprüfungen aus und kompiliert die Geräteprüfungen. Eine ausgeführte Instrumentierung wird nur nach tatsächlichem Geräte-Lauf behauptet.

Die APK aktiviert keine ausstehenden Serverrouten oder Dienste. Insbesondere die neuen Personalisierungsrouten und noch nicht ausgerollte Backendfunktionen benötigen den entsprechenden Serverstand. Reale Worker, Anbieterzugänge, Matrix-/Push-Anmeldung und Office-/Video-/Healthadapter behalten ihre bisherigen Voraussetzungen. Android WebView stellt die Desktop-Fensterauswahl (`getDisplayMedia`) nicht bereit; Kamera-/Bildanhänge und vorhandene Medien bleiben nutzbar. Desktop-Fensteraufzeichnungen benötigen weiterhin den unterstützten Desktopbrowser. Downloads über 32 MB sind nicht durch den integrierten Speicherdialog abgedeckt.

Die APK wird bereitgestellt, ohne Installation, Appstart, Server-Redeploy oder Veränderungen am ausgewählten Gerät.

## Build abgeschlossen am 11. Oktober 2026

[APK 1.6.0-debug](../../data/apks/plum-1.6.0-assistant-debug.apk), VersionCode 31,
38 464 908 Bytes. SHA-256:
`a1bea3fa9d11ae2303ee58fb2630a68d54bd1396ce25717a866212a2dad83352`.

Android Builder meldet `BUILD SUCCESSFUL`. 91 App- und 55 Schwarm-JVM-Tests
sind erfolgreich, einschliesslich beider neuer Personalisierungsverträge.
Die Instrumentierungs-APK ist gebaut; eine Geräteausführung fand nicht statt.
Alle 246 enthaltenen Frontenddateien stimmen mit ihren Manifest-Hashes überein.
Die Signaturidentität ist identisch mit der vorherigen 1.5.22-Debug-APK.

Der [Buildnachweis](../../reports/plum-android-1.6.0-build-2026-10-11.json)
und die getrennten Browserberichte dokumentieren tatsächliche Prüfungen und Grenzen.
