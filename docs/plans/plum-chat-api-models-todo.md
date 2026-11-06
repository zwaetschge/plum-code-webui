# Plum Chat: getrennte API-Modelle

- [x] Bestehende Chat-Auswahl, Transport und verschlüsselte Provider-Ablage prüfen.
- [x] Anthropic-Schlüssel verschlüsselt einrichten und verfügbare Modelle direkt prüfen.
- [x] Mistral, DeepSeek und GLM 5.3 über die vorhandenen Verbindungen prüfen.
- [x] Chat auf API-Zugänge beschränken; Reihenfolge Anthropic, Mistral, DeepSeek, GLM, weitere APIs.
- [x] Task/Code-CLI-Auswahl und bestehende Verläufe erhalten.
- [x] Streaming, Personalisierung und Desktop-/Mobil-Auswahl testen.
- [x] Backend rebuilt/deployed; vier echte temporäre API-Gespräche erfolgreich, CLI-Chat-Erstellung serverseitig abgelehnt, Desktop/Mobil live geprüft.
- [x] Aktualisierte APK 1.6.8 nach Zwischenspeicher liefern und SHA-256 abgleichen.
- [x] Android-Navigation überarbeiten: getrennte Chat-/Task-/Code-Einstiege, keine überlappenden Tabs, korrekte Session-Zuordnung.
- [x] Android-Personalisierung mit lesbaren Überschriften und bedienbaren API-Modelloptionen korrigieren.
- [x] Native Ansichten im ausdrücklich gewählten Emulator mit grosser Schrift, hellem/dunklem Thema und einem vollständigen Chat prüfen.

Der genannte monatliche Anthropic-Kredit beträgt 200 USD. Das ist eine vom Benutzer angegebene Kreditgrösse, kein von Plum bestätigter Kontostand.

Kataloge direkt am jeweiligen Konto geprüft. Standard: Claude Sonnet 5.5; Mistral Large 4; DeepSeek Flash; GLM 5.3. Mistral benötigt zusätzlich die getestete Stream-Parserkorrektur für gemischte Textblöcke. Live-Verifikation aller vier Anbieter bestanden. Android-Navigation und WebView-Viewport sind korrigiert und im Emulator geprüft.

Zusätzlicher Android-Befund: Room SessionEntity hat surface bisher verworfen. Migration 8 → 9 ergänzt die Zuordnung, ohne Verläufe/Entwürfe/Outbox zu löschen. Native Task- und Code-Listen und Zähler werden bereichsweise gefiltert.

Abgeschlossen am 12. Oktober 2026: APK 1.6.8 im Unraid-Share, SHA-256 gegen Build-Artefakt geprüft. Fünf Emulator-Prüfungen bestanden: Navigation 100/200 % in hell/dunkel, native Task-/Code-Listen, Personalisierung speichern, Room-Verlaufserhalt sowie API-Chat senden/Antwort anzeigen/zu Task und Code wechseln. Chat-Abnahme ohne Test-CSS-Override. Der 0-Pixel-WebView-Container nutzt jetzt gemessene CSS-Pixel und aktualisiert sich bei Grössenänderungen.

Nachweise: `reports/plum-android-emulator-verification-2026-10-11.json`, `reports/plum-android-1.6.8-native-navigation-build-2026-10-11.json`. Physische Geräte wurden nicht installiert/getestet.
