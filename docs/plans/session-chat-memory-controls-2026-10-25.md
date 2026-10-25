# Chatgedächtnis und Sprachmodell — 25.10.2026

Der Browservergleich hat zwei unabhängig vom laufenden Kontoaudit belegte Vertragsfehler und eine Bedienlücke ergeben. Der Nutzer hat die Umsetzung der fehlenden Plum-Funktionen autorisiert. Dieser Schritt ersetzt keinen vollständigen Funktionsabschluss.

## Änderung

- Normale automatische Sprachantworten (STT → API-Chat → TTS) verwenden das ausdrücklich gewählte Chatmodell und dessen Verbindung. Eine konfigurierte Anthropic-Haiku-Verbindung löst keinen stillen Providerwechsel mehr aus. Realtime und Diktieren bleiben eigene Wege.
- `memoryRead` und `memoryLearn` sind unabhängige, optionale Einschränkungen pro API-Chat. Fehlende Felder bestehender Chats bewahren die bisherigen Kontofreigaben. Neue Chats speichern beide Entscheidungen; temporäre Chats sperren beide immer. Konto-/Profilfreigaben bleiben Voraussetzung, diese Flags erteilen keine zusätzliche globale Berechtigung.
- `memoryRead=false` sperrt erinnerte Fakten, erinnerte Zusammenfassungen/Stil, frühere Voice-Kontexte, Legacy-Profilnotizen und direkte Auszüge anderer Projektchats. Projekt-/Profilanweisungen, bewusst ausgewählte Quellen und der laufende Gesprächsverlauf bleiben expliziter Kontext. Direkte Projektchatauszüge benötigen ausserdem die globale Historienfreigabe. Dies beseitigt den vorher belegten Memory-/History-Bypass.
- `memoryLearn=false` verhindert neue Analyseaufträge für Fakten, Zusammenfassungen und gelernten Stil aus diesem Chat. Der Turn speichert seine Lernentscheidung: späteres Einschalten macht einen Turn mit damals ausgeschaltetem Lernen nicht nachträglich lernfähig. Bereits gelernte Fakten werden durch Ausschalten nicht gelöscht. Das ist kein temporärer Chat: gespeicherte Originalchats bleiben separat zugängliche Historie.
- Ausschalten des Lernens storniert ausstehende API-Memory-Jobs dieses Chats. Ein Benutzerlock serialisiert diese Änderung mit dem abschliessenden Memory-Commit; ein bereits extrahiertes Ergebnis muss die neue Freigabe erneut bestehen.
- Web: Controls bei neuem Chat in Gesprächsoptionen sowie bestehendem Chat unter „+ / Gesprächsoptionen“, ausserdem im Mini-/Dokumentstarter. Android: „+ / Gedächtnis“ bei neuen und bestehenden Chats, beide Startpfade einschliesslich erster Dateianlage führen die Flags mit. Keine neue Top-Level-Navigation.

## Nachweise

- `packages/backend/scripts/chat-memory-controls-regression-tests.ts`: alle vier Lese-/Lernkombinationen, vorhandene Projektanweisungen, History-Off/Memory-Off, temporäre Chats, Turn-Snapshot und Stornierung ohne Wiederbelebung; Widerruf während laufender Extraktion verhindert Fakten- und Summary-Commit. Eigenes PostgreSQL-Testschema, keine Modellaufrufe.
- Bestehende API-Chat-Suite vollständig bestanden, ergänzt um Sprachantwort bei gleichzeitig konfiguriertem Haiku und gewähltem anderem Modell sowie Legacy-Profil-Off für Projektkontext. Nur Fake-HTTP-Endpunkte.
- Bestehende Memory-Suite: 38 Checks bestanden; Personalisierung einschliesslich HTTP-/Auth-/Revisionsprüfungen bestanden.
- Monorepo-Typecheck und gezieltes ESLint bestanden. Abschliessender Typecheck nach dem Einbau der Controls bestanden. Produktions-Webbundle mit Vite erfolgreich gebaut; ein vorheriger kombinierter Buildprozess endete durch SIGTERM, danach Typecheck und Vite getrennt erfolgreich.
- `packages/frontend/scripts/chat-memory-controls-browser-tests.py`: gerendertes neues und bestehendes Gespräch auf 1440×1000 und 390×844, getrennte Auswahl, Create-/Patch-Payload, Reload, keine Seitenfehler/kein horizontaler Überlauf. Lokaler Vite-Server mit vollständig abgefangener Fixture-API; keine echten Chats/Modelle. Screenshots `.screenshots/chat-memory-{new,existing}-{1440,390}.png`; mobile und Desktopbilder angesehen.

## Lieferung

Android-Build über android-builder erfolgreich: **1.9.5-debug / vc57**, frisches APK vom 25.10.2026 21:55:36 UTC, Builder `built` um 21:58:31 UTC. APK `/mnt/user/Zwischenspeicher/plum-1.9.5.apk`, 51’968’014 Bytes, SHA-256 `2c38f824e9e661f357cf92f97842d59b25c4292e82619f6c9a8f2dee22354ec7` stimmt mit Builderoriginal überein. Kotlin-Quell-/Buildsnapshot SHA-256 `e0c823cf1f39767a6e308dc99292683fbe619263a9e6d18284279e1c78c760a3`. Claim nach Export freigegeben. Keine Installation oder Veröffentlichung; kein nativer Laufzeit-/Screenshotnachweis für diese neuen Schalter. Kein raw adb/Gradle. Neue Flags benötigen den Backend-Rollout, bevor die APK veröffentlicht/installiert wird. Hauptrollout ist mit der separaten laufenden Schwarm-Integration abzustimmen; bisher kein paralleler Neustart ausgelöst. Keine Aussage über produktiv ausgelieferte Änderungen, solange Rollout und echte Clients nicht bestätigt sind.

Der ursprüngliche Browseraudit ist nach Nutzer-Fortsetzen wieder freigegeben. Genau ein Browserführer setzt die übrigen Kontoprüfungen fort; dessen neue Belege liegen unter `research_notes/Plum Chat Browserabschluss/`. Frühere Gesamtberichte sind Zwischenstände. Weitere bestätigte Lücken (Antwortbelege, Themenwissen, Skills/Toolrechte und übrige Arbeitsabläufe) sind damit noch nicht umgesetzt oder vollständig abgenommen.

Implementierung `5700571`; zusätzlicher Kontextfenster-Hinweis aus den tatsächlichen Chatoptionen statt fest 20 Turns: `b19e0bb`, synthetisch geprüft.

Für den abgestimmten Repair-Bot-Rollout liegt das vollständige Paket der sieben betroffenen Web-/Backend-Quelldateien unter `.probe/chat-memory-controls/source.tar`; SHA-256-Vorherstände und Paketmanifest unter `.probe/chat-memory-controls/manifest.json`. Es wurde kein Container neu gestartet und kein Produktionspfad überschrieben.
