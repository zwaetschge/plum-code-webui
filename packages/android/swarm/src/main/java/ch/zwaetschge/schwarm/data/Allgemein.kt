package com.claudewebui.swarm.data

/**
 * „Allgemein“ (SCHNITTSTELLEN-app.md, App 2.1): ein DM zwischen Vale und Brian, der ChatGPT im Web
 * ersetzt. Ein Chat ist ein Thread: Jede Nachricht von Vale auf oberster Ebene beginnt einen, Brian
 * (Hermes mit `MATRIX_DM_AUTO_THREAD=true`) antwortet darin. Werkzeugzeilen und „⏳ Working“ sind
 * Status, keine Antwort. Nur Text, kein Netz: Die Vorschau liest mit denselben Funktionen.
 */

/** Wo die App den Raum merkt: Account-Daten mit `{ "room_id": "!…" }`. */
const val KONTO_ALLGEMEIN = "ch.zwaetschge.schwarm.allgemein"

/** Eigene Titel, Angeheftet und Archiv je Chat (App 2.7), in den Account-Daten: übersteht jede Neuinstallation. */
const val KONTO_CHATS = "ch.zwaetschge.schwarm.chats"

data class ChatEinstellung(val titel: String? = null, val angeheftet: Boolean = false, val archiviert: Boolean = false) {
    val leer: Boolean get() = titel == null && !angeheftet && !archiviert
}

/** Ein Treffer der Suche über alle Chats (Matrix-Suche von Synapse), auch in Chats, die nicht geladen sind. */
data class ChatTreffer(val wurzel: String, val eventId: String, val text: String, val zeit: Long, val vonMir: Boolean)
const val BRIAN_LOKAL = "brian"

enum class AllgemeinStand {
    /** Noch kein Sync: Ob es den Raum gibt, ist offen. */
    UNBEKANNT,
    /** Keine Account-Daten: Die App legt den Raum an. */
    FEHLT,
    WIRD_ANGELEGT,
    /** Brian ist eingeladen, aber noch nicht beigetreten: Die Eingabe wartet. */
    WARTET_AUF_BRIAN,
    BEREIT,
    /** Mehr als zwei Mitglieder: Für Hermes kein DM mehr, Brian schweigt. */
    ZU_VIELE,
    /** Die Account-Daten nennen einen Raum, in dem Vale nicht (mehr) ist. */
    NICHT_ERREICHBAR,
}

enum class ChatZustand(val titel: String) {
    GESENDET("gesendet"),
    ARBEITET("arbeitet"),
    FERTIG("fertig"),
    FEHLER("Fehler"),
    GESTOPPT("gestoppt"),
    OFFEN(""),
}

enum class ChatArt {
    /** Von Vale. */
    FRAGE,
    /** Brians Antwort, Markdown. */
    ANTWORT,
    /** Werkzeugzeile, „⏳ Working“, „⚡ Stopped“: klein und eingeklappt. */
    STATUS,
    /** Ein Befehl an Brian, etwa `/model … --session` (App 2.2): eine kleine Zeile, keine Frage. */
    BEFEHL,
}

data class ChatNachricht(val n: Nachricht, val art: ChatArt)

data class Chat(
    val raumId: String,
    /** Das Event, mit dem der Chat begann: die Thread-Wurzel. */
    val wurzel: String,
    val titel: String,
    val start: Long,
    val zuletzt: Long,
    /** Erste Zeile der letzten Antwort (oder der letzten Nachricht). */
    val vorschau: String?,
    val zustand: ChatZustand,
    val ungelesen: Int,
    val nachrichten: List<ChatNachricht>,
    /** Das letzte Event im Thread: Darauf zeigt `m.in_reply_to` der nächsten Nachricht. */
    val letztesEvent: String,
    /** Bis wann der Chat gelesen ist (Trenner „Neu“). */
    val gelesenBis: Long,
)

data class Allgemein(
    val raumId: String? = null,
    val stand: AllgemeinStand = AllgemeinStand.UNBEKANNT,
    /** Neueste zuerst. */
    val chats: List<Chat> = emptyList(),
    val brianTippt: Boolean = false,
    val mitglieder: Int? = null,
    val ungelesen: Int = 0,
    /** Weiter zurück gibt es nichts mehr zu laden. */
    val anfangErreicht: Boolean = true,
    /** Titel, Angeheftet und Archiv je Chat-Wurzel (App 2.7). */
    val einstellungen: Map<String, ChatEinstellung> = emptyMap(),
) {
    fun chat(wurzel: String?): Chat? = chats.firstOrNull { it.wurzel == wurzel }

    /** Der Titel, den du vergeben hast, sonst der aus der ersten Nachricht. */
    fun titel(c: Chat): String = einstellungen[c.wurzel]?.titel ?: c.titel
    val bereit: Boolean get() = stand == AllgemeinStand.BEREIT
}

