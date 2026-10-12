package com.claudewebui.swarm.data

import com.claudewebui.swarm.data.matrix.Ereignis
import com.claudewebui.swarm.data.matrix.SchwarmJson
import kotlinx.serialization.json.jsonObject
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDate
import java.util.Date
import java.util.Locale

/** Welche Seite der Vorschau: als Vale, als Gast oder ohne Zugang, dazu Störungen zum Ausprobieren. */
data class VorschauArt(
    val zugang: Zugang = Zugang.VALE,
    /** Der Sync fällt aus: Die App zeigt den letzten bekannten Stand mit Zeitstempel. */
    val gestoert: Boolean = false,
    /** Der Hub schickt die Routinen schon mit `v: 2`: „bitte App aktualisieren“. */
    val neuereVersion: Boolean = false,
)

/**
 * Beispieldaten für die Vorschau ohne Anmeldung: So sieht der Schwarm aus, wenn Brian eine
 * Übergabe an Claude Code macht und Claude Code auf deine Freigabe wartet. Freigaben und Alarme
 * liest die Vorschau mit denselben Funktionen wie der echte Sync aus Beispiel-Notices des Hubs,
 * ebenso die State-Events des Hubs (Plum, Türsteher, Abo-Stand, Routinen, Not-Aus, Kennzahlen,
 * Rollen). Nichts davon geht ans Netz.
 */
object Vorschau {
    const val ICH = "@zwaetschge:zwaetschge-webui.ch"
    const val GAST = "@vanessa:zwaetschge-webui.ch"
    const val FREMD = "@besuch:zwaetschge-webui.ch"
    private const val HUB = "@schwarm:zwaetschge-webui.ch"
    private const val BRIAN = "@brian:zwaetschge-webui.ch"
    private const val CLAUDE = "@_sw_claude-code:zwaetschge-webui.ch"
    private const val CODEX = "@_sw_codex-host:zwaetschge-webui.ch"
    private const val AUTOUPDATER = "@_sw_autoupdater:zwaetschge-webui.ch"
    private const val UNRAID = "@_sw_unraid:zwaetschge-webui.ch"
    private const val BETRIEB = "@_sw_betrieb:zwaetschge-webui.ch"
    private const val PLUM = "@_sw_plum:zwaetschge-webui.ch"

    /** Der Plan von T-0013, wie ihn der Worker als `frage` schickt. */
    private const val PLAN_TEXT = "📋 Plan zum Freigeben:\n" +
        "1. MCP-Werkzeuge `beanspruchen` und `freigeben` in packages/matrix/src/mcp/zusatz.ts\n" +
        "2. Ablaufzeit je Anspruch (Standard 2 h), Überschneidung meldet einen Hinweis\n" +
        "3. `!absprachen` liest dieselbe Tabelle; Tests in test/absprachen.mjs\n" +
        "Schätzung: 35 min · 1.40 USD · 4 Dateien, keine Migration nötig"

    /** Die Adresse des Patches im Beispiel; die Vorschau liefert ihn selbst, ohne Server. */
    const val PATCH_MXC = "mxc://zwaetschge-webui.ch/VorschauPatch0014"

    /** Die Beispiel-Geräte-ID des Not-Aus, wenn auf dem Gerät noch kein Schlüssel liegt. */
    const val GERAET = "3f2a9c01d4e5b6a7"

    /** Das Bild im Beispiel-Chat; die Vorschau malt es selbst, ohne Server. */
    const val BILD_MXC = "mxc://zwaetschge-webui.ch/VorschauBalkon"

    /** Dateien der Vorschau (App 2.2): PDF, Sprachnachricht, Audio, Video. Das Video gibt es nur als Karte. */
    const val PDF_MXC = "mxc://zwaetschge-webui.ch/VorschauSteuer"
    const val SPRACHE_MXC = "mxc://zwaetschge-webui.ch/VorschauSprache"
    const val AUDIO_MXC = "mxc://zwaetschge-webui.ch/VorschauTagesbericht"
    const val VIDEO_MXC = "mxc://zwaetschge-webui.ch/VorschauKamera"

    /** Die Bytes einer Datei der Vorschau; `null`, wenn es sie nur als Karte gibt. */
    fun medien(mxc: String): ByteArray? = when (mxc) {
        PDF_MXC -> VorschauMedien.pdf(listOf(
            "Steuererklärung 2025 - Zürich",
            "Einreichen bis: 31. März 2026 (Fristerstreckung bis 30. September möglich)",
            "Belege Säule 3a: bis Ende Januar anfordern",
            "Vorauszahlung: bis 30. September für Zins",
        ))
        SPRACHE_MXC -> VorschauMedien.sprechprobe(2, 7.4)
        AUDIO_MXC -> VorschauMedien.sprechprobe(0, 6.0)
        else -> null
    }

    /** Eine Welle wie von einer echten Sprachnachricht: leiser Anfang, Sätze, Pausen. */
    private val WELLE = listOf(
        40, 90, 210, 480, 620, 540, 700, 820, 610, 380, 120, 60, 300, 560, 760, 900, 830, 650, 420, 200,
        90, 70, 260, 520, 690, 610, 480, 700, 880, 760, 540, 310, 140, 60, 50, 220, 470, 640, 720, 580,
        400, 230, 110, 60, 40,
    )

    /** Brians Antwort mit Überschriften, Code, Tabelle, Liste, Zitat und Link: zum Prüfen des Markdowns. */
    private val CSV_ANTWORT = """
Ohne Bibliothek reicht für einfache Dateien `readLines()` und `split`. **Achtung:** Felder mit Kommas in Anführungszeichen brauchen einen echten Parser.

## Einfache Variante

```kotlin
data class Zeile(val name: String, val ort: String, val kwh: Int)

fun lesen(datei: File): List<Zeile> {
    val (kopf, rest) = datei.readLines().let { it.first() to it.drop(1) }
    val spalten = kopf.split(",").withIndex().associate { (i, n) -> n.trim() to i }
    return rest.filter { it.isNotBlank() }.map { z ->
        val f = z.split(",")
        Zeile(f[spalten.getValue("name")], f[spalten.getValue("ort")], f[spalten.getValue("kwh")].trim().toInt())
    }
}
```

## Was wann passt

| Weg | Anführungszeichen | Grosse Dateien |
|:--|:-:|--:|
| `split(",")` | nein | ja |
| eigener Zustandsautomat | ja | ja |
| *kotlin-csv* (Bibliothek) | ja | ja |

1. Kopfzeile einmal lesen und die Spalten **nach Namen** suchen.
2. Leere Zeilen überspringen.
   - Auch Zeilen mit nur Leerzeichen.
3. Zahlen mit `trim()` säubern.

> Tipp: Mit `useLines { }` liest du grosse Dateien, ohne alles in den Speicher zu laden.

Mehr dazu: [Kotlin-Doku zu Dateien](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.io/java.io.-file/)
""".trim()

    private val KOMMA_ANTWORT = """
Dann brauchst du einen kleinen Zustandsautomaten, der Anführungszeichen beachtet:

```kotlin
fun felder(zeile: String): List<String> {
    val aus = mutableListOf<String>()
    val feld = StringBuilder()
    var inZitat = false
    for (c in zeile) when {
        c == '"' -> inZitat = !inZitat
        c == ',' && !inZitat -> { aus += feld.toString(); feld.clear() }
        else -> feld.append(c)
    }
    return aus + feld.toString()
}
```

Doppelte Anführungszeichen (`""`) innerhalb eines Feldes deckt das noch nicht ab.
""".trim()

    private const val PFLANZE_ANTWORT = "Das ist sehr wahrscheinlich ein **Oleander** (*Nerium oleander*).\n\n" +
        "- Blätter schmal und lederartig, zu dritt am Stängel\n" +
        "- Blüten rosa bis rot, den ganzen Sommer\n" +
        "- **Giftig** für Menschen und Haustiere: nach dem Schneiden die Hände waschen\n\n" +
        "Im Winter will er es hell und kühl (5–10 °C), etwa im Treppenhaus."

