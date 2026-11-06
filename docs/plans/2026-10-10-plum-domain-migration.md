# Domainwechsel auf plum.zwaetschge-webui.ch

Stand: 10.10.2026. Ausführbarer Migrationsplan für I15, noch nicht angewandt. Zugehöriger [Gesamtumsetzungsplan](2026-10-10-plum-integration-roadmap.md) und [Aufgabenstand](plum-assistant-todo.md).

## 1. Verbindliches Ziel

Die bestehende Installation wird unter `https://plum.zwaetschge-webui.ch` zur gemeinsamen Anwendung für Plum Chat, Plum Task und Plum Code. Es werden weder eine zweite Datenbank noch getrennte Installationen je Bereich angelegt. Der bestehende Traefik und das bestehende Authelia schützen den Webzugriff. Der vorhandene Android-JWT-Gateway bleibt erhalten.

| Zugang | Ziel | Behandlung |
| --- | --- | --- |
| Web und PWA | `https://plum.zwaetschge-webui.ch` | Authelia, danach bestehendes Plum-Konto |
| Android-REST | `https://plum.zwaetschge-webui.ch/mobile` | Plum-JWT; exakte bestehende Bootstrap-Ausnahmen |
| Android-Socket.IO | `/mobile/socket.io` auf neuem Host | JWT beim Handshake; Prefix wird am Proxy entfernt |
| Android-SSO-Übergabe | `/mobile/auth/proxy/mobile` | Authelia vor StripPrefix; PKCE-Code wie bisher |
| Erweiterung/Desktop-Begleiter | `/api/browser-bridge/ws`, hinter SSO Fallback `/mobile/api/browser-bridge/ws` | Eigener benutzergebundener, widerrufbarer Pairingtoken im ersten WebSocket-Frame |
| Geschützte Entwicklungsvorschau | `https://preview-plum.zwaetschge-webui.ch` | Authelia, bestehende Vorschauzuordnung/Ownership |
| Alte App-Adresse | `https://code.zwaetschge-webui.ch` | Zeitweise echte Aliasroute; später Redirect für Webnavigation |
| Alte Vorschau | `https://preview.code.zwaetschge-webui.ch` | Für aktive Verbindungen befristet erhalten |
| Anmeldung | `https://auth.zwaetschge-webui.ch` | Vorhandenes Portal beibehalten |

`preview-plum` wird statt `preview.plum` verwendet: Es passt unter das vorhandene Zertifikat `*.zwaetschge-webui.ch`. Veröffentlichte, fremden Nutzern zugängliche Apps werden später separat vom geschützten Dev-Preview geplant; ein Authelia-geschützter Entwicklungsrouter ist keine öffentliche Hostingplattform.

## 2. Tatsächlich geprüfter Bestand

Read-only geprüft wurden die lokale Compose-Überlagerung, selektive laufende Docker-Metadaten, relevante externe Proxy-/Authelia-Regeln, Auth-/Socket-Code, lokale DNS-Auflösung, TLS und unauthentifizierte HEAD-Anfragen. Keine Secrets werden in diesem Dokument übernommen.

| Befund | Ergebnis am Stichtag |
| --- | --- |
| Laufender WebUI-Dienst | `claude-code-webui`, Backendport 3001, Loopbackport 4545; vier Docker-Netze |
| Gemeinsames Proxy-Netz | `brian_traefik-public`; Traefik-Dockerprovider verwendet dieses Netz bereits als Standard |
| Proxy | Traefik mit Dockerprovider und Fileprovider; ACME-DNS-Challenge über Resolver `cloudflare` |
| Auth | Authelia; `authelia@file` leitet über `authelia-authz:8080` an Authelias ForwardAuth weiter |
| Cookies | Authelia-Cookiedomain `zwaetschge-webui.ch`; Plum-Browsercookie hostgebunden, Secure/HttpOnly/SameSite=Lax |
| Richtlinien | Deny für spezifische gesperrte Gruppen vor allgemeiner Two-Factor-Regel; kein globales Bypass nötig |
| Neue App-Domain | Lokale Auflösung auf `192.168.1.36`, TLS gültig; HEAD `/` liefert 404, keine Plum-Route vorhanden |
| Alte App-Domain | HEAD `/` liefert 401 mit Authelia-Location; dies ist kein angemeldeter Funktionstest |
| Verschachtelte neue Vorschau | `preview.plum.zwaetschge-webui.ch`: TLS-SNI fehlgeschlagen; wird nicht als Ziel verwendet |
| Android-App-Links | Beim Bestandsabgleich enthielt das Manifest `your-domain.example.com`; der Quellstand enthält jetzt die neue Plum-Domain. Vorhandener Custom-Scheme `claudewebui` bleibt funktionsrelevant; kein neues APK gebaut oder installiert |
| Türsteher | IP-Sperren werden automatisch erzeugt; Vertrauensliste enthält Routeridentitäten, nicht nur Hosts |

