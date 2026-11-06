# Plum-Langzeitgedächtnis

Stand: 11. Oktober 2026. Vollständige Implementierung im Arbeitsverzeichnis. Der laufende Server wurde für diese Arbeit weder neu gebaut noch neu gestartet. Die APK aktiviert die noch nicht ausgerollten Serverfunktionen nicht selbst.

## Gemeinsames Gedächtnis

Plum Chat, API-Modellchats und Task-Gespräche verwenden gemeinsame persönliche und Projekt-Erinnerungen. Personalisierung, Profilberechtigung und temporärer Modus begrenzen sowohl Lesen als auch Lernen. Code erhält nur seine ausdrücklich freigegebenen Profil-Erinnerungen. Die Schalter für Erinnerungen verwenden, automatisch lernen, frühere Chats berücksichtigen, Schreibstil lernen und Weitergabe an beauftragte Agenten sind unabhängig; neue Lern- und Weitergabeschalter sind standardmässig aus.

Neue CLI-Gespräche lernen direkt im eigenen Modellturn über `plum_process_memory`. Der Server bindet die Analyse an den SHA-256 des aktuellen Originalbeitrags, Konto, Profil und aktuelle Zustimmung. Andere Quellen oder ein inzwischen gewechselter Beitrag werden abgewiesen. «Merk dir», «Korrigiere» und «Vergiss» haben weiterhin unmittelbare MCP-Werkzeuge. Ein Modell darf einen Speichererfolg erst nach Werkzeugbestätigung melden.

Ein dauerhafter Hintergrunddienst fängt verpasste Analysen auf und verarbeitet API-Beiträge, abgeschlossene CLI-Beiträge und eigene abgeschlossene Task-Ziele. Eigene API-Verbindungen werden bevorzugt; fehlt eine solche, kann der für dieses Konto freigegebene vorhandene Codex-Login verwendet werden. Die Personalisierung bietet eine explizite Auswahl von Verbindung und Modell. Der Codex-Helfer läuft kurzlebig in einem leeren Arbeitsverzeichnis mit derselben nativen Auth-Verwaltung und deaktivierter Benutzerkonfiguration, ohne MCP, Shell, Browser, Apps, Plugins oder Delegation. OAuth-Erneuerung bleibt beim gemeinsamen nativen Auth-Store; Refresh-Tokens werden nicht in einen zweiten Store kopiert. Das temporäre Arbeitsverzeichnis wird anschliessend entfernt. Kein globaler Admin-LLM-Fallback. Neue Gespräche mit anderen CLI-Providern lernen über deren laufenden Turn; der unabhängige Hintergrund-CLI-Fallback verwendet Codex.

Modellantworten enthalten höchstens acht Fakten mit genauen Nutzerzitaten und stabilen Themen. Belege müssen wirklich im Original stehen. Zugangsdaten werden abgewiesen. Sensible Fakten bleiben Vorschläge bis zur Bestätigung; ihre Beiträge werden vorher auch nicht als Zusammenfassung oder Schreibstil genutzt. Eigene gespeicherte oder korrigierte Einträge bleiben angeheftet und werden nicht still überschrieben. Explizites Wiedermerken kann eine zuvor vergessene Angabe bewusst neu speichern.

## Semantische Suche und gesamter Verlauf

Die Suche verwendet den vorhandenen privaten bge-m3-Dienst des nativen Schwarms unter `http://schwarm-plum-relay:8080/einbettung`. Keine neue Cloudverbindung und kein zusätzlicher Modellschlüssel. `PLUM_MEMORY_EMBEDDING_URL` und `EINBETTUNG_MODELL` können den bestehenden Dienst konfigurieren. Reale normalisierte 1024-dimensionale Vektoren liegen revisionsgebunden und kontogetrennt in PostgreSQL. Lange Erinnerungen werden in überlappende Abschnitte geteilt; der Kontext enthält die tatsächlich passende Stelle. Auch ältere Einträge ausserhalb der jüngsten Verwaltungsliste werden gefunden. PostgreSQL-Volltextsuche ergänzt die semantische Suche und bleibt bei Ausfall des Embeddingdienstes verfügbar. Ausstehende Vektoren werden später erneut indexiert.