    private fun uhr(ms: Long): String = SimpleDateFormat("HH:mm", Locale.GERMAN).format(Date(ms))

    private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

    /** Eine Freigabe-Notice, wie sie der Hub schreibt (`council/freigabe.ts`). */
    private fun freigabeNotice(id: String, kette: String, was: String, ergebnis: String, grenzen: String, gesendet: Long) =
        "🔐 Freigabe nötig · $id · T2-Agent\n" +
            "Kette: $kette\n" +
            "Was: $was\n" +
            "Ergebnis: $ergebnis\n" +
            "Grenzen: $grenzen\n" +
            "Läuft ab: ${uhr(gesendet + FREIGABE_FRIST_MIN * 60_000L)} (nach $FREIGABE_FRIST_MIN min)\n" +
            "✅ auf diese Nachricht gibt frei, ❌ lehnt ab. Es zählt nur deine Reaktion (§7.3)."

    fun zustand(art: VorschauArt = VorschauArt()): SchwarmZustand {
        val jetzt = System.currentTimeMillis()
        fun vor(min: Int) = jetzt - min * 60_000L
        val ich = when (art.zugang) {
            Zugang.GAST -> GAST
            Zugang.KEIN_ZUGANG, Zugang.PRUEFT -> FREMD
            Zugang.VALE -> ICH
        }
        val raeume = Raeume(
            lobby = "!lobby", board = "!board", freigaben = "!freigaben", log = "!log", alarme = "!alarme",
            space = "!space",
            agenten = mapOf(
                "brian" to "!ag-brian", "claude-code" to "!ag-claude-code", "codex-host" to "!ag-codex-host",
                "plum" to "!ag-plum", "betrieb" to "!ag-betrieb",
                // Wie live: Die Melder schreiben in #schwarm-alarme und teilen sich diesen Raum (Absturz in 2.3.0).
                "autoupdater" to "!alarme", "trader" to "!alarme", "sicherheit" to "!alarme",
            ),
            // Allgemein ist Vales Chat mit Brian; ein Gast hat keinen.
            allgemein = if (art.zugang == Zugang.VALE) "!allgemein" else null,
        )
        val agenten = listOf(
            Agent("brian", "Brian", "L2", "T1", "native", AgentStatus.ONLINE, "!ag-brian", "hermes-agent", "glm-5.3",
                listOf("recherche", "zusammenfassen", "gedaechtnis", "telegram", "netz"), 1, "3.0", BRIAN),
            Agent("claude-code", "Claude Code", "L3", "T2", "worker", AgentStatus.ONLINE, "!ag-claude-code", "schwarm-claude", "sonnet",
                listOf("code", "dateien", "lesen", "review"), 1, null, CLAUDE),
            Agent("codex-host", "Codex (Host)", "L3", "T2", "worker", AgentStatus.ONLINE, "!ag-codex-host", "codex-bot", null,
                listOf("code", "shell-workspace", "dateien"), 1, null, CODEX),
            Agent("plum", "Plum", "L3", "T2", "worker", AgentStatus.ONLINE, "!ag-plum", "plum-bridge", null,
                listOf("code", "sitzungen", "chat"), 4, null, PLUM),
            Agent("betrieb", "Betrieb", "L2", "T2", "worker", AgentStatus.ONLINE, "!ag-betrieb", "betrieb", null,
                listOf("docker", "unraid", "pihole", "tuersteher"), 2, null, BETRIEB),
            Agent("autoupdater", "Hermes-Autoupdater", "L0", "T0", "notify", AgentStatus.ONLINE, null, null, null,
                emptyList(), 1, null, AUTOUPDATER),
        )
        val auftraege = listOf(
            Auftrag("T-0015", Zustand.IN_ARBEIT, "plum", "@voxtral: Stream prüfen", 0, null,
                null, vor(2), "!ag-plum", "\$k15", "kurzer Befund", emptyList(), "20 min", null, ICH),
            Auftrag("T-0014", Zustand.FERTIG, "claude-code", "Medien-Retention: abgelaufene Anhänge täglich löschen", 0, null,
                "Patch mit Migration, Wartung und Tests liegt im Thread (3 Dateien, +34 −9).", vor(20), "!ag-claude-code", "\$k14",
                "Patch", listOf("nur Zweig, kein Push"), "1.00 USD · 30 min", null, ICH),
            Auftrag("T-0013", Zustand.RUECKFRAGE, "claude-code", "Baue die Absprachen als MCP-Werkzeug in den Hub ein", 0, "heute 20:00",
                null, vor(4), "!ag-claude-code", "\$k13", "Patch", emptyList(), "2.00 USD · 60 min", null, ICH),
            Auftrag("T-0012", Zustand.RUECKFRAGE, "brian", "Recherchiere Hosting für die Familien-Fotos", 0, "heute 18:00",
                null, vor(3), "!ag-brian", "\$k12", "kurze Zusammenfassung", emptyList(), "0.50 USD · 20 min", null, ICH),
            Auftrag("T-0011", Zustand.FREIGABE, "claude-code", "Prüfe im Backup-Skript, warum das Backup gestern nicht lief", 1,
                "heute 17:30", null, vor(6), "!ag-claude-code", "\$k11", "Befund in drei Sätzen", listOf("nur lesen"),
                "4 min", "T-0010", BRIAN),
            Auftrag("T-0010", Zustand.IN_ARBEIT, "brian", "Warum war das Backup gestern so klein?", 0, "heute 17:00",
                null, vor(7), "!ag-brian", "\$k10", "kurze Zusammenfassung", emptyList(), "0.50 USD · 20 min", null, ICH),
            Auftrag("T-0009", Zustand.FERTIG, "brian", "Fasse die Release-Notes von Synapse 1.162 zusammen", 0, null,
                "Drei Punkte: Sliding Sync ist Standard, Python 3.9 fällt weg, neue Admin-API für Medien.", vor(52),
                "!ag-brian", "\$k9", "kurze Zusammenfassung", emptyList(), "0.50 USD · 20 min", null, ICH),
            Auftrag("T-0008", Zustand.FEHLGESCHLAGEN, "codex-host", "Räume die alten Build-Ordner auf", 0, null,
                "Zeitgrenze 240 s erreicht", vor(180), "!ag-codex-host", "\$k8", "Liste der gelöschten Ordner",
                emptyList(), "4 min", null, ICH),
        )
        /** `eigene`: deine Reaktionen, jeweils vor wie vielen Minuten. */
        fun n(id: String, raum: String, von: String, name: String, min: Int, text: String, notice: Boolean = false,
              thread: String? = null, reaktionen: Map<String, Int> = emptyMap(), auftrag: String? = null,
              eigene: Map<String, Int> = emptyMap(), datei: Datei? = null) = Nachricht(
            id, raum, von, name, vor(min), text, notice, thread, false, reaktionen, eigene.keys, auftrag,
            von == ich, von == HUB, eigene.mapValues { vor(it.value) }, datei,
        )
        val verlaeufe = mapOf(
            "!lobby" to Verlauf(listOf(
                n("\$l1", "!lobby", ICH, "Vale", 8, "!auftrag @brian Warum war das Backup gestern so klein?"),
                n("\$l2", "!lobby", HUB, "Hub", 8, "📥 T-0010 → Brian · Warum war das Backup gestern so klein?\nhttps://matrix.to/#/!ag-brian", true),
                n("\$l3", "!lobby", HUB, "Hub", 6, "🔐 T-0011: Brian möchte Claude Code beauftragen. Die Freigabe liegt in #schwarm-freigaben (✅ oder ❌, $FREIGABE_FRIST_MIN min).", true),
                n("\$l7", "!lobby", HUB, "Hub", 45, "🧭 Ablauf code-aenderung #3: Medien-Retention für den Hub\n1. @claude-code  2. @codex-host  3. 🚦 du entscheidest  4. git: Patch 1\nDie Schritte antworten hier im Thread.", true),
                n("\$l7a", "!lobby", HUB, "Hub", 20, "✅ Schritt 1/4: T-0014 fertig (Claude Code)", true, thread = "\$l7"),
                n("\$l5", "!lobby", HUB, "Hub", 5, "🚦 Ablauf code-aenderung #3, Schritt 3/4: codex-host hat den Patch von T-0014 geprüft, die Tests sind grün. Zusammenführen?\nWeiter? ✅ / ❌ (Reaktion auf diese Nachricht)", true, thread = "\$l7"),
                n("\$l4", "!lobby", HUB, "Hub", 3, "❓ T-0012 · Brian fragt: Soll es in der Schweiz gehostet sein, oder reicht die EU?", true),
                n("\$l6", "!lobby", HUB, "Hub", 4, "❓ Claude Code fragt zu T-0013:\n$PLAN_TEXT\n\nAntwort im Thread der Karte.", true),
            ), anfangErreicht = true),
            "!ag-brian" to Verlauf(listOf(
                // Dateien in einem Arbeitsraum (App 2.2): Audio und Video als Karte.
                n("\$v1", "!ag-brian", BRIAN, "Brian", 41, "tagesbericht-27-09.m4a",
                    datei = Datei("tagesbericht-27-09.m4a", AUDIO_MXC, "audio/mp4", 96_000, null, art = "m.audio", dauerMs = 6_000)),
                n("\$v2", "!ag-brian", BRIAN, "Brian", 40, "kamera-balkon.mp4",
                    datei = Datei("kamera-balkon.mp4", VIDEO_MXC, "video/mp4", 8_450_000, null, breite = 1920, hoehe = 1080,
                        art = "m.video", dauerMs = 12_000)),
                n("\$k9", "!ag-brian", HUB, "Hub", 60, "@Brian Auftrag T-0009 — Fasse die Release-Notes von Synapse 1.162 zusammen\n\nErgebnis: kurze Zusammenfassung",
                    reaktionen = mapOf("👀" to 1, "👍" to 1), auftrag = "T-0009", eigene = mapOf("👍" to 50)),
                n("\$b9", "!ag-brian", BRIAN, "Brian", 52, "Drei Punkte: Sliding Sync ist Standard, Python 3.9 fällt weg, neue Admin-API für Medien.", thread = "\$k9"),
                n("\$k10", "!ag-brian", HUB, "Hub", 8, "@Brian Auftrag T-0010 — Warum war das Backup gestern so klein?\n\nZiel: Warum war das Backup gestern so klein?\nErgebnis: kurze Zusammenfassung\nGrenzen: keine\nBudget: 0.50 USD / 20 min · Frist: heute 17:00", reaktionen = mapOf("👀" to 1), auftrag = "T-0010"),
                n("\$b1", "!ag-brian", BRIAN, "Brian", 7, "Dafür muss jemand ins Backup-Skript schauen. Ich gebe das an Claude Code weiter (T-0011).", thread = "\$k10"),
                n("\$b2", "!ag-brian", HUB, "Hub", 6, "⏳ T-0010: wartet auf T-0011 (Claude Code, Freigabe nötig)", true, thread = "\$k10"),
            ), anfangErreicht = true),
            "!ag-claude-code" to Verlauf(listOf(
                n("\$k11", "!ag-claude-code", HUB, "Hub", 6, "@Claude Code Auftrag T-0011 — Prüfe im Backup-Skript, warum das Backup gestern nicht lief\n\nZiel: …\nErgebnis: Befund in drei Sätzen\nGrenzen: nur lesen\nKette: Hop 1 von 4, Tiefe 1, Eltern-Auftrag T-0010", auftrag = "T-0011"),
                n("\$k14", "!ag-claude-code", HUB, "Hub", 40, "@Claude Code Auftrag T-0014 — Medien-Retention: abgelaufene Anhänge täglich löschen\n\nErgebnis: Patch\nGrenzen: nur Zweig, kein Push\nBudget: 1.00 USD / 30 min", reaktionen = mapOf("👀" to 1), auftrag = "T-0014"),
                n("\$s14", "!ag-claude-code", HUB, "Hub", 39, "🔎 Ähnlich: T-0009 (✅ Release-Notes zusammengefasst), T-0010 (⚙️ Backup zu klein)", true, thread = "\$k14"),
                n("\$c14", "!ag-claude-code", CLAUDE, "Claude Code", 21, "Fertig. Migration 0021, Wartung und Tests; alle Tests grün. Der Patch hängt an.", thread = "\$k14"),
                n("\$d14", "!ag-claude-code", CLAUDE, "Claude Code", 20, "T-0014.patch", thread = "\$k14",
                    datei = Datei("T-0014.patch", PATCH_MXC, "text/x-diff", PATCH.length.toLong(), PatchInfo("T-0014", "matrix", 3, 34, 9))),
                n("\$k13", "!ag-claude-code", HUB, "Hub", 5, "@Claude Code Auftrag T-0013 — Baue die Absprachen als MCP-Werkzeug in den Hub ein\n\nErgebnis: Patch\nBudget: 2.00 USD / 60 min · Frist: heute 20:00", reaktionen = mapOf("👀" to 1), auftrag = "T-0013"),
                n("\$p13", "!ag-claude-code", CLAUDE, "Claude Code", 4,
                    "❓ T-0013 · Claude Code\n$PLAN_TEXT\n\nAntwort hier im Thread, sie geht direkt an Claude Code.",
                    true, thread = "\$k13"),
            ), anfangErreicht = true),
            "!ag-plum" to Verlauf(listOf(
                n("\$m1", "!ag-plum", PLUM, "Plum", 190, "🗑 Plum-Sitzung gelöscht: alt-test", true),
                n("\$m2", "!ag-plum", PLUM, "Plum", 75, "🆕 Neue Plum-Sitzung: matrix-app (Android-App Schwarm)", true),
                n("\$k15", "!ag-plum", HUB, "Hub", 2, "@Plum Auftrag T-0015 — @voxtral: Stream prüfen", auftrag = "T-0015"),
                n("\$m3", "!ag-plum", PLUM, "Plum", 1, "🆕 Neue Plum-Sitzung: voxtral (Stream prüfen)", true),
            ), anfangErreicht = true),
            // Zwei Meldungen ohne Fingerabdruck (nur lesen); Alarme: einer behoben (noch mit „✅ schliessen“
            // wie vor 2026-09-26), einer von dir quittiert, einer stumm, einer auf crit gestiegen.
            "!alarme" to Verlauf(listOf(
                n("\$a1", "!alarme", AUTOUPDATER, "Hermes-Autoupdater", 300, "ℹ️ [TEST] Autoupdater ist an den Schwarm angeschlossen (P4).", true),
                n("\$a2", "!alarme", UNRAID, "Unraid Assistant", 180,
                    "⚠️ Disk 3: 91 % belegt\nFrei sind noch 1.1 TB von 12 TB.\nunraid-space:disk3 · ✅ schliessen · 🔕 24 h stumm", true),
                n("\$a5", "!alarme", BETRIEB, "Betrieb", 120,
                    "⚠️ nextcloud: Update auf 29.0.8 verfügbar\nDie Wache meldet es bei jeder Auffrischung.\ndocker-updates:nextcloud · ✅ quittieren · 🔕 24 h stumm",
                    true, reaktionen = mapOf("✅" to 1), eigene = mapOf("✅" to 118)),
                n("\$a5b", "!alarme", HUB, "Hub", 118,
                    "✅ quittiert von Vale · meldet sich erst wieder, wenn er behoben war oder schlimmer wird", true, thread = "\$a5"),
                n("\$a2b", "!alarme", UNRAID, "Unraid Assistant", 95,
                    "✅ behoben: Disk 3: 78 % belegt\nDer Mover hat 1.6 TB aufs Array verschoben.", true, thread = "\$a2"),
                n("\$a3", "!alarme", HUB, "Hub", 50,
                    "⚠️ hub: Hermes Phone ist nicht verbunden\nZuletzt gesehen ${uhr(vor(66))}. Aufträge an hermes-phone warten, bis der Worker zurück ist.\nworker-weg:hermes-phone · ✅ quittieren · 🔕 24 h stumm",
                    true, reaktionen = mapOf("🔕" to 1), eigene = mapOf("🔕" to 46)),
                n("\$a3b", "!alarme", HUB, "Hub", 45, "🔕 stumm bis ${uhr(vor(45) + 24 * 3_600_000L)} (24 h) · 🔔 hebt das auf", true, thread = "\$a3"),
                n("\$a6", "!alarme", BETRIEB, "Betrieb", 25,
                    "ℹ️ Korrektur: 20 Alarme der Wache von heute Mittag waren Fehlalarme\nDer Healthcheck lief während der Updates; die Container waren gesund.", true),
                n("\$a4", "!alarme", BETRIEB, "Betrieb", 16,
                    "⚠️ paperless: unhealthy seit 3 min\nHealthcheck: HTTP 502 von /api/\nhttps://paperless.zwaetschge-webui.ch\ndocker-health:paperless · ✅ quittieren · 🔕 24 h stumm", true),
                n("\$a4b", "!alarme", BETRIEB, "Betrieb", 4,
                    "⬆️ 🚨 jetzt crit: paperless: unhealthy seit 15 min\nEin Neustart nach Runbook hat nicht geholfen.", true, thread = "\$a4"),
            ), anfangErreicht = true),
            // Eine Freigabe abgelaufen, eine erteilt, eine offen.
            "!freigaben" to Verlauf(listOf(
                n("\$f3", "!freigaben", HUB, "Hub", 190, freigabeNotice("T-0005", "Vale → Codex (Host)",
                    "Räume die alten Docker-Images auf dem Host auf", "Liste der gelöschten Images", "nur ungenutzte Images", vor(190)), true),
                n("\$f3q", "!freigaben", HUB, "Hub", 160, "⌛ abgelaufen nach $FREIGABE_FRIST_MIN min · T-0005", true, thread = "\$f3"),
                n("\$f2", "!freigaben", HUB, "Hub", 42, freigabeNotice("T-0007", "Vale → Brian → Betrieb",
                    "docker.restart immich — hängt seit dem Update, Neustart laut Runbook", "Container läuft wieder", "keine", vor(42)),
                    true, reaktionen = mapOf("✅" to 1), eigene = mapOf("✅" to 41)),
                n("\$f2q", "!freigaben", HUB, "Hub", 41, "✅ freigegeben · T-0007", true, thread = "\$f2"),
                n("\$f1", "!freigaben", HUB, "Hub", 6, freigabeNotice("T-0011", "Vale → Brian → Claude Code",
                    "Prüfe im Backup-Skript, warum das Backup gestern nicht lief", "Befund in drei Sätzen", "nur lesen", vor(6)), true),
            ), anfangErreicht = true),
            "!log" to Verlauf(listOf(
                n("\$g1", "!log", HUB, "Hub", 30, "🚀 Hub-Release r42 läuft: Basis 476df4d, 18 Prüfungen grün. Rückweg: r41.", true),
            ), anfangErreicht = true),
            "!ag-codex-host" to Verlauf(emptyList(), anfangErreicht = true),
            "!ag-betrieb" to Verlauf(emptyList(), anfangErreicht = true),
            // Allgemein: ein fertiger Chat mit Code und Tabelle, einer mit Bild, einer, an dem Brian arbeitet.
            "!allgemein" to Verlauf(listOf(
                // Ein PDF mit Frage (Brian kann PDFs in Matrix noch nicht lesen) und eine Sprachnachricht.
                n("\$c4", "!allgemein", ICH, "Vale", 180, "Kannst du mir die wichtigsten Fristen aus diesem PDF heraussuchen?",
                    reaktionen = mapOf("✅" to 1),
                    datei = Datei("Steuererklaerung-2025.pdf", PDF_MXC, "application/pdf", 48_213, null, art = "m.file")),
                n("\$c4a", "!allgemein", BRIAN, "Brian", 179,
                    "Ich sehe, dass du **Steuererklaerung-2025.pdf** geschickt hast, aber PDFs kann ich in Matrix noch nicht lesen – " +
                        "dort fehlt mir das Datei-Werkzeug.\n\nKopier mir den Text hinein oder schick die Seiten als Bild, dann suche ich die Fristen heraus.",
                    thread = "\$c4"),
                n("\$c5", "!allgemein", ICH, "Vale", 26, "sprachnachricht-20260927-1204.ogg", reaktionen = mapOf("✅" to 1),
                    datei = Datei("sprachnachricht-20260927-1204.ogg", SPRACHE_MXC, "audio/ogg", 38_400, null, art = "m.audio",
                        dauerMs = 7_400, sprache = true, welle = WELLE)),
                n("\$c5a", "!allgemein", BRIAN, "Brian", 25,
                    "Du hast gefragt, ob es morgen in Zürich regnet: **Ja**, ab etwa 15 Uhr ziehen Schauer auf, gegen Abend bis 6 mm. " +
                        "Der Vormittag bleibt trocken, um 14 °C.", thread = "\$c5"),
                n("\$c1", "!allgemein", ICH, "Vale", 95, "Wie lese ich in Kotlin eine CSV-Datei mit Kopfzeile ein, ohne Bibliothek?",
                    reaktionen = mapOf("✅" to 1)),
                n("\$c1a", "!allgemein", BRIAN, "Brian", 94, CSV_ANTWORT, thread = "\$c1"),
                n("\$c1m", "!allgemein", ICH, "Vale", 91, "/model gpt-5.6-sol --provider openai-codex --session", thread = "\$c1"),
                n("\$c1n", "!allgemein", BRIAN, "Brian", 91, "✅ Model switched to gpt-5.6-sol (openai-codex) for this session.", thread = "\$c1"),
                n("\$c1b", "!allgemein", ICH, "Vale", 90, "Und wenn ein Feld ein Komma enthält?", thread = "\$c1",
                    reaktionen = mapOf("✅" to 1)),
                n("\$c1c", "!allgemein", BRIAN, "Brian", 89, KOMMA_ANTWORT, thread = "\$c1"),
                n("\$c3", "!allgemein", ICH, "Vale", 12, "Was ist das für eine Pflanze? Sie steht bei uns auf dem Balkon.",
                    reaktionen = mapOf("✅" to 1),
                    datei = Datei("balkon.jpg", BILD_MXC, "image/jpeg", 184_320, null, bild = true, breite = 1200, hoehe = 900)),
                n("\$c3a", "!allgemein", BRIAN, "Brian", 10, PFLANZE_ANTWORT, thread = "\$c3"),
                n("\$c2", "!allgemein", ICH, "Vale", 3, "Vergleiche die Stromtarife von EWZ und BKW für 4500 kWh im Jahr, mit Grundgebühr.",
                    reaktionen = mapOf("👀" to 1)),
                n("\$c2t", "!allgemein", BRIAN, "Brian", 2,
                    "🔍 web_search: \"EWZ Stromtarif 2026 Haushalt\"\n📄 web_extract: \"ewz.ch/de/privatkunden/strom/tarife\"\n🔍 web_search: \"BKW Stromtarif 2026 Grundgebühr\"",
                    thread = "\$c2"),
                n("\$c2w", "!allgemein", BRIAN, "Brian", 1, "⏳ Working — 2 min — web_search", thread = "\$c2"),
            ), anfangErreicht = true),
        )
            .mapValues { (_, v) -> v.copy(nachrichten = v.nachrichten.sortedBy { it.zeit }) }
        val freigaben = Lebenslauf.freigabenLesen(verlaeufe.getValue("!freigaben").nachrichten)
        val alarme = Lebenslauf.alarmeLesen(verlaeufe.getValue("!alarme").nachrichten)
        val hubstand = HubLeser.lesen(hubEvents(art, jetzt), HUB)
        val z = SchwarmZustand(
            verbindung = if (art.gestoert) Verbindung.FEHLER else Verbindung.BEREIT,
            fehler = if (art.gestoert) "Keine Antwort von zwaetschge-webui.ch (Zeitüberschreitung nach 15 s)" else null,
            ich = ich,
            raeume = raeume,
            beigetreten = raeume.alle,
            agenten = agenten,
            auftraege = auftraege,
            verlaeufe = verlaeufe,
            einladungen = emptyList(),
            freigaben = freigaben.eintraege,
            alarme = alarme.eintraege,
            nurLesen = mapOf("!freigaben" to freigaben.nurLesen, "!alarme" to alarme.nurLesen),
            zuletztSync = if (art.gestoert) vor(25) else jetzt,
            hub = hubstand,
            rolle = Rolle.bestimmen(ich, hubstand, lobbyBeigetreten = true, lobbyEingeladen = false),
            entscheidungen = Lebenslauf.entscheidungenLesen(verlaeufe, auftraege, jetzt),
            plumHinweise = Lebenslauf.plumHinweise(verlaeufe.getValue("!ag-plum").nachrichten, PLUM),
            ausSpeicher = if (art.gestoert) vor(25) else null,
        )
        return gelesenRechnen(z, lesestaende(z), jetzt)
    }