Die lokale DNS-Auflösung beweist keinen öffentlichen Cloudflare-Eintrag. Öffentliche A/AAAA-/CNAME-Auflösung, IPv6, Zugriff von ausserhalb des LAN und Zertifikaterneuerung sind beim Rollout separat zu prüfen. Die TLS-Situation von `preview-plum` wurde noch nicht live abgenommen.

Lokale Grundlagen: [Compose-Overlay](../../docker-compose.override.yml), [Backend-Konfiguration](../../packages/backend/src/config.ts), [SSO/PKCE](../../packages/backend/src/routes/auth.ts), [Mobile-Gateway](../../packages/backend/src/middleware/mobileGateway.ts), [Cookieoptionen](../../packages/backend/src/utils/sessionCookie.ts), [Android-Socketprefix](../../packages/android/app/src/main/java/com/claudewebui/app/core/network/SocketManager.kt), [Android-Manifest](../../packages/android/app/src/main/AndroidManifest.xml).

## 3. Änderungsorte und konkrete Werte

| Ort | Geplante Änderung |
| --- | --- |
| `docker-compose.override.yml` im bestehenden Projekt | Hostregeln, Origins, Frontend-URL und Vorschauhost ändern; portable Basis bleibt allgemein nutzbar |
| Deployment-`.env` | Aktive explizite URL-/Callbackwerte abgleichen; ein geänderter `WEBUI_`-Alias überstimmt kein gesetztes `FRONTEND_URL` |
| `/mnt/user/appdata/brian/traefik/config/dynamic/` | Nur nötige neue/angepasste Plum-Routen; keine breitflächige Änderung anderer Anwendungen |
| `/mnt/user/appdata/brian/authelia/config/configuration.yml` | Neue Hostabdeckung/Regelreihenfolge prüfen; bestehende Gruppensperren bewahren |
| `/mnt/user/appdata/brian/authelia-authz/nginx.conf` | Bestehende Cookiebehandlung bewahren; kein Umbau für den Domainwechsel nötig |
| DNS-Zone und LAN-DNS | App und `preview-plum` auf bestehenden Edge bringen; öffentliche und lokale Ergebnisse abgleichen |
| GitHub-/Google-Loginregistrierungen | Neue Callback-URIs registrieren, alte während laufender Authvorgänge erhalten |
| Web/PWA | Originwechsel, Login, lokale Drafts/Outbox, Serviceworker, Push und Installationsmetadaten |
| Android | Neues Serverprofil, gleiche Konto-/Instanzzuordnung, App-Links und Widgets/Push-Links |
| Browser-Erweiterung/Begleiter | Persönliche Serveradresse und WebSocket-Ziel auf neue Origin setzen; Verbindung real prüfen |
| Schwarm-Plum-Brücke | `PLUM_OEFFENTLICH=https://plum.zwaetschge-webui.ch` für erzeugte Links; native interne Endpoints getrennt halten |
| Monitoring/Handbuch/QR-Codes | Sichtbare kanonische Adresse ersetzen; QR-Neuerstellung erst mit funktionierendem Ziel |

Kanonische Zielwerte:

```dotenv
FRONTEND_URL=https://plum.zwaetschge-webui.ch
CORS_ALLOWED_ORIGINS=https://plum.zwaetschge-webui.ch,https://code.zwaetschge-webui.ch,http://localhost:4545
PREVIEW_HOSTNAME=preview-plum.zwaetschge-webui.ch
PROXY_AUTH_ENABLED=true
GITHUB_CALLBACK_URL=https://plum.zwaetschge-webui.ch/auth/github/callback
GOOGLE_CALLBACK_URL=https://plum.zwaetschge-webui.ch/auth/google/callback
```

Die alte Origin ist nur für das Übergangsfenster vorgesehen. Auth-Secrets, JWT-Key, Verschlüsselungsschlüssel, Providerhomes, Datenpfade und DB-Namen werden durch einen Domainwechsel nicht rotiert. Damit bleiben gespeicherte Providerzugänge und der Rückweg erhalten. GitHub-/Google-Callbacks werden nur benötigt, soweit der jeweilige Login weiterhin aktiviert ist.

