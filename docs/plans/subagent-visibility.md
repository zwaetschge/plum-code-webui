# Verlässliche Subagenten-Anzeige

Stand: 2026-09-21. Implementiert; Prüf- und Auslieferungsstand siehe `reviews/subagent-visibility/verification.md`.

## Gewünschtes Ergebnis

In jeder Session ist ohne Suchen erkennbar, wie viele Subagenten gerade arbeiten oder warten, welchen Auftrag jeder hat, was zuletzt tatsächlich beobachtet wurde und welche Ergebnisse vorliegen. Das bleibt während der Antwort des Hauptagenten, nach Neuladen, bei Reconnect und bei Hintergrundarbeit nachvollziehbar. WebUI und Android erhalten dieselbe Bedeutung der Zähler und Zustände.

## Im aktuellen Code belegte Probleme

- `components/session/RunCockpit.tsx`: `activeAgents.length || agents.length` lässt den Zähler bei null aktiven Agenten auf die historische Gesamtzahl umspringen. Die Liste endet bei zehn Einträgen ohne vollständige aktive Übersicht. Konfigurierte CLI-Delegationsziele stehen im selben Abschnitt wie echte Ausführungen.
- `pages/SessionPage.tsx`: Die Agenten-Kurzanzeige hängt am Chat-Footer und verschwindet bei vorhandenem Streaming-Text. Laufende Arbeit ist dadurch nicht dauerhaft sichtbar.
- `ClaudeProcessManager.ts`: Trim und Runtime-Snapshot begrenzen auf insgesamt 30 Einträge, inklusive aktiver Runs. Mehr als 30 aktive Runs können damit verloren gehen.
- `findSubagentRun`: Auch nach erfolgloser Suche mit expliziter ID fällt die Zuordnung auf den jüngsten aktiven Agenten zurück. Das kann den falschen Agenten abschliessen.
- Codex MCP-Übersetzung: Das Ende von `wait_agent` wird als erfolgreicher Abschluss der Zielagenten behandelt, ohne deren Rückgabestatus auszuwerten. Ein abgelaufener Wait ist kein erfolgreicher Agentenabschluss.
- `SubagentRun` kennt bisher nur started/completed/error. Aktuelle Tätigkeit, Modell, Elternbeziehung, Chat-/Turn-Zuordnung und letzte Aktualisierung fehlen. Provider wird vom Hauptprozess übernommen; bei gemischten CLI-Subagenten muss stattdessen der tatsächliche Worker angegeben werden.
- Das Socket-Ereignis überträgt vorhandene Provider-/Background-Metadaten nicht. Der Web-Store übernimmt Provider nur aus bereits bekannten Runs.
- Web-Store und Session-Hydration verschmelzen Listen; leere Runtime-Snapshots werden teilweise übersprungen. Das ist kein verlässlicher Abgleich verschwundener/überholter Runs.
- Android `AgentEvent` enthält keine Run-ID; `SessionRuntime` enthält keine Subagenten-Liste. `ChatStreamingController.onAgentEvent` verwendet einen einzigen StreamingState.AgentRunning. Ein Abschluss setzt diesen auf Idle, auch wenn andere Agenten weiterarbeiten. Die vorhandene Chat-AgentCard ist nicht im Chat eingebunden.

Diese Befunde stammen aus Quellcodeprüfung, nicht aus einer aufgezeichneten Live-Reproduktion der gemeldeten Session.

## Oberfläche und klare Begriffe

### Kompakte Übersicht

Rechte Session-Navigation: **Subagenten · 4 aktiv** mit Aufteilung **3 arbeiten · 1 wartet**. Hauptagent separat, nicht in diesen vier mitzählen. Der Einstieg bleibt auch während Streaming sichtbar. Nach Abschluss steht explizit **0 aktiv**; kein Ersatz durch die Gesamtzahl.

