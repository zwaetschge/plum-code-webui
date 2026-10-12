package com.claudewebui.swarm.data

/**
 * Ungelesenes rechnet die App selbst aus (SCHNITTSTELLEN-app.md, App 2.1): Synapses
 * `unread_notifications` taugt nicht, weil die Notices der Bots keine Benachrichtigung auslösen.
 * Gezählt werden Nachrichten anderer nach Vales Lesebestätigung, ohne Bearbeitungen, Reaktionen,
 * Schwärzungen und State; die fallen schon beim Lesen des Verlaufs weg. Nur Text, kein Netz.
 */

/** Bis wohin gelesen ist: das Event und seine Zeit (die Zeit der Bestätigung, wenn das Event fehlt). */
data class Beleg(val eventId: String, val ts: Long)

/** Vales Lesestand in einem Raum. */
data class Lesestand(
    /** `m.read` ohne Thread: gilt für den ganzen Raum bis zu diesem Event. */
    val raum: Beleg? = null,
    /** `m.read` mit `thread_id: main`: nur die Hauptzeitleiste. */
    val haupt: Beleg? = null,
    /** `m.read` je Thread-Wurzel. */
    val threads: Map<String, Beleg> = emptyMap(),
    /** `m.fully_read` aus den Raum-Account-Daten. */
    val vollGelesen: Beleg? = null,
) {
    /** Bis wann die Hauptzeitleiste (ohne Thread) gelesen ist. */
    fun hauptBis(): Long = maxOf(raum?.ts ?: 0, vollGelesen?.ts ?: 0, haupt?.ts ?: 0)

    /** Bis wann ein Thread gelesen ist; eine Bestätigung ohne Thread gilt auch für ihn. */
    fun threadBis(wurzel: String): Long = maxOf(raum?.ts ?: 0, vollGelesen?.ts ?: 0, threads[wurzel]?.ts ?: 0)

    /** Ein neuer Beleg, nur wenn er weiter reicht als der bisherige. */
    fun mit(thread: String?, beleg: Beleg): Lesestand = when (thread) {
        null -> if ((raum?.ts ?: 0) <= beleg.ts) copy(raum = beleg) else this
        "main" -> if ((haupt?.ts ?: 0) <= beleg.ts) copy(haupt = beleg) else this
        else -> if ((threads[thread]?.ts ?: 0) <= beleg.ts) copy(threads = threads + (thread to beleg)) else this
    }
}

/** Ungelesenes eines Raums. */
data class Ungelesen(
    val anzahl: Int = 0,
    /** Die ungelesenen Nachrichten, neueste zuerst, höchstens [UNGELESEN_LISTE]. */
    val neueste: List<Nachricht> = emptyList(),
    /** Bis wann der Raum als Ganzes gelesen ist: Hier steht der Trenner „Neu“. */
    val gelesenBis: Long = 0,
    /** Je Thread-Wurzel die Zahl, für die Chats in Allgemein. */
    val threads: Map<String, Int> = emptyMap(),
)

const val UNGELESEN_LISTE = 20

object UngelesenRechner {
    /**
     * `zaehlt` entscheidet, welche Nachrichten überhaupt zählen (in Allgemein etwa keine Werkzeugzeilen).
     * Eine eigene Nachricht gilt als gelesen bis zu ihr: Wer schreibt, hat gesehen, was davor kam.
     */
    fun berechnen(
        nachrichten: List<Nachricht>,
        stand: Lesestand?,
        ich: String,
        zaehlt: (Nachricht) -> Boolean = { true },
    ): Ungelesen {
        val s = stand ?: Lesestand()
        // Die letzte eigene Nachricht je Thread (null = Hauptzeitleiste) und im ganzen Raum.
        val eigeneJeThread = HashMap<String?, Long>()
        var eigeneRaum = 0L
        for (n in nachrichten) {
            if (n.absender != ich) continue
            eigeneJeThread.merge(n.threadWurzel, n.zeit) { a, b -> maxOf(a, b) }
            eigeneRaum = maxOf(eigeneRaum, n.zeit)
        }
        val ungelesen = ArrayList<Nachricht>()
        val threads = HashMap<String, Int>()
        for (n in nachrichten) {
            if (n.absender == ich || !zaehlt(n)) continue
            val bis = maxOf(
                if (n.threadWurzel == null) s.hauptBis() else s.threadBis(n.threadWurzel),
                eigeneJeThread[n.threadWurzel] ?: 0,
            )
            if (n.zeit <= bis) continue
            ungelesen += n
            val wurzel = n.threadWurzel ?: n.eventId
            threads.merge(wurzel, 1, Int::plus)
        }
        ungelesen.sortByDescending { it.zeit }
        return Ungelesen(
            anzahl = ungelesen.size,
            neueste = ungelesen.take(UNGELESEN_LISTE),
            gelesenBis = maxOf(s.hauptBis(), eigeneRaum),
            threads = threads,
        )
    }
}

/** Ungelesenes aller Räume ausser dem Space; in Allgemein zählen Werkzeugzeilen nicht. */
fun ungelesenAlle(
    raeume: Raeume,
    verlaeufe: Map<String, Verlauf>,
    lesestaende: Map<String, Lesestand>,
    ich: String,
): Map<String, Ungelesen> = raeume.alle.filter { it != raeume.space }.associateWith { raum ->
    val nachrichten = verlaeufe[raum]?.nachrichten.orEmpty()
    val zaehlt: (Nachricht) -> Boolean
    if (raum == raeume.allgemein) {
        // Bestätigungen von Befehlen (etwa `/model`) zählen so wenig wie Werkzeugzeilen.
        val befehle = AllgemeinLeser.befehlsAntworten(nachrichten, ich)
        zaehlt = { n -> AllgemeinLeser.zaehlt(n) && n.eventId !in befehle }
    } else {
        zaehlt = { true }
    }
    UngelesenRechner.berechnen(nachrichten, lesestaende[raum], ich, zaehlt)
}
