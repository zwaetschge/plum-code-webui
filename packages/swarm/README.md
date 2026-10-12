# Native Schwarm-Koordination in Plum

Quellübernahme des bestehenden Schwarm-Hubs mit unverändertem Matrix-/Workervertrag. Brian/Hermes, Trader, Phone und andere Worker behalten ihre native Identität und Laufzeit. `SOURCE.json` dokumentiert die übernommenen Quellstände. Geheimnisse, Agentenkonfiguration und Daten werden nicht in dieses Paket kopiert.

Der Prozess bleibt standardmässig aus. Der bestehende Hub arbeitet weiter, bis die spätere Übernahme ausdrücklich konfiguriert wird. `PLUM_SWARM_COORDINATOR_ENABLED=true`, `PLUM_SWARM_ENV_FILE` und `PLUM_SWARM_LEGACY_CONTAINER` sind Voraussetzungen. Der tatsächliche alte Docker-Prozess muss gestoppt sein. Ein reservierter PostgreSQL-Advisory-Lock verhindert mehrere Plum-Koordinatoren; ein Monitor beendet den neuen Prozess bei wieder gestarteter Legacy-Instanz oder verlorener Datenbankverbindung.

Die vorhandene native `swarm`-Datenbankrolle, Migrationshistorie, Agenten- und Raumdateien, Appserviceidentität und Worker-URLs bleiben erhalten. Der native Listener bleibt ein internes Interface. Am bisherigen Hub-Endpunkt wird beim späteren Rollout der Plum-Prozess angeschlossen, damit Worker und Synapse ihre Ziele behalten. Traefik und Authelia schützen die Benutzeroberfläche, nicht diese internen Workerprotokolle.

Das Paket umfasst Inbox/Outbox, Auftragsbroker, Worker-Leases, Freigaben, Rat, Routinen/Abläufe, Alarme, Gedächtnis, Modelle/Stimmen, signierten Not-Aus, Push, Rollen, Berichte und Wartung. Die Quellübernahme ersetzt keine Abnahme des Umschaltens oder der Android-Funktionsparität. Laufende produktive Dienste und ihre Schemahistorie wurden während der Implementierung nicht verändert.

`pnpm --filter @plum-code-webui/swarm test` setzt über den eigenen Runner feste Unit-Testwerte. Datenbank/Homeserver verweisen auf einen nicht erreichbaren lokalen Fixtureport; native Tokens werden nicht geerbt. Diese übernommenen Tests prüfen reine Hilfs-/Protokollfunktionen ohne Datenbank und Netz. Tatsächliche Koordinator-/Worker-E2E-Abnahmen bleiben davon getrennt.