Ein kurzer Statusstreifen im Chat-Arbeitsbereich informiert über laufende Subagenten und öffnet die Übersicht. Er enthält keine zusätzlichen Session-Steuerungen im Chat-Header und verdeckt weder Composer noch Nachrichten. Er erscheint bei laufender/unklarer Arbeit oder erforderlicher Aufmerksamkeit, nicht dauerhaft als leere Dekoration.

### Agentenpanel

Eigenes dockbares Session-Panel rechts; im schmalen Web-Layout über die Session-Sheet erreichbar. Android erhält denselben Einstieg in den Chat-Werkzeugen mit aktiver Anzahl und eine Bottom-Sheet beziehungsweise ein breiteres Seitenpanel.

Pro Run eine kompakte Zeile/Karte:

| Feld | Beispiel |
| --- | --- |
| Name/Rolle | API-Prüfung · Agent 2 |
| Auftrag | Fehlerbehandlung der Login-Routen prüfen |
| Zustand | Arbeitet |
| Beobachtete Tätigkeit | Liest cli-login.ts |
| Herkunft | Z.AI · glm-5.3, sofern tatsächlich gemeldet |
| Zeit | Seit 02:14 · letzte Aktivität vor 8 s |
| Kennzeichnung | Hintergrund, falls entkoppelt |

Klick öffnet Auftrag, zeitlichen Tätigkeitsverlauf, zugeordnete Tool-Aufrufe, Ergebnis oder Fehlermeldung. Keine Prompt-/Output-Volltexte unkontrolliert in den schmalen Zeilen. Keine frei erfundenen Fortschrittsprozente oder Restzeiten. Token/Kosten erst anzeigen, wenn diesem Run sicher zuordenbar.

Sortierung: zuerst erforderliche Eingaben/Fehlerhinweise, dann aktive Runs in stabiler Startreihenfolge; abgeschlossene Runs einklappbar. Alle aktiven Runs erreichbar, bei grossen Listen virtualisiert. Abgeschlossene Historie paginiert. Optional nach aktuellem Auftrag/Turn oder gesamtem Chat filtern; aktuell laufende Hintergrundagenten aus früheren Turns bleiben sichtbar und tragen einen Hinweis. Ein einfacher Filter statt neuer Baum-/Graphansicht; Elternbeziehungen in Details zeigen.

Konfigurierte CLI-Subagenten bleiben bei Runtime/Einstellungen und heissen dort **Verfügbare CLI-Subagenten**. Die Ausführungsübersicht zählt ausschliesslich gestartete Runs.

## Zustände und Zählregeln

Lebenszyklus: queued, running, completed, failed, cancelled, interrupted. Tätigkeit innerhalb running separat: starting, working, waiting; Wartegrund nur bei belegtem Ereignis, etwa Freigabe, Nutzereingabe oder Abhängigkeit. Datenqualität/Verbindung separat: live, stale, unknown.

- **Aktiv** = bekannte running-Runs; Unterteilung in arbeitet/startet/wartet, ohne Doppelzählung.
- Queue, fertig, fehlgeschlagen, abgebrochen und unterbrochen separat zählen.
- Konfigurierte Worker, Hauptagent und historische Tool-Aufrufe niemals als aktive Runs zählen.
- Bei verlorener Verbindung: „Zuletzt 4 aktiv · Verbindung unterbrochen“ statt behaupteter Echtzeit.
- Fehlende neue Ereignisse allein bedeuten weder Stillstand noch Fehler. „Keine neue Aktivitätsmeldung seit …“ bleibt eine Beobachtung.
- Ein Hintergrundagent kann bei idle Hauptagent weiterlaufen. Hintergrundzählung darf den Composer nicht fälschlich blockieren.
- Prozessende ohne bestätigtes Ergebnis ist interrupted/unknown, niemals automatisch completed.

## Datenfluss und Umsetzung

### 1. Run-Zustand und Provider-Ereignisse korrigieren

