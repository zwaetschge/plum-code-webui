# Native Schwarmfunktionen in der Plum-App

Dieses Android-Library-Modul übernimmt den vollständigen Client-Quellstand 2.10.1
in dieselbe Plum-APK. `SOURCE.json` verzeichnet die Originaldateien und SHA-256.
Es gibt keine zweite Application, keinen eigenen Launcher, keine übernommenen
Signierschlüssel und keinen Installationspfad für Schwarm-APKs.

Plum initialisiert `SwarmIntegration` und öffnet die eingebettete Activity über
„Alle Schwarmfunktionen“. Widgets, Share-Ziel, Pushreceiver, Hintergrundprüfung,
Freigabe-/Antwortaktionen und Not-Aus-Kachel werden durch Manifest-Merging in
Plum registriert. Ressourcen haben den Präfix `swarm_`; Paket/Namespace sind
`com.claudewebui.swarm`. Die bestehenden Matrix-Event-, Account-Data- und
Befehlskennungen bleiben für die native Kompatibilität unverändert.

Der Not-Aus-Schlüssel und Endpunktcache werden auch vom kompakten Plum-Einstieg
verwendet. Androids privater Speicher der bisherigen separaten Schwarm-App wird
nicht kopiert: Anmeldung, Pushendpoint und Not-Aus-Registrierung erfolgen für die
Plum-Installation neu. Die eingebettete Matrix-Verbindung hat ihren eigenen
verschlüsselten Gerätezugang; die im Backend verbundenen und nativ angemeldeten
Identitäten werden sichtbar angezeigt und dürfen nicht stillschweigend
vertauscht werden. Native Stimmwahl und Stückausgabe verwenden den bestehenden
Hubvertrag, dessen Stimmenservice ausschliesslich OmniVoice zulässt.

Plums `AppUpdateChecker` ist der einzige APK-Updateweg. Native Schwarm-Releases
werden nicht als Plum-Update angeboten. Sensible native Sitzungen, Offlinecache
und Absturzdateien sind von Cloudbackup und Gerätetransfer ausgeschlossen.

Noch keine Android-Kompilierung, Manifest-Merge-Abnahme oder Geräteprüfung: Auf
Wunsch sind Builds zurückgestellt. Beim späteren Builder-Sync auch `swarm/`,
Settings, Root-Builddatei und Versionskatalog kopieren; der bisherige reine
`app/src`-Sync reicht für dieses Modul nicht. JVM-/Instrumentierungstests und
S01–S37 auf dem ausgewählten Gerät sind vor der App-Ablösung erforderlich.