object AllgemeinLeser {
    /**
     * Eine Werkzeugzeile von Hermes: `{emoji} {werkzeug}...` oder `{emoji} {werkzeug}: "…"`. Mit
     * `tool_progress_grouping: accumulate` stehen mehrere solche Zeilen in einer bearbeiteten Nachricht.
     */
    private val werkzeugZeile = Regex("""^[^\p{L}\p{N}\s]{1,12}\s+[^"\n]{1,48}?(?:\s*\.\.\.|…|:\s*".*)\s*$""")
    private val markdownZeichen = Regex("""^[#>*\-+\s]+|[*_`~]""")

    /** Status statt Antwort: Werkzeugzeilen, „⏳ Working“, „⚡ Stopped“, „⏩ Steer queued“. */
    fun istStatus(n: Nachricht): Boolean = n.datei == null && istStatusText(n.text)

    /** Dasselbe am blossen Text, für die Benachrichtigung im Hintergrund. */
    fun istStatusText(text: String): Boolean {
        val zeilen = text.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val erste = zeilen.firstOrNull() ?: return false
        if (erste.startsWith("⏳") || erste.startsWith("⚡") || erste.startsWith("⏩")) return true
        return zeilen.all { werkzeugZeile.matches(it) }
    }

    fun istGestoppt(n: Nachricht): Boolean = n.text.trimStart().startsWith("⚡ Stopped")

    /** Beginnt eine Nachricht mit `/`, ist sie ein Befehl an Brian (SCHNITTSTELLEN-app.md, App 2.2). */
    fun istBefehl(n: Nachricht): Boolean = n.datei == null && n.text.trimStart().startsWith("/")

    /**
     * Brians erste Nachricht nach einem Befehl von dir, im selben Thread: die Bestätigung, etwa des
     * Modellwechsels. Sie zählt als Statuszeile, nicht als Antwort und nicht als ungelesen.
     */
    fun befehlsAntworten(nachrichten: List<Nachricht>, ich: String): Set<String> {
        val aus = HashSet<String>()
        nachrichten.groupBy { it.threadWurzel ?: it.eventId }.values.forEach { liste ->
            var wartet = false
            liste.sortedBy { it.zeit }.forEach { n ->
                when {
                    n.absender == ich -> wartet = istBefehl(n)
                    wartet -> {
                        aus += n.eventId
                        wartet = false
                    }
                }
            }
        }
        return aus
    }

    /** Die erste Zeile, ohne Markdown-Zeichen, höchstens 60 Zeichen. */
    fun titel(n: Nachricht): String {
        val d = n.datei
        // Nur ein Anhang ohne eigenen Text: die Art statt des Dateinamens (Sprachnachricht, Bild …).
        if (d != null && !d.bild && (n.text == d.name || !n.text.any(Char::isWhitespace))) return kuerzen(anhangKurz(d))
        return titelText(n.text, d?.bild == true)
    }

    private fun kuerzen(s: String) = if (s.length <= 60) s else s.take(59).trimEnd() + "…"

    /** „🎤 Sprachnachricht“, „🖼 Bild“, „🎬 name“, „🎵 name“, „📎 name“. */
    fun anhangKurz(d: Datei): String = when {
        d.sprache -> "🎤 Sprachnachricht"
        d.bild -> "🖼 Bild"
        d.video -> "🎬 ${d.name}"
        d.audio -> "🎵 ${d.name}"
        else -> "📎 ${d.name}"
    }

    fun titelText(body: String, bild: Boolean): String {
        // Hermes liest einen body mit Leerzeichen als Bildunterschrift; sonst ist es nur der Dateiname.
        val text = if (bild) body.takeIf { it.any(Char::isWhitespace) } ?: "Bild" else body
        val zeile = text.lineSequence().map { it.replace(markdownZeichen, "").trim() }.firstOrNull { it.isNotEmpty() } ?: "(leer)"
        return if (zeile.length <= 60) zeile else zeile.take(59).trimEnd() + "…"
    }

    fun ersteZeile(n: Nachricht): String {
        val d = n.datei
        return if (d != null && (n.text == d.name || !n.text.any(Char::isWhitespace))) anhangKurz(d) else titel(n)
    }