## 4. Traefik-Routervertrag

Router-/Servicenamen `plumcode`, `plumcode-mobile`, `plumcode-mobile-auth` und `plumpreview` werden intern zunächst behalten. Dadurch bleibt die Türsteher-Zuordnung nachvollziehbar; sichtbares Branding hängt nicht vom internen Dockerlabel ab. Die späteren drei Bereiche sind URL-Pfade derselben Origin.

| Router | Host/Path | Priorität | Middlewarefolge | Backend |
| --- | --- | --- | --- | --- |
| `plumcode` | Neuer und vorübergehend alter App-Host | Explizit 100 | `authelia@file`, `security-headers@file` | `plumcode:3001` |
| `plumcode-mobile` | Beide App-Hosts und exakt `/mobile` oder Prefix `/mobile/` | 200 | StripPrefix, Marker, Security-Headers | `plumcode:3001` |
| `plumcode-mobile-auth` | Beide App-Hosts und exakt `/mobile/auth/proxy/mobile` | 210 | Authelia, StripPrefix, Marker, Security-Headers | `plumcode:3001` |
| `plumpreview` | Neuer Vorschauhost; alte Vorschau während Übergang | Explizit 100 | Authelia, Security-Headers | Derselbe Backend-Vhost |

Der folgende Ausschnitt beschreibt den geplanten Patch, keine vollständige Compose-Datei und keine angewandte Änderung:

```yaml
labels:
  - 'traefik.docker.network=brian_traefik-public'
  - 'traefik.http.routers.plumcode.rule=Host(`plum.zwaetschge-webui.ch`) || Host(`code.zwaetschge-webui.ch`)'
  - 'traefik.http.routers.plumcode.priority=100'
  - 'traefik.http.routers.plumcode.middlewares=authelia@file,security-headers@file'
  - 'traefik.http.routers.plumcode-mobile.rule=(Host(`plum.zwaetschge-webui.ch`) || Host(`code.zwaetschge-webui.ch`)) && (Path(`/mobile`) || PathPrefix(`/mobile/`))'
  - 'traefik.http.routers.plumcode-mobile.priority=200'
  - 'traefik.http.routers.plumcode-mobile-auth.rule=(Host(`plum.zwaetschge-webui.ch`) || Host(`code.zwaetschge-webui.ch`)) && Path(`/mobile/auth/proxy/mobile`)'
  - 'traefik.http.routers.plumcode-mobile-auth.priority=210'
  - 'traefik.http.routers.plumpreview.rule=Host(`preview-plum.zwaetschge-webui.ch`) || Host(`preview.code.zwaetschge-webui.ch`)'
  - 'traefik.http.routers.plumpreview.priority=100'
```

Die bestehende `websecure`-/TLS-/Resolver-/Servicezuordnung sowie die vollständigen Mobile-Middlewarefolgen aus dem Overlay bleiben Teil des Patches. Besonders der Mobile-Router erhält weiterhin **keine** Authelia-Middleware; mobile REST-Aufrufe werden im vorhandenen Plum-JWT-Middlewarepfad geschützt und Socket.IO prüft seinen Handshake. Die rohe Browser-Bridge-WebSocket-Verbindung verwendet dagegen ihren eigenen Pairingtoken, nicht diesen REST-Middlewarepfad. Die Route zur PKCE-Übergabe bleibt separat geschützt. JWT-Prüfung, Besitzrechte und beide Socket-Authwege sind Pflichtabnahmen.

Der Marker `X-Plum-Mobile-Gateway` und sämtliche behaupteten Identity-Header müssen am Edge definiert behandelt werden. Für normale Webrouten wird ein vom Client gelieferter Mobile-Marker entfernt; für Mobile setzt Traefik den Marker selbst. `Remote-*` darf ausschliesslich aus erfolgreicher Auth stammen. Ein unauthentifizierter mobiler Aufruf von `/auth/proxy` darf kein Webkonto erzeugen. Diese Prüfungen sichern die tatsächliche vorhandene Trennung; sie sind kein Anlass für ein neues Loginframework.

