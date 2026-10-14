# Seitenmenü und Chatbar nach Modus (Chat · Task · Code · Schwarm)

Stand 2026-10-14. Gilt für WebUI **und** Android (Parität). Jede Phase ist eine eigene, kurze Session.

## Grundsätze

1. **Seitenmenü = Navigation und Kontext des Modus.** Keine Laufzeit-Einstellungen mehr darin.
2. **Wie ein Lauf arbeitet, steht in der Chatbar** (Modell, Denkaufwand, Ausführungsmodus, Presets), in Chat, Task und Code gleich gebaut.
3. **Werkzeuge erscheinen dort, wo sie gebraucht werden**, und melden sich selbst, wenn etwas passiert (Badge), statt als statische Knopfwand.
4. Selten Genutztes liegt im Überlauf-Menü (⋯) der Session, nicht in der Sidebar.

## 1. Aufbau des Seitenmenüs (alle Modi)

| Zone | Inhalt |
|---|---|
| ① Kopf | Modus-Pille `Chat · Task · Code · Schwarm` (wie App-Header). Modus kommt aus der Route (`/chat`, `/tasks`, `/code`, `/swarm`), zuletzt genutzter Modus wird gemerkt. Ersetzt das 2×5-Linkraster. |
| ② Mitte | Liste des Modus; bei geöffneter Task-/Code-Session darunter die Werkzeuge (Abschnitt 3). Tabs „Sessions / Session tools" entfallen: Liste oben, Werkzeuge der offenen Session als eigener Block darunter (einklappbar). |
| ③ Fuß | Verbrauchsbalken; Icon-Zeile Übersicht · Agenten · Monitor · Analytics · Outbox · Operations (schmal: „Mehr ▾"); Einstellungen. |

Mitte je Modus:

- **Chat:** „Neuer Chat", Suche, Verlauf (Heute / Gestern / Älter). Keine Werkzeuge.
- **Task:** „Neue Aufgabe", Filter (Läuft · Braucht dich), Task-Sessions.
- **Code:** „Neue Session", Projekte/Kategorien, Code-Sessions.
- **Schwarm:** Brian, Räume, Agenten mit Status; Not-Aus als roter Knopf am Blockende.

## 2. Chatbar (Composer) – einheitlich

```
[+]  Nachricht …                      [Opus 5.5 · Hoch ▾] [YOLO ▾] [🎤] (➤)
```

- **Modell-Chip** = bestehender `ModelEffortPicker` / Android `ModelEffortSheet`: Modelle gruppiert nach Provider (der Providerwechsel ist damit Teil der Modellwahl), darunter die animierte Denkaufwand-Schiene inkl. Ultra/Ultracode. Erweitert-Abschnitt: „Subagent-Modell" (heute „Task agent model").
- **Modus-Chip** (nur Task/Code): Planen · Manuell · Auto-Accept · YOLO.
- **`+`-Menü:** Anhänge, Kamera/Screenshot, **Preset** (Abschnitt 4).
- Der Block **„Model & execution" verschwindet aus der Sidebar** (Mode, Provider, Model, Task-Agent-Modell, Effort).
- Android: `ModelEffortChip` existiert; Modus-Chip und `+`-Preset ergänzen.

## 3. Werkzeuge der offenen Session

Heute: Goal & Tasks, Agents, Files, Git, Preview, Notes + „More tools" (Session Mesh, Android, Browser, GitHub, Checkpoints, Tool Log). Genutzt wird praktisch nur Android.

**Code – vier feste Werkzeuge:**

| Neu | Enthält | Verhalten |
|---|---|---|
| **Dateien** | Files, Editor | wie heute |
| **Versionen** | Git + GitHub + Checkpoints als Tabs | Badge bei uncommitteten Änderungen |
| **Vorschau** | Preview | nur sichtbar, wenn ein Preview-Port läuft |
| **Verbindungen** | Android-Geräte, SSH-Hosts, Browser | Abschnitt 5 |

**Fortschritt** (statt „Goal & Tasks" und „Agents"): ein Panel mit Ziel, Todo-Liste und laufenden Subagenten. Erscheint **automatisch**, sobald der Lauf Todos oder Agenten hat (Badge mit Zähler), sonst unsichtbar. Das Ziel wird im Kopf des Chats gesetzt/angezeigt (`/goal`), nicht in der Sidebar.