Gemeinsamer Vertrag in `packages/shared/src/types/session.ts` und `websocket.ts`: stabile Run-ID, Session-/Chat-/Turn-ID, optional parentRunId, tatsächlicher Worker-Provider/Modell, Name/Auftrag, Lebenszyklus, Tätigkeit/Wartegrund, Zeitstempel, Background und monotone Revision/Eventfolge. Optionales Modell nicht vom Hauptagenten erfinden. Ein Agent kann mehrere Aufträge abarbeiten: Agent-Identität und Ausführungs-ID getrennt führen, damit Wiederverwendung keinen abgeschlossenen Run wiederbelebt.

In `ClaudeProcessManager.ts` Start, Fortschritt und Ende vereinheitlichen. Explizite unbekannte IDs dürfen nie auf einen anderen Agenten fallen. Aktive Runs nicht mit dem Historienlimit abschneiden. Start-Acknowledgement und Wait-Timeout nicht mit Abschluss verwechseln. Kind-Tool-Events anhand realer Parent-/Agent-IDs zuordnen; ohne Zuordnung keine Tätigkeiten anderer Agenten übernehmen.

Provider zuerst dort vollständig anbinden, wo die Nutzung liegt: Claude/Z.AI inklusive Hintergrund-/Workflow-Ereignissen, Codex inklusive Spawn/Wait/Close/Follow-up und die gemischten CLI-Subagenten. In `scripts/mcp-servers/subagents.mjs` eigene Start-/End-/Fehler-/Timeout-Meldungen mit Run-ID und echtem Worker-Provider liefern. Die Startmeldung muss vor dem Warten auf runChild sichtbar werden. Falls ein CLI keine Kind-Tool-Ereignisse liefert, ehrlich nur Auftrag, Laufstatus und Ergebnis anzeigen. OpenCode/Pi/Kimi gegen tatsächliche Payloads prüfen und denselben Vertrag bedienen, ohne nicht vorhandene Details zu versprechen.

Socket-Ereignisse und REST-/Reconnect-Snapshots erhalten dieselben Metadaten. Neue Felder zunächst additiv; neue Zustände mit Legacy-Abbildung für ältere Clients einführen, damit Android-Enums nicht an unbekannten Werten scheitern.

### 2. Reload, Reconnect und Historie verlässlich machen

Eine Run-Map pro Session/Chat mit derselben Zustandslogik in Web und Android. Einzelereignisse idempotent anhand Run-ID + Revision anwenden; ältere started-Ereignisse dürfen completed nicht überschreiben. Ein vollständiger Snapshot hat Scope, Generation und Revisionsgrenze und ersetzt den bestätigten Stand dieses Scopes; er darf nach seinem Snapshot neu eingetroffene Events nicht löschen. Leere bestätigte Snapshots behandeln, statt zu überspringen.

Vorhandenes dauerhaftes Session-Eventlog auf Agenten-Replay prüfen und nutzen. Falls Run-Zustand nach Backend-Neustart daraus nicht zuverlässig rekonstruierbar ist, eine kleine persistente Run-Projektion ergänzen. Keine zweite Event-Infrastruktur. Historie bleibt sichtbar; vor dem Neustart aktive Runs werden nur nach Provider-Abgleich wieder als aktiv bestätigt, sonst als unterbrochen/unklar markiert. Abfragen und Replay immer nach Eigentümer, Session und Chat abgrenzen.

Zählwerte aus derselben normalisierten Run-Menge ableiten. Beim paginierten Verlauf serverseitige Summen getrennt von der sichtbaren Seite übertragen. Keine Zähler aus der auf zehn/30 Karten gekürzten Liste ableiten.

### 3. Web und Android gemeinsam ausliefern

Web: `sessionStore.ts`, `SessionPage.tsx`, `RunCockpit.tsx`; eigenständige wiederverwendbare Agentenliste samt Detailansicht. Im bestehenden `panelDockStore.ts` Panel-Key plus beide Default-Maps, Metadaten, Render-Zweig und mobile Session-Sheet ergänzen. Den bisherigen Run-Cockpit-Abschnitt mit derselben Datenquelle betreiben, nicht parallel eigene Zählregeln entwickeln.