    /** Was in der Vorschau schon gelesen ist: Lobby, Alarme und zwei Arbeitsräume haben Neues, Allgemein eine Antwort. */
    fun lesestaende(z: SchwarmZustand): Map<String, Lesestand> = buildMap {
        mapOf(
            "!lobby" to "\$l1", "!alarme" to "\$a6", "!freigaben" to "\$f1", "!log" to "\$g1",
            "!ag-brian" to "\$k10", "!ag-claude-code" to "\$d14", "!ag-plum" to "\$k15", "!allgemein" to "\$c1c",
        ).forEach { (raum, id) ->
            z.verlauf(raum).nachrichten.firstOrNull { it.eventId == id }?.let { put(raum, Lesestand(raum = Beleg(id, it.zeit))) }
        }
    }

    /** Ungelesenes und die Chats von Allgemein aus den Lesestaenden der Vorschau; Brian tippt im Chat, der arbeitet. */
    fun gelesenRechnen(z: SchwarmZustand, lesestaende: Map<String, Lesestand>, jetzt: Long = System.currentTimeMillis()): SchwarmZustand {
        val ungelesen = ungelesenAlle(z.raeume, z.verlaeufe, lesestaende, z.ich)
        val raum = z.raeume.allgemein ?: return z.copy(ungelesen = ungelesen)
        val (chats, tippt) = AllgemeinLeser.lesen(raum, z.verlauf(raum).nachrichten, z.ich, BRIAN, setOf(BRIAN), lesestaende[raum], jetzt)
        return z.copy(
            ungelesen = ungelesen,
            allgemein = Allgemein(raum, AllgemeinStand.BEREIT, chats, tippt, 2, chats.sumOf { it.ungelesen }, anfangErreicht = true),
        )
    }