    /**
     * Chats aus dem Verlauf von Allgemein. `tippen`: wer gerade tippt (m.typing). Zustand des Chats aus
     * Brians Reaktionen auf Vales letzte Nachricht: 👀 arbeitet, ✅ fertig, ❌ Fehler; „⚡ Stopped“ danach
     * heisst gestoppt (das 👀 bleibt dann stehen).
     */
    fun lesen(
        raumId: String,
        nachrichten: List<Nachricht>,
        ich: String,
        brian: String,
        tippen: Set<String>,
        stand: Lesestand?,
        jetzt: Long,
    ): Pair<List<Chat>, Boolean> {
        val s = stand ?: Lesestand()
        val befehlsAntworten = befehlsAntworten(nachrichten, ich)
        fun antwort(n: Nachricht) = n.absender != ich && !istStatus(n) && n.eventId !in befehlsAntworten
        // Befehlschats (Wurzel mit „/“) gehören nicht in die Chatliste.
        val wurzeln = nachrichten.filter { it.threadWurzel == null && !(it.absender == ich && istBefehl(it)) }
        val imThread = nachrichten.filter { it.threadWurzel != null }.groupBy { it.threadWurzel }
        val brianTippt = brian in tippen
        val chats = wurzeln.map { w ->
            val alle = (listOf(w) + imThread[w.eventId].orEmpty()).sortedBy { it.zeit }
            val teile = alle.map { n ->
                ChatNachricht(
                    n,
                    when {
                        n.absender == ich && istBefehl(n) -> ChatArt.BEFEHL
                        n.absender == ich -> ChatArt.FRAGE
                        istStatus(n) || n.eventId in befehlsAntworten -> ChatArt.STATUS
                        else -> ChatArt.ANTWORT
                    },
                )
            }
            val letzteFrage = alle.lastOrNull { it.absender == ich && !istBefehl(it) }
            val nachFrage = alle.filter { letzteFrage == null || it.zeit >= letzteFrage.zeit }
            val r = letzteFrage?.reaktionen?.keys?.map(Lebenslauf::zeichen)?.toSet().orEmpty()
            val antwortDanach = nachFrage.any { antwort(it) }
            val gestoppt = nachFrage.any { it.absender != ich && istGestoppt(it) }
            val zustand = when {
                letzteFrage == null -> ChatZustand.FERTIG
                "❌" in r -> ChatZustand.FEHLER
                "✅" in r -> ChatZustand.FERTIG
                gestoppt -> ChatZustand.GESTOPPT
                "👀" in r -> ChatZustand.ARBEITET
                antwortDanach -> ChatZustand.FERTIG
                jetzt - letzteFrage.zeit < 10 * 60_000L -> ChatZustand.GESENDET
                else -> ChatZustand.OFFEN
            }
            val bis = maxOf(s.threadBis(w.eventId), alle.filter { it.absender == ich }.maxOfOrNull { it.zeit } ?: 0)
            val letzteAntwort = alle.lastOrNull { antwort(it) }
            Chat(
                raumId = raumId,
                wurzel = w.eventId,
                titel = titel(w),
                start = w.zeit,
                zuletzt = alle.maxOf { it.zeit },
                vorschau = (letzteAntwort ?: alle.lastOrNull { !istStatus(it) && !istBefehl(it) })?.let(::ersteZeile),
                zustand = zustand,
                ungelesen = alle.count { antwort(it) && it.zeit > bis },
                nachrichten = teile,
                letztesEvent = alle.last().eventId,
                gelesenBis = bis,
            )
        }.toMutableList()
        // Brian tippt: Das gehört zum Chat, der arbeitet, sonst zum jüngsten, der auf ihn wartet.
        if (brianTippt) {
            val i = chats.indexOfFirst { it.zustand == ChatZustand.ARBEITET }.takeIf { it >= 0 }
                ?: chats.indices.filter { chats[it].zustand == ChatZustand.GESENDET }.maxByOrNull { chats[it].zuletzt }
            if (i != null) chats[i] = chats[i].copy(zustand = ChatZustand.ARBEITET)
        }
        return chats.sortedByDescending { it.zuletzt } to brianTippt
    }

    /** Was in Allgemein als ungelesen zählt: Brians Antworten, keine Werkzeugzeilen und keine Bestätigungen. */
    fun zaehlt(n: Nachricht): Boolean = !istStatus(n)
}