Traefik nutzt bereits das gewünschte Docker-Netz. Das zusätzliche Label macht die Wahl am konkreten Multi-Netz-Backend explizit. `PROXY_AUTH_TRUSTED_IPS=private` ist aktueller Bestand, keine präzise Aussage über ausschliessliches Traefikvertrauen. Engere Proxyadressen werden nur mit stabiler Adressierung eingeführt; eine volatile Container-IP darf keinen späteren Login-Ausfall erzeugen. Die tatsächliche Peerkontrolle aus `auth.ts` bleibt erhalten.

## 5. Authelia und Sitzungskontinuität

Die vorhandene parent-domain Cookiekonfiguration passt zur neuen App-Adresse. Das Authportal und die Defaults anderer Anwendungen bleiben unverändert. Neue spezifische Zwei-Faktor-Regeln dürfen nicht vor den bestehenden `deny`-Regeln für gesperrte Gruppen platziert werden. Für `preview-plum` wird dieselbe Schutzwirkung explizit geprüft. Globale Bypass-Ausnahmen sind nicht erforderlich.

Die vorhandene Middleware läuft über den Authz-Nginx, der Set-Cookie-Ausgaben nach Authstatus behandelt. Diesen bestehenden Integrationspfad beibehalten; nicht parallel eine zweite anders konfigurierte ForwardAuth-Middleware einführen. Die Herstellerintegration beschreibt ForwardAuth und Identity-Header; die konkrete lokale Konfiguration hat zusätzlich diesen Authz-Proxy. ([Authelia-Traefik-Integration](https://www.authelia.com/integration/proxies/traefik/), [Traefik ForwardAuth](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/forwardauth/))

Authelia-SSO kann domainübergreifend weiterwirken; Plums hostgebundener Cookie und Browserstorage wandern dadurch nicht automatisch. Die neue Origin erhält eine neue Plum-Anmeldung auf dasselbe bestehende Benutzerkonto. Keine Tokenkopie per Queryparameter als allgemeine Domain-Migration. Kontozuordnung über stabile User-ID/E-Mail prüfen; keine zweite Supervisoridentität erzeugen.

## 6. WebSockets, Streams, Vorschau und interne Dienste

Web verwendet `/socket.io`, Android `/mobile/socket.io`; beide müssen Polling, Upgrade, Auth und Reconnect durchlaufen. SSE unter dem vorhandenen Gateway wird ohne Antwortpufferung geprüft. ForwardAuth darf keine Requestbody-Weitergabe erzwingen, die Streaming verändert; Traefik dokumentiert diese Einschränkung ausdrücklich. ([ForwardAuth](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/forwardauth/))

Die Browser-Erweiterung und der Desktop-Begleiter haben einen zusätzlichen rohen WebSocket: `/api/browser-bridge/ws`, mit automatischem Fallback über `/mobile/api/browser-bridge/ws` hinter Authelia. Nach StripPrefix authentifiziert [die Bridge](../../packages/backend/src/services/browserBridge/bridge.ts) den ersten `hello`-Frame mit einem benutzergebundenen Pairingtoken; fehlender/ungültiger oder widerrufener Token wird abgewiesen. Dies ist vom Android-JWT-/Socket.IO-Vertrag getrennt. Fallback, Reconnect und Widerruf müssen auf der neuen Domain geprüft werden; Token bleiben aus URL und Zugriffslogs heraus. Die eigentliche Chatansicht der Erweiterung behält ihren normalen Weblogin.

Der Backend-Vhost kennt aktuell einen `PREVIEW_HOSTNAME`. Die geplante befristete Aliasunterstützung muss deshalb im Code ergänzt werden: validierte Liste zusätzlicher Vorschauhosts, dieselbe Ownership-Prüfung, eigener Cookiebootstrap pro Host und keine Annahme, dass ein zweites Proxylabel alleine reicht. Bis diese Unterstützung fertig ist, bleibt die alte Vorschau kanonisch; der App-Domainwechsel ist davon nicht blockiert. Neue Vorschau nach echtem HTTP-/Dev-WebSocket-Test umschalten.

MCP-internes HTTP, Hook-Secret, Session-ID, Modelrouter, Builder-, Vocarium- und ComfyUI-Adressen bleiben interne Verbindungen. Sie werden nicht unnötig über die neue öffentliche Authelia-Adresse geführt. Öffentlich gespeicherte Links und die Erweiterungs-/Companionadresse ändern sich dagegen tatsächlich.

## 7. Origin- und Gerätemigration

Quellergänzung vom 11.10.2026: Die staged Compose-Datei enthält zusätzlich die genau begrenzte anonyme Route `Host(plum.zwaetschge-webui.ch) && PathPrefix(/published/)`. Das Backend liefert dort nur explizit veröffentlichte immutable HTML-Snapshots und opake Offline-Iframes; weder allgemeine API noch Authzustand oder Appzustands-/Taskbrücken werden freigegeben. `PLUM_PUBLICATIONS_ENABLED` bleibt standardmässig `false`. Vor einer späteren Aktivierung sind ein anonymer Abruf, Widerruf/Ablauf, CSP und die unverändert geschützte Hauptapp über den echten Edge zu prüfen. Migration `012-assistant-publications` und produktive Veröffentlichungen wurden nicht ausgeführt. Der Office-Bootstrap bleibt der separat im Override definierte eng begrenzte Capabilityweg.

| Zustand | Behandlung |
| --- | --- |
| Serverseitige Gespräche, Projekte, Uploads, Profile, Tasks | Gleiche DB und Besitzer; kein Umzug allein wegen Domain |
| Webdrafts | Serverseitig gespiegelte Fassung nach neuer Anmeldung; zusätzlich noch nicht synchronisierte lokale Fassung von alter Origin ausdrücklich übertragen/exportieren |
| Browser-Outbox | Lokale Nachrichten und fertige Uploadreferenzen vor Stilllegung abgleichen; derselbe `clientMessageId` bleibt beim Retry erhalten |
| Browserstorage | Nicht automatisch zwischen Origins lesbar; kleiner Export/Import mit Instanz-/Kontoabgleich, Konfliktanzeige und ohne Credentials |
| PWA und Webpush | Neue Installation/Subscription für neue Origin; bestehende VAPID-Schlüssel können bleiben, Subscription-Endpunkte sind trotzdem neu |
| Android-Serverprofil | Nur bekannte alte Plum-Adresse umstellen; Konto/Installation prüfen, dann Tokenvalidierung oder erneuter PKCE-Login |
| Android-Room/Drafts/Outbox | Bestehende Daten nicht löschen; URLscopes kontrolliert auf dieselbe Installation abbilden, offene Sends nicht doppelt abschicken |
| HTTPS-App-Links | Echten neuen Host statt Platzhalter eintragen; `assetlinks.json` mit tatsächlichem APK-Signaturfingerprint |
| Custom-Scheme | `claudewebui://` während Migration weiter akzeptieren; Markenrename nicht mit Auth-Rückweg brechen |
| Widgets/Push/QR/Shortcuts | Ziele auf neue Adresse und stabile Objektkennungen umstellen |

Falls noch keine stabile Installationskennung existiert, ist ein persistierter, nicht geheimer Installations-Identifier als kleiner Migrationsbaustein vorgesehen. Er ersetzt keine Authentifizierung. App-Link-Nachweis darf als exakt begrenzte öffentliche `/.well-known/assetlinks.json`-Route ausgeliefert werden; kein genereller `/.well-known`-Bypass. Firmen-/Debug-/Release-Signaturen werden nicht geraten.

## 8. Gestaffelter Rollout

| Schritt | Ausführung | Abschlussbeleg |
| --- | --- | --- |
| D01 Bestand sichern | Operatorpfade/Overlay, Proxyregeln, DB-Dump, Image-ID und Origins sichern; aktive Turns und mobile Versionen erfassen | Backup und Restoreliste lesbar; keine Secretwerte im Bericht |
| D02 neue Hosts vorbereiten | Öffentliches/LAN-DNS und Zertifikate prüfen, Autheliaabdeckung ergänzen soweit nötig | Neuer Host erreichbar; Schutz greift; keine fremde Route überschrieben |
| D03 Aliasrouter ausrollen | Neue und alte App-Origin auf dasselbe Backend, bestehende Routennamen und Mobileprioritäten erhalten; Backend zunächst noch alte kanonische URL | HTTP, Authredirect und JWT-Routen erreichen richtigen Dienst |
| D04 neue Origin kanonisch machen | Callbacks registrieren; `FRONTEND_URL`, CORS und neue erzeugte Links umstellen; neue Anmeldung auf vorhandenes Konto | Weblogin, OAuth soweit aktiv und Android-PKCE auf neuer Origin |
| D05 Clients und Vorschau migrieren | Browserstorage/Outbox, PWA/Push, Androidprofile, Brücke, Begleiter und Vorschaualias umstellen | Geräte-/Reconnect-/Upload-/Vorschaubelege ohne Datenverlust |
| D06 Althost schrittweise abbauen | Zuerst Webnavigation umleiten; API, `/mobile`, Socket, alte Callbacks und aktive Vorschau noch bedienen | Keine relevanten alten Aufrufe in redigierten Logs; keine offenen Originmigrationen |
| D07 Abschluss | Alte Origins/Callbacks/Aliasregeln nur nach abgeschlossener Clientmigration entfernen; alte Weblinks langfristig weiterleiten | Alle Abnahmen bestanden; dokumentierter Rückweg bleibt möglich |

Backend-/Image-Releases laufen ausschliesslich über `bash scripts/plum-rebuild.sh` beziehungsweise den bestehenden `repair-bot`. Traefik-Fileprovideränderungen und Authelia-Konfigurationsvalidierung werden getrennt als Operatoraktionen ausgeführt. Kein inner-container `compose build` plus Selbst-Recreate. DB-Migrationen bleiben additiv und erfolgen in dem bestehenden nummerierten Migrationssystem.

Althost-Weiterleitungen dürfen keinen pauschalen Redirect von POST, WebSockets, OAuthcallbacks oder mobilen APIs erzeugen. Zuerst 302 für tatsächliche Webnavigation; dauerhafte Redirects erst nach belegter Migration. Eine ggf. verwendete Traefik-RedirectRegex muss Compose-Escaping (`$${1}`) und Pfad-/Queryerhalt berücksichtigen. ([RedirectRegex](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/redirectregex/))

## 9. Echte Abnahme

- Neues Weblogin mit Authelia/2FA, bestehendes Konto, Logout und gesperrter Benutzer.
- Unangemeldetes HTML/API hinter Webrouter geschützt; gefälschte Identity-Header erzeugen keine Anmeldung.
- Android-Bootstrap über Authelia/PKCE; `/mobile/api/sessions` ohne JWT abgewiesen, mit gültigem JWT nur eigene Daten.
- Web- und Android-Socketupgrade, Folgefrage, Stoppen und Reconnect mit korrektem Thread und Cursor.
- Upload, generiertes Bild, PDF, Audio/OmniVoice und bestehende Browser-/Gerätewerkzeuge auf neuer Origin.
- Vorschauauth, Eigentümerprüfung, Dev-WebSocket und keine Verwechslung mit normalem App-HTML.
- Browser-Outbox/Drafts, PWA/Webpush und Androidcache nach Domainwechsel erhalten.
- App-Link-Nachweis, Widgets/Benachrichtigungsziele und Erweiterungsreconnect auf realem Gerät.
- Browser-/Begleiter-Bridge direkt und über Mobile-Fallback: ohne Pairingtoken abgewiesen, mit gültigem Token richtiges Konto, Widerruf beendet bestehende Verbindung.
- Alte Weblinks und noch benötigte alte APIs funktionieren im Übergangsfenster.
- Public-DNS/IPv6 und externer Zugriff separat geprüft; lokale Auflösung reicht nicht als Abschluss.

## 10. Rückweg

Alte Hostregeln, kanonische URL, Origins und Previewkonfiguration werden aus dem gesicherten Stand wieder aktiviert; neue DB-Daten bleiben in derselben DB. Neue Auth-/Provider-Secrets sind für diesen Rückweg nicht erforderlich. Bei einem Imagefehler übernimmt der Repair-Bot den geschützten vorherigen Image-Stand. Bei einem reinen Edgefehler werden nur die betreffenden Router-/Authregeln zurückgesetzt, keine Gespräche oder neu erzeugten Ergebnisse gelöscht.

Die Abschaltung der alten Origin erfolgt anhand tatsächlich verbleibender Clients und Outbox-Daten, nicht nach einer erfundenen Kalenderfrist. Laufende Providerprozesse können bei einem Backend-Rebuild unterbrochen werden; daher aktive Turns vor dem jeweiligen Release auslaufen lassen oder als unterbrochen mit ehrlicher Wiederaufnahme behandeln.

## 11. Status

Der Plan und sein read-only Bestandsabgleich sind abgeschlossen. Inzwischen sind Domain-Compose-Overlay, Callback-/Origin-Übergang, Preview-Alias, App-Link-Route und Androidmanifest im Quellcode vorbereitet. DNS, laufende Traefik-/Authelia-Konfiguration, Container und externe Callbackregistrierungen bleiben unverändert. Kein Rebuild, Redeploy oder APK-Wechsel wurde ausgeführt. Benutzerbezogene SSO-, JWT-, Push-, WebSocket- und Geräteabnahmen bleiben für I15 offen.