    /** Die State-Events des Hubs in der Lobby, als JSON wie vom Hub, gelesen mit [HubLeser]. */
    private fun hubEvents(art: VorschauArt, jetzt: Long): List<Ereignis> {
        fun vor(min: Int) = jetzt - min * 60_000L
        fun nach(min: Int) = jetzt + min * 60_000L
        fun e(typ: String, key: String, json: String) =
            Ereignis(typ, "\$s-$typ-$key", HUB, jetzt, SchwarmJson.parseToJsonElement(json).jsonObject, key)

        val einheiten = """
            { "v": 1, "agent": "plum", "at": ${vor(1) + 20_000}, "verbunden": true, "eintraege": [
              { "name": "matrix-app", "zustand": "wartet auf dich", "text": "Soll der Widget-Knopf auch den Not-Aus zeigen?",
                "link": "https://code.zwaetschge-webui.ch/session/a81f", "id": "a81f" },
              { "name": "voxtral", "zustand": "arbeitet", "text": "Stream prüfen",
                "link": "https://code.zwaetschge-webui.ch/session/9c2e", "id": "9c2e", "auftrag": "T-0015" },
              { "name": "hub-release", "zustand": "Fehler", "text": "Test-DB belegt: swarm_test_matrix",
                "link": "https://code.zwaetschge-webui.ch/session/77d0", "id": "77d0" },
              { "name": "autoren-buero", "zustand": "bereit", "text": "",
                "link": "https://code.zwaetschge-webui.ch/session/1b33", "id": "1b33" }
            ] }
        """
        val tuersteher = """
            { "v": 1, "aktualisiert": "${iso(vor(6))}", "veraltet": false, "gesperrt": 85, "neu_7_tage": 12, "vertraut": 12,
              "sperren": [
                { "ip": "203.0.113.7", "seit": "${iso(vor(35))}", "bis": "${iso(nach(24 * 60 - 35))}", "grund": "Scanner (.env, .git)", "rueckfall": false },
                { "ip": "198.51.100.23", "seit": "${iso(vor(140))}", "bis": "${iso(nach(7 * 24 * 60))}", "grund": "wp-login.php, 40 Versuche", "rueckfall": true },
                { "ip": "2001:db8:4f::17", "seit": "${iso(vor(300))}", "bis": "${iso(nach(20 * 60))}", "grund": "Scanner (/.aws/credentials)", "rueckfall": false },
                { "ip": "192.0.2.144", "seit": "${iso(vor(900))}", "bis": "${iso(nach(9 * 60))}", "grund": "Authelia: 12 Fehlversuche", "rueckfall": false },
                { "ip": "203.0.113.90", "seit": "${iso(vor(1500))}", "bis": "${iso(nach(60))}", "grund": "phpMyAdmin-Suche", "rueckfall": false }
              ] }
        """
        val kontingente = """
            { "v": 1, "at": ${vor(3)},
              "eintraege": [
                { "agent": "claude-code", "anbieter": "claude", "fenster": "5h", "prozent": 96, "zurueck": "${iso(nach(95))}", "stand": ${vor(3)} },
                { "agent": "codex-host", "anbieter": "codex", "fenster": "7d", "prozent": "41", "zurueck": null, "stand": ${vor(3)} },
                { "agent": "brian", "anbieter": "zai", "fenster": "5h", "prozent": 83, "zurueck": "${iso(nach(140))}", "stand": ${vor(9)} },
                { "agent": "plum", "anbieter": "claude", "fenster": "7d", "prozent": null, "zurueck": null, "stand": null }
              ],
              "umleitung": { "claude-code": "codex-host" } }
        """
        val routinenV = if (art.neuereVersion) 2 else 1
        val routinen = """
            { "v": $routinenV, "routinen": [
              { "name": "sicherheitswache", "zeitplan": "mo 06:10", "agent": "betrieb",
                "ziel": "Aussenprobe, Spuren, Router ohne Authelia, Secret-Rechte und Türsteher prüfen", "pausiert": false,
                "naechster": "${iso(nach(26 * 60))}", "letzter": { "auftrag": "T-0006", "zustand": "completed", "zeit": "${iso(vor(6 * 24 * 60))}" } },
              { "name": "backup", "zeitplan": "täglich 06:30", "agent": "betrieb",
                "ziel": "Prüfe, ob council-backup von heute vollständig ist", "pausiert": false,
                "naechster": "${iso(nach(9 * 60))}", "letzter": { "auftrag": "T-0010", "zustand": "working", "zeit": "${iso(vor(7))}" } },
              { "name": "abhaengigkeiten", "zeitplan": "mo,do 07:00", "agent": "claude-code",
                "ziel": "Veraltete Abhängigkeiten im Hub melden, mit Risiko", "pausiert": true,
                "naechster": null, "letzter": { "auftrag": "T-0008", "zustand": "failed", "zeit": "${iso(vor(3 * 24 * 60))}" },
                "fehler": "codex-host pausiert (3 Fehlschläge in Folge)" },
              { "name": "abendbericht", "zeitplan": "täglich 19:00", "agent": "brian",
                "ziel": "Kurzer Bericht: was der Schwarm heute erledigt hat", "pausiert": false,
                "naechster": "${iso(nach(3 * 60))}", "letzter": null }
            ] }
        """
        val notaus = """
            { "v": 1, "url": "https://schwarm.zwaetschge-webui.ch/notaus",
              "geraete": [
                { "id": "${NotAusSchluessel.geraetId() ?: GERAET}", "name": "Fold 8", "erstellt": "${iso(vor(3 * 24 * 60))}" },
                { "id": "91bc03e2aa47f0d5", "name": "iPlay60 mini", "erstellt": "${iso(vor(20 * 24 * 60))}" }
              ] }
        """
        val rollen = """
            { "v": 1, "rolle": "gast", "name": "Vanessa", "agenten": ["brian", "plum"],
              "befehle": ["auftrag", "stand", "board", "agenten", "budget", "hilfe"], "budget_usd_tag_cent": 200 }
        """
        // Stimmen beim Vorlesen (App 2.3): ein Ausschnitt aus Vocarium, beide Engines.
        val kikiri = listOf(
            "default-1" to "Default 1", "fallback-de-jonas" to "Jonas", "fallback-de-fabian" to "Fabian",
            "fallback-de-johanna" to "Johanna", "fallback-de-konrad" to "Konrad", "fallback-de-eva" to "Eva",
            "fallback-de-nele" to "Nele", "fallback-de-bernhard" to "Bernhard", "fallback-de-tobias" to "Tobias",
            "fallback-de-thorsten-whisper" to "Thorsten · Flüsternd",
        ).joinToString(",") { (id, name) -> """{ "id": "$id", "name": "$name", "sprache": "German", "engine": "kikiri" }""" }
        val omnivoice = listOf("Marc-Uwe-Kling", "Rufus-Beck", "David-Nathan", "Maurice-Moss", "Dragonball-Erzaehler")
            .joinToString(",") { id -> """{ "id": "$id", "name": "$id", "sprache": "Auto", "engine": "omnivoice" }""" }
        val stimmen = """{ "v": 1, "stimmen": [ $kikiri, $omnivoice ],
            "hub": "fallback-de-eva", "hub_standard": "fallback-de-eva", "standard": "default-1" }"""
        // Modelle je Agent (App 2.2), wie sie der Hub aus seinem Katalog meldet; codex-host mit einer Änderung.
        val claude = """[ { "id": "fable", "name": "Claude Fable 5.1" }, { "id": "opus", "name": "Claude Opus 5.5" },
            { "id": "sonnet", "name": "Claude Sonnet 5" }, { "id": "haiku", "name": "Claude Haiku 4.5" } ]"""
        val gpt = """[ { "id": "gpt-5.6-sol", "name": "GPT-5.6-Sol" }, { "id": "gpt-5.6-terra", "name": "GPT-5.6-Terra" },
            { "id": "gpt-5.6-luna", "name": "GPT-5.6-Luna" }, { "id": "gpt-5.5", "name": "GPT-5.5" }, { "id": "gpt-5.4", "name": "GPT-5.4" },
            { "id": "gpt-5.4-mini", "name": "GPT-5.4-Mini" }, { "id": "gpt-5.3-codex-spark", "name": "GPT-5.3-Codex-Spark" } ]"""
        val plumModelle = """[ { "id": "claude:standard", "name": "Claude (Plum-Standard)", "anbieter": "claude" },
            { "id": "claude:fable", "name": "Claude Fable 5.1", "anbieter": "claude" }, { "id": "claude:opus", "name": "Claude Opus 5.5", "anbieter": "claude" },
            { "id": "claude:sonnet", "name": "Claude Sonnet 5", "anbieter": "claude" }, { "id": "codex:gpt-5.6-sol", "name": "Codex GPT-5.6-Sol", "anbieter": "codex" },
            { "id": "codex:gpt-5.5", "name": "Codex GPT-5.5", "anbieter": "codex" }, { "id": "zai:glm-5.3", "name": "GLM-5.3 (Z.AI)", "anbieter": "zai" } ]"""
        val modelle = mapOf(
            "brian" to """{ "v": 1, "agent": "brian", "stimme": "fallback-de-jonas", "stimme_standard": "fallback-de-jonas", "art": "hermes", "einstellbar": true,
                "modell": "mistral/glm-5.3", "fallback": ["glm-5.3", "glm-5.3-flash", "local/qwen-flash"], "aufwand": null,
                "standard": { "modell": "mistral/glm-5.3", "fallback": ["glm-5.3", "glm-5.3-flash", "local/qwen-flash"], "aufwand": null },
                "modelle": [ { "id": "mistral/glm-5.3", "name": "GLM-5.3 (Mistral-API)", "anbieter": "litellm" },
                             { "id": "glm-5.3", "name": "GLM-5.3 (Z.AI Coding-Plan)", "anbieter": "zai-coding" },
                             { "id": "glm-5.3-flash", "name": "GLM-5.3-Flash (Z.AI Coding-Plan)", "anbieter": "zai-coding" },
                             { "id": "local/qwen-flash", "name": "Qwen Flash Next (lokal)", "anbieter": "litellm" } ],
                "aufwaende": [], "fallback_aenderbar": false, "fallback_max": 3, "wirkt": "sofort",
                "hinweis": "Global nur innerhalb von Z.AI, andere Anbieter pro Chat in Allgemein. Die Ersatzkette steht in Brians config.yaml und lässt sich hier nur ansehen.",
                "nur_chat": [ { "id": "ds/v4-pro", "name": "DeepSeek · v4-pro (LiteLLM)", "anbieter": "litellm" },
                  { "id": "gem/3.1-pro", "name": "Gemini · 3.1-pro (LiteLLM)", "anbieter": "litellm" },
                  { "id": "gpt-5.6-sol", "name": "GPT-5.6-Sol (ChatGPT-Abo)", "anbieter": "openai-codex" },
                              { "id": "gpt-5.5", "name": "GPT-5.5 (ChatGPT-Abo)", "anbieter": "openai-codex" } ],
                "geaendert_von": null, "geaendert_am": null, "bestaetigung": "Model switched to glm-5.3 (global)." }""",
            "claude-code" to """{ "v": 1, "agent": "claude-code", "stimme": "fallback-de-fabian", "stimme_standard": "fallback-de-fabian", "art": "claude", "einstellbar": true,
                "modell": "sonnet", "fallback": [], "aufwand": null,
                "standard": { "modell": "sonnet", "fallback": [], "aufwand": null },
                "modelle": $claude, "aufwaende": ["low", "medium", "high", "xhigh", "max"],
                "fallback_aenderbar": true, "fallback_max": 1, "wirkt": "naechster-auftrag",
                "hinweis": "Gilt ab dem nächsten Auftrag. Claude Code nimmt genau ein Ersatzmodell.", "nur_chat": [],
                "geaendert_von": null, "geaendert_am": null, "bestaetigung": null }""",
            "codex-host" to """{ "v": 1, "agent": "codex-host", "stimme": "fallback-de-johanna", "stimme_standard": "fallback-de-johanna", "art": "codex", "einstellbar": true,
                "modell": "gpt-5.5", "fallback": ["gpt-5.4", "gpt-5.4-mini"], "aufwand": "low",
                "standard": { "modell": "gpt-5.5", "fallback": [], "aufwand": "low" },
                "modelle": $gpt, "aufwaende": ["low", "medium", "high", "xhigh"],
                "fallback_aenderbar": true, "fallback_max": 3, "wirkt": "naechster-auftrag",
                "hinweis": "Gilt ab dem nächsten Auftrag. Scheitert ein Lauf ohne Ausgabe, versucht der Worker das nächste Ersatzmodell.",
                "nur_chat": [], "geaendert_von": "$ICH", "geaendert_am": ${jetzt - 2 * 3_600_000L}, "bestaetigung": null }""",
            "plum" to """{ "v": 1, "agent": "plum", "stimme": "fallback-de-konrad", "stimme_standard": "fallback-de-konrad", "art": "plum", "einstellbar": true,
                "modell": "claude:standard", "fallback": [], "aufwand": null,
                "standard": { "modell": "claude:standard", "fallback": [], "aufwand": null },
                "modelle": $plumModelle, "aufwaende": ["low", "medium", "high", "xhigh"],
                "fallback_aenderbar": true, "fallback_max": 2, "wirkt": "neue-sitzung",
                "hinweis": "Gilt für neue Sitzungen, laufende behalten ihr Modell.", "nur_chat": [],
                "geaendert_von": null, "geaendert_am": null, "bestaetigung": null }""",
            "hermes-phone" to """{ "v": 1, "agent": "hermes-phone", "stimme": "fallback-de-nele", "stimme_standard": "fallback-de-nele", "art": "extern", "einstellbar": false,
                "modell": null, "fallback": [], "aufwand": null, "standard": null, "modelle": [], "aufwaende": [],
                "fallback_aenderbar": false, "fallback_max": 3, "wirkt": null,
                "hinweis": "Hermes auf dem Phone. Sein Modell stellt die Phone-Session ein.", "nur_chat": [],
                "geaendert_von": null, "geaendert_am": null, "bestaetigung": null }""",
            "autoupdater" to """{ "v": 1, "agent": "autoupdater", "stimme": "fallback-de-tobias", "stimme_standard": "fallback-de-tobias", "art": "keins", "einstellbar": false,
                "modell": null, "fallback": [], "aufwand": null, "standard": null, "modelle": [], "aufwaende": [],
                "fallback_aenderbar": false, "fallback_max": 3, "wirkt": null, "hinweis": "Ohne einstellbares Sprachmodell.", "nur_chat": [],
                "geaendert_von": null, "geaendert_am": null, "bestaetigung": null }""",
            "betrieb" to """{ "v": 1, "agent": "betrieb", "stimme": "fallback-de-bernhard", "stimme_standard": "fallback-de-bernhard", "art": "keins", "einstellbar": false,
                "modell": null, "fallback": [], "aufwand": null, "standard": null, "modelle": [], "aufwaende": [],
                "fallback_aenderbar": false, "fallback_max": 3, "wirkt": null, "hinweis": "Ohne einstellbares Sprachmodell.", "nur_chat": [],
                "geaendert_von": null, "geaendert_am": null, "bestaetigung": null }""",
        )
        return listOf(
            e(SCHWARM_EINHEITEN, "plum", einheiten),
            e(SCHWARM_TUERSTEHER, "", tuersteher),
            e(SCHWARM_KONTINGENTE, "", kontingente),
            e(SCHWARM_ROUTINEN, "", routinen),
            e(SCHWARM_NOTAUS, "", notaus),
            e(SCHWARM_KENNZAHLEN, "woche", kennzahlen("woche", 7, jetzt)),
            e(SCHWARM_KENNZAHLEN, "monat", kennzahlen("monat", 30, jetzt)),
            e(SCHWARM_ROLLEN, GAST, rollen),
        ) + modelle.map { (agent, json) -> e(SCHWARM_MODELLE, agent, json) } + e(SCHWARM_STIMMEN, "", stimmen) +
            e(SCHWARM_RELEASE, "", """{ "v": 1, "strasse": true, "tag": "rel-20260927-193638z", "basis": "e933f1e8a1b2", "zusatz": 5,
                "von": "matrix-70", "suiten": 25, "gruen": 25, "pruefungen": 714, "seit": ${jetzt - 42 * 60_000} }""") +
            e(SCHWARM_TAGESBERICHT, "", """{ "v": 1, "tag": "${java.time.LocalDate.now()}", "erstellt": ${jetzt - 25 * 60_000},
                "auftraege": 12, "ok": 9, "fehler": 1, "abbruch": 1, "offen": 5, "warten": 3, "kosten_cent": 247, "budget_cent": 1500,
                "alarme_offen": 2, "abo": [{ "agent": "claude-code", "pct": 96 }, { "agent": "brian", "pct": 83 }] }""") +
            e(SCHWARM_APP, "", """{ "v": 1, "version_code": 999, "version_name": "3.0.0",
                "mxc": "mxc://zwaetschge-webui.ch/VorschauApk", "groesse": 21500000,
                "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                "notizen": "Neu: Updates kommen über den Server, Rückfragen lassen sich aus der Benachrichtigung beantworten.",
                "zeit": ${jetzt - 90 * 60_000} }""") +
            e(SCHWARM_RUHE, "", """{ "v": 1, "an": true, "von": "22:00", "bis": "07:00", "zone": "Europe/Zurich" }""") +
            e(SCHWARM_LITELLM, "", """{ "v": 1, "erreichbar": true, "ausgaben_cent": 312, "budget_cent": 4000, "zeitraum": "30d",
                "zurueck": ${jetzt + 3 * 86_400_000L}, "stand": ${jetzt - 2 * 60_000},
                "modelle": [ { "id": "mistral/glm-5.3", "anbieter": "Mistral" }, { "id": "ds/v4-flash", "anbieter": "DeepSeek" }, { "id": "ds/v4-flash-vision", "anbieter": "DeepSeek" },
                  { "id": "ds/v4-pro", "anbieter": "DeepSeek" }, { "id": "gem/3.1-pro", "anbieter": "Gemini" },
                  { "id": "kimi/coding", "anbieter": "Kimi" }, { "id": "local/qwen-flash", "anbieter": "Lokal" } ] }""")
    }