Erlaubte frühere Gespräche liefern getrennte Zusammenfassungen und Stilbeobachtungen mit Originalreferenzen. Jeder Abruf überprüft Originalinhalt, Besitzer und aktuelle Profil-/Projektgrenzen. Das bestätigte Einlesen bestehender Chats setzt einen dauerhaften Cursor und eine feste zeitliche Grenze. Alle erlaubten Beiträge werden seitenweise vorgemerkt, nicht bloss die letzten 50. Nach Neustart geht es am Cursor weiter; Abbrechen storniert ausstehende Backfill-Jobs. Temporäre, fremde und archivierte Gespräche bleiben ausgeschlossen. Währenddessen eintreffende Beiträge laufen durch die normale Verarbeitung.

## Native Hermes- und Schwarm-Speicher

Die Verwaltung liest tatsächlich `swarm.gedaechtnis` und Hermes' `MEMORY.md`/`USER.md`. Zugelassen ist ausschliesslich das aktuell verifizierte verbundene Matrix-Betreiberkonto des nativen Schwarms. Eine gespeicherte Identitätsbeschriftung reicht nicht; das aktuelle Token wird am Homeserver geprüft. Andere Plum-Konten sehen diese Originalspeicher nicht.

Standardmässig sind die vorhandenen lesbaren Brian- und Trader-Speicher registriert. Weitere Hermes-Instanzen lassen sich über `PLUM_HERMES_MEMORY_ROOTS` als JSON-Zuordnung Agent-ID → Gedächtnisverzeichnis anbinden. Alle Agenten, die im nativen Schwarm Resultatwissen speichern, erscheinen in dessen Datenbankspeicher. Nicht erreichbare Originalspeicher werden ausdrücklich angezeigt.

Hermes-Änderungen respektieren das native Absatzformat `\n§\n`, dieselbe separate `fcntl`-Dateisperre, SHA-basierte Konfliktprüfung, Grössenbegrenzung und atomisches Ersetzen. Der Helfer verwendet den vorhandenen nativen Threat-Scanner aus dem jeweiligen vertrauenswürdigen Hermes-Code. Schwarm-Änderungen verwenden ein atomisches Textvergleich-Update; gelöschte Task-Ergebnisse bekommen einen Tombstone, damit der native Tick sie nicht erneut erzeugt. Änderungen aktualisieren unveränderte eigene Plum-Importkopien; ausdrücklich abweichende persönliche Korrekturen bleiben autoritativ. «Im Original vergessen» entfernt auch alle eigenen daraus importierten Plum-Versionen.

Eine Übernahme erstellt zunächst eine getrennte Agentenerinnerung mit nativer Herkunft und Revision. Die zusätzliche persönliche Übernahme ist explizit. Hermes hält seinen Systemprompt während eines nativen Gesprächs konstant: Originaländerungen gelten dort ab dem nächsten neuen nativen Gespräch. Plum verändert oder beendet dafür keine laufende Hermes-Session.

## Verwaltung, Transfer und echtes Vergessen

Erinnerungen und gelernter Gesprächskontext haben serverseitige Suche und Nachladen ohne globale 100-Einträge-Grenze. Die Oberfläche zeigt Herkunft, Belege, sensible Vorschläge, Korrektur, Versionen, native Speicher und Verarbeitungsstatus. Einzelner gelernter Gesprächskontext kann vergessen werden, ohne die ausdrücklich gespeicherten Fakten oder Originalchats zu löschen.

Export speichert alle eigenen Erinnerungen als `plum-memory`-JSON. Import akzeptiert diesen Export, eine Liste von Texten/Erinnerungsobjekten oder kopierten Erinnerungstext eines anderen Assistenten als TXT/Markdown. Imports sind ausdrücklich gespeicherte, angeheftete Fakten; Duplikate und Zugangsdaten werden getrennt gezählt. Fremde Projektverweise werden nicht übernommen; unberechtigte Referenzen werden zu persönlichen Erinnerungen. Herkunft bleibt als Importdatei dokumentiert. Es gibt keine behauptete private Kontosynchronisation mit ChatGPT oder Claude.