**Ins ⋯-Menü der Session:** Notizen, Protokoll (Tool Log), Session Mesh, Darstellung (Design-Vorgabe, Abschnitt 4), Umbenennen, Archivieren.

**Task:** Fortschritt, Dateien (Ergebnisse), Verbindungen (meist Browser). Kein Git/Preview.
**Chat / Schwarm:** keine Session-Werkzeuge.

„Configure agents" wandert nach Einstellungen → Agenten; die globale Agenten-Seite in den Fuß.

## 4. Presets

- **Schreibstil** (Writing Styles): aus Code entfernen. Wird ein **Preset im `+`-Menü von Chat und Task** („Stil: Sachlich / Persönlich / …") plus Standard in der Personalisierung.
- **Design-Vorgabe** (Design Styles) – Überarbeitung:
  - nur in **Code** (und Task bei Dokument-/Präsentationsaufgaben), gewählt über ⋯ → Darstellung oder beim Anlegen der Session;
  - Auswahl als **Karten mit Vorschau** (`designPreviewTemplates.ts` existiert), 8 kuratierte sichtbar, Rest per Suche;
  - Standard-Vorgabe für neue Sessions in den Einstellungen;
  - Anzeige in der Session nur als kleiner Hinweis, kein eigener Sidebar-Block.

## 5. Verbindungen (neu): Android, SSH, Browser

Eine Liste „Verbindungen" (global in Einstellungen, pro Session angehängt im Werkzeug):

| Typ | Daten | Aktionen |
|---|---|---|
| Android | bestehende Geräte-Registry (`/api/android/*`, Kopplung/WLAN) | Koppeln, Verbinden, an Session hängen |
| **SSH** | Name, Host, Port, Benutzer, Schlüssel (aus dem read-only `~/.ssh`-Mount wählen oder hochladen, verschlüsselt), optional Jump-Host, Tags | Testen, an Session hängen, (Phase 2) Terminal |
| Browser | Plum-Browser-Kopplung (`browser_tokens`) | Status, Live-Ansicht |

- Backend: Tabelle `connections` (`id, user_id, kind, name, config_json, secret_enc`), `GET/POST/PATCH/DELETE /api/connections`, `POST /api/connections/:id/test`; Zuordnung `session_connections`.
- Agentenzugriff: angehängte SSH-Hosts werden der Session als generierte `ssh_config`-Aliase bereitgestellt (`ssh <alias>`), Kontextzeile „Verfügbare Verbindungen: …". Gilt nur bei `CLI_RUNNER_ACCESS=admin-only`-Berechtigten.
- Secrets write-only (`*Configured`-Flag, `clear*`), wie bei anderen Integrationen.

## 6. Phasen (je eine Session, WebUI + Android)

| Phase | Inhalt | Fertig wenn |
|---|---|---|
| P1 Chatbar | Modell-/Effort-/Modus-Chip in Task/Code, Sidebar-Block „Model & execution" entfernt | Modell, Effort, Modus in beiden Clients aus der Chatbar umstellbar |
| P2 Sidebar | Drei Zonen, Modus-Pille, Mitte je Modus, Fuß-Icons | Jeder Modus zeigt nur seine Liste; Route ↔ Pille synchron |
| P3 Werkzeuge | Dateien · Versionen · Vorschau · Verbindungen; Fortschritt automatisch; ⋯-Menü | „More tools" existiert nicht mehr; Badges funktionieren |
| P4 Presets | Schreibstil ins `+`-Menü (Chat/Task); Design-Vorgabe als Karten | Kein Style-Block mehr in der Sidebar |
| P5 Verbindungen | Backend + UI Android/SSH/Browser, SSH-Test, Session-Zuordnung, Agent-Aliase | SSH-Host anlegen, testen, an Session hängen, Agent erreicht ihn |

## Offene Entscheidungen

1. Notizen behalten (im ⋯-Menü) oder ganz entfernen?
2. SSH: nur für Agenten nutzbar, oder auch ein Terminal in der WebUI (Phase 2 von P5)?
3. Schreibstil-Preset auch in Task oder nur in Chat?