    /** Glaubwürdige Zahlen, jedes Mal gleich: ein einfacher Zufall mit festem Startwert. */
    private fun kennzahlen(zeitraum: String, tage: Int, jetzt: Long): String {
        var saat = if (tage == 7) 42L else 4242L
        fun zufall(bis: Int): Int {
            saat = (saat * 1_103_515_245L + 12_345L) and 0x7fffffffL
            return (saat % bis).toInt()
        }
        val heute = LocalDate.now()
        val tageJson = (tage - 1 downTo 0).joinToString(",\n") { vorTagen ->
            val tag = heute.minusDays(vorTagen.toLong())
            val wochenende = tag.dayOfWeek.value >= 6
            val auftraege = if (wochenende) 3 + zufall(5) else 8 + zufall(10)
            val fehler = zufall(3)
            val abbruch = if (zufall(4) == 0) 1 else 0
            val offen = if (vorTagen == 0) 2 else 0
            val ok = (auftraege - fehler - abbruch - offen).coerceAtLeast(0)
            val cent = auftraege * (3 + zufall(5))
            """{ "tag": "$tag", "auftraege": $auftraege, "ok": $ok, "fehler": $fehler, "abbruch": $abbruch, "kosten_cent": $cent, "alarme": ${zufall(6)} }"""
        }
        val f = if (tage == 7) 1 else 4
        return """
            { "v": 1, "zeitraum": "$zeitraum", "von": "${heute.minusDays((tage - 1).toLong())}", "bis": "$heute", "erstellt": ${jetzt - 600_000},
              "tage": [ $tageJson ],
              "agenten": [
                { "agent": "brian", "auftraege": ${20 * f}, "ok": ${18 * f}, "quote_pct": 90, "dauer_median_s": 120, "kosten_cent": ${120 * f}, "budget_tag_cent": 300, "plus": ${3 * f}, "minus": 0, "pause_bis": null },
                { "agent": "claude-code", "auftraege": ${14 * f}, "ok": ${11 * f}, "quote_pct": 79, "dauer_median_s": 610, "kosten_cent": ${460 * f}, "budget_tag_cent": 100, "plus": ${4 * f}, "minus": 1, "pause_bis": null },
                { "agent": "codex-host", "auftraege": ${9 * f}, "ok": ${5 * f}, "quote_pct": "56", "dauer_median_s": 380, "kosten_cent": 0, "budget_tag_cent": null, "plus": 1, "minus": ${2 * f}, "pause_bis": "${iso(jetzt + 40 * 60_000L)}" },
                { "agent": "betrieb", "auftraege": ${11 * f}, "ok": ${11 * f}, "quote_pct": 100, "dauer_median_s": 25, "kosten_cent": 0, "budget_tag_cent": null, "plus": 0, "minus": 0, "pause_bis": null },
                { "agent": "plum", "auftraege": ${6 * f}, "ok": ${5 * f}, "quote_pct": 83, "dauer_median_s": 900, "kosten_cent": ${90 * f}, "budget_tag_cent": 200, "plus": ${2 * f}, "minus": 0, "pause_bis": null }
              ],
              "freigaben": { "anzahl": ${4 * f}, "median_s": 300 },
              "alarme": { "anzahl": ${12 * f}, "quittiert": ${8 * f}, "median_quittung_s": 600 } }
        """
    }