«Vergessen» entfernt Inhalt, frühere Erinnerungsversionen, Vektoren und betroffene gelernte Zusammenfassungen. Inhaltsfreie Fingerabdrücke verhindern automatisches Wiederlernen aus vergessenen Originalbeiträgen. Sammellöschung und separate Verlauf-/Stillöschung bleiben verfügbar. Abschalten sperrt Nutzung, ohne vorhandene Fakten heimlich zu löschen. Vor und nach Modellanalysen werden Zustimmung, Quellhash und Revision erneut geprüft; ein zwischenzeitlicher Widerruf verhindert einen verspäteten Write.

## Verbrauch und Aktivierung

API-Analysen buchen tatsächliche Tokens und bekannte Kosten im bestehenden separaten API-Ledger. Direkte CLI-Analysen sind bereits Teil des normalen CLI-Turns und werden nicht doppelt gebucht. Eigenständige Codex-Hintergrundanalysen halten ihre tatsächlichen Tokens und API-äquivalenten Vergleichskosten im Gedächtnisjob fest; sie verbrauchen das vorhandene CLI-Abo. Der Backfill-Dialog weist vor dem Start auf Modellkosten beziehungsweise Kontingentverbrauch hin. Fehlgeschlagene Analysen, unbekannte Preise und nicht erreichbare Speicher werden nicht als Erfolg ausgegeben.

Rollout benötigt gemeinsam Backend-/Webcode und Migrationen `013-assistant-long-term-memory`, `014-assistant-semantic-memory` sowie native Schwarm-Migration `0027_gedaechtnis_verworfen.sql`. Die normalen Startup-Runner wenden diese an. Keine davon wurde für diese Arbeit manuell in der Live-Datenbank aktiviert. Konfigurierte native DB-Zugangsdaten bleiben in `config/swarm/native.env`; sie werden nicht an den Browser oder Export ausgegeben.

Android 1.6.2 (VersionCode 33, Debug) enthält den aktuellen eingebetteten Plum-Chat-/Task-Bereich einschliesslich der vollständigen Gedächtnisverwaltung sowie die bestehenden nativen Personalisierungsschalter. Nur APK-Build, keine Geräteinstallation oder Serverunterbrechung.

## Nachweise

- `test:assistant-memory`: 38 isolierte PostgreSQL-/HTTP-Fälle für Quellen, Korrektur, sensibles Lernen, Scopes, echtes Vergessen und Widerruf.
- `test:assistant-memory-completion`: zusätzliche Prüfungen mit echtem bge-m3, mehrsprachigen Umschreibungen, langen Abschnitten, 125 älteren Beiträgen, Transfer, nativem PostgreSQL und Hermes-Dateisperren samt upstream Threat-Scanner. `PLUM_MEMORY_REAL_CLI=1` ergänzt einen echten Codex-Modelltest ohne separaten API-Zugang.
- Browserprüfungen verwenden reale isolierte HTTP-Routen bei 1440, 390 und 320 Pixeln; Import, Exportdownload, mehr als 100 Erinnerungen, Korrektur/Löschung und Kontoabgrenzung sind abgedeckt.
- Schwarm-Regressionssuite: 72 Fälle. Android-Buildnachweis und APK-Hashes stehen unter `reports/`.

Final geprüft: 19 zusätzliche Backendfälle einschliesslich echtem Codex-Modelltest; 147 JVM-Prüfungen, 246 aktuelle Webdateien mit SHA-256-Abgleich und unveränderte Debug-Signatur. APK: `data/apks/plum-1.6.2-memory-complete-debug.apk`. Nachweise: `reports/plum-memory-completion-verification-2026-10-11.json` und `reports/plum-android-1.6.2-memory-build-2026-10-11.json`.