Android: `AgentEvent`, `SessionRuntime`, eigener Agenten-Run-State statt einzigem StreamingState; `ChatStreamingController`/`ChatSocketBinder` und Reconnect-Hydration aktualisieren. Bestehende AgentCard passend erweitern und tatsächlich einbinden. Lokalisierte Ressourcen und PlumTheme-Tokens verwenden. Hauptantwort-Streaming und Agentenstatus unabhängig halten.

Visuell kompakt im vorhandenen Design bleiben: lesbare Statuslabels zusätzlich zu Farbe, zurückhaltende Glasflächen, tastaturbedienbare Details, skalierbare Schrift und Reduced Motion. Laufzeit-Ticker nur in sichtbaren aktiven Zeilen; schnelle Tool-Folgen bündeln, Start/Ende sofort anzeigen.

## Abnahme: konkrete Szenarien

1. Drei parallele Agenten: drei eindeutige Runs mit je eigenem Auftrag; Abschluss eines Runs lässt zwei aktiv.
2. Hauptagent streamt gleichzeitig: Zähler und Einstieg bleiben sichtbar.
3. wait_agent läuft in Timeout: Zielagent bleibt aktiv, sofern kein anderes Abschlussereignis vorliegt.
4. Hintergrund-Start bestätigt, Hauptturn fertig: Agent bleibt aktiv, Composer bleibt nutzbar.
5. Native und CLI-MCP-Subagenten parallel: korrekte Provider, keine doppelten Runs für einen Start.
6. Freigabe/Eingabe: Wartegrund und passender Link nur dem zugeordneten Run zuweisen.
7. Reload/Reconnect mit leeren, verspäteten und doppelten Events: gleiche Liste/Zähler, keine wiederbelebten Geisteragenten.
8. 40 aktive Agenten: Anzahl 40, jeder erreichbar; abgeschlossene Historie darf begrenzt werden.
9. Chatwechsel und Backend-Neustart: kein Übersprechen, keine falschen Erfolgsmeldungen; Hintergrundarbeit eindeutig zugeordnet.
10. Provider ohne Fortschrittstelemetrie: nachvollziehbarer Laufstatus mit „Keine Tätigkeitsdaten verfügbar“.
11. Desktop, schmaler Browser und Android: echte gerenderte Zustände mit 0/1/3/40 Runs, langen Aufträgen, Fehler und Verbindungsverlust prüfen.

Tests: Provider-Adapter mit aufgezeichneten anonymisierten Payloads; deterministische Zustands-/Replay-Tests; UI-Tests für Zähler, Details und Navigation. Zum Schluss ein begrenzter echter Parallel-Lauf mit Claude/Z.AI und Codex/MCP. Android-Build über android-builder, Installation/Instrumentierung auf dem ausgewählten Gerät sobald erreichbar; ein erfolgreicher Build ersetzt keinen Gerätetest.

## Reihenfolge der Lieferung

1. Sofort nutzbarer vertikaler Schritt: korrekte IDs/Zustände/Zähler, alle aktiven Runs, dauerhaft sichtbarer Einstieg und Listen mit Auftrag/Status in beiden Clients. Spawn/Wait/Background und Android-Mehrfachagenten gehören bereits hierzu.
2. Danach belastbare Tätigkeitszuordnung, Provider-Metadaten und Detailverlauf samt Reconnect-/Neustart-Abgleich vervollständigen. Replay-Grundregeln sind bereits Voraussetzung für Schritt 1.
3. Prüfung der obigen Szenarien, abgestimmte Web-/Android-Auslieferung und anschliessend Live-Verifikation. Kein „fertig“, solange die Anzahl nur optisch stimmt oder das getestete Gerät/der Provider nicht tatsächlich geprüft wurde; offene Prüfungen explizit ausweisen.