    /** Vorlagen zum Ausprobieren; sie leben nur in der Vorschau und werden nicht gespeichert. */
    fun vorlagen(): List<Vorlage> = listOf(
        Vorlage("v-neustart", "Container neu starten", "betrieb",
            "Starte den Container {container} neu und prüfe danach den Healthcheck.", budgetMin = 10, favorit = true),
        Vorlage("v-backup", "Backup prüfen", "claude-code",
            "Prüfe, ob das Backup von heute Nacht vollständig ist, und nenne Auffälligkeiten.",
            budgetUsd = 0.5, budgetMin = 20, frist = "heute 18:00", favorit = true),
        Vorlage("v-uebersetzen", "Übersetzen", "brian", "Übersetze ins Englische: {text}", favorit = true),
        Vorlage("v-voxtral", "Voxtral: Stand", "plum/voxtral", "Fasse zusammen, woran du gerade arbeitest.", favorit = true),
        Vorlage("v-release", "Release-Notes", "brian",
            "Fasse die Release-Notes von {projekt} {version} in drei Punkten zusammen.", budgetUsd = 0.3),
    )

    /** Der Patch von T-0014 im Beispiel, wie ihn `git format-patch` schreibt. */
    val PATCH = """
From 3f1c2a9d5e Mon Sep 17 00:00:00 2001
From: Claude Code <claude-code@schwarm>
Subject: [PATCH] Medien-Retention: abgelaufene Anhänge täglich löschen

T-0014: Anhänge in swarm.artifacts bekommen ein Ablaufdatum; die Wartung
löscht abgelaufene Dateien täglich um 03:00. Patches bleiben 90 Tage.
---
 packages/matrix/migrations/0021_artefakt_ablauf.sql |  8 ++++++
 packages/matrix/src/wartung.ts                      | 22 +++++++++++-----
 packages/matrix/test/wartung.mjs                    | 13 ++++++---
 3 files changed, 34 insertions(+), 9 deletions(-)

diff --git a/packages/matrix/migrations/0021_artefakt_ablauf.sql b/packages/matrix/migrations/0021_artefakt_ablauf.sql
new file mode 100644
index 0000000..8c1d2e4
--- /dev/null
+++ b/packages/matrix/migrations/0021_artefakt_ablauf.sql
@@ -0,0 +1,8 @@
+-- Anhänge laufen ab: Standard 30 Tage, Patches 90 Tage.
+ALTER TABLE swarm.artifacts
+  ADD COLUMN ablauf timestamptz;
+
+UPDATE swarm.artifacts
+   SET ablauf = created_at + interval '30 days'
+ WHERE ablauf IS NULL;
+CREATE INDEX artifacts_ablauf ON swarm.artifacts (ablauf);
diff --git a/packages/matrix/src/wartung.ts b/packages/matrix/src/wartung.ts
index 5b7e0a1..c2d9f37 100644
--- a/packages/matrix/src/wartung.ts
+++ b/packages/matrix/src/wartung.ts
@@ -12,14 +12,24 @@ import { audit } from './db/audit.js'
 const TAG_MS = 24 * 3600_000
-const AUFBEWAHREN_TAGE = Number(process.env.MEDIEN_TAGE || 30)
+const STANDARD_TAGE = Number(process.env.MEDIEN_TAGE || 30)
+const PATCH_TAGE = Number(process.env.PATCH_TAGE || 90)
 
-export async function medienAufraeumen(ctx: Ctx): Promise<number> {
-  const grenze = new Date(Date.now() - AUFBEWAHREN_TAGE * TAG_MS)
-  const alt = await sql`SELECT id, mxc FROM swarm.artifacts WHERE created_at < ${'$'}{grenze}`
+/** Abgelaufene Anhänge löschen: zuerst das m.file redigieren, dann die Datei im Media-Store. */
+export async function medienAufraeumen(ctx: Ctx, jetzt = new Date()): Promise<number> {
+  const alt = await sql`
+    SELECT id, mxc, name FROM swarm.artifacts
+     WHERE COALESCE(ablauf, created_at + ${'$'}{STANDARD_TAGE} * interval '1 day') < ${'$'}{jetzt}`
   let geloescht = 0
   for (const a of alt) {
-    await ctx.matrix.deleteMedia(a.mxc)
-    geloescht++
+    const tage = a.name.endsWith('.patch') ? PATCH_TAGE : STANDARD_TAGE
+    if (tage <= 0) continue
+    try {
+      await ctx.matrix.deleteMedia(a.mxc)
+      await sql`DELETE FROM swarm.artifacts WHERE id = ${'$'}{a.id}`
+      geloescht++
+    } catch (err) {
+      ctx.log.warn({ err, id: a.id }, 'Anhang nicht gelöscht')
+    }
   }
   await audit(ctx.hub, 'medien.aufraeumen', null, { geloescht })
   return geloescht
 }
diff --git a/packages/matrix/test/wartung.mjs b/packages/matrix/test/wartung.mjs
index 0d4be21..9a61f0c 100644
--- a/packages/matrix/test/wartung.mjs
+++ b/packages/matrix/test/wartung.mjs
@@ -40,5 +40,12 @@ test('medienAufraeumen löscht alte Anhänge', async () => {
   const ctx = testCtx()
-  await anhang(ctx, { alter: 31 })
-  await anhang(ctx, { alter: 2 })
-  assert.equal(await medienAufraeumen(ctx), 1)
+  await anhang(ctx, { alter: 31, name: 'bericht.md' })
+  await anhang(ctx, { alter: 31, name: 'T-0001.patch' })
+  await anhang(ctx, { alter: 2, name: 'neu.md' })
+  assert.equal(await medienAufraeumen(ctx), 1, 'nur der alte Bericht')
 })
+
+test('ein Patch bleibt 90 Tage', async () => {
+  const ctx = testCtx()
+  await anhang(ctx, { alter: 91, name: 'T-0002.patch' })
+  assert.equal(await medienAufraeumen(ctx), 1)
+})
-- 
2.43.0
""".trimStart('\n')
}
