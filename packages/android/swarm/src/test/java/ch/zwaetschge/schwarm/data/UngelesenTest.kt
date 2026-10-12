package com.claudewebui.swarm.data

import com.claudewebui.swarm.MIN
import com.claudewebui.swarm.VALE
import com.claudewebui.swarm.nachricht
import org.junit.Assert.assertEquals
import org.junit.Test

/** Ungelesenes rechnet die App selbst (App 2.1): nach Vales Lesebestätigung, je Thread, ohne eigene. */
class UngelesenTest {

    private val brian = "@brian:example.ch"

    @Test
    fun `Lesebestaetigung, eigene Nachricht und Threads getrennt`() {
        val n = listOf(
            nachricht("\$1", "alt", zeit = 1 * MIN, von = brian, notice = false),
            nachricht("\$2", "neu", zeit = 3 * MIN, von = brian, notice = false),
            nachricht("\$3", "ich schreibe", zeit = 4 * MIN, von = VALE, notice = false),
            nachricht("\$4", "danach", zeit = 5 * MIN, von = brian, notice = false),
            nachricht("\$t1", "im Thread", zeit = 6 * MIN, von = brian, notice = false, thread = "\$1"),
            nachricht("\$t2", "noch einer", zeit = 7 * MIN, von = brian, notice = false, thread = "\$1"),
        )
        val u = UngelesenRechner.berechnen(n, Lesestand(raum = Beleg("\$1", 2 * MIN)), VALE)
        // $2 ist durch deine eigene Nachricht gelesen; $4 und die zwei im Thread nicht.
        assertEquals(3, u.anzahl)
        assertEquals(listOf("\$t2", "\$t1", "\$4"), u.neueste.map { it.eventId })
        assertEquals(mapOf("\$1" to 2, "\$4" to 1), u.threads)
        assertEquals(4 * MIN, u.gelesenBis)

        val threadGelesen = Lesestand(raum = Beleg("\$1", 2 * MIN)).mit("\$1", Beleg("\$t2", 7 * MIN))
        assertEquals(1, UngelesenRechner.berechnen(n, threadGelesen, VALE).anzahl)
    }

    @Test
    fun `Ein aelterer Beleg ueberschreibt keinen neueren`() {
        val s = Lesestand().mit(null, Beleg("\$b", 5 * MIN)).mit(null, Beleg("\$a", 2 * MIN))
        assertEquals("\$b", s.raum!!.eventId)
    }

    @Test
    fun `In Allgemein zaehlen Werkzeugzeilen und Befehlsbestaetigungen nicht`() {
        val raeume = Raeume(allgemein = "!allgemein")
        val n = listOf(
            nachricht("\$f", "Wie wird das Wetter?", zeit = 1 * MIN, raum = "!allgemein", von = VALE, notice = false),
            nachricht("\$w", "🔍 web_search: \"Wetter Zürich\"", zeit = 2 * MIN, raum = "!allgemein", von = brian, notice = false, thread = "\$f"),
            nachricht("\$a", "Morgen regnet es ab 15 Uhr.", zeit = 3 * MIN, raum = "!allgemein", von = brian, notice = false, thread = "\$f"),
            nachricht("\$m", "/model gpt-5 --session", zeit = 4 * MIN, raum = "!allgemein", von = VALE, notice = false, thread = "\$f"),
            nachricht("\$ok", "✅ Model switched to gpt-5.", zeit = 5 * MIN, raum = "!allgemein", von = brian, notice = false, thread = "\$f"),
        )
        val u = ungelesenAlle(raeume, mapOf("!allgemein" to Verlauf(n)), emptyMap(), VALE).getValue("!allgemein")
        // Deine /model-Nachricht liest den Thread bis 4 min, die Bestätigung danach zählt nicht: nichts ungelesen.
        assertEquals(0, u.anzahl)

        val ohneBefehl = n.filter { it.eventId !in setOf("\$m", "\$ok") }
        val v = ungelesenAlle(raeume, mapOf("!allgemein" to Verlauf(ohneBefehl)), emptyMap(), VALE).getValue("!allgemein")
        assertEquals("nur die Antwort, nicht die Werkzeugzeile", listOf("\$a"), v.neueste.map { it.eventId })
    }
}
